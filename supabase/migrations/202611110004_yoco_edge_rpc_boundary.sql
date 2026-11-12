-- Yoco client payments: service-role RPC boundary for Edge Functions
-- Target branch: feature/yoco-client-payments
-- REVIEW-ONLY. Do not execute against production.
-- Requires migrations 001-003.
--
-- The operational functions live in innerme_private, which is intentionally
-- not exposed through PostgREST. These narrow public wrappers are callable
-- only by service_role and provide the Edge Functions a stable RPC boundary.

begin;

create or replace function public.yoco_create_payment_attempt(
    p_invoice_id uuid,
    p_client_id uuid,
    p_amount_cents bigint,
    p_idempotency_key text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
    select innerme_private.create_yoco_payment_attempt(
        p_invoice_id, p_client_id, p_amount_cents, p_idempotency_key
    );
$$;

create or replace function public.yoco_attach_checkout(
    p_attempt_id uuid,
    p_provider_checkout_id text,
    p_checkout_url text,
    p_expires_at timestamptz default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
    select innerme_private.attach_yoco_checkout(
        p_attempt_id, p_provider_checkout_id, p_checkout_url, p_expires_at
    );
$$;

create or replace function public.yoco_record_verified_webhook(
    p_provider_event_id text,
    p_event_type text,
    p_body_sha256 text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
    select innerme_private.record_verified_yoco_webhook(
        p_provider_event_id, p_event_type, p_body_sha256
    );
$$;

create or replace function public.yoco_settle_payment(
    p_attempt_id uuid,
    p_event_id uuid,
    p_provider_checkout_id text,
    p_amount_cents bigint,
    p_currency text,
    p_processing_mode text,
    p_provider_transaction_id text default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
    select innerme_private.settle_yoco_payment(
        p_attempt_id, p_event_id, p_provider_checkout_id,
        p_amount_cents, p_currency, p_processing_mode,
        p_provider_transaction_id
    );
$$;

create or replace function public.yoco_record_refund_success(
    p_event_id uuid,
    p_payment_id uuid,
    p_provider_refund_id text,
    p_amount_cents bigint,
    p_currency text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
    select innerme_private.record_yoco_refund_success(
        p_event_id, p_payment_id, p_provider_refund_id,
        p_amount_cents, p_currency
    );
$$;

revoke all on function public.yoco_create_payment_attempt(uuid, uuid, bigint, text)
    from public, anon, authenticated;
revoke all on function public.yoco_attach_checkout(uuid, text, text, timestamptz)
    from public, anon, authenticated;
revoke all on function public.yoco_record_verified_webhook(text, text, text)
    from public, anon, authenticated;
revoke all on function public.yoco_settle_payment(uuid, uuid, text, bigint, text, text, text)
    from public, anon, authenticated;
revoke all on function public.yoco_record_refund_success(uuid, uuid, text, bigint, text)
    from public, anon, authenticated;

grant execute on function public.yoco_create_payment_attempt(uuid, uuid, bigint, text)
    to service_role;
grant execute on function public.yoco_attach_checkout(uuid, text, text, timestamptz)
    to service_role;
grant execute on function public.yoco_record_verified_webhook(text, text, text)
    to service_role;
grant execute on function public.yoco_settle_payment(uuid, uuid, text, bigint, text, text, text)
    to service_role;
grant execute on function public.yoco_record_refund_success(uuid, uuid, text, bigint, text)
    to service_role;

commit;
