-- Yoco client payments: additive database foundation
-- Target branch: feature/yoco-client-payments
-- IMPORTANT:
--   * Review-only migration. Do not execute against production.
--   * Test environment only. No live payment support is enabled.
--   * Existing invoice/payment triggers and balance functions are intentionally
--     NOT replaced in this migration.
--   * Edge Functions and atomic settlement are separate implementation work.

begin;

-- ---------------------------------------------------------------------------
-- 1. Add provider metadata to the existing payment ledger.
--    Keep method='Card'; provider identifies the processor separately.
-- ---------------------------------------------------------------------------

alter table public.payments
    add column if not exists provider text,
    add column if not exists provider_transaction_id text,
    add column if not exists provider_checkout_id text,
    add column if not exists currency text not null default 'ZAR';

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.payments'::regclass
          and conname = 'payments_provider_check'
    ) then
        alter table public.payments
            add constraint payments_provider_check
            check (provider is null or provider in ('yoco'));
    end if;
end;
$$;

create unique index if not exists payments_provider_transaction_uidx
    on public.payments(provider, provider_transaction_id)
    where provider is not null
      and provider_transaction_id is not null;

create unique index if not exists payments_provider_checkout_uidx
    on public.payments(provider, provider_checkout_id)
    where provider is not null
      and provider_checkout_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Add invoice-level online payment controls. Disabled by default.
-- ---------------------------------------------------------------------------

alter table public.invoices
    add column if not exists online_payment_enabled boolean not null default false,
    add column if not exists partial_payment_enabled boolean not null default false,
    add column if not exists deposit_amount numeric(12,2);

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.invoices'::regclass
          and conname = 'invoices_deposit_amount_check'
    ) then
        alter table public.invoices
            add constraint invoices_deposit_amount_check
            check (deposit_amount is null or deposit_amount > 0);
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Payment attempts. A checkout attempt is not a payment.
--    No permanent one-open-attempt-per-invoice index is used: timed-out
--    provider requests need to be recoverable without blocking the invoice.
-- ---------------------------------------------------------------------------

create table if not exists public.payment_attempts (
    id uuid primary key default gen_random_uuid(),
    invoice_id uuid not null references public.invoices(id) on delete restrict,
    client_id uuid not null references public.clients(id) on delete restrict,
    provider text not null default 'yoco' check (provider = 'yoco'),
    environment text not null default 'test' check (environment = 'test'),
    amount_cents bigint not null check (amount_cents >= 200),
    currency text not null default 'ZAR' check (currency = 'ZAR'),
    idempotency_key text not null,
    provider_checkout_id text,
    checkout_url text,
    status text not null default 'created'
        check (status in (
            'created',
            'pending',
            'succeeded',
            'failed',
            'abandoned',
            'expired',
            'requires_review'
        )),
    payment_id uuid references public.payments(id) on delete restrict,
    failure_code text,
    failure_message text,
    expires_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    settled_at timestamptz,
    constraint payment_attempts_idempotency_key_nonempty
        check (length(btrim(idempotency_key)) > 0)
);

create unique index if not exists payment_attempts_idempotency_uidx
    on public.payment_attempts(provider, environment, client_id, idempotency_key);

create unique index if not exists payment_attempts_checkout_uidx
    on public.payment_attempts(provider, environment, provider_checkout_id)
    where provider_checkout_id is not null;

create unique index if not exists payment_attempts_payment_uidx
    on public.payment_attempts(payment_id)
    where payment_id is not null;

create index if not exists payment_attempts_invoice_created_idx
    on public.payment_attempts(invoice_id, created_at desc);

create index if not exists payment_attempts_client_created_idx
    on public.payment_attempts(client_id, created_at desc);

create index if not exists payment_attempts_status_created_idx
    on public.payment_attempts(status, created_at);

-- ---------------------------------------------------------------------------
-- 4. Webhook event inbox. Store only selected metadata and a body digest here;
--    raw request bodies should not be persisted by default.
-- ---------------------------------------------------------------------------

create table if not exists public.payment_webhook_events (
    id uuid primary key default gen_random_uuid(),
    provider text not null default 'yoco' check (provider = 'yoco'),
    environment text not null default 'test' check (environment = 'test'),
    provider_event_id text not null,
    event_type text not null,
    payment_attempt_id uuid references public.payment_attempts(id) on delete restrict,
    signature_verified boolean not null default false,
    body_sha256 text,
    processing_status text not null default 'received'
        check (processing_status in (
            'received',
            'processing',
            'processed',
            'failed_retryable',
            'requires_review',
            'rejected'
        )),
    failure_code text,
    failure_message text,
    received_at timestamptz not null default now(),
    processed_at timestamptz,
    constraint payment_webhook_event_id_nonempty
        check (length(btrim(provider_event_id)) > 0),
    constraint payment_webhook_event_type_nonempty
        check (length(btrim(event_type)) > 0)
);

create unique index if not exists payment_webhook_events_provider_event_uidx
    on public.payment_webhook_events(provider, environment, provider_event_id);

create index if not exists payment_webhook_events_status_received_idx
    on public.payment_webhook_events(processing_status, received_at);

create index if not exists payment_webhook_events_attempt_idx
    on public.payment_webhook_events(payment_attempt_id, received_at desc);

-- ---------------------------------------------------------------------------
-- 5. Refund ledger. A refund is a separate financial event; original payments
--    must never be deleted or rewritten to represent a refund.
-- ---------------------------------------------------------------------------

create table if not exists public.payment_refunds (
    id uuid primary key default gen_random_uuid(),
    payment_id uuid not null references public.payments(id) on delete restrict,
    provider text not null default 'yoco' check (provider = 'yoco'),
    environment text not null default 'test' check (environment = 'test'),
    provider_refund_id text,
    amount numeric(12,2) not null check (amount > 0),
    currency text not null default 'ZAR' check (currency = 'ZAR'),
    status text not null default 'pending'
        check (status in ('pending', 'succeeded', 'failed', 'requires_review')),
    reason text,
    provider_event_id text,
    created_at timestamptz not null default now(),
    processed_at timestamptz
);

create unique index if not exists payment_refunds_provider_refund_uidx
    on public.payment_refunds(provider, environment, provider_refund_id)
    where provider_refund_id is not null;

create index if not exists payment_refunds_payment_status_idx
    on public.payment_refunds(payment_id, status);

-- ---------------------------------------------------------------------------
-- 6. Receipt numbering and immutable receipt snapshots.
--    Sequence gaps after transaction rollback are acceptable; uniqueness is
--    the requirement. Receipt allocation is implemented with settlement later.
-- ---------------------------------------------------------------------------

create sequence if not exists public.swayphics_payment_receipt_seq
    as bigint
    start with 1
    increment by 1
    no cycle;

create table if not exists public.payment_receipts (
    id uuid primary key default gen_random_uuid(),
    payment_id uuid not null unique references public.payments(id) on delete restrict,
    receipt_number text not null unique,
    issued_at timestamptz not null default now(),
    snapshot jsonb not null,
    created_at timestamptz not null default now(),
    constraint payment_receipts_number_nonempty
        check (length(btrim(receipt_number)) > 0),
    constraint payment_receipts_snapshot_object
        check (jsonb_typeof(snapshot) = 'object')
);

create index if not exists payment_receipts_issued_idx
    on public.payment_receipts(issued_at desc);

-- ---------------------------------------------------------------------------
-- 7. Reconciliation cases. This table records investigation state; it does not
--    itself change the payment ledger or invoice balances.
-- ---------------------------------------------------------------------------

create table if not exists public.payment_reconciliation (
    id uuid primary key default gen_random_uuid(),
    payment_attempt_id uuid references public.payment_attempts(id) on delete restrict,
    payment_id uuid references public.payments(id) on delete restrict,
    refund_id uuid references public.payment_refunds(id) on delete restrict,
    provider text not null default 'yoco' check (provider = 'yoco'),
    environment text not null default 'test' check (environment = 'test'),
    discrepancy_type text not null
        check (discrepancy_type in (
            'unmatched_provider_transaction',
            'payment_missing_from_provider',
            'amount_mismatch',
            'currency_mismatch',
            'duplicate_transaction',
            'refund_mismatch',
            'payout_mismatch',
            'other'
        )),
    status text not null default 'open'
        check (status in ('open', 'investigating', 'resolved', 'dismissed')),
    summary text not null,
    resolution text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    resolved_at timestamptz,
    constraint payment_reconciliation_reference_check
        check (
            payment_attempt_id is not null
            or payment_id is not null
            or refund_id is not null
        )
);

create index if not exists payment_reconciliation_status_created_idx
    on public.payment_reconciliation(status, created_at desc);

create index if not exists payment_reconciliation_payment_idx
    on public.payment_reconciliation(payment_id)
    where payment_id is not null;

-- ---------------------------------------------------------------------------
-- 8. Enable RLS and deny direct browser-role access to operational records.
--    Service-role access is granted for server-side Edge Function workflows.
--    No client-facing policies are added in this foundation migration.
-- ---------------------------------------------------------------------------

alter table public.payment_attempts enable row level security;
alter table public.payment_webhook_events enable row level security;
alter table public.payment_refunds enable row level security;
alter table public.payment_receipts enable row level security;
alter table public.payment_reconciliation enable row level security;

revoke all privileges on table
    public.payment_attempts,
    public.payment_webhook_events,
    public.payment_refunds,
    public.payment_receipts,
    public.payment_reconciliation
from public, anon, authenticated;

grant select, insert, update, delete on table
    public.payment_attempts,
    public.payment_webhook_events,
    public.payment_refunds,
    public.payment_receipts,
    public.payment_reconciliation
to service_role;

revoke all privileges on sequence public.swayphics_payment_receipt_seq
from public, anon, authenticated;

grant usage, select on sequence public.swayphics_payment_receipt_seq
to service_role;

commit;

-- Deliberately not included:
--   * No invoice/payment trigger replacements.
--   * No refund-aware balance recalculation yet.
--   * No RPC settlement functions.
--   * No Yoco API or webhook calls.
--   * No client portal or admin policies for the new tables.
--   * No live environment support or live credentials.
