-- Owner-only cleanup for a verified Yoco TEST payment.
-- The provider attempt and webhook event remain as immutable audit evidence.
-- The receipt and its delivery metadata are copied into a private audit table
-- before deletion. This function must never be used for Paystack/live or manual
-- payments, bank-transfer submissions, refunds, or reconciliation records.

begin;

create table if not exists innerme_private.yoco_test_payment_cleanup_audit (
    id uuid primary key default gen_random_uuid(),
    original_payment_id uuid not null,
    invoice_id uuid not null,
    payment_attempt_id uuid not null,
    receipt_number text not null,
    actor_user_id uuid not null,
    reason text not null,
    confirmation text not null,
    payment_snapshot jsonb not null,
    attempt_snapshot jsonb not null,
    receipt_snapshot jsonb not null,
    webhook_event_snapshots jsonb not null default '[]'::jsonb,
    receipt_delivery_snapshot jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint yoco_test_payment_cleanup_reason_nonempty
        check (length(btrim(reason)) >= 10),
    constraint yoco_test_payment_cleanup_confirmation_nonempty
        check (length(btrim(confirmation)) > 0)
);

revoke all on table innerme_private.yoco_test_payment_cleanup_audit
    from public, anon, authenticated, service_role;

comment on table innerme_private.yoco_test_payment_cleanup_audit is
    'Append-only private snapshots of explicitly owner-approved Yoco test-payment cleanup operations.';

create or replace function innerme_private.prevent_yoco_test_payment_cleanup_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
    raise exception 'Yoco test-payment cleanup audit records are immutable.'
        using errcode = '55000';
end;
$function$;

revoke all on function innerme_private.prevent_yoco_test_payment_cleanup_audit_mutation()
    from public, anon, authenticated, service_role;

drop trigger if exists trg_prevent_yoco_test_payment_cleanup_audit_mutation
    on innerme_private.yoco_test_payment_cleanup_audit;
create trigger trg_prevent_yoco_test_payment_cleanup_audit_mutation
before update or delete on innerme_private.yoco_test_payment_cleanup_audit
for each row
execute function innerme_private.prevent_yoco_test_payment_cleanup_audit_mutation();

-- Add a second, narrowly scoped exception to the existing immutable-ledger
-- guard. The archived-invoice purge path is left unchanged.
create or replace function innerme_private.guard_yoco_financial_ledger()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
    if tg_op = 'DELETE'
       and coalesce(public.is_swayphics_owner(), false)
       and (
            current_setting('innerme_private.allow_archived_invoice_purge', true) = 'on'
            or (
                current_setting('innerme_private.allow_yoco_test_payment_cleanup', true) = 'on'
                and tg_table_name in ('payments', 'payment_receipts')
            )
       ) then
        return old;
    end if;

    if tg_table_name = 'payments' then
        if tg_op = 'DELETE' then
            if old.provider = 'yoco' then
                raise exception 'Yoco payment ledger entries are immutable.'
                    using errcode = '55000';
            end if;
            return old;
        end if;

        if old.provider = 'yoco' or new.provider = 'yoco' then
            raise exception 'Yoco payment ledger entries are immutable.'
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
            raise exception 'Successful Yoco refund ledger entries are immutable.'
                using errcode = '55000';
        end if;
        return new;
    end if;

    if tg_table_name = 'payment_receipts' then
        raise exception 'Issued payment receipts are immutable.'
            using errcode = '55000';
    end if;

    raise exception 'Unsupported Yoco ledger trigger target.';
end;
$function$;

revoke all on function innerme_private.guard_yoco_financial_ledger()
    from public, anon, authenticated, service_role;

create or replace function public.admin_cleanup_yoco_test_payment(
    p_payment_id uuid,
    p_confirmation text,
    p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_payment public.payments%rowtype;
    v_attempt public.payment_attempts%rowtype;
    v_invoice public.invoices%rowtype;
    v_receipt public.payment_receipts%rowtype;
    v_audit_id uuid;
    v_expected_confirmation text;
    v_reason text := btrim(coalesce(p_reason, ''));
    v_receipt_delivery_snapshot jsonb;
    v_webhook_event_snapshots jsonb;
begin
    if auth.uid() is null
       or not coalesce(public.is_swayphics_owner(), false) then
        raise exception 'Active Swayphics owner access is required.'
            using errcode = '42501';
    end if;

    if p_payment_id is null then
        raise exception 'Select a payment to clean up.';
    end if;

    if length(v_reason) < 10 or length(v_reason) > 500 then
        raise exception 'Provide a cleanup reason between 10 and 500 characters.';
    end if;

    -- Acquire locks in the same parent-first order as archived-invoice purge
    -- and refund recording: invoice, payment, attempt, then webhook events.
    -- This avoids lock inversion with those financial workflows.
    select p.* into v_payment
      from public.payments p
     where p.id = p_payment_id;

    if not found then
        raise exception 'The selected payment no longer exists.';
    end if;

    if v_payment.provider is distinct from 'yoco' then
        raise exception 'Only Yoco test-mode payments are eligible. Paystack and manual payments are protected.';
    end if;

    if v_payment.invoice_id is null then
        raise exception 'The payment is not linked to an invoice.';
    end if;

    select i.* into v_invoice
      from public.invoices i
     where i.id = v_payment.invoice_id
     for update;

    if not found then
        raise exception 'The linked invoice no longer exists.';
    end if;

    select p.* into v_payment
      from public.payments p
     where p.id = p_payment_id
     for update;

    if not found or v_payment.provider is distinct from 'yoco' then
        raise exception 'The payment changed during cleanup. Retry after reviewing it.';
    end if;

    select pa.* into v_attempt
      from public.payment_attempts pa
     where pa.payment_id = p_payment_id
       and pa.provider = 'yoco'
       and pa.environment = 'test'
     for update;

    if not found then
        raise exception 'No linked Yoco test-mode payment attempt was found.';
    end if;

    if v_attempt.status is distinct from 'succeeded'
       or v_attempt.invoice_id is distinct from v_payment.invoice_id
       or v_attempt.client_id is distinct from v_payment.client_id
       or v_attempt.provider_checkout_id is null
       or v_attempt.provider_checkout_id is distinct from v_payment.provider_checkout_id
       or v_payment.method is distinct from 'Card'
       or v_payment.status is distinct from 'paid'
       or round(v_payment.amount * 100)::bigint is distinct from v_attempt.amount_cents
       or upper(coalesce(v_payment.currency, '')) is distinct from v_attempt.currency then
        raise exception 'Payment and Yoco test-attempt evidence do not match. No records were changed.';
    end if;

    -- Lock every webhook row bound to this attempt before validating its
    -- verified success event and taking the financial cleanup snapshots.
    perform 1
      from public.payment_webhook_events e
     where e.payment_attempt_id = v_attempt.id
     for update;

    if not exists (
        select 1
          from public.payment_webhook_events e
         where e.payment_attempt_id = v_attempt.id
           and e.provider = 'yoco'
           and e.environment = 'test'
           and e.event_type = 'payment.succeeded'
           and e.signature_verified is true
           and e.processing_status = 'processed'
    ) then
        raise exception 'A processed, signature-verified Yoco test success event is required.';
    end if;

    if exists (
        select 1
          from public.payment_webhook_events e
         where e.payment_attempt_id = v_attempt.id
           and (e.provider is distinct from 'yoco'
                or e.environment is distinct from 'test')
    ) then
        raise exception 'The payment attempt has webhook evidence from an unexpected provider environment.';
    end if;

    -- Refuse any record with financial, transfer, or reconciliation evidence.
    if exists (select 1 from public.payment_refunds r where r.payment_id = p_payment_id)
       or exists (
            select 1 from public.payment_reconciliation rc
             where rc.payment_id = p_payment_id
                or rc.payment_attempt_id = v_attempt.id
       )
       or exists (
            select 1 from public.payment_reconciliation_actions ra
             where ra.related_payment_id = p_payment_id
       )
       or exists (
            select 1 from public.bank_transfer_submissions bts
             where bts.payment_id = p_payment_id
                or bts.invoice_id = v_invoice.id
       )
       or exists (
            select 1 from public.manual_payment_record_requests mr
             where mr.payment_id = p_payment_id
       ) then
        raise exception 'This payment has refund, reconciliation, bank-transfer, or manual-payment evidence. It cannot be cleaned up.';
    end if;

    select pr.* into v_receipt
      from public.payment_receipts pr
     where pr.payment_id = p_payment_id
     for update;

    if not found then
        raise exception 'The issued receipt is missing. Resolve the ledger inconsistency before cleanup.';
    end if;

    v_expected_confirmation := 'DELETE TEST PAYMENT ' || p_payment_id::text;
    if p_confirmation is null
       or p_confirmation <> v_expected_confirmation then
        raise exception 'Confirmation must exactly match: %', v_expected_confirmation;
    end if;

    select jsonb_build_object(
        'deliveries', coalesce((
            select jsonb_agg(to_jsonb(d) order by d.created_at)
              from public.payment_receipt_deliveries d
             where d.receipt_id = v_receipt.id
        ), '[]'::jsonb),
        'delivery_attempts', coalesce((
            select jsonb_agg(to_jsonb(a) order by a.attempted_at)
              from public.payment_receipt_delivery_attempts a
             where a.receipt_id = v_receipt.id
        ), '[]'::jsonb),
        'provider_events', coalesce((
            select jsonb_agg(to_jsonb(pe) order by pe.received_at)
              from public.payment_receipt_provider_events pe
             where pe.receipt_id = v_receipt.id
        ), '[]'::jsonb)
    ) into v_receipt_delivery_snapshot;

    select coalesce(jsonb_agg(to_jsonb(e) order by e.received_at), '[]'::jsonb)
      into v_webhook_event_snapshots
      from public.payment_webhook_events e
     where e.payment_attempt_id = v_attempt.id;

    insert into innerme_private.yoco_test_payment_cleanup_audit (
        original_payment_id,
        invoice_id,
        payment_attempt_id,
        receipt_number,
        actor_user_id,
        reason,
        confirmation,
        payment_snapshot,
        attempt_snapshot,
        receipt_snapshot,
        webhook_event_snapshots,
        receipt_delivery_snapshot
    )
    values (
        v_payment.id,
        v_invoice.id,
        v_attempt.id,
        v_receipt.receipt_number,
        auth.uid(),
        v_reason,
        p_confirmation,
        to_jsonb(v_payment),
        to_jsonb(v_attempt),
        to_jsonb(v_receipt),
        v_webhook_event_snapshots,
        v_receipt_delivery_snapshot
    )
    returning id into v_audit_id;

    -- Preserve the provider attempt and webhook event history. Detach the
    -- deleted local ledger row only after its complete snapshot is recorded.
    update public.payment_attempts
       set payment_id = null,
           updated_at = now()
     where id = v_attempt.id;

    -- This transaction-local flag is set only after owner, environment,
    -- provider evidence, dependency, and confirmation checks have passed.
    perform set_config('innerme_private.allow_yoco_test_payment_cleanup', 'on', true);

    delete from public.payment_receipts
     where id = v_receipt.id;

    delete from public.payments
     where id = v_payment.id;

    perform set_config('innerme_private.allow_yoco_test_payment_cleanup', 'off', true);

    return jsonb_build_object(
        'ok', true,
        'payment_id', p_payment_id,
        'payment_attempt_id', v_attempt.id,
        'receipt_number', v_receipt.receipt_number,
        'audit_id', v_audit_id,
        'message', 'Verified Yoco test payment removed. Provider attempt, webhook events, and cleanup audit snapshot were retained.'
    );
end;
$function$;

revoke all on function public.admin_cleanup_yoco_test_payment(uuid, text, text)
    from public, anon;
grant execute on function public.admin_cleanup_yoco_test_payment(uuid, text, text)
    to authenticated;

comment on function public.admin_cleanup_yoco_test_payment(uuid, text, text) is
    'Owner-only cleanup of a verified Yoco test-mode payment with a mandatory exact-ID confirmation and immutable private audit snapshots.';

commit;
