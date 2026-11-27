-- Owner-controlled marking and permanent deletion of explicitly classified test payments.
-- Production payments, provider attempts, refunds, transfer evidence and reconciliation history remain protected.

begin;

alter table public.payments
  add column if not exists is_test boolean not null default false;

comment on column public.payments.is_test is
  'Owner-classified test-only payment. Test payments are excluded from revenue reporting and may be permanently purged through the guarded admin RPC.';

create or replace function innerme_private.swayphics_invoice_net_paid(p_invoice_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $function$
    select greatest(
        coalesce((
            select sum(p.amount)
            from public.payments p
            where p.invoice_id = p_invoice_id
              and p.status in ('paid', 'partially paid')
              and p.is_test is false
        ), 0)
        -
        coalesce((
            select sum(r.amount)
            from public.payment_refunds r
            join public.payments rp on rp.id = r.payment_id
            where rp.invoice_id = p_invoice_id
              and rp.is_test is false
              and r.status = 'succeeded'
        ), 0),
        0
    )::numeric(12,2);
$function$;

create or replace function public.enforce_swayphics_payment_invoice_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_invoice_client_id uuid;
    v_invoice_project_id uuid;
    v_invoice_total numeric(12,2);
    v_invoice_status text;
    v_existing_paid numeric(12,2);
    v_successful_refunds numeric(12,2);
    v_available_balance numeric(12,2);
begin
    -- The only permitted metadata-only update is the owner RPC marking an
    -- existing manual payment as test data. No financial field may change.
    if tg_op = 'UPDATE'
       and old.is_test is distinct from new.is_test
       and current_setting('innerme_private.allow_mark_payment_test', true) = 'on'
       and coalesce(public.is_swayphics_owner(), false)
       and old.is_test is false
       and new.is_test is true
       and old.id is not distinct from new.id
       and old.client_id is not distinct from new.client_id
       and old.project_id is not distinct from new.project_id
       and old.amount is not distinct from new.amount
       and old.status is not distinct from new.status
       and old.method is not distinct from new.method
       and old.reference is not distinct from new.reference
       and old.due_date is not distinct from new.due_date
       and old.paid_at is not distinct from new.paid_at
       and old.notes is not distinct from new.notes
       and old.invoice_id is not distinct from new.invoice_id
       and old.provider is not distinct from new.provider
       and old.provider_transaction_id is not distinct from new.provider_transaction_id
       and old.provider_checkout_id is not distinct from new.provider_checkout_id
       and old.currency is not distinct from new.currency then
        return new;
    end if;

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
                when p.status in ('paid', 'partially paid') and p.is_test is false then p.amount
                else 0
            end
        ), 0),
        coalesce((
            select sum(r.amount)
            from public.payment_refunds r
            join public.payments rp on rp.id = r.payment_id
            where rp.invoice_id = new.invoice_id
              and rp.id is distinct from new.id
              and rp.is_test is false
              and r.status = 'succeeded'
        ), 0)
    into v_existing_paid, v_successful_refunds
    from public.payments p
    where p.invoice_id = new.invoice_id
      and p.id is distinct from new.id
      and p.is_test is false;

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

    new.client_id := v_invoice_client_id;
    new.project_id := v_invoice_project_id;
    new.status := 'paid';

    return new;
end;
$function$;

create or replace function innerme_private.guard_yoco_financial_ledger()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
    if tg_table_name = 'payments' then
        if tg_op = 'UPDATE' and old.is_test is distinct from new.is_test then
            if current_setting('innerme_private.allow_mark_payment_test', true) = 'on'
               and coalesce(public.is_swayphics_owner(), false)
               and old.is_test is false
               and new.is_test is true then
                return new;
            end if;
            raise exception 'Test classification can only be changed through the owner-authorized payment workflow.'
                using errcode = '55000';
        end if;

        if tg_op = 'DELETE' then
            if current_setting('innerme_private.allow_archived_invoice_purge', true) = 'on'
               and coalesce(public.is_swayphics_owner(), false) then
                return old;
            end if;

            if current_setting('innerme_private.allow_test_payment_purge', true) = 'on'
               and coalesce(public.is_swayphics_owner(), false)
               and old.is_test is true then
                return old;
            end if;

            if old.provider = 'yoco' then
                raise exception 'Yoco payment ledger entries are immutable.'
                    using errcode = '55000';
            end if;

            raise exception 'Payments must be deleted through an authorized test-payment or archived-invoice purge workflow.'
                using errcode = '55000';
        end if;

        return new;
    end if;

    if tg_table_name = 'payment_refunds' then
        if tg_op = 'DELETE' then
            if old.provider = 'yoco' and old.status = 'succeeded' then
                raise exception 'Successful Yoco refund ledger entries are immutable.'
                    using errcode = '55000';
            end if;
            return old;
        end if;

        if (old.provider = 'yoco' and old.status = 'succeeded')
           or (new.provider = 'yoco' and new.status = 'succeeded') then
            raise exception 'Yoco payment refund ledger entries are immutable.'
                using errcode = '55000';
        end if;
        return new;
    end if;

    if tg_table_name = 'payment_receipts' then
        if tg_op = 'DELETE'
           and current_setting('innerme_private.allow_archived_invoice_purge', true) = 'on'
           and coalesce(public.is_swayphics_owner(), false) then
            return old;
        end if;

        if tg_op = 'DELETE'
           and current_setting('innerme_private.allow_test_payment_purge', true) = 'on'
           and coalesce(public.is_swayphics_owner(), false)
           and exists (
               select 1 from public.payments p
               where p.id = old.payment_id and p.is_test is true
           ) then
            return old;
        end if;

        raise exception 'Issued payment receipts are immutable outside an authorized test-data or archived-invoice purge.'
            using errcode = '55000';
    end if;

    raise exception 'Unsupported financial ledger trigger target.';
end;
$function$;

revoke all on function innerme_private.guard_yoco_financial_ledger()
  from public, anon, authenticated, service_role;

create or replace function innerme_private.mark_payment_as_test(p_payment_id uuid, p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_payment public.payments%rowtype;
    v_previous_setting text;
begin
    if auth.uid() is null or not coalesce(public.is_swayphics_owner(), false) then
        raise exception 'Owner access is required.' using errcode = '42501';
    end if;

    select * into v_payment
    from public.payments
    where id = p_payment_id
    for update;

    if not found then
        raise exception 'The selected payment no longer exists.';
    end if;

    if v_payment.is_test then
        raise exception 'This payment is already classified as test data.';
    end if;

    if v_payment.provider is not null then
        raise exception 'Provider-linked payments cannot be reclassified or deleted as manual test data.';
    end if;

    if p_confirmation is distinct from 'TEST PAYMENT ' || p_payment_id::text then
        raise exception 'The test-payment confirmation does not match.';
    end if;

    if exists (select 1 from public.payment_attempts where payment_id = p_payment_id or invoice_id = v_payment.invoice_id)
       or exists (select 1 from public.payment_refunds where payment_id = p_payment_id)
       or exists (select 1 from public.bank_transfer_submissions where payment_id = p_payment_id or invoice_id = v_payment.invoice_id)
       or exists (select 1 from public.payment_reconciliation where payment_id = p_payment_id)
       or exists (select 1 from public.payment_reconciliation_actions where related_payment_id = p_payment_id) then
        raise exception 'This payment has provider, refund, transfer-proof or reconciliation history and cannot be marked as disposable test data.';
    end if;

    v_previous_setting := current_setting('innerme_private.allow_mark_payment_test', true);
    perform set_config('innerme_private.allow_mark_payment_test', 'on', true);

    update public.payments set is_test = true where id = p_payment_id;

    perform set_config('innerme_private.allow_mark_payment_test', coalesce(v_previous_setting, 'off'), true);

    return jsonb_build_object('marked_as_test', true, 'payment_id', p_payment_id);
end;
$function$;

create or replace function public.admin_mark_payment_as_test(p_payment_id uuid, p_confirmation text)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
    select innerme_private.mark_payment_as_test(p_payment_id, p_confirmation);
$function$;

create or replace function innerme_private.purge_test_payment(p_payment_id uuid, p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_payment public.payments%rowtype;
    v_receipt_ids uuid[] := array[]::uuid[];
    v_deleted_receipts integer := 0;
    v_previous_setting text;
begin
    if auth.uid() is null or not coalesce(public.is_swayphics_owner(), false) then
        raise exception 'Owner access is required.' using errcode = '42501';
    end if;

    select * into v_payment
    from public.payments
    where id = p_payment_id
    for update;

    if not found then
        raise exception 'The selected payment no longer exists.';
    end if;

    if v_payment.is_test is not true then
        raise exception 'Only payments explicitly classified as test data can be permanently deleted.';
    end if;

    if v_payment.provider is not null then
        raise exception 'Provider-linked payments cannot be deleted through the test-payment workflow.';
    end if;

    if p_confirmation is distinct from 'DELETE TEST PAYMENT ' || p_payment_id::text then
        raise exception 'The test-payment deletion confirmation does not match.';
    end if;

    if exists (select 1 from public.payment_attempts where payment_id = p_payment_id or invoice_id = v_payment.invoice_id)
       or exists (select 1 from public.payment_refunds where payment_id = p_payment_id)
       or exists (select 1 from public.bank_transfer_submissions where payment_id = p_payment_id or invoice_id = v_payment.invoice_id)
       or exists (select 1 from public.payment_reconciliation where payment_id = p_payment_id)
       or exists (select 1 from public.payment_reconciliation_actions where related_payment_id = p_payment_id) then
        raise exception 'Protected provider, refund, transfer-proof or reconciliation records prevent deletion.';
    end if;

    perform 1
      from public.payment_receipts
     where payment_id = p_payment_id
     for update;

    select coalesce(array_agg(id), array[]::uuid[])
      into v_receipt_ids
      from public.payment_receipts
     where payment_id = p_payment_id;

    if exists (
        select 1
        from public.payment_receipt_deliveries d
        where d.receipt_id = any(v_receipt_ids)
          and d.pdf_storage_path is not null
    ) then
        raise exception 'A receipt PDF is stored for this payment. Remove it through the receipt storage workflow before deleting the test payment.';
    end if;

    v_previous_setting := current_setting('innerme_private.allow_test_payment_purge', true);
    perform set_config('innerme_private.allow_test_payment_purge', 'on', true);

    delete from public.payment_receipts
     where id = any(v_receipt_ids);
    get diagnostics v_deleted_receipts = row_count;

    delete from public.payments
     where id = p_payment_id;

    if not found then
        raise exception 'The test payment was not deleted.';
    end if;

    perform set_config('innerme_private.allow_test_payment_purge', coalesce(v_previous_setting, 'off'), true);

    return jsonb_build_object(
        'deleted', true,
        'payment_id', p_payment_id,
        'receipts_deleted', v_deleted_receipts
    );
end;
$function$;

create or replace function public.admin_permanently_delete_test_payment(p_payment_id uuid, p_confirmation text)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
    select innerme_private.purge_test_payment(p_payment_id, p_confirmation);
$function$;

revoke all on function innerme_private.mark_payment_as_test(uuid,text) from public, anon;
revoke all on function innerme_private.purge_test_payment(uuid,text) from public, anon;
revoke all on function public.admin_mark_payment_as_test(uuid,text) from public, anon;
revoke all on function public.admin_permanently_delete_test_payment(uuid,text) from public, anon;

grant execute on function innerme_private.mark_payment_as_test(uuid,text) to authenticated;
grant execute on function innerme_private.purge_test_payment(uuid,text) to authenticated;
grant execute on function public.admin_mark_payment_as_test(uuid,text) to authenticated;
grant execute on function public.admin_permanently_delete_test_payment(uuid,text) to authenticated;

commit;
