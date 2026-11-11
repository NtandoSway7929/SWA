-- Yoco client payments: refund-aware invoice integrity
-- Target branch: feature/yoco-client-payments
-- REVIEW-ONLY. Do not run against production.
-- Requires: 202611110001_yoco_payment_foundation.sql
-- No provider API calls, live credentials, or live payment activation.
--
-- This migration coordinates the existing invoice/payment calculation paths:
--   * admin invoice balance recalculation
--   * invoice BEFORE INSERT/UPDATE synchronisation
--   * payment overpayment guard
--   * refund-triggered recalculation
--   * private-token client portal invoice balances
--
-- It does not implement checkout settlement or refund creation. Those require
-- separate locked, idempotent private operations.

begin;

create schema if not exists innerme_private;
revoke all on schema innerme_private from public, anon;

-- ---------------------------------------------------------------------------
-- 1. One authoritative invoice net-paid calculation.
-- ---------------------------------------------------------------------------

create or replace function innerme_private.swayphics_invoice_net_paid(
    p_invoice_id uuid
)
returns numeric(12,2)
language sql
stable
security definer
set search_path = ''
as $$
    select greatest(
        coalesce((
            select sum(p.amount)
            from public.payments p
            where p.invoice_id = p_invoice_id
              and p.status in ('paid', 'partially paid')
        ), 0)
        -
        coalesce((
            select sum(r.amount)
            from public.payment_refunds r
            join public.payments rp
              on rp.id = r.payment_id
            where rp.invoice_id = p_invoice_id
              and r.status = 'succeeded'
        ), 0),
        0
    )::numeric(12,2);
$$;

revoke all on function innerme_private.swayphics_invoice_net_paid(uuid)
    from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Replace the admin-facing invoice balance recalculation function.
-- ---------------------------------------------------------------------------

create or replace function public.recalculate_swayphics_invoice_balance(
    p_invoice_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_total numeric(12,2);
    v_paid numeric(12,2);
    v_outstanding numeric(12,2);
    v_due_date date;
    v_status text;
    v_today date := (now() at time zone 'Africa/Johannesburg')::date;
begin
    select i.total, i.due_date, i.status
    into v_total, v_due_date, v_status
    from public.invoices i
    where i.id = p_invoice_id;

    if not found then
        return;
    end if;

    v_paid := innerme_private.swayphics_invoice_net_paid(p_invoice_id);
    v_paid := greatest(
        0,
        least(coalesce(v_paid, 0), greatest(coalesce(v_total, 0), 0))
    );
    v_outstanding := greatest(coalesce(v_total, 0) - v_paid, 0);

    update public.invoices i
    set amount_paid = v_paid,
        amount_outstanding = v_outstanding,
        status = case
            when v_status = 'cancelled' then 'cancelled'
            when coalesce(v_total, 0) > 0
                 and v_paid >= coalesce(v_total, 0) then 'paid'
            when v_status = 'draft' and v_paid <= 0 then 'draft'
            when v_due_date is not null
                 and v_due_date < v_today
                 and v_outstanding > 0 then 'overdue'
            when v_paid > 0 then 'partially paid'
            else 'sent'
        end,
        updated_at = now()
    where i.id = p_invoice_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Replace invoice BEFORE INSERT/UPDATE balance derivation.
--    Keep draft/cancelled semantics and Johannesburg due-date handling.
-- ---------------------------------------------------------------------------

create or replace function public.sync_swayphics_invoice_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_paid numeric(12,2);
    v_total numeric(12,2);
    v_outstanding numeric(12,2);
    v_today date := (now() at time zone 'Africa/Johannesburg')::date;
begin
    if tg_op = 'INSERT' then
        new.amount_paid := 0;
        new.amount_outstanding := greatest(coalesce(new.total, 0), 0);
        new.status := case
            when new.status = 'cancelled' then 'cancelled'
            when new.status = 'draft' then 'draft'
            when new.due_date is not null
                 and new.due_date < v_today
                 and coalesce(new.total, 0) > 0 then 'overdue'
            else 'sent'
        end;
        return new;
    end if;

    if new.total is distinct from old.total
       or new.due_date is distinct from old.due_date
       or new.project_id is distinct from old.project_id
       or new.status is distinct from old.status
       or new.amount_paid is distinct from old.amount_paid
       or new.amount_outstanding is distinct from old.amount_outstanding
    then
        v_paid := innerme_private.swayphics_invoice_net_paid(new.id);
        v_total := greatest(coalesce(new.total, 0), 0);
        v_paid := greatest(0, least(coalesce(v_paid, 0), v_total));
        v_outstanding := greatest(v_total - v_paid, 0);

        new.amount_paid := v_paid;
        new.amount_outstanding := v_outstanding;
        new.status := case
            when new.status = 'cancelled' then 'cancelled'
            when v_total > 0 and v_paid >= v_total then 'paid'
            when new.status = 'draft' and v_paid <= 0 then 'draft'
            when new.due_date is not null
                 and new.due_date < v_today
                 and v_outstanding > 0 then 'overdue'
            when v_paid > 0 then 'partially paid'
            else 'sent'
        end;
    end if;

    return new;
end;
$$;

-- Existing trigger trg_sync_swayphics_invoice_before_change remains attached
-- to this replaced function. No duplicate trigger is created.

-- ---------------------------------------------------------------------------
-- 4. Make the payment integrity guard refund-aware.
--    Invoice row lock remains the serialization point for payment creation.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_swayphics_payment_invoice_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_invoice_client_id uuid;
    v_invoice_project_id uuid;
    v_invoice_total numeric(12,2);
    v_invoice_status text;
    v_existing_paid numeric(12,2);
    v_successful_refunds numeric(12,2);
    v_available_balance numeric(12,2);
begin
    if new.invoice_id is null then
        if tg_op = 'INSERT' then
            raise exception 'Payments must reference a specific invoice number.';
        end if;
        return new;
    end if;

    select i.client_id, i.project_id, i.total, i.status
    into v_invoice_client_id, v_invoice_project_id, v_invoice_total, v_invoice_status
    from public.invoices i
    where i.id = new.invoice_id
    for update;

    if not found then
        raise exception 'The selected invoice does not exist.';
    end if;

    if v_invoice_status = 'cancelled' then
        raise exception 'Cancelled invoices cannot receive payments.';
    end if;

    if tg_op = 'UPDATE'
       and old.invoice_id is distinct from new.invoice_id then
        raise exception 'The invoice attached to an existing payment cannot be changed.';
    end if;

    if new.amount is null or new.amount <= 0 then
        raise exception 'Payment amount must be greater than R0.';
    end if;

    select
        coalesce(sum(
            case
                when p.status in ('paid', 'partially paid') then p.amount
                else 0
            end
        ), 0),
        coalesce((
            select sum(r.amount)
            from public.payment_refunds r
            join public.payments rp on rp.id = r.payment_id
            where rp.invoice_id = new.invoice_id
              and rp.id is distinct from new.id
              and r.status = 'succeeded'
        ), 0)
    into v_existing_paid, v_successful_refunds
    from public.payments p
    where p.invoice_id = new.invoice_id
      and p.id is distinct from new.id;

    v_existing_paid := greatest(
        coalesce(v_existing_paid, 0) - coalesce(v_successful_refunds, 0),
        0
    );

    v_available_balance := greatest(
        coalesce(v_invoice_total, 0) - v_existing_paid,
        0
    );

    if new.amount > v_available_balance then
        raise exception
            'Payment exceeds the available invoice balance of R%.2f.',
            v_available_balance;
    end if;

    -- Relationship fields and settled status remain invoice-authoritative.
    new.client_id := v_invoice_client_id;
    new.project_id := v_invoice_project_id;
    new.status := 'paid';

    return new;
end;
$$;

-- Existing BEFORE INSERT/UPDATE trigger remains attached to the replaced
-- function. Its authenticated execute grant is preserved by CREATE OR REPLACE.

-- ---------------------------------------------------------------------------
-- 5. Recalculate invoice and project state whenever a refund changes.
--    Pending/failed refunds do not reduce net paid; only succeeded refunds do.
-- ---------------------------------------------------------------------------

create or replace function public.sync_swayphics_refund_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_new_invoice_id uuid;
    v_old_invoice_id uuid;
begin
    if tg_op <> 'DELETE' then
        select p.invoice_id
        into v_new_invoice_id
        from public.payments p
        where p.id = new.payment_id;

        if v_new_invoice_id is not null then
            perform public.recalculate_swayphics_invoice_balance(v_new_invoice_id);
        end if;
    end if;

    if tg_op <> 'INSERT' then
        select p.invoice_id
        into v_old_invoice_id
        from public.payments p
        where p.id = old.payment_id;

        if v_old_invoice_id is not null
           and v_old_invoice_id is distinct from v_new_invoice_id then
            perform public.recalculate_swayphics_invoice_balance(v_old_invoice_id);
        end if;
    end if;

    if tg_op = 'DELETE' then
        return old;
    end if;

    return new;
end;
$$;

drop trigger if exists trg_sync_swayphics_refund_after_change
    on public.payment_refunds;

create trigger trg_sync_swayphics_refund_after_change
after insert or update or delete on public.payment_refunds
for each row
execute function public.sync_swayphics_refund_after_change();

revoke all on function public.sync_swayphics_refund_after_change()
    from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Replace the private-token portal RPC without changing its authentication
--    model or unrelated project/quote/payment response fields.
-- ---------------------------------------------------------------------------

create or replace function public.get_client_portal(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_token public.client_portal_tokens%rowtype;
    v_result jsonb;
begin
    if p_token is null or length(trim(p_token)) < 32 then
        return jsonb_build_object(
            'ok', false,
            'error', 'Invalid portal link.'
        );
    end if;

    select *
    into v_token
    from public.client_portal_tokens
    where token_hash = encode(
        extensions.digest(trim(p_token), 'sha256'),
        'hex'
    )
      and active = true
      and (expires_at is null or expires_at > now())
    order by created_at desc
    limit 1;

    if not found then
        return jsonb_build_object(
            'ok', false,
            'error', 'This portal link is invalid or has expired.'
        );
    end if;

    update public.client_portal_tokens
    set last_used_at = now()
    where id = v_token.id;

    select jsonb_build_object(
        'ok', true,
        'client', jsonb_build_object(
            'id', c.id,
            'business_name', c.business_name,
            'contact_name', c.contact_name,
            'email', c.email,
            'phone', c.phone,
            'status', c.status
        ),
        'projects', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id', p.id,
                    'name', p.name,
                    'service', p.service,
                    'description', p.description,
                    'status', p.status,
                    'value', p.value,
                    'due_date', p.due_date,
                    'payment_status', p.payment_status
                )
                order by p.created_at desc
            )
            from public.client_projects p
            where p.client_id = c.id
        ), '[]'::jsonb),
        'quotes', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id', q.id,
                    'quote_number', q.quote_number,
                    'title', q.title,
                    'amount', q.amount,
                    'status', q.status,
                    'valid_until', q.valid_until,
                    'notes', q.notes
                )
                order by q.created_at desc
            )
            from public.quotes q
            where q.client_id = c.id
              and q.status <> 'rejected'
        ), '[]'::jsonb),
        'invoices', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id', i.id,
                    'invoice_number', i.invoice_number,
                    'issue_date', i.issue_date,
                    'due_date', i.due_date,
                    'status', i.status,
                    'currency', i.currency,
                    'total', i.total,
                    'amount_paid', least(
                        innerme_private.swayphics_invoice_net_paid(i.id),
                        greatest(coalesce(i.total, 0), 0)
                    ),
                    'amount_outstanding', greatest(
                        coalesce(i.total, 0) -
                        least(
                            innerme_private.swayphics_invoice_net_paid(i.id),
                            greatest(coalesce(i.total, 0), 0)
                        ),
                        0
                    ),
                    'notes', i.notes
                )
                order by i.created_at desc
            )
            from public.invoices i
            where i.client_id = c.id
              and i.status <> 'cancelled'
        ), '[]'::jsonb),
        'payments', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id', pp.id,
                    'amount', pp.amount,
                    'method', pp.method,
                    'reference', pp.reference,
                    'paid_at', pp.paid_at
                )
                order by pp.paid_at desc nulls last, pp.created_at desc
            )
            from public.payments pp
            where pp.client_id = c.id
              and pp.status = 'paid'
        ), '[]'::jsonb)
    )
    into v_result
    from public.clients c
    where c.id = v_token.client_id;

    if v_result is null then
        return jsonb_build_object(
            'ok', false,
            'error', 'This client record is no longer available.'
        );
    end if;

    return v_result;
end;
$$;

revoke all on function public.get_client_portal(text) from public;
grant execute on function public.get_client_portal(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Reconcile existing stored invoice balances once, using the new shared
--    calculation. This also refreshes project payment status via existing
--    invoice triggers. It is intentionally part of the migration transaction.
-- ---------------------------------------------------------------------------

do $$
declare
    v_invoice_id uuid;
begin
    for v_invoice_id in
        select i.id
        from public.invoices i
    loop
        perform public.recalculate_swayphics_invoice_balance(v_invoice_id);
    end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;

-- Explicitly deferred:
--   * refund amount validation and immutable refund recording RPC
--   * atomic Yoco checkout settlement
--   * webhook event verification/processing
--   * receipt issuance and client portal receipt presentation
--   * client portal Pay Online interface
--   * admin reconciliation interface
--   * all test/live provider configuration
