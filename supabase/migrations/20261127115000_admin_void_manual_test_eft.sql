-- Audited void of the single owner-confirmed R700 manual EFT test transaction.
-- Original payment, invoice, receipt, transfer approval and private proof remain in place.
begin;

alter table public.payments
    drop constraint if exists payments_status_check;
alter table public.payments
    add constraint payments_status_check
    check (status = any (array['due','partially paid','paid','overdue','voided_test']::text[]));

alter table public.payment_receipts
    add column if not exists voided_at timestamptz,
    add column if not exists voided_by uuid references auth.users(id) on delete restrict,
    add column if not exists void_reason text;

alter table public.payment_receipts
    drop constraint if exists payment_receipts_void_metadata_check;
alter table public.payment_receipts
    add constraint payment_receipts_void_metadata_check
    check (
        (voided_at is null and voided_by is null and void_reason is null)
        or (
            voided_at is not null
            and voided_by is not null
            and void_reason is not null
            and length(btrim(void_reason)) between 10 and 1000
        )
    );

alter table public.bank_transfer_submissions
    add column if not exists voided_at timestamptz,
    add column if not exists voided_by uuid references auth.users(id) on delete restrict,
    add column if not exists void_reason text;

alter table public.bank_transfer_submissions
    drop constraint if exists bank_transfer_submissions_status_check;
alter table public.bank_transfer_submissions
    add constraint bank_transfer_submissions_status_check
    check (status = any (array['pending_review','approved','rejected','voided_test']::text[]));

alter table public.bank_transfer_submissions
    drop constraint if exists bank_transfer_submissions_void_test_check;
alter table public.bank_transfer_submissions
    add constraint bank_transfer_submissions_void_test_check
    check (
        (status <> 'voided_test')
        or (
            payment_id is not null
            and voided_at is not null
            and voided_by is not null
            and void_reason is not null
            and length(btrim(void_reason)) between 10 and 1000
        )
    );

comment on column public.payments.status is
    'voided_test marks an owner-confirmed test transaction excluded from received-payment and invoice-balance totals.';
comment on column public.payment_receipts.voided_at is
    'When this issued receipt was invalidated as evidence of a test transaction. Original receipt data is retained.';
comment on column public.bank_transfer_submissions.voided_at is
    'When this bank-transfer submission was invalidated as an owner-confirmed test transaction. Original review and proof data are retained.';

create table if not exists innerme_private.manual_test_eft_void_audit (
    id uuid primary key default gen_random_uuid(),
    original_payment_id uuid not null unique,
    original_invoice_id uuid not null,
    original_receipt_id uuid not null,
    original_submission_id uuid not null,
    actor_user_id uuid not null references auth.users(id) on delete restrict,
    reason text not null,
    confirmation text not null,
    proof_storage_path text not null,
    payment_snapshot jsonb not null,
    invoice_snapshot jsonb not null,
    receipt_snapshot jsonb not null,
    bank_transfer_snapshot jsonb not null,
    receipt_delivery_snapshot jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint manual_test_eft_void_reason_check
        check (length(btrim(reason)) between 10 and 500),
    constraint manual_test_eft_void_confirmation_check
        check (length(btrim(confirmation)) > 0)
);

alter table innerme_private.manual_test_eft_void_audit enable row level security;
revoke all on table innerme_private.manual_test_eft_void_audit
    from public, anon, authenticated, service_role;

comment on table innerme_private.manual_test_eft_void_audit is
    'Append-only private snapshots for the owner-approved R700 manual EFT test-transaction void.';

create or replace function innerme_private.prevent_manual_test_eft_void_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
    raise exception 'Manual test EFT void audit records are immutable.'
        using errcode = '55000';
end;
$function$;

revoke all on function innerme_private.prevent_manual_test_eft_void_audit_mutation()
    from public, anon, authenticated, service_role;

drop trigger if exists trg_prevent_manual_test_eft_void_audit_mutation
    on innerme_private.manual_test_eft_void_audit;
create trigger trg_prevent_manual_test_eft_void_audit_mutation
before update or delete on innerme_private.manual_test_eft_void_audit
for each row
execute function innerme_private.prevent_manual_test_eft_void_audit_mutation();

-- Permit one tightly constrained receipt metadata update. Every issued receipt
-- remains immutable outside this owner-only, transaction-local void operation.
create or replace function innerme_private.guard_yoco_financial_ledger()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
    if tg_table_name = 'payment_receipts'
       and tg_op = 'UPDATE'
       and current_setting('innerme_private.allow_manual_test_eft_void', true) = 'on'
       and auth.uid() is not null
       and coalesce(public.is_swayphics_owner(), false)
       and old.id = 'f5c08942-97d1-4c55-9cd5-f7e14557b325'::uuid
       and old.payment_id = '4e8761b0-feec-429a-a690-7085b59aedcd'::uuid
       and new.payment_id = old.payment_id
       and new.receipt_number = old.receipt_number
       and old.voided_at is null
       and new.voided_at is not null
       and new.voided_by = auth.uid()
       and length(btrim(coalesce(new.void_reason, ''))) between 10 and 1000
       and (to_jsonb(new) - 'voided_at' - 'voided_by' - 'void_reason')
           = (to_jsonb(old) - 'voided_at' - 'voided_by' - 'void_reason') then
        return new;
    end if;

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

-- The payment trigger is normally authoritative for setting status='paid'.
-- A narrow branch permits only this one test EFT to move from paid to voided_test.
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
    v_void_audit_id text;
    v_expected_notes text;
begin
    if tg_op = 'UPDATE' then
        v_void_audit_id := current_setting('innerme_private.manual_test_eft_void_audit_id', true);
        v_expected_notes := concat_ws(
            E'\n\n',
            nullif(old.notes, ''),
            'VOIDED TEST EFT: Owner-confirmed no funds were received. Audit reference: ' || coalesce(v_void_audit_id, '')
        );

        if current_setting('innerme_private.allow_manual_test_eft_void', true) = 'on'
           and auth.uid() is not null
           and coalesce(public.is_swayphics_owner(), false)
           and old.id = '4e8761b0-feec-429a-a690-7085b59aedcd'::uuid
           and old.invoice_id = '19c2cc60-89d9-4a7e-b609-a33ca33b2dbb'::uuid
           and old.client_id = 'f8ce9e4a-127f-404b-8741-130d3d7e085c'::uuid
           and old.status = 'paid'
           and new.status = 'voided_test'
           and old.method = 'EFT'
           and old.provider is null
           and old.amount = 700.00
           and old.currency = 'ZAR'
           and old.reference = 'SWY'
           and new.notes is not distinct from v_expected_notes
           and v_void_audit_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}

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

    new.client_id := v_invoice_client_id;
    new.project_id := v_invoice_project_id;
    new.status := 'paid';

    return new;
end;
$function$;

revoke all on function public.enforce_swayphics_payment_invoice_integrity()
    from public, anon, authenticated, service_role;

create or replace function public.admin_get_manual_test_eft_void_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_result jsonb;
begin
    if auth.uid() is null
       or not coalesce(public.is_swayphics_owner(), false) then
        raise exception 'Active Swayphics owner access is required.'
            using errcode = '42501';
    end if;

    select jsonb_build_object(
        'ok', true,
        'payment_id', p.id,
        'payment_status', p.status,
        'amount', p.amount,
        'currency', p.currency,
        'method', p.method,
        'reference', p.reference,
        'invoice_id', i.id,
        'invoice_number', i.invoice_number,
        'invoice_status', i.status,
        'invoice_amount_paid', i.amount_paid,
        'invoice_amount_outstanding', i.amount_outstanding,
        'invoice_archived', i.archived,
        'receipt_number', pr.receipt_number,
        'receipt_voided_at', pr.voided_at,
        'receipt_void_reason', pr.void_reason,
        'bank_transfer_status', bts.status,
        'bank_transfer_voided_at', bts.voided_at,
        'bank_transfer_void_reason', bts.void_reason,
        'audit_id', audit.id,
        'audit_created_at', audit.created_at
    )
      into v_result
      from public.payments p
      join public.invoices i on i.id = p.invoice_id
      left join public.payment_receipts pr on pr.payment_id = p.id
      left join public.bank_transfer_submissions bts on bts.payment_id = p.id
      left join innerme_private.manual_test_eft_void_audit audit
        on audit.original_payment_id = p.id
     where p.id = '4e8761b0-feec-429a-a690-7085b59aedcd'::uuid;

    if v_result is null then
        raise exception 'The specific R700 test EFT payment or its invoice is missing. No changes were made.';
    end if;

    return v_result;
end;
$function$;

revoke all on function public.admin_get_manual_test_eft_void_status()
    from public, anon;
grant execute on function public.admin_get_manual_test_eft_void_status()
    to authenticated;

create or replace function public.admin_void_manual_test_eft(
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
    v_invoice public.invoices%rowtype;
    v_payment public.payments%rowtype;
    v_receipt public.payment_receipts%rowtype;
    v_submission public.bank_transfer_submissions%rowtype;
    v_audit_id uuid;
    v_reason text := btrim(coalesce(p_reason, ''));
    v_confirmation text := 'VOID TEST EFT PAYMENT 4e8761b0-feec-429a-a690-7085b59aedcd';
    v_delivery_snapshot jsonb;
    v_statement_match boolean := false;
begin
    if auth.uid() is null
       or not coalesce(public.is_swayphics_owner(), false) then
        raise exception 'Active Swayphics owner access is required.'
            using errcode = '42501';
    end if;

    if p_payment_id is distinct from '4e8761b0-feec-429a-a690-7085b59aedcd'::uuid then
        raise exception 'Only the specifically approved R700 test EFT transaction can be voided.';
    end if;

    if p_confirmation is distinct from v_confirmation then
        raise exception 'Confirmation must exactly match: %', v_confirmation;
    end if;

    if length(v_reason) < 10 or length(v_reason) > 500 then
        raise exception 'A void reason between 10 and 500 characters is required.';
    end if;

    select i.*
      into v_invoice
      from public.invoices i
     where i.id = '19c2cc60-89d9-4a7e-b609-a33ca33b2dbb'::uuid
     for update;
    if not found then
        raise exception 'The linked invoice no longer exists.';
    end if;

    select p.*
      into v_payment
      from public.payments p
     where p.id = p_payment_id
     for update;
    if not found then
        raise exception 'The specified R700 test EFT payment no longer exists.';
    end if;

    select pr.*
      into v_receipt
      from public.payment_receipts pr
     where pr.payment_id = p_payment_id
     for update;
    if not found then
        raise exception 'The original receipt is missing. Stop and investigate the ledger inconsistency.';
    end if;

    select bts.*
      into v_submission
      from public.bank_transfer_submissions bts
     where bts.id = '1eca46ef-3c9e-4e04-a72e-907431ad7bc6'::uuid
     for update;
    if not found then
        raise exception 'The original bank-transfer submission is missing. No records were changed.';
    end if;

    if v_invoice.id <> '19c2cc60-89d9-4a7e-b609-a33ca33b2dbb'::uuid
       or v_invoice.invoice_number is distinct from 'SWY-2026-0010'
       or v_invoice.client_id is distinct from 'f8ce9e4a-127f-404b-8741-130d3d7e085c'::uuid
       or v_invoice.total is distinct from 700.00
       or v_invoice.amount_paid is distinct from 700.00
       or v_invoice.amount_outstanding is distinct from 0.00
       or v_invoice.status is distinct from 'paid'
       or v_invoice.archived is distinct from true then
        raise exception 'The linked invoice no longer matches the reviewed R700 test-invoice facts. No changes were made.';
    end if;

    if v_payment.invoice_id is distinct from v_invoice.id
       or v_payment.client_id is distinct from v_invoice.client_id
       or v_payment.amount is distinct from 700.00
       or v_payment.currency is distinct from 'ZAR'
       or v_payment.method is distinct from 'EFT'
       or v_payment.provider is not null
       or v_payment.reference is distinct from 'SWY'
       or v_payment.status is distinct from 'paid'
       or v_payment.paid_at is null
       or v_payment.provider_transaction_id is not null
       or v_payment.provider_checkout_id is not null then
        raise exception 'The payment no longer matches the specifically approved manual EFT test transaction. No changes were made.';
    end if;

    if v_receipt.id is distinct from 'f5c08942-97d1-4c55-9cd5-f7e14557b325'::uuid
       or v_receipt.receipt_number is distinct from 'SW-RCPT-2026-000001'
       or v_receipt.voided_at is not null then
        raise exception 'The original receipt no longer matches the expected unvoided receipt. No changes were made.';
    end if;

    if v_submission.invoice_id is distinct from v_invoice.id
       or v_submission.client_id is distinct from v_invoice.client_id
       or v_submission.payment_id is distinct from v_payment.id
       or v_submission.amount is distinct from 700.00
       or v_submission.bank_reference is distinct from 'SWY'
       or v_submission.status is distinct from 'approved'
       or v_submission.voided_at is not null
       or v_submission.proof_storage_path is null then
        raise exception 'The bank-transfer approval or its proof reference no longer matches. No changes were made.';
    end if;

    if exists (
        select 1 from public.payment_refunds r
         where r.payment_id = p_payment_id
    ) or exists (
        select 1 from public.payment_reconciliation rc
         where rc.payment_id = p_payment_id
    ) or exists (
        select 1 from public.payment_reconciliation_actions ra
         where ra.related_payment_id = p_payment_id
    ) or exists (
        select 1 from public.payment_attempts pa
         where pa.payment_id = p_payment_id
    ) then
        raise exception 'Refund, reconciliation, or provider-attempt history exists. This test-payment void is blocked.';
    end if;

    -- bank_statement_lines is optional in older disposable schemas, so check
    -- it dynamically; a real matched statement line blocks the operation.
    if to_regclass('public.bank_statement_lines') is not null then
        execute
            'select exists (
                select 1
                  from public.bank_statement_lines
                 where matched_source_id = $1
                    or matched_source_id = $2
             )'
          into v_statement_match
          using p_payment_id, v_submission.id;
        if v_statement_match then
            raise exception 'A bank-statement line is linked to this payment or transfer. Resolve reconciliation before voiding.';
        end if;
    end if;

    if v_receipt.payment_id is distinct from p_payment_id then
        raise exception 'The receipt-payment relationship is inconsistent.';
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
            select jsonb_agg(to_jsonb(e) order by e.received_at)
              from public.payment_receipt_provider_events e
             where e.receipt_id = v_receipt.id
        ), '[]'::jsonb)
    )
      into v_delivery_snapshot;

    insert into innerme_private.manual_test_eft_void_audit (
        original_payment_id,
        original_invoice_id,
        original_receipt_id,
        original_submission_id,
        actor_user_id,
        reason,
        confirmation,
        proof_storage_path,
        payment_snapshot,
        invoice_snapshot,
        receipt_snapshot,
        bank_transfer_snapshot,
        receipt_delivery_snapshot
    )
    values (
        v_payment.id,
        v_invoice.id,
        v_receipt.id,
        v_submission.id,
        auth.uid(),
        v_reason,
        p_confirmation,
        v_submission.proof_storage_path,
        to_jsonb(v_payment),
        to_jsonb(v_invoice),
        to_jsonb(v_receipt),
        to_jsonb(v_submission),
        v_delivery_snapshot
    )
    returning id into v_audit_id;

    perform set_config('innerme_private.allow_manual_test_eft_void', 'on', true);
    perform set_config('innerme_private.manual_test_eft_void_audit_id', v_audit_id::text, true);

    -- Keep the original reviewer, reviewed timestamp, bank reference and
    -- proof_storage_path. This status now distinguishes a test submission
    -- from a real deposit without erasing its approval history.
    update public.bank_transfer_submissions
       set status = 'voided_test',
           voided_at = now(),
           voided_by = auth.uid(),
           void_reason = v_reason
     where id = v_submission.id;

    update public.payment_receipts
       set voided_at = now(),
           voided_by = auth.uid(),
           void_reason = v_reason
     where id = v_receipt.id;

    update public.payments
       set status = 'voided_test',
           notes = concat_ws(
               E'\n\n',
               nullif(notes, ''),
               'VOIDED TEST EFT: Owner-confirmed no funds were received. Audit reference: ' || v_audit_id::text
           ),
           updated_at = now()
     where id = v_payment.id;

    perform set_config('innerme_private.allow_manual_test_eft_void', 'off', true);
    perform set_config('innerme_private.manual_test_eft_void_audit_id', '', true);

    return jsonb_build_object(
        'ok', true,
        'payment_id', v_payment.id,
        'invoice_id', v_invoice.id,
        'invoice_number', v_invoice.invoice_number,
        'receipt_number', v_receipt.receipt_number,
        'bank_transfer_submission_id', v_submission.id,
        'audit_id', v_audit_id,
        'amount_voided', v_payment.amount,
        'message', 'The owner-confirmed R700 EFT test transaction, receipt and bank-transfer submission were voided. Original records, proof and delivery history were retained; the invoice balance was recalculated.'
    );
end;
$function$;

revoke all on function public.admin_void_manual_test_eft(uuid, text, text)
    from public, anon;
grant execute on function public.admin_void_manual_test_eft(uuid, text, text)
    to authenticated;

comment on function public.admin_void_manual_test_eft(uuid, text, text) is
    'Owner-only, exact-ID audited void of the R700 manual EFT test transaction; preserves original payment, receipt, proof and delivery history.';

commit;

           and (to_jsonb(new) - 'status' - 'updated_at' - 'notes')
               = (to_jsonb(old) - 'status' - 'updated_at' - 'notes') then
            return new;
        end if;
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

    new.client_id := v_invoice_client_id;
    new.project_id := v_invoice_project_id;
    new.status := 'paid';

    return new;
end;
$function$;

revoke all on function public.enforce_swayphics_payment_invoice_integrity()
    from public, anon, authenticated, service_role;

create or replace function public.admin_get_manual_test_eft_void_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_result jsonb;
begin
    if auth.uid() is null
       or not coalesce(public.is_swayphics_owner(), false) then
        raise exception 'Active Swayphics owner access is required.'
            using errcode = '42501';
    end if;

    select jsonb_build_object(
        'ok', true,
        'payment_id', p.id,
        'payment_status', p.status,
        'amount', p.amount,
        'currency', p.currency,
        'method', p.method,
        'reference', p.reference,
        'invoice_id', i.id,
        'invoice_number', i.invoice_number,
        'invoice_status', i.status,
        'invoice_amount_paid', i.amount_paid,
        'invoice_amount_outstanding', i.amount_outstanding,
        'invoice_archived', i.archived,
        'receipt_number', pr.receipt_number,
        'receipt_voided_at', pr.voided_at,
        'receipt_void_reason', pr.void_reason,
        'bank_transfer_status', bts.status,
        'bank_transfer_voided_at', bts.voided_at,
        'bank_transfer_void_reason', bts.void_reason,
        'audit_id', audit.id,
        'audit_created_at', audit.created_at
    )
      into v_result
      from public.payments p
      join public.invoices i on i.id = p.invoice_id
      left join public.payment_receipts pr on pr.payment_id = p.id
      left join public.bank_transfer_submissions bts on bts.payment_id = p.id
      left join innerme_private.manual_test_eft_void_audit audit
        on audit.original_payment_id = p.id
     where p.id = '4e8761b0-feec-429a-a690-7085b59aedcd'::uuid;

    if v_result is null then
        raise exception 'The specific R700 test EFT payment or its invoice is missing. No changes were made.';
    end if;

    return v_result;
end;
$function$;

revoke all on function public.admin_get_manual_test_eft_void_status()
    from public, anon;
grant execute on function public.admin_get_manual_test_eft_void_status()
    to authenticated;

create or replace function public.admin_void_manual_test_eft(
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
    v_invoice public.invoices%rowtype;
    v_payment public.payments%rowtype;
    v_receipt public.payment_receipts%rowtype;
    v_submission public.bank_transfer_submissions%rowtype;
    v_audit_id uuid;
    v_reason text := btrim(coalesce(p_reason, ''));
    v_confirmation text := 'VOID TEST EFT PAYMENT 4e8761b0-feec-429a-a690-7085b59aedcd';
    v_delivery_snapshot jsonb;
    v_statement_match boolean := false;
begin
    if auth.uid() is null
       or not coalesce(public.is_swayphics_owner(), false) then
        raise exception 'Active Swayphics owner access is required.'
            using errcode = '42501';
    end if;

    if p_payment_id is distinct from '4e8761b0-feec-429a-a690-7085b59aedcd'::uuid then
        raise exception 'Only the specifically approved R700 test EFT transaction can be voided.';
    end if;

    if p_confirmation is distinct from v_confirmation then
        raise exception 'Confirmation must exactly match: %', v_confirmation;
    end if;

    if length(v_reason) < 10 or length(v_reason) > 500 then
        raise exception 'A void reason between 10 and 500 characters is required.';
    end if;

    select i.*
      into v_invoice
      from public.invoices i
     where i.id = '19c2cc60-89d9-4a7e-b609-a33ca33b2dbb'::uuid
     for update;
    if not found then
        raise exception 'The linked invoice no longer exists.';
    end if;

    select p.*
      into v_payment
      from public.payments p
     where p.id = p_payment_id
     for update;
    if not found then
        raise exception 'The specified R700 test EFT payment no longer exists.';
    end if;

    select pr.*
      into v_receipt
      from public.payment_receipts pr
     where pr.payment_id = p_payment_id
     for update;
    if not found then
        raise exception 'The original receipt is missing. Stop and investigate the ledger inconsistency.';
    end if;

    select bts.*
      into v_submission
      from public.bank_transfer_submissions bts
     where bts.id = '1eca46ef-3c9e-4e04-a72e-907431ad7bc6'::uuid
     for update;
    if not found then
        raise exception 'The original bank-transfer submission is missing. No records were changed.';
    end if;

    if v_invoice.id <> '19c2cc60-89d9-4a7e-b609-a33ca33b2dbb'::uuid
       or v_invoice.invoice_number is distinct from 'SWY-2026-0010'
       or v_invoice.client_id is distinct from 'f8ce9e4a-127f-404b-8741-130d3d7e085c'::uuid
       or v_invoice.total is distinct from 700.00
       or v_invoice.amount_paid is distinct from 700.00
       or v_invoice.amount_outstanding is distinct from 0.00
       or v_invoice.status is distinct from 'paid'
       or v_invoice.archived is distinct from true then
        raise exception 'The linked invoice no longer matches the reviewed R700 test-invoice facts. No changes were made.';
    end if;

    if v_payment.invoice_id is distinct from v_invoice.id
       or v_payment.client_id is distinct from v_invoice.client_id
       or v_payment.amount is distinct from 700.00
       or v_payment.currency is distinct from 'ZAR'
       or v_payment.method is distinct from 'EFT'
       or v_payment.provider is not null
       or v_payment.reference is distinct from 'SWY'
       or v_payment.status is distinct from 'paid'
       or v_payment.paid_at is null
       or v_payment.provider_transaction_id is not null
       or v_payment.provider_checkout_id is not null then
        raise exception 'The payment no longer matches the specifically approved manual EFT test transaction. No changes were made.';
    end if;

    if v_receipt.id is distinct from 'f5c08942-97d1-4c55-9cd5-f7e14557b325'::uuid
       or v_receipt.receipt_number is distinct from 'SW-RCPT-2026-000001'
       or v_receipt.voided_at is not null then
        raise exception 'The original receipt no longer matches the expected unvoided receipt. No changes were made.';
    end if;

    if v_submission.invoice_id is distinct from v_invoice.id
       or v_submission.client_id is distinct from v_invoice.client_id
       or v_submission.payment_id is distinct from v_payment.id
       or v_submission.amount is distinct from 700.00
       or v_submission.bank_reference is distinct from 'SWY'
       or v_submission.status is distinct from 'approved'
       or v_submission.voided_at is not null
       or v_submission.proof_storage_path is null then
        raise exception 'The bank-transfer approval or its proof reference no longer matches. No changes were made.';
    end if;

    if exists (
        select 1 from public.payment_refunds r
         where r.payment_id = p_payment_id
    ) or exists (
        select 1 from public.payment_reconciliation rc
         where rc.payment_id = p_payment_id
    ) or exists (
        select 1 from public.payment_reconciliation_actions ra
         where ra.related_payment_id = p_payment_id
    ) or exists (
        select 1 from public.payment_attempts pa
         where pa.payment_id = p_payment_id
    ) then
        raise exception 'Refund, reconciliation, or provider-attempt history exists. This test-payment void is blocked.';
    end if;

    -- bank_statement_lines is optional in older disposable schemas, so check
    -- it dynamically; a real matched statement line blocks the operation.
    if to_regclass('public.bank_statement_lines') is not null then
        execute
            'select exists (
                select 1
                  from public.bank_statement_lines
                 where matched_source_id = $1
                    or matched_source_id = $2
             )'
          into v_statement_match
          using p_payment_id, v_submission.id;
        if v_statement_match then
            raise exception 'A bank-statement line is linked to this payment or transfer. Resolve reconciliation before voiding.';
        end if;
    end if;

    if v_receipt.payment_id is distinct from p_payment_id then
        raise exception 'The receipt-payment relationship is inconsistent.';
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
            select jsonb_agg(to_jsonb(e) order by e.received_at)
              from public.payment_receipt_provider_events e
             where e.receipt_id = v_receipt.id
        ), '[]'::jsonb)
    )
      into v_delivery_snapshot;

    insert into innerme_private.manual_test_eft_void_audit (
        original_payment_id,
        original_invoice_id,
        original_receipt_id,
        original_submission_id,
        actor_user_id,
        reason,
        confirmation,
        proof_storage_path,
        payment_snapshot,
        invoice_snapshot,
        receipt_snapshot,
        bank_transfer_snapshot,
        receipt_delivery_snapshot
    )
    values (
        v_payment.id,
        v_invoice.id,
        v_receipt.id,
        v_submission.id,
        auth.uid(),
        v_reason,
        p_confirmation,
        v_submission.proof_storage_path,
        to_jsonb(v_payment),
        to_jsonb(v_invoice),
        to_jsonb(v_receipt),
        to_jsonb(v_submission),
        v_delivery_snapshot
    )
    returning id into v_audit_id;

    perform set_config('innerme_private.allow_manual_test_eft_void', 'on', true);
    perform set_config('innerme_private.manual_test_eft_void_audit_id', v_audit_id::text, true);

    -- Keep the original reviewer, reviewed timestamp, bank reference and
    -- proof_storage_path. This status now distinguishes a test submission
    -- from a real deposit without erasing its approval history.
    update public.bank_transfer_submissions
       set status = 'voided_test',
           voided_at = now(),
           voided_by = auth.uid(),
           void_reason = v_reason
     where id = v_submission.id;

    update public.payment_receipts
       set voided_at = now(),
           voided_by = auth.uid(),
           void_reason = v_reason
     where id = v_receipt.id;

    update public.payments
       set status = 'voided_test',
           notes = concat_ws(
               E'\n\n',
               nullif(notes, ''),
               'VOIDED TEST EFT: Owner-confirmed no funds were received. Audit reference: ' || v_audit_id::text
           ),
           updated_at = now()
     where id = v_payment.id;

    perform set_config('innerme_private.allow_manual_test_eft_void', 'off', true);
    perform set_config('innerme_private.manual_test_eft_void_audit_id', '', true);

    return jsonb_build_object(
        'ok', true,
        'payment_id', v_payment.id,
        'invoice_id', v_invoice.id,
        'invoice_number', v_invoice.invoice_number,
        'receipt_number', v_receipt.receipt_number,
        'bank_transfer_submission_id', v_submission.id,
        'audit_id', v_audit_id,
        'amount_voided', v_payment.amount,
        'message', 'The owner-confirmed R700 EFT test transaction, receipt and bank-transfer submission were voided. Original records, proof and delivery history were retained; the invoice balance was recalculated.'
    );
end;
$function$;

revoke all on function public.admin_void_manual_test_eft(uuid, text, text)
    from public, anon;
grant execute on function public.admin_void_manual_test_eft(uuid, text, text)
    to authenticated;

comment on function public.admin_void_manual_test_eft(uuid, text, text) is
    'Owner-only, exact-ID audited void of the R700 manual EFT test transaction; preserves original payment, receipt, proof and delivery history.';

commit;
