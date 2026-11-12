-- Yoco client payments: private atomic payment operations
-- Target branch: feature/yoco-client-payments
-- REVIEW-ONLY. Do not execute against production.
-- Requires migrations 001 and 002.
-- Test environment only. No live keys, provider calls, or live activation.
--
-- These SECURITY DEFINER functions are intended to be invoked only by trusted
-- server-side Edge Functions using service_role. Browser roles receive no
-- execute privileges. Provider signatures must be verified against the exact
-- raw HTTP body in the Edge Function before an event is recorded here.

begin;

grant usage on schema innerme_private to service_role;

-- ---------------------------------------------------------------------------
-- 1. Create an invoice-bound payment attempt.
-- ---------------------------------------------------------------------------

create or replace function innerme_private.create_yoco_payment_attempt(
    p_invoice_id uuid,
    p_client_id uuid,
    p_amount_cents bigint,
    p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_invoice public.invoices%rowtype;
    v_attempt public.payment_attempts%rowtype;
    v_outstanding_cents bigint;
begin
    if p_invoice_id is null or p_client_id is null then
        raise exception 'Invoice and client are required.';
    end if;
    if p_amount_cents is null or p_amount_cents < 200 then
        raise exception 'Payment amount is below the supported minimum.';
    end if;
    if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then
        raise exception 'A valid idempotency key is required.';
    end if;

    select *
    into v_invoice
    from public.invoices
    where id = p_invoice_id
      and client_id = p_client_id
    for update;

    if not found then
        raise exception 'Invoice not found for this client.';
    end if;
    if not coalesce(v_invoice.online_payment_enabled, false) then
        raise exception 'Online payment is not enabled for this invoice.';
    end if;
    if v_invoice.status in ('draft', 'cancelled') then
        raise exception 'This invoice cannot accept an online payment.';
    end if;

    v_outstanding_cents := round(
        greatest(coalesce(v_invoice.amount_outstanding, 0), 0) * 100
    )::bigint;

    if v_outstanding_cents < 200 or p_amount_cents > v_outstanding_cents then
        raise exception 'The requested amount exceeds the outstanding invoice balance.';
    end if;

    if p_amount_cents < v_outstanding_cents
       and not coalesce(v_invoice.partial_payment_enabled, false) then
        raise exception 'Partial payments are not enabled for this invoice.';
    end if;

    -- A configured deposit is the minimum first payment only. Once any
    -- payment has been recorded against the invoice, later instalments may be
    -- smaller than the initial deposit.
    if coalesce(v_invoice.deposit_amount, 0) > 0
       and not exists (
           select 1
           from public.payments p
           where p.invoice_id = v_invoice.id
             and p.status in ('paid', 'partially paid')
       )
       and p_amount_cents < round(v_invoice.deposit_amount * 100)::bigint then
        raise exception 'The requested first payment is below the required deposit.';
    end if;

    insert into public.payment_attempts (
        invoice_id, client_id, provider, environment, amount_cents,
        currency, idempotency_key, status
    )
    values (
        p_invoice_id, p_client_id, 'yoco', 'test', p_amount_cents,
        'ZAR', btrim(p_idempotency_key), 'created'
    )
    on conflict (provider, environment, client_id, idempotency_key)
    do nothing;

    select *
    into v_attempt
    from public.payment_attempts
    where provider = 'yoco'
      and environment = 'test'
      and client_id = p_client_id
      and idempotency_key = btrim(p_idempotency_key)
    for update;

    if v_attempt.invoice_id <> p_invoice_id
       or v_attempt.amount_cents <> p_amount_cents then
        raise exception 'Idempotency key was already used for a different payment request.';
    end if;

    return jsonb_build_object(
        'attempt_id', v_attempt.id,
        'invoice_id', v_attempt.invoice_id,
        'amount_cents', v_attempt.amount_cents,
        'currency', v_attempt.currency,
        'status', v_attempt.status,
        'provider_checkout_id', v_attempt.provider_checkout_id,
        'checkout_url', v_attempt.checkout_url
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Attach the provider-created hosted checkout to its attempt.
-- ---------------------------------------------------------------------------

create or replace function innerme_private.attach_yoco_checkout(
    p_attempt_id uuid,
    p_provider_checkout_id text,
    p_checkout_url text,
    p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_attempt public.payment_attempts%rowtype;
begin
    if p_provider_checkout_id is null
       or length(btrim(p_provider_checkout_id)) = 0
       or p_checkout_url is null
       or p_checkout_url !~ '^https://'
    then
        raise exception 'A valid provider checkout ID and HTTPS checkout URL are required.';
    end if;

    select *
    into v_attempt
    from public.payment_attempts
    where id = p_attempt_id
    for update;

    if not found then
        raise exception 'Payment attempt not found.';
    end if;

    if v_attempt.status = 'succeeded' then
        return jsonb_build_object(
            'attempt_id', v_attempt.id,
            'status', v_attempt.status,
            'provider_checkout_id', v_attempt.provider_checkout_id
        );
    end if;

    if v_attempt.status not in ('created', 'pending') then
        raise exception 'This payment attempt cannot accept a checkout.';
    end if;

    if v_attempt.provider_checkout_id is not null
       and v_attempt.provider_checkout_id <> p_provider_checkout_id then
        raise exception 'A different checkout is already attached to this attempt.';
    end if;

    update public.payment_attempts
    set provider_checkout_id = btrim(p_provider_checkout_id),
        checkout_url = p_checkout_url,
        status = 'pending',
        expires_at = coalesce(p_expires_at, expires_at),
        updated_at = now()
    where id = p_attempt_id
    returning * into v_attempt;

    return jsonb_build_object(
        'attempt_id', v_attempt.id,
        'status', v_attempt.status,
        'provider_checkout_id', v_attempt.provider_checkout_id,
        'checkout_url', v_attempt.checkout_url,
        'expires_at', v_attempt.expires_at
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Persist only already-verified webhook metadata. Event identity is unique.
-- ---------------------------------------------------------------------------

create or replace function innerme_private.record_verified_yoco_webhook(
    p_provider_event_id text,
    p_event_type text,
    p_body_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_event public.payment_webhook_events%rowtype;
    v_inserted_count integer := 0;
begin
    if p_provider_event_id is null or length(btrim(p_provider_event_id)) = 0
       or p_event_type is null or length(btrim(p_event_type)) = 0
       or p_body_sha256 is null or p_body_sha256 !~ '^[0-9a-fA-F]{64}$'
    then
        raise exception 'Webhook event metadata is invalid.';
    end if;

    insert into public.payment_webhook_events (
        provider, environment, provider_event_id, event_type,
        signature_verified, body_sha256, processing_status
    )
    values (
        'yoco', 'test', btrim(p_provider_event_id), btrim(p_event_type),
        true, lower(p_body_sha256), 'received'
    )
    on conflict (provider, environment, provider_event_id)
    do nothing;

    get diagnostics v_inserted_count = row_count;

    select *
    into v_event
    from public.payment_webhook_events
    where provider = 'yoco'
      and environment = 'test'
      and provider_event_id = btrim(p_provider_event_id)
    for update;

    if v_event.event_type <> btrim(p_event_type)
       or v_event.body_sha256 <> lower(p_body_sha256) then
        update public.payment_webhook_events
        set processing_status = 'requires_review',
            failure_code = 'event_identity_payload_conflict',
            failure_message = 'The same provider event ID was received with different event content.'
        where id = v_event.id;

        return jsonb_build_object(
            'event_id', v_event.id,
            'event_type', v_event.event_type,
            'processing_status', 'requires_review',
            'duplicate', true,
            'reason', 'event_identity_payload_conflict'
        );
    end if;

    return jsonb_build_object(
        'event_id', v_event.id,
        'event_type', v_event.event_type,
        'processing_status', v_event.processing_status,
        'duplicate', v_inserted_count = 0
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Settle a verified payment exactly once and issue its receipt.
--    The caller supplies normalized fields only after verifying the provider
--    signature and parsing the official event. Success redirect is not proof.
-- ---------------------------------------------------------------------------

create or replace function innerme_private.settle_yoco_payment(
    p_attempt_id uuid,
    p_event_id uuid,
    p_provider_checkout_id text,
    p_amount_cents bigint,
    p_currency text,
    p_processing_mode text,
    p_provider_transaction_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_attempt public.payment_attempts%rowtype;
    v_event public.payment_webhook_events%rowtype;
    v_invoice public.invoices%rowtype;
    v_payment public.payments%rowtype;
    v_receipt public.payment_receipts%rowtype;
    v_payment_amount numeric(12,2);
    v_available_cents bigint;
    v_receipt_number text;
    v_snapshot jsonb;
    v_sequence bigint;
begin
    -- Lock order: attempt, webhook event, invoice. All settlement callers must
    -- follow this order; invoice payment guard then re-locks the same invoice.
    select * into v_attempt
    from public.payment_attempts
    where id = p_attempt_id
    for update;

    if not found then
        raise exception 'Payment attempt not found.';
    end if;

    select * into v_event
    from public.payment_webhook_events
    where id = p_event_id
    for update;

    if not found then
        raise exception 'Verified webhook event not found.';
    end if;

    if v_event.payment_attempt_id is not null
       and v_event.payment_attempt_id <> v_attempt.id then
        raise exception 'Webhook event is already associated with a different payment attempt.';
    end if;

    if v_event.provider <> 'yoco'
       or v_event.environment <> 'test'
       or not v_event.signature_verified
       or v_event.event_type <> 'payment.succeeded' then
        raise exception 'Webhook event is not an eligible verified test payment success.';
    end if;

    if v_attempt.status not in ('created', 'pending', 'requires_review', 'succeeded') then
        raise exception 'Payment attempt is not in a settleable state.';
    end if;

    if v_attempt.provider_checkout_id is null
       or v_attempt.provider_checkout_id <> p_provider_checkout_id then
        raise exception 'Provider checkout ID does not match the payment attempt.';
    end if;

    if p_amount_cents is distinct from v_attempt.amount_cents
       or upper(coalesce(p_currency, '')) <> v_attempt.currency
       or lower(coalesce(p_processing_mode, '')) <> 'test' then
        if v_attempt.status <> 'succeeded' then
            update public.payment_attempts
            set status = 'requires_review',
                failure_code = 'provider_payment_mismatch',
                failure_message = 'Provider amount, currency, or processing mode did not match the attempt.',
                updated_at = now()
            where id = v_attempt.id;
        end if;

        update public.payment_webhook_events
        set payment_attempt_id = v_attempt.id,
            processing_status = 'requires_review',
            failure_code = 'provider_payment_mismatch',
            processed_at = now()
        where id = v_event.id;

        return jsonb_build_object(
            'settled', false,
            'requires_review', true,
            'reason', 'provider_payment_mismatch'
        );
    end if;

    if v_attempt.status = 'succeeded' and v_attempt.payment_id is not null then
        select * into v_payment
        from public.payments
        where id = v_attempt.payment_id;

        select * into v_receipt
        from public.payment_receipts
        where payment_id = v_payment.id;

        update public.payment_webhook_events
        set payment_attempt_id = v_attempt.id,
            processing_status = 'processed',
            processed_at = coalesce(processed_at, now())
        where id = v_event.id;

        return jsonb_build_object(
            'settled', true,
            'duplicate', true,
            'payment_id', v_payment.id,
            'receipt_number', v_receipt.receipt_number
        );
    end if;

    if v_attempt.status = 'succeeded' then
        raise exception 'Settled payment attempt is missing its payment ledger reference.';
    end if;

    select * into v_invoice
    from public.invoices
    where id = v_attempt.invoice_id
    for update;

    if not found
       or v_invoice.client_id <> v_attempt.client_id
       or v_invoice.status in ('draft', 'cancelled') then
        update public.payment_attempts
        set status = 'requires_review',
            failure_code = 'invoice_unavailable',
            updated_at = now()
        where id = v_attempt.id;

        update public.payment_webhook_events
        set payment_attempt_id = v_attempt.id,
            processing_status = 'requires_review',
            failure_code = 'invoice_unavailable',
            processed_at = now()
        where id = v_event.id;

        return jsonb_build_object(
            'settled', false,
            'requires_review', true,
            'reason', 'invoice_unavailable'
        );
    end if;

    -- Distinct checkouts can be created while an invoice has sufficient
    -- balance. Recheck the locked invoice at settlement so only one of
    -- competing successful checkouts can consume the same outstanding funds.
    -- A provider-captured payment that no longer fits the balance is kept out
    -- of the ledger and marked for manual reconciliation rather than retried
    -- indefinitely or allowed to overpay the invoice.
    v_available_cents := round(
        greatest(coalesce(v_invoice.amount_outstanding, 0), 0) * 100
    )::bigint;

    if v_attempt.amount_cents > v_available_cents then
        update public.payment_attempts
        set status = 'requires_review',
            failure_code = 'invoice_balance_changed',
            failure_message = 'A different payment reduced the invoice balance before this checkout was confirmed.',
            updated_at = now()
        where id = v_attempt.id;

        update public.payment_webhook_events
        set payment_attempt_id = v_attempt.id,
            processing_status = 'requires_review',
            failure_code = 'invoice_balance_changed',
            failure_message = 'Verified provider payment exceeds the invoice balance remaining at settlement.',
            processed_at = now()
        where id = v_event.id;

        return jsonb_build_object(
            'settled', false,
            'requires_review', true,
            'reason', 'invoice_balance_changed'
        );
    end if;

    v_payment_amount := (v_attempt.amount_cents::numeric / 100)::numeric(12,2);

    insert into public.payments (
        client_id, project_id, invoice_id, amount, status, method,
        reference, paid_at, provider, provider_checkout_id,
        provider_transaction_id, currency, notes
    )
    values (
        v_attempt.client_id,
        v_invoice.project_id,
        v_invoice.id,
        v_payment_amount,
        'paid',
        'Card',
        v_attempt.provider_checkout_id,
        now(),
        'yoco',
        v_attempt.provider_checkout_id,
        nullif(btrim(coalesce(p_provider_transaction_id, '')), ''),
        v_attempt.currency,
        'Confirmed by verified Yoco test webhook.'
    )
    returning * into v_payment;

    update public.payment_attempts
    set status = 'succeeded',
        payment_id = v_payment.id,
        settled_at = now(),
        updated_at = now(),
        failure_code = null,
        failure_message = null
    where id = v_attempt.id;

    v_sequence := nextval('public.swayphics_payment_receipt_seq'::regclass);
    v_receipt_number := 'SW-RCPT-' ||
        to_char(now() at time zone 'Africa/Johannesburg', 'YYYY') ||
        '-' || lpad(v_sequence::text, 6, '0');

    v_snapshot := jsonb_build_object(
        'receipt_number', v_receipt_number,
        'issued_at', now(),
        'business', 'Swayphics',
        'client_id', v_attempt.client_id,
        'invoice_id', v_invoice.id,
        'invoice_number', v_invoice.invoice_number,
        'payment_id', v_payment.id,
        'amount', v_payment.amount,
        'currency', v_payment.currency,
        'method', 'Card',
        'provider', 'Yoco',
        'provider_checkout_id', v_attempt.provider_checkout_id,
        'payment_date', v_payment.paid_at
    );

    insert into public.payment_receipts (
        payment_id, receipt_number, snapshot
    )
    values (
        v_payment.id, v_receipt_number, v_snapshot
    )
    on conflict (payment_id) do nothing
    returning * into v_receipt;

    if v_receipt.id is null then
        select * into v_receipt
        from public.payment_receipts
        where payment_id = v_payment.id;
    end if;

    update public.payment_webhook_events
    set payment_attempt_id = v_attempt.id,
        processing_status = 'processed',
        processed_at = now(),
        failure_code = null,
        failure_message = null
    where id = v_event.id;

    return jsonb_build_object(
        'settled', true,
        'duplicate', false,
        'payment_id', v_payment.id,
        'receipt_number', v_receipt.receipt_number,
        'amount', v_payment.amount,
        'currency', v_payment.currency
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Record a provider-confirmed refund without exceeding the payment amount.
--    Pending refunds are not created here; only verified refund.succeeded events
--    are accepted. Refund ledger remains separate from the original payment.
-- ---------------------------------------------------------------------------

create or replace function innerme_private.record_yoco_refund_success(
    p_event_id uuid,
    p_payment_id uuid,
    p_provider_refund_id text,
    p_amount_cents bigint,
    p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_event public.payment_webhook_events%rowtype;
    v_payment public.payments%rowtype;
    v_refund public.payment_refunds%rowtype;
    v_existing_refunds numeric(12,2);
    v_refund_amount numeric(12,2);
begin
    select * into v_payment
    from public.payments
    where id = p_payment_id
    for update;

    if not found or v_payment.provider <> 'yoco' then
        raise exception 'Yoco payment not found.';
    end if;

    select * into v_event
    from public.payment_webhook_events
    where id = p_event_id
    for update;

    if not found
       or v_event.provider <> 'yoco'
       or v_event.environment <> 'test'
       or not v_event.signature_verified
       or v_event.event_type <> 'refund.succeeded' then
        raise exception 'Webhook event is not an eligible verified refund success.';
    end if;

    if v_event.payment_attempt_id is null
       or not exists (
           select 1
           from public.payment_attempts a
           where a.id = v_event.payment_attempt_id
             and a.provider = 'yoco'
             and a.environment = 'test'
             and a.payment_id = v_payment.id
       ) then
        raise exception 'Refund event is not bound to the matching Yoco payment attempt.';
    end if;

    if p_provider_refund_id is null
       or length(btrim(p_provider_refund_id)) = 0
       or p_amount_cents is null
       or p_amount_cents < 1
       or upper(coalesce(p_currency, '')) <> v_payment.currency then
        raise exception 'Refund provider reference, amount, or currency is invalid.';
    end if;

    v_refund_amount := (p_amount_cents::numeric / 100)::numeric(12,2);

    select coalesce(sum(r.amount), 0)
    into v_existing_refunds
    from public.payment_refunds r
    where r.payment_id = v_payment.id
      and r.status = 'succeeded';

    select * into v_refund
    from public.payment_refunds
    where provider = 'yoco'
      and environment = 'test'
      and provider_refund_id = btrim(p_provider_refund_id);

    if found then
        if v_refund.payment_id <> v_payment.id
           or v_refund.amount <> v_refund_amount then
            raise exception 'Refund reference conflicts with an existing refund record.';
        end if;

        update public.payment_webhook_events
        set processing_status = 'processed',
            processed_at = now()
        where id = v_event.id;

        return jsonb_build_object(
            'recorded', true,
            'duplicate', true,
            'refund_id', v_refund.id
        );
    end if;

    if v_existing_refunds + v_refund_amount > v_payment.amount then
        update public.payment_webhook_events
        set processing_status = 'requires_review',
            failure_code = 'refund_exceeds_payment',
            failure_message = 'Verified refund amount exceeds the remaining refundable payment amount.',
            processed_at = now()
        where id = v_event.id;

        return jsonb_build_object(
            'recorded', false,
            'requires_review', true,
            'reason', 'refund_exceeds_payment'
        );
    end if;

    insert into public.payment_refunds (
        payment_id, provider, environment, provider_refund_id,
        amount, currency, status, provider_event_id, processed_at
    )
    values (
        v_payment.id, 'yoco', 'test', btrim(p_provider_refund_id),
        v_refund_amount, v_payment.currency, 'succeeded',
        v_event.provider_event_id, now()
    )
    returning * into v_refund;

    update public.payment_webhook_events
    set processing_status = 'processed',
        processed_at = now()
    where id = v_event.id;

    return jsonb_build_object(
        'recorded', true,
        'duplicate', false,
        'refund_id', v_refund.id,
        'amount', v_refund.amount,
        'currency', v_refund.currency
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Restrict private operations to the trusted server role.
-- ---------------------------------------------------------------------------

revoke all on function innerme_private.create_yoco_payment_attempt(uuid, uuid, bigint, text)
    from public, anon, authenticated;
revoke all on function innerme_private.attach_yoco_checkout(uuid, text, text, timestamptz)
    from public, anon, authenticated;
revoke all on function innerme_private.record_verified_yoco_webhook(text, text, text)
    from public, anon, authenticated;
revoke all on function innerme_private.settle_yoco_payment(uuid, uuid, text, bigint, text, text, text)
    from public, anon, authenticated;
revoke all on function innerme_private.record_yoco_refund_success(uuid, uuid, text, bigint, text)
    from public, anon, authenticated;

grant execute on function innerme_private.create_yoco_payment_attempt(uuid, uuid, bigint, text)
    to service_role;
grant execute on function innerme_private.attach_yoco_checkout(uuid, text, text, timestamptz)
    to service_role;
grant execute on function innerme_private.record_verified_yoco_webhook(text, text, text)
    to service_role;
grant execute on function innerme_private.settle_yoco_payment(uuid, uuid, text, bigint, text, text, text)
    to service_role;
grant execute on function innerme_private.record_yoco_refund_success(uuid, uuid, text, bigint, text)
    to service_role;

commit;

-- Deferred to later stages:
--   * provider API Edge Functions and raw-body HMAC verification
--   * retry/replay worker and dead-letter monitoring
--   * receipt immutability trigger and receipt download endpoint
--   * admin reconciliation UI and manual payout reconciliation
--   * client portal payment status polling and checkout UX
--   * live mode, live secrets, production migrations, and deployment
