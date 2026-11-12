-- Manual EFT submissions with private proof storage and admin-only settlement.
begin;

create table if not exists public.bank_transfer_submissions (
    id uuid primary key default gen_random_uuid(),
    invoice_id uuid not null references public.invoices(id) on delete restrict,
    client_id uuid not null references public.clients(id) on delete restrict,
    amount numeric(12,2) not null check (amount > 0),
    bank_reference text not null check (length(btrim(bank_reference)) between 1 and 120),
    proof_storage_path text not null unique,
    proof_file_name text not null check (length(btrim(proof_file_name)) between 1 and 180),
    proof_mime_type text not null check (proof_mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
    proof_size_bytes bigint not null check (proof_size_bytes between 1 and 5242880),
    status text not null default 'pending_review'
        check (status in ('pending_review','approved','rejected')),
    payment_id uuid unique references public.payments(id) on delete restrict,
    submitted_at timestamptz not null default now(),
    reviewed_at timestamptz,
    reviewed_by uuid references auth.users(id) on delete restrict,
    rejection_reason text,
    check (
        (status = 'approved' and payment_id is not null and reviewed_at is not null and reviewed_by is not null)
        or status <> 'approved'
    ),
    check (
        (status = 'rejected' and rejection_reason is not null and length(btrim(rejection_reason)) between 1 and 1000)
        or status <> 'rejected'
    )
);

create index if not exists bank_transfer_submissions_client_invoice_idx
    on public.bank_transfer_submissions(client_id, invoice_id, submitted_at desc);
create index if not exists bank_transfer_submissions_review_queue_idx
    on public.bank_transfer_submissions(status, submitted_at asc);

create unique index if not exists bank_transfer_submissions_reference_uidx
    on public.bank_transfer_submissions(client_id, lower(btrim(bank_reference)))
    where status in ('pending_review','approved');

alter table public.bank_transfer_submissions enable row level security;
revoke all on table public.bank_transfer_submissions from public, anon, authenticated;
grant all privileges on table public.bank_transfer_submissions to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'swayphics-payment-proofs',
    'swayphics-payment-proofs',
    false,
    5242880,
    array['application/pdf','image/jpeg','image/png','image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function innerme_private.approve_bank_transfer_submission(
    p_submission_id uuid,
    p_reviewer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_submission public.bank_transfer_submissions%rowtype;
    v_invoice public.invoices%rowtype;
    v_payment public.payments%rowtype;
    v_receipt public.payment_receipts%rowtype;
    v_receipt_number text;
    v_sequence bigint;
    v_snapshot jsonb;
    v_paid numeric(12,2);
    v_outstanding numeric(12,2);
begin
    if p_submission_id is null or p_reviewer_id is null then
        raise exception 'A submission and authenticated reviewer are required.';
    end if;

    if not exists (
        select 1 from public.admin_users au
        where au.user_id = p_reviewer_id and au.active = true
    ) then
        raise exception 'An active Swayphics administrator is required.';
    end if;

    select * into v_submission
    from public.bank_transfer_submissions
    where id = p_submission_id
    for update;

    if not found then
        raise exception 'Bank transfer submission not found.';
    end if;

    if v_submission.status = 'approved' and v_submission.payment_id is not null then
        return jsonb_build_object(
            'ok', true,
            'duplicate', true,
            'submission_id', v_submission.id,
            'payment_id', v_submission.payment_id
        );
    end if;

    if v_submission.status <> 'pending_review' then
        raise exception 'Only pending submissions can be approved.';
    end if;

    select * into v_invoice
    from public.invoices
    where id = v_submission.invoice_id
    for update;

    if not found
       or v_invoice.client_id <> v_submission.client_id
       or v_invoice.status not in ('sent','partially paid','overdue') then
        raise exception 'The invoice is no longer eligible for payment.';
    end if;

    v_paid := least(
        innerme_private.swayphics_invoice_net_paid(v_invoice.id),
        greatest(coalesce(v_invoice.total, 0), 0)
    );
    v_outstanding := greatest(coalesce(v_invoice.total, 0) - v_paid, 0);

    if v_submission.amount > v_outstanding then
        raise exception 'The submitted amount exceeds the invoice balance currently outstanding.';
    end if;

    insert into public.payments (
        client_id, project_id, invoice_id, amount, status, method,
        reference, paid_at, provider, currency, notes
    )
    values (
        v_invoice.client_id,
        v_invoice.project_id,
        v_invoice.id,
        v_submission.amount,
        'paid',
        'EFT',
        v_submission.bank_reference,
        now(),
        null,
        v_invoice.currency,
        'Bank transfer proof reviewed and payment manually confirmed by an active Swayphics administrator.'
    )
    returning * into v_payment;

    v_sequence := nextval('public.swayphics_payment_receipt_seq'::regclass);
    v_receipt_number := 'SW-RCPT-' ||
        to_char(now() at time zone 'Africa/Johannesburg', 'YYYY') ||
        '-' || lpad(v_sequence::text, 6, '0');

    v_snapshot := jsonb_build_object(
        'receipt_number', v_receipt_number,
        'issued_at', now(),
        'business', 'Swayphics',
        'client_id', v_invoice.client_id,
        'invoice_id', v_invoice.id,
        'invoice_number', v_invoice.invoice_number,
        'payment_id', v_payment.id,
        'amount', v_payment.amount,
        'currency', v_payment.currency,
        'method', 'EFT',
        'provider', 'Manual bank transfer',
        'bank_reference', v_submission.bank_reference,
        'payment_date', v_payment.paid_at
    );

    insert into public.payment_receipts (payment_id, receipt_number, snapshot)
    values (v_payment.id, v_receipt_number, v_snapshot)
    returning * into v_receipt;

    update public.bank_transfer_submissions
    set status = 'approved',
        payment_id = v_payment.id,
        reviewed_at = now(),
        reviewed_by = p_reviewer_id,
        rejection_reason = null
    where id = v_submission.id;

    return jsonb_build_object(
        'ok', true,
        'duplicate', false,
        'submission_id', v_submission.id,
        'payment_id', v_payment.id,
        'receipt_number', v_receipt.receipt_number,
        'amount', v_payment.amount
    );
end;
$$;

create or replace function innerme_private.reject_bank_transfer_submission(
    p_submission_id uuid,
    p_reviewer_id uuid,
    p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_submission public.bank_transfer_submissions%rowtype;
begin
    if p_submission_id is null or p_reviewer_id is null
       or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
        raise exception 'A submission, reviewer and rejection reason are required.';
    end if;

    if not exists (
        select 1 from public.admin_users au
        where au.user_id = p_reviewer_id and au.active = true
    ) then
        raise exception 'An active Swayphics administrator is required.';
    end if;

    select * into v_submission
    from public.bank_transfer_submissions
    where id = p_submission_id
    for update;

    if not found then
        raise exception 'Bank transfer submission not found.';
    end if;

    if v_submission.status <> 'pending_review' then
        raise exception 'Only pending submissions can be rejected.';
    end if;

    update public.bank_transfer_submissions
    set status = 'rejected',
        rejection_reason = btrim(p_reason),
        reviewed_at = now(),
        reviewed_by = p_reviewer_id
    where id = v_submission.id;

    return jsonb_build_object(
        'ok', true,
        'submission_id', v_submission.id,
        'status', 'rejected'
    );
end;
$$;

revoke all on function innerme_private.approve_bank_transfer_submission(uuid, uuid)
    from public, anon, authenticated;
revoke all on function innerme_private.reject_bank_transfer_submission(uuid, uuid, text)
    from public, anon, authenticated;
grant execute on function innerme_private.approve_bank_transfer_submission(uuid, uuid)
    to service_role;
grant execute on function innerme_private.reject_bank_transfer_submission(uuid, uuid, text)
    to service_role;

commit;

-- PostgREST entry points are kept in public but executable only by service_role.
-- The actual financial routines and their implementation stay in innerme_private.
create or replace function public.admin_approve_bank_transfer_submission(
    p_submission_id uuid,
    p_reviewer_id uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
    select innerme_private.approve_bank_transfer_submission(
        p_submission_id,
        p_reviewer_id
    );
$$;

create or replace function public.admin_reject_bank_transfer_submission(
    p_submission_id uuid,
    p_reviewer_id uuid,
    p_reason text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
    select innerme_private.reject_bank_transfer_submission(
        p_submission_id,
        p_reviewer_id,
        p_reason
    );
$$;

revoke all on function public.admin_approve_bank_transfer_submission(uuid, uuid)
    from public, anon, authenticated;
revoke all on function public.admin_reject_bank_transfer_submission(uuid, uuid, text)
    from public, anon, authenticated;
grant execute on function public.admin_approve_bank_transfer_submission(uuid, uuid)
    to service_role;
grant execute on function public.admin_reject_bank_transfer_submission(uuid, uuid, text)
    to service_role;
