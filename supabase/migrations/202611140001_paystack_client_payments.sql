-- Paystack test-mode client payments.
-- Additive extension of the existing payment ledger. Yoco records and RPCs remain intact.
-- Test-only until a separate live-mode approval, credential configuration and rollout.
begin;

alter table public.payments drop constraint if exists payments_provider_check;
alter table public.payments add constraint payments_provider_check
  check (provider is null or provider in ('yoco','paystack'));

alter table public.payment_attempts drop constraint if exists payment_attempts_provider_check;
alter table public.payment_attempts add constraint payment_attempts_provider_check
  check (provider in ('yoco','paystack'));

alter table public.payment_webhook_events drop constraint if exists payment_webhook_events_provider_check;
alter table public.payment_webhook_events add constraint payment_webhook_events_provider_check
  check (provider in ('yoco','paystack'));

create or replace function innerme_private.create_paystack_payment_attempt(
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
        p_invoice_id, p_client_id, 'paystack', 'test', p_amount_cents,
        'ZAR', btrim(p_idempotency_key), 'created'
    )
    on conflict (provider, environment, client_id, idempotency_key)
    do nothing;

    select *
    into v_attempt
    from public.payment_attempts
    where provider = 'paystack'
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

create or replace function innerme_private.attach_paystack_checkout(
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

    if v_attempt.provider <> 'paystack' or v_attempt.environment <> 'test' then
        raise exception 'Only Paystack test payment attempts can receive this checkout.';
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

create or replace function innerme_private.record_verified_paystack_webhook(
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
        'paystack', 'test', btrim(p_provider_event_id), btrim(p_event_type),
        true, lower(p_body_sha256), 'received'
    )
    on conflict (provider, environment, provider_event_id)
    do nothing;

    get diagnostics v_inserted_count = row_count;

    select *
    into v_event
    from public.payment_webhook_events
    where provider = 'paystack'
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

create or replace function innerme_private.settle_paystack_payment(
    p_attempt_id uuid,
    p_event_id uuid,
    p_provider_checkout_id text,
    p_amount_cents bigint,
    p_currency text,
    p_processing_mode text,
    p_provider_transaction_id text default null,
    p_payment_channel text default null
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
    v_payment_method text;
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

    if v_event.provider <> 'paystack'
       or v_event.environment <> 'test'
       or not v_event.signature_verified
       or v_event.event_type <> 'charge.success' then
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
    v_payment_method := case lower(coalesce(p_payment_channel, ''))
        when 'card' then 'Card'
        when 'eft' then 'EFT'
        when 'bank' then 'EFT'
        when 'bank_transfer' then 'EFT'
        when 'capitec_pay' then 'EFT'
        else 'Other'
    end;

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
        v_payment_method,
        v_attempt.provider_checkout_id,
        now(),
        'paystack',
        v_attempt.provider_checkout_id,
        nullif(btrim(coalesce(p_provider_transaction_id, '')), ''),
        v_attempt.currency,
        'Confirmed by verified Paystack test webhook. Channel: ' || coalesce(lower(p_payment_channel), 'unreported')
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
        'method', v_payment_method,
        'provider', 'Paystack',
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

create or replace function innerme_private.claim_paystack_webhook_event(
  p_event_id uuid,
  p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.payment_webhook_events%rowtype;
  v_token uuid;
begin
  if p_event_id is null or p_lease_seconds is null
     or p_lease_seconds < 30 or p_lease_seconds > 300 then
    raise exception 'Invalid webhook lease request.';
  end if;

  select * into v_event
  from public.payment_webhook_events
  where id = p_event_id
    and provider = 'paystack'
    and environment = 'test'
    and signature_verified
  for update;

  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'event_unavailable');
  end if;

  if v_event.processing_status in ('processed','requires_review','rejected') then
    return jsonb_build_object('claimed', false, 'reason', 'terminal',
      'processing_status', v_event.processing_status);
  end if;

  if v_event.processing_status not in ('received','processing','failed_retryable') then
    return jsonb_build_object('claimed', false, 'reason', 'unknown_state');
  end if;

  if v_event.processing_lease_expires_at is not null
     and v_event.processing_lease_expires_at > now() then
    return jsonb_build_object('claimed', false, 'reason', 'lease_active',
      'lease_expires_at', v_event.processing_lease_expires_at);
  end if;

  v_token := gen_random_uuid();
  update public.payment_webhook_events
  set processing_status = 'processing',
      processing_lease_token = v_token,
      processing_lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      failure_code = null,
      failure_message = null
  where id = p_event_id;

  return jsonb_build_object(
    'claimed', true,
    'lease_token', v_token,
    'lease_expires_at', now() + make_interval(secs => p_lease_seconds)
  );
end;
$$;

create or replace function innerme_private.update_paystack_webhook_event(
  p_event_id uuid,
  p_lease_token uuid,
  p_processing_status text,
  p_payment_attempt_id uuid default null,
  p_failure_code text default null,
  p_failure_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if p_processing_status is null or p_processing_status not in ('processing','processed','failed_retryable','requires_review','rejected') then
    raise exception 'Invalid webhook event state.';
  end if;
  update public.payment_webhook_events
  set processing_status = p_processing_status,
      payment_attempt_id = coalesce(p_payment_attempt_id, payment_attempt_id),
      failure_code = p_failure_code,
      failure_message = p_failure_message,
      processed_at = case when p_processing_status in ('processed','requires_review','rejected') then now() else null end,
      processing_lease_token = case when p_processing_status = 'processing' then processing_lease_token else null end,
      processing_lease_expires_at = case when p_processing_status = 'processing' then processing_lease_expires_at else null end
  where id = p_event_id
    and processing_lease_token = p_lease_token
    and processing_lease_expires_at > now()
    and provider = 'paystack'
    and environment = 'test'
    and processing_status = 'processing';
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create or replace function innerme_private.settle_paystack_payment_with_lease(
  p_attempt_id uuid,
  p_event_id uuid,
  p_lease_token uuid,
  p_provider_checkout_id text,
  p_amount_cents bigint,
  p_currency text,
  p_processing_mode text,
  p_provider_transaction_id text default null,
  p_payment_channel text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.payment_webhook_events%rowtype;
  v_result jsonb;
begin
  perform 1 from public.payment_attempts where id = p_attempt_id for update;
  if not found then raise exception 'Payment attempt not found.'; end if;

  select * into v_event from public.payment_webhook_events
  where id = p_event_id for update;
  if not found
     or v_event.provider <> 'paystack'
     or v_event.environment <> 'test'
     or v_event.processing_status <> 'processing'
     or v_event.processing_lease_token is distinct from p_lease_token
     or v_event.processing_lease_expires_at is null
     or v_event.processing_lease_expires_at <= now() then
    raise exception 'Webhook processing lease is missing, expired, or stale.';
  end if;

  v_result := innerme_private.settle_paystack_payment(
    p_attempt_id, p_event_id, p_provider_checkout_id, p_amount_cents,
    p_currency, p_processing_mode, p_provider_transaction_id, p_payment_channel
  );
  update public.payment_webhook_events
  set processing_lease_token = null, processing_lease_expires_at = null
  where id = p_event_id;
  return v_result;
end;
$$;


create or replace function public.paystack_create_payment_attempt(
    p_invoice_id uuid, p_client_id uuid, p_amount_cents bigint, p_idempotency_key text
) returns jsonb language sql security definer set search_path = '' as $$
  select innerme_private.create_paystack_payment_attempt(p_invoice_id,p_client_id,p_amount_cents,p_idempotency_key);
$$;

create or replace function public.paystack_attach_checkout(
    p_attempt_id uuid, p_provider_checkout_id text, p_checkout_url text, p_expires_at timestamptz default null
) returns jsonb language sql security definer set search_path = '' as $$
  select innerme_private.attach_paystack_checkout(p_attempt_id,p_provider_checkout_id,p_checkout_url,p_expires_at);
$$;

create or replace function public.paystack_record_verified_webhook(
    p_provider_event_id text, p_event_type text, p_body_sha256 text
) returns jsonb language sql security definer set search_path = '' as $$
  select innerme_private.record_verified_paystack_webhook(p_provider_event_id,p_event_type,p_body_sha256);
$$;

create or replace function public.paystack_claim_webhook_event(
    p_event_id uuid, p_lease_seconds integer default 120
) returns jsonb language sql security definer set search_path = '' as $$
  select innerme_private.claim_paystack_webhook_event(p_event_id,p_lease_seconds);
$$;

create or replace function public.paystack_update_webhook_event(
    p_event_id uuid, p_lease_token uuid, p_processing_status text,
    p_payment_attempt_id uuid default null, p_failure_code text default null,
    p_failure_message text default null
) returns boolean language sql security definer set search_path = '' as $$
  select innerme_private.update_paystack_webhook_event(
    p_event_id,p_lease_token,p_processing_status,p_payment_attempt_id,p_failure_code,p_failure_message
  );
$$;

create or replace function public.paystack_settle_payment_with_lease(
    p_attempt_id uuid, p_event_id uuid, p_lease_token uuid,
    p_provider_checkout_id text, p_amount_cents bigint, p_currency text,
    p_processing_mode text, p_provider_transaction_id text default null,
    p_payment_channel text default null
) returns jsonb language sql security definer set search_path = '' as $$
  select innerme_private.settle_paystack_payment_with_lease(
    p_attempt_id,p_event_id,p_lease_token,p_provider_checkout_id,p_amount_cents,
    p_currency,p_processing_mode,p_provider_transaction_id,p_payment_channel
  );
$$;

create or replace function public.admin_set_invoice_online_payment_settings(
    p_invoice_id uuid, p_online_payment_enabled boolean,
    p_partial_payment_enabled boolean, p_deposit_amount numeric default null
) returns jsonb language sql security definer set search_path = '' as $$
  select public.admin_set_invoice_yoco_settings(
    p_invoice_id,p_online_payment_enabled,p_partial_payment_enabled,p_deposit_amount
  );
$$;



revoke all on function innerme_private.create_paystack_payment_attempt(uuid,uuid,bigint,text) from public,anon,authenticated;
revoke all on function innerme_private.attach_paystack_checkout(uuid,text,text,timestamptz) from public,anon,authenticated;
revoke all on function innerme_private.record_verified_paystack_webhook(text,text,text) from public,anon,authenticated;
revoke all on function innerme_private.settle_paystack_payment(uuid,uuid,text,bigint,text,text,text,text) from public,anon,authenticated;
revoke all on function innerme_private.claim_paystack_webhook_event(uuid,integer) from public,anon,authenticated;
revoke all on function innerme_private.update_paystack_webhook_event(uuid,uuid,text,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function innerme_private.settle_paystack_payment_with_lease(uuid,uuid,uuid,text,bigint,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function innerme_private.create_paystack_payment_attempt(uuid,uuid,bigint,text) to service_role;
grant execute on function innerme_private.attach_paystack_checkout(uuid,text,text,timestamptz) to service_role;
grant execute on function innerme_private.record_verified_paystack_webhook(text,text,text) to service_role;
grant execute on function innerme_private.claim_paystack_webhook_event(uuid,integer) to service_role;
revoke all on function public.paystack_create_payment_attempt(uuid,uuid,bigint,text) from public,anon,authenticated;
revoke all on function public.paystack_attach_checkout(uuid,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.paystack_record_verified_webhook(text,text,text) from public,anon,authenticated;
revoke all on function public.paystack_claim_webhook_event(uuid,integer) from public,anon,authenticated;
revoke all on function public.paystack_update_webhook_event(uuid,uuid,text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.paystack_settle_payment_with_lease(uuid,uuid,uuid,text,bigint,text,text,text,text) from public,anon,authenticated;
revoke all on function public.admin_set_invoice_online_payment_settings(uuid,boolean,boolean,numeric) from public,anon;
grant execute on function public.paystack_create_payment_attempt(uuid,uuid,bigint,text) to service_role;
grant execute on function public.paystack_attach_checkout(uuid,text,text,timestamptz) to service_role;
grant execute on function public.paystack_record_verified_webhook(text,text,text) to service_role;
grant execute on function public.paystack_claim_webhook_event(uuid,integer) to service_role;
grant execute on function public.paystack_update_webhook_event(uuid,uuid,text,uuid,text,text) to service_role;
grant execute on function public.paystack_settle_payment_with_lease(uuid,uuid,uuid,text,bigint,text,text,text,text) to service_role;
grant execute on function public.admin_set_invoice_online_payment_settings(uuid,boolean,boolean,numeric) to authenticated;


commit;
