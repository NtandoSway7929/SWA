-- Swayphics Paystack live payment integration.
-- Yoco remains test-only and existing invoice provider assignments are preserved.

ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS online_payment_provider text NOT NULL DEFAULT 'yoco';

UPDATE public.invoices
SET online_payment_provider = 'yoco'
WHERE online_payment_provider IS NULL OR btrim(online_payment_provider) = '';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.invoices'::regclass
          AND conname = 'invoices_online_payment_provider_check'
    ) THEN
        ALTER TABLE public.invoices
            ADD CONSTRAINT invoices_online_payment_provider_check
            CHECK (online_payment_provider IN ('paystack', 'yoco'));
    END IF;
END $$;

-- Existing invoices keep Yoco; invoices created after this migration default to Paystack.
ALTER TABLE public.invoices
    ALTER COLUMN online_payment_provider SET DEFAULT 'paystack';

ALTER TABLE public.payment_refunds
    ADD COLUMN IF NOT EXISTS provider_refund_reference text,
    ADD COLUMN IF NOT EXISTS provider_status text,
    ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Permit only the intended provider/environment combinations.
ALTER TABLE public.payment_attempts
    DROP CONSTRAINT IF EXISTS payment_attempts_provider_check,
    DROP CONSTRAINT IF EXISTS payment_attempts_environment_check;
ALTER TABLE public.payment_attempts
    ADD CONSTRAINT payment_attempts_provider_check
        CHECK (provider IN ('yoco', 'paystack')),
    ADD CONSTRAINT payment_attempts_environment_check
        CHECK (
            (provider = 'yoco' AND environment = 'test')
            OR (provider = 'paystack' AND environment = 'live')
        );

ALTER TABLE public.payments
    DROP CONSTRAINT IF EXISTS payments_provider_check;
ALTER TABLE public.payments
    ADD CONSTRAINT payments_provider_check
        CHECK (provider IS NULL OR provider IN ('yoco', 'paystack'));

ALTER TABLE public.payment_refunds
    DROP CONSTRAINT IF EXISTS payment_refunds_provider_check,
    DROP CONSTRAINT IF EXISTS payment_refunds_environment_check;
ALTER TABLE public.payment_refunds
    ADD CONSTRAINT payment_refunds_provider_check
        CHECK (provider IN ('yoco', 'paystack')),
    ADD CONSTRAINT payment_refunds_environment_check
        CHECK (
            (provider = 'yoco' AND environment = 'test')
            OR (provider = 'paystack' AND environment = 'live')
        );

ALTER TABLE public.payment_webhook_events
    DROP CONSTRAINT IF EXISTS payment_webhook_events_provider_check,
    DROP CONSTRAINT IF EXISTS payment_webhook_events_environment_check;
ALTER TABLE public.payment_webhook_events
    ADD CONSTRAINT payment_webhook_events_provider_check
        CHECK (provider IN ('yoco', 'paystack')),
    ADD CONSTRAINT payment_webhook_events_environment_check
        CHECK (
            (provider = 'yoco' AND environment = 'test')
            OR (provider = 'paystack' AND environment = 'live')
        );

ALTER TABLE public.payment_reconciliation
    DROP CONSTRAINT IF EXISTS payment_reconciliation_provider_check,
    DROP CONSTRAINT IF EXISTS payment_reconciliation_environment_check;
ALTER TABLE public.payment_reconciliation
    ADD CONSTRAINT payment_reconciliation_provider_check
        CHECK (provider IN ('yoco', 'paystack')),
    ADD CONSTRAINT payment_reconciliation_environment_check
        CHECK (
            (provider = 'yoco' AND environment = 'test')
            OR (provider = 'paystack' AND environment = 'live')
        );

CREATE UNIQUE INDEX IF NOT EXISTS payment_refunds_idempotency_uidx
    ON public.payment_refunds (provider, environment, payment_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payment_refunds_provider_reference_uidx
    ON public.payment_refunds (provider, environment, provider_refund_reference)
    WHERE provider_refund_reference IS NOT NULL;

-- Do not let a Paystack refund reservation be blocked by the Yoco-only guard.
-- Paystack's own atomic RPCs enforce verified event, payment, attempt and amount binding.
CREATE OR REPLACE FUNCTION innerme_private.validate_yoco_refund_event_binding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_event public.payment_webhook_events%rowtype;
    v_attempt public.payment_attempts%rowtype;
BEGIN
    IF NEW.provider = 'paystack' AND NEW.environment = 'live' THEN
        RETURN NEW;
    END IF;

    IF NEW.provider <> 'yoco' OR NEW.environment <> 'test'
       OR NEW.status <> 'succeeded' THEN
        RAISE EXCEPTION 'Only verified successful Yoco test refunds may enter this ledger.';
    END IF;

    IF NEW.provider_event_id IS NULL OR length(btrim(NEW.provider_event_id)) = 0 THEN
        RAISE EXCEPTION 'A provider event reference is required for a successful refund.';
    END IF;

    SELECT * INTO v_event
    FROM public.payment_webhook_events
    WHERE provider = 'yoco'
      AND environment = 'test'
      AND provider_event_id = NEW.provider_event_id
    FOR UPDATE;

    IF NOT FOUND
       OR NOT v_event.signature_verified
       OR v_event.event_type <> 'refund.succeeded'
       OR v_event.processing_status NOT IN ('received', 'processing') THEN
        RAISE EXCEPTION 'Refund does not reference an eligible verified provider event.';
    END IF;

    IF v_event.payment_attempt_id IS NULL THEN
        RAISE EXCEPTION 'Refund event is not bound to a local payment attempt.';
    END IF;

    SELECT * INTO v_attempt
    FROM public.payment_attempts
    WHERE id = v_event.payment_attempt_id
      AND provider = 'yoco'
      AND environment = 'test'
      AND payment_id = NEW.payment_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Refund event payment attempt does not match the payment ledger entry.';
    END IF;

    RETURN NEW;
END;
$function$;

-- Lock Yoco attempts to Yoco invoices after provider selection is introduced.

CREATE OR REPLACE FUNCTION innerme_private.create_yoco_payment_attempt(p_invoice_id uuid, p_client_id uuid, p_amount_cents bigint, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    if coalesce(v_invoice.online_payment_provider, 'yoco') <> 'yoco' then
        raise exception 'This invoice is configured for a different payment provider.';
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
$function$


-- Paystack server-side payment, webhook, settlement and refund functions.
CREATE OR REPLACE FUNCTION innerme_private.apply_paystack_refund_webhook_with_lease(p_event_id uuid, p_lease_token uuid, p_attempt_id uuid, p_payment_id uuid, p_transaction_reference text, p_provider_refund_id text, p_provider_refund_reference text, p_amount_cents bigint, p_currency text, p_provider_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_attempt public.payment_attempts%rowtype;
  v_event public.payment_webhook_events%rowtype;
  v_payment public.payments%rowtype;
  v_refund public.payment_refunds%rowtype;
  v_target_status text;
  v_refund_amount numeric(12,2);
  v_reserved numeric(12,2);
  v_candidate_count integer := 0;
  v_has_refund boolean := false;
  v_expected_event text;
begin
  if p_event_id is null or p_lease_token is null or p_attempt_id is null
     or p_payment_id is null or p_transaction_reference is null
     or p_amount_cents is null or p_amount_cents < 1
     or upper(coalesce(p_currency, '')) <> 'ZAR'
     or p_provider_status is null
     or p_provider_status not in ('pending','processing','needs-attention','failed','processed')
     or (p_provider_refund_id is not null and p_provider_refund_id !~ '^[0-9]+$')
     or (p_provider_refund_reference is not null
         and (length(btrim(p_provider_refund_reference)) < 8
              or length(btrim(p_provider_refund_reference)) > 64
              or btrim(p_provider_refund_reference) !~ '^[A-Za-z0-9_-]+$')) then
    raise exception 'Verified Paystack refund details are invalid.';
  end if;

  v_expected_event := case p_provider_status
    when 'pending' then 'refund.pending'
    when 'processing' then 'refund.processing'
    when 'needs-attention' then 'refund.needs-attention'
    when 'failed' then 'refund.failed'
    when 'processed' then 'refund.processed'
  end;

  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found or v_payment.provider <> 'paystack'
     or v_payment.currency <> 'ZAR'
     or v_payment.status <> 'paid' then
    raise exception 'Paystack refund payment is not eligible.';
  end if;

select * into v_attempt
  from public.payment_attempts
  where id = p_attempt_id
  for update;

  if not found or v_attempt.provider <> 'paystack'
     or v_attempt.environment <> 'live
     or v_attempt.payment_id is distinct from p_payment_id
     or v_attempt.provider_checkout_id is distinct from p_transaction_reference then
    raise exception 'Paystack refund does not match its successful payment attempt.';
  end if;

  select * into v_event
  from public.payment_webhook_events
  where id = p_event_id
  for update;

  if not found or v_event.provider <> 'paystack'
     or v_event.environment <> 'live
     or not v_event.signature_verified
     or v_event.event_type <> v_expected_event
     or v_event.processing_status <> 'processing'
     or v_event.processing_lease_token is distinct from p_lease_token
     or v_event.processing_lease_expires_at is null
     or v_event.processing_lease_expires_at <= now() then
    raise exception 'Paystack refund webhook lease or event is invalid.';
  end if;

  v_refund_amount := (p_amount_cents::numeric / 100)::numeric(12,2);

  if p_provider_refund_reference is not null then
    select * into v_refund
    from public.payment_refunds
    where provider = 'paystack'
      and environment = 'live
      and provider_refund_reference = btrim(p_provider_refund_reference)
    for update;
    v_has_refund := found;
  end if;

  if not v_has_refund and p_provider_refund_id is not null then
    select * into v_refund
    from public.payment_refunds
    where provider = 'paystack'
      and environment = 'live
      and provider_refund_id = p_provider_refund_id
    for update;
    v_has_refund := found;
  end if;

  -- Some valid Paystack refund event payloads contain a null refund_reference.
  -- In that case, only bind by payment and amount when exactly one open refund
  -- can match. Ambiguous matching is sent to manual review, never guessed.
  if not v_has_refund
     and p_provider_refund_reference is null
     and p_provider_refund_id is null then
    select count(*) into v_candidate_count
    from public.payment_refunds
    where provider = 'paystack'
      and environment = 'live
      and payment_id = p_payment_id
      and amount = v_refund_amount
      and status in ('pending', 'requires_review', 'succeeded');

    if v_candidate_count = 1 then
      select * into v_refund
      from public.payment_refunds
      where provider = 'paystack'
        and environment = 'live
        and payment_id = p_payment_id
        and amount = v_refund_amount
        and status in ('pending', 'requires_review', 'succeeded')
      order by created_at, id
      limit 1
      for update;
      v_has_refund := true;
    elsif v_candidate_count > 1 then
      update public.payment_webhook_events
      set payment_attempt_id = p_attempt_id,
          processing_status = 'requires_review',
          failure_code = 'ambiguous_refund_match',
          failure_message = 'Paystack refund event has no refund reference and matches multiple pending local refunds.',
          processed_at = now(),
          processing_lease_token = null,
          processing_lease_expires_at = null
      where id = v_event.id;
      return jsonb_build_object(
        'recorded', false,
        'requires_review', true,
        'reason', 'ambiguous_refund_match'
      );
    end if;
  end if;

  if v_has_refund and (
    v_refund.payment_id <> p_payment_id
    or v_refund.amount <> v_refund_amount
    or (v_refund.provider_refund_reference is not null
        and p_provider_refund_reference is not null
        and v_refund.provider_refund_reference <> btrim(p_provider_refund_reference))
    or (v_refund.provider_refund_id is not null
        and p_provider_refund_id is not null
        and v_refund.provider_refund_id <> p_provider_refund_id)
  ) then
    update public.payment_webhook_events
    set payment_attempt_id = p_attempt_id,
        processing_status = 'requires_review',
        failure_code = 'refund_identity_mismatch',
        failure_message = 'Paystack refund event does not match the local refund reference, payment or amount.',
        processed_at = now(),
        processing_lease_token = null,
        processing_lease_expires_at = null
    where id = v_event.id;
    return jsonb_build_object(
      'recorded', false,
      'requires_review', true,
      'reason', 'refund_identity_mismatch'
    );
  end if;

  v_target_status := case p_provider_status
    when 'pending' then 'pending'
    when 'processing' then 'pending'
    when 'needs-attention' then 'requires_review'
    when 'failed' then 'failed'
    when 'processed' then 'succeeded'
  end;

  if v_has_refund and v_refund.status = 'succeeded' then
    update public.payment_webhook_events
    set payment_attempt_id = p_attempt_id,
        processing_status = 'processed',
        processed_at = now(),
        processing_lease_token = null,
        processing_lease_expires_at = null
    where id = v_event.id;
    return jsonb_build_object(
      'recorded', true,
      'duplicate', true,
      'refund_id', v_refund.id,
      'status', v_refund.status
    );
  end if;

  if v_has_refund and v_refund.status = 'failed'
     and p_provider_status <> 'failed' then
    update public.payment_webhook_events
    set payment_attempt_id = p_attempt_id,
        processing_status = 'requires_review',
        failure_code = 'refund_terminal_status_conflict',
        failure_message = 'A later Paystack event conflicts with a previously failed refund.',
        processed_at = now(),
        processing_lease_token = null,
        processing_lease_expires_at = null
    where id = v_event.id;
    return jsonb_build_object(
      'recorded', false,
      'requires_review', true,
      'reason', 'refund_terminal_status_conflict'
    );
  end if;

  select coalesce(sum(amount), 0)
  into v_reserved
  from public.payment_refunds
  where payment_id = p_payment_id
    and provider = 'paystack'
    and environment = 'live
    and status in ('pending', 'requires_review', 'succeeded')
    and (not v_has_refund or id <> v_refund.id);

  if v_reserved + v_refund_amount > v_payment.amount then
    update public.payment_webhook_events
    set payment_attempt_id = p_attempt_id,
        processing_status = 'requires_review',
        failure_code = 'refund_exceeds_payment',
        failure_message = 'Verified Paystack refund exceeds the remaining refundable payment amount.',
        processed_at = now(),
        processing_lease_token = null,
        processing_lease_expires_at = null
    where id = v_event.id;
    return jsonb_build_object(
      'recorded', false,
      'requires_review', true,
      'reason', 'refund_exceeds_payment'
    );
  end if;

  update public.payment_webhook_events
  set payment_attempt_id = p_attempt_id
  where id = v_event.id;

  if v_has_refund then
    update public.payment_refunds
    set provider_refund_id = coalesce(p_provider_refund_id, provider_refund_id),
        provider_refund_reference = coalesce(
          nullif(btrim(p_provider_refund_reference), ''),
          provider_refund_reference
        ),
        provider_status = p_provider_status,
        status = v_target_status,
        provider_event_id = v_event.provider_event_id,
        processed_at = case when v_target_status in ('succeeded', 'failed') then now() else null end
    where id = v_refund.id
    returning * into v_refund;
  else
    insert into public.payment_refunds (
      payment_id, provider, environment, provider_refund_id,
      provider_refund_reference, amount, currency, status,
      provider_status, provider_event_id, processed_at
    )
    values (
      p_payment_id, 'paystack', 'live, p_provider_refund_id,
      nullif(btrim(p_provider_refund_reference), ''),
      v_refund_amount, 'ZAR', v_target_status,
      p_provider_status, v_event.provider_event_id,
      case when v_target_status in ('succeeded', 'failed') then now() else null end
    )
    returning * into v_refund;
  end if;

  update public.payment_webhook_events
  set processing_status = 'processed',
      processed_at = now(),
      failure_code = null,
      failure_message = null,
      processing_lease_token = null,
      processing_lease_expires_at = null
  where id = v_event.id;

  return jsonb_build_object(
    'recorded', true,
    'duplicate', false,
    'refund_id', v_refund.id,
    'status', v_refund.status,
    'provider_status', v_refund.provider_status,
    'amount', v_refund.amount,
    'currency', v_refund.currency
  );
end;
$function$


CREATE OR REPLACE FUNCTION innerme_private.attach_paystack_checkout(p_attempt_id uuid, p_provider_checkout_id text, p_checkout_url text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

    if v_attempt.provider <> 'paystack' or v_attempt.environment <> 'live then
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
$function$


CREATE OR REPLACE FUNCTION innerme_private.claim_paystack_webhook_event(p_event_id uuid, p_lease_seconds integer DEFAULT 120)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    and environment = 'live
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
$function$


CREATE OR REPLACE FUNCTION innerme_private.create_paystack_payment_attempt(p_invoice_id uuid, p_client_id uuid, p_amount_cents bigint, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    if coalesce(v_invoice.online_payment_provider, 'yoco') <> 'paystack' then
        raise exception 'This invoice is not configured for Paystack checkout.';
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
        p_invoice_id, p_client_id, 'paystack', 'live, p_amount_cents,
        'ZAR', btrim(p_idempotency_key), 'created'
    )
    on conflict (provider, environment, client_id, idempotency_key)
    do nothing;

    select *
    into v_attempt
    from public.payment_attempts
    where provider = 'paystack'
      and environment = 'live
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
$function$


CREATE OR REPLACE FUNCTION innerme_private.create_paystack_refund_request(p_payment_id uuid, p_amount_cents bigint, p_idempotency_key uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_payment public.payments%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_refund public.payment_refunds%rowtype;
  v_reserved numeric(12,2);
  v_amount numeric(12,2);
  v_reference text;
begin
  if p_payment_id is null or p_amount_cents is null or p_amount_cents < 1
     or p_idempotency_key is null then
    raise exception 'A valid payment, refund amount and idempotency key are required.';
  end if;

  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found or v_payment.provider <> 'paystack'
     or v_payment.currency <> 'ZAR'
     or v_payment.status <> 'paid'
     or v_payment.amount <= 0 then
    raise exception 'Only a settled Paystack test payment can be refunded.';
  end if;

  select * into v_attempt
  from public.payment_attempts
  where payment_id = v_payment.id
    and provider = 'paystack'
    and environment = 'live
    and status = 'succeeded'
  for update;

  if not found or v_attempt.provider_checkout_id is null then
    raise exception 'A matching successful Paystack test attempt is required.';
  end if;

  v_amount := (p_amount_cents::numeric / 100)::numeric(12,2);

  select * into v_refund
  from public.payment_refunds
  where provider = 'paystack'
    and environment = 'live
    and payment_id = v_payment.id
    and idempotency_key = p_idempotency_key::text
  for update;

  if found then
    if v_refund.amount <> v_amount then
      raise exception 'Refund idempotency key was already used for a different amount.';
    end if;
    return jsonb_build_object(
      'refund_id', v_refund.id,
      'refund_reference', v_refund.provider_refund_reference,
      'amount_cents', p_amount_cents,
      'currency', v_refund.currency,
      'transaction_reference', v_attempt.provider_checkout_id,
      'provider_transaction_id', v_payment.provider_transaction_id,
      'status', v_refund.status,
      'provider_refund_id', v_refund.provider_refund_id,
      'reused', true
    );
  end if;

  select coalesce(sum(amount), 0)
  into v_reserved
  from public.payment_refunds
  where payment_id = v_payment.id
    and provider = 'paystack'
    and environment = 'live
    and status in ('pending', 'requires_review', 'succeeded');

  if v_reserved + v_amount > v_payment.amount then
    raise exception 'Refund amount exceeds the remaining refundable payment balance.';
  end if;

  v_reference := 'SWPR-' || replace(p_idempotency_key::text, '-', '');

  insert into public.payment_refunds (
    payment_id, provider, environment, amount, currency, status,
    reason, provider_refund_reference, idempotency_key
  )
  values (
    v_payment.id, 'paystack', 'live, v_amount, 'ZAR', 'pending',
    nullif(left(btrim(coalesce(p_reason, '')), 500), ''),
    v_reference, p_idempotency_key::text
  )
  returning * into v_refund;

  return jsonb_build_object(
    'refund_id', v_refund.id,
    'refund_reference', v_reference,
    'amount_cents', p_amount_cents,
    'currency', v_refund.currency,
    'transaction_reference', v_attempt.provider_checkout_id,
    'provider_transaction_id', v_payment.provider_transaction_id,
    'status', v_refund.status,
    'provider_refund_id', null,
    'reused', false
  );
end;
$function$


CREATE OR REPLACE FUNCTION innerme_private.record_paystack_failed_attempt_status(p_attempt_id uuid, p_provider_checkout_id text, p_amount_cents bigint, p_currency text, p_processing_mode text, p_provider_transaction_id text, p_provider_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_attempt public.payment_attempts%rowtype;
    v_target_status text;
    v_failure_code text;
    v_failure_message text;
begin
    if p_attempt_id is null
       or p_provider_checkout_id is null
       or length(btrim(p_provider_checkout_id)) < 8
       or p_amount_cents is null
       or p_amount_cents < 200
       or upper(coalesce(p_currency, '')) <> 'ZAR'
       or lower(coalesce(p_processing_mode, '')) <> 'live
       or p_provider_transaction_id is null
       or p_provider_transaction_id !~ '^[0-9]+$'
       or p_provider_status is null
       or p_provider_status not in ('failed', 'abandoned') then
        raise exception 'Verified Paystack transaction status is invalid.';
    end if;

    v_target_status := p_provider_status;
    v_failure_code := case v_target_status
        when 'failed' then 'provider_transaction_failed'
        else 'provider_transaction_abandoned'
    end;
    v_failure_message := case v_target_status
        when 'failed' then 'Paystack confirmed that the transaction failed.'
        else 'Paystack confirmed that the checkout was abandoned.'
    end;

    select *
    into v_attempt
    from public.payment_attempts
    where id = p_attempt_id
    for update;

    if not found then
        raise exception 'Paystack payment attempt not found.';
    end if;

    if v_attempt.provider <> 'paystack'
       or v_attempt.environment <> 'live
       or v_attempt.provider_checkout_id is distinct from p_provider_checkout_id
       or v_attempt.amount_cents <> p_amount_cents
       or v_attempt.currency <> upper(p_currency) then
        raise exception 'Verified Paystack transaction does not match the payment attempt.';
    end if;

    -- Never downgrade an attempt that was settled by a concurrent success webhook.
    if v_attempt.status = 'succeeded' or v_attempt.payment_id is not null then
        return jsonb_build_object(
            'attempt_id', v_attempt.id,
            'status', 'succeeded',
            'payment_id', v_attempt.payment_id,
            'updated', false,
            'reason', 'already_settled'
        );
    end if;

    -- Idempotent read-after-write behavior for repeated status checks.
    if v_attempt.status = v_target_status then
        return jsonb_build_object(
            'attempt_id', v_attempt.id,
            'status', v_attempt.status,
            'payment_id', v_attempt.payment_id,
            'updated', false,
            'duplicate', true
        );
    end if;

    if v_attempt.status not in ('created', 'pending') then
        return jsonb_build_object(
            'attempt_id', v_attempt.id,
            'status', v_attempt.status,
            'payment_id', v_attempt.payment_id,
            'updated', false,
            'reason', 'attempt_not_transitionable'
        );
    end if;

    update public.payment_attempts
    set status = v_target_status,
        failure_code = v_failure_code,
        failure_message = v_failure_message,
        updated_at = now()
    where id = v_attempt.id
    returning * into v_attempt;

    return jsonb_build_object(
        'attempt_id', v_attempt.id,
        'status', v_attempt.status,
        'payment_id', v_attempt.payment_id,
        'updated', true
    );
end;
$function$


CREATE OR REPLACE FUNCTION innerme_private.record_paystack_refund_initialization(p_refund_id uuid, p_refund_reference text, p_provider_refund_id text, p_provider_status text, p_failure_message text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_refund public.payment_refunds%rowtype;
  v_target_status text;
begin
  if p_refund_id is null or p_refund_reference is null
     or length(btrim(p_refund_reference)) < 8
     or p_provider_status is null
     or p_provider_status not in (
       'pending', 'processing', 'needs-attention', 'failed',
       'processed', 'unknown', 'request_rejected'
     )
     or (p_provider_refund_id is not null and p_provider_refund_id !~ '^[0-9]+$') then
    raise exception 'Paystack refund initialization result is invalid.';
  end if;

  select * into v_refund
  from public.payment_refunds
  where id = p_refund_id
  for update;

  if not found or v_refund.provider <> 'paystack'
     or v_refund.environment <> 'live
     or v_refund.provider_refund_reference is distinct from btrim(p_refund_reference) then
    raise exception 'Paystack refund request was not found.';
  end if;

  if v_refund.status = 'succeeded' then
    return jsonb_build_object(
      'refund_id', v_refund.id,
      'status', v_refund.status,
      'duplicate', true
    );
  end if;

  v_target_status := case p_provider_status
    when 'needs-attention' then 'requires_review'
    when 'unknown' then 'requires_review'
    when 'request_rejected' then 'failed'
    when 'failed' then 'failed'
    else 'pending'
  end;

  update public.payment_refunds
  set provider_refund_id = coalesce(p_provider_refund_id, provider_refund_id),
      provider_status = p_provider_status,
      status = v_target_status,
      reason = case
        when p_failure_message is not null and length(btrim(p_failure_message)) > 0
          then left(btrim(p_failure_message), 500)
        else reason
      end,
      processed_at = case when v_target_status = 'failed' then now() else null end
  where id = v_refund.id
  returning * into v_refund;

  return jsonb_build_object(
    'refund_id', v_refund.id,
    'status', v_refund.status,
    'provider_status', v_refund.provider_status,
    'provider_refund_id', v_refund.provider_refund_id
  );
end;
$function$


CREATE OR REPLACE FUNCTION innerme_private.record_verified_paystack_webhook(p_provider_event_id text, p_event_type text, p_body_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        'paystack', 'live, btrim(p_provider_event_id), btrim(p_event_type),
        true, lower(p_body_sha256), 'received'
    )
    on conflict (provider, environment, provider_event_id)
    do nothing;

    get diagnostics v_inserted_count = row_count;

    select *
    into v_event
    from public.payment_webhook_events
    where provider = 'paystack'
      and environment = 'live
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
$function$


CREATE OR REPLACE FUNCTION innerme_private.settle_paystack_payment(p_attempt_id uuid, p_event_id uuid, p_provider_checkout_id text, p_amount_cents bigint, p_currency text, p_processing_mode text, p_provider_transaction_id text DEFAULT NULL::text, p_payment_channel text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
       or v_event.environment <> 'live
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
       or lower(coalesce(p_processing_mode, '')) <> 'live then
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
$function$


CREATE OR REPLACE FUNCTION innerme_private.settle_paystack_payment_with_lease(p_attempt_id uuid, p_event_id uuid, p_lease_token uuid, p_provider_checkout_id text, p_amount_cents bigint, p_currency text, p_processing_mode text, p_provider_transaction_id text DEFAULT NULL::text, p_payment_channel text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     or v_event.environment <> 'live
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
$function$


CREATE OR REPLACE FUNCTION innerme_private.update_paystack_webhook_event(p_event_id uuid, p_lease_token uuid, p_processing_status text, p_payment_attempt_id uuid DEFAULT NULL::uuid, p_failure_code text DEFAULT NULL::text, p_failure_message text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    and environment = 'live
    and processing_status = 'processing';
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$function$


CREATE OR REPLACE FUNCTION public.paystack_apply_refund_webhook_with_lease(p_event_id uuid, p_lease_token uuid, p_attempt_id uuid, p_payment_id uuid, p_transaction_reference text, p_provider_refund_id text, p_provider_refund_reference text, p_amount_cents bigint, p_currency text, p_provider_status text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select innerme_private.apply_paystack_refund_webhook_with_lease(
    p_event_id, p_lease_token, p_attempt_id, p_payment_id,
    p_transaction_reference, p_provider_refund_id,
    p_provider_refund_reference, p_amount_cents,
    p_currency, p_provider_status
  );
$function$


CREATE OR REPLACE FUNCTION public.paystack_attach_checkout(p_attempt_id uuid, p_provider_checkout_id text, p_checkout_url text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select innerme_private.attach_paystack_checkout(p_attempt_id,p_provider_checkout_id,p_checkout_url,p_expires_at);
$function$


CREATE OR REPLACE FUNCTION public.paystack_claim_webhook_event(p_event_id uuid, p_lease_seconds integer DEFAULT 120)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select innerme_private.claim_paystack_webhook_event(p_event_id,p_lease_seconds);
$function$


CREATE OR REPLACE FUNCTION public.paystack_create_payment_attempt(p_invoice_id uuid, p_client_id uuid, p_amount_cents bigint, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select innerme_private.create_paystack_payment_attempt(p_invoice_id,p_client_id,p_amount_cents,p_idempotency_key);
$function$


CREATE OR REPLACE FUNCTION public.paystack_create_refund_request(p_payment_id uuid, p_amount_cents bigint, p_idempotency_key uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select innerme_private.create_paystack_refund_request(
    p_payment_id, p_amount_cents, p_idempotency_key, p_reason
  );
$function$


CREATE OR REPLACE FUNCTION public.paystack_record_failed_attempt_status(p_attempt_id uuid, p_provider_checkout_id text, p_amount_cents bigint, p_currency text, p_processing_mode text, p_provider_transaction_id text, p_provider_status text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
    select innerme_private.record_paystack_failed_attempt_status(
        p_attempt_id,
        p_provider_checkout_id,
        p_amount_cents,
        p_currency,
        p_processing_mode,
        p_provider_transaction_id,
        p_provider_status
    );
$function$


CREATE OR REPLACE FUNCTION public.paystack_record_refund_initialization(p_refund_id uuid, p_refund_reference text, p_provider_refund_id text, p_provider_status text, p_failure_message text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select innerme_private.record_paystack_refund_initialization(
    p_refund_id, p_refund_reference, p_provider_refund_id,
    p_provider_status, p_failure_message
  );
$function$


CREATE OR REPLACE FUNCTION public.paystack_record_verified_webhook(p_provider_event_id text, p_event_type text, p_body_sha256 text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select innerme_private.record_verified_paystack_webhook(p_provider_event_id,p_event_type,p_body_sha256);
$function$


CREATE OR REPLACE FUNCTION public.paystack_settle_payment_with_lease(p_attempt_id uuid, p_event_id uuid, p_lease_token uuid, p_provider_checkout_id text, p_amount_cents bigint, p_currency text, p_processing_mode text, p_provider_transaction_id text DEFAULT NULL::text, p_payment_channel text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select innerme_private.settle_paystack_payment_with_lease(
    p_attempt_id,p_event_id,p_lease_token,p_provider_checkout_id,p_amount_cents,
    p_currency,p_processing_mode,p_provider_transaction_id,p_payment_channel
  );
$function$


CREATE OR REPLACE FUNCTION public.paystack_update_webhook_event(p_event_id uuid, p_lease_token uuid, p_processing_status text, p_payment_attempt_id uuid DEFAULT NULL::uuid, p_failure_code text DEFAULT NULL::text, p_failure_message text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select innerme_private.update_paystack_webhook_event(
    p_event_id,p_lease_token,p_processing_status,p_payment_attempt_id,p_failure_code,p_failure_message
  );
$function$


REVOKE ALL ON FUNCTION public.paystack_apply_refund_webhook_with_lease(uuid, uuid, uuid, uuid, text, text, text, bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paystack_apply_refund_webhook_with_lease(uuid, uuid, uuid, uuid, text, text, text, bigint, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.paystack_attach_checkout(uuid, text, text, timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paystack_attach_checkout(uuid, text, text, timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION public.paystack_claim_webhook_event(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paystack_claim_webhook_event(uuid, integer) TO service_role;
REVOKE ALL ON FUNCTION public.paystack_create_payment_attempt(uuid, uuid, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paystack_create_payment_attempt(uuid, uuid, bigint, text) TO service_role;
REVOKE ALL ON FUNCTION public.paystack_create_refund_request(uuid, bigint, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paystack_create_refund_request(uuid, bigint, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.paystack_record_failed_attempt_status(uuid, text, bigint, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paystack_record_failed_attempt_status(uuid, text, bigint, text, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.paystack_record_refund_initialization(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paystack_record_refund_initialization(uuid, text, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.paystack_record_verified_webhook(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paystack_record_verified_webhook(text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.paystack_settle_payment_with_lease(uuid, uuid, uuid, text, bigint, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paystack_settle_payment_with_lease(uuid, uuid, uuid, text, bigint, text, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.paystack_update_webhook_event(uuid, uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paystack_update_webhook_event(uuid, uuid, text, uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION innerme_private.apply_paystack_refund_webhook_with_lease(uuid, uuid, uuid, uuid, text, text, text, bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION innerme_private.apply_paystack_refund_webhook_with_lease(uuid, uuid, uuid, uuid, text, text, text, bigint, text, text) TO service_role;
REVOKE ALL ON FUNCTION innerme_private.attach_paystack_checkout(uuid, text, text, timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION innerme_private.attach_paystack_checkout(uuid, text, text, timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION innerme_private.claim_paystack_webhook_event(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION innerme_private.claim_paystack_webhook_event(uuid, integer) TO service_role;
REVOKE ALL ON FUNCTION innerme_private.create_paystack_payment_attempt(uuid, uuid, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION innerme_private.create_paystack_payment_attempt(uuid, uuid, bigint, text) TO service_role;
REVOKE ALL ON FUNCTION innerme_private.create_paystack_refund_request(uuid, bigint, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION innerme_private.create_paystack_refund_request(uuid, bigint, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION innerme_private.record_paystack_failed_attempt_status(uuid, text, bigint, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION innerme_private.record_paystack_failed_attempt_status(uuid, text, bigint, text, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION innerme_private.record_paystack_refund_initialization(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION innerme_private.record_paystack_refund_initialization(uuid, text, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION innerme_private.record_verified_paystack_webhook(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION innerme_private.record_verified_paystack_webhook(text, text, text) TO service_role;
REVOKE ALL ON FUNCTION innerme_private.settle_paystack_payment(uuid, uuid, text, bigint, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION innerme_private.settle_paystack_payment_with_lease(uuid, uuid, uuid, text, bigint, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION innerme_private.update_paystack_webhook_event(uuid, uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION innerme_private.update_paystack_webhook_event(uuid, uuid, text, uuid, text, text) TO service_role;
-- Save invoice-level provider selection through an authenticated admin-only RPC.
CREATE OR REPLACE FUNCTION public.admin_set_invoice_payment_settings(
    p_invoice_id uuid,
    p_online_payment_enabled boolean,
    p_partial_payment_enabled boolean,
    p_deposit_amount numeric DEFAULT NULL,
    p_provider text DEFAULT 'paystack'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_invoice public.invoices%rowtype;
    v_online boolean := coalesce(p_online_payment_enabled, false);
    v_partial boolean := coalesce(p_partial_payment_enabled, false);
    v_provider text := lower(btrim(coalesce(p_provider, '')));
    v_deposit numeric(12,2) := p_deposit_amount;
BEGIN
    IF auth.uid() IS NULL OR NOT coalesce(public.is_swayphics_admin(), false) THEN
        RAISE EXCEPTION 'Administrator access is required.'
            USING errcode = '42501';
    END IF;

    IF p_invoice_id IS NULL THEN
        RAISE EXCEPTION 'A valid invoice is required.';
    END IF;

    IF v_provider NOT IN ('paystack', 'yoco') THEN
        RAISE EXCEPTION 'Select a supported payment provider.';
    END IF;

    SELECT i.*
    INTO v_invoice
    FROM public.invoices i
    WHERE i.id = p_invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invoice not found.';
    END IF;

    IF v_invoice.status IN ('draft', 'cancelled', 'paid')
       OR coalesce(v_invoice.amount_outstanding, v_invoice.total, 0) <= 0 THEN
        RAISE EXCEPTION 'Only issued invoices with an outstanding balance can accept online payment settings.';
    END IF;

    IF v_online AND upper(coalesce(v_invoice.currency, '')) <> 'ZAR' THEN
        RAISE EXCEPTION 'Paystack and Yoco invoice checkout currently require ZAR invoices.';
    END IF;

    IF v_partial AND NOT v_online THEN
        RAISE EXCEPTION 'Partial payments require online payments to be enabled.';
    END IF;

    IF v_deposit IS NOT NULL THEN
        IF NOT v_partial THEN
            RAISE EXCEPTION 'A minimum deposit can only be configured when partial payments are enabled.';
        END IF;
        IF v_deposit <= 0
           OR v_deposit > coalesce(v_invoice.amount_outstanding, v_invoice.total, 0) THEN
            RAISE EXCEPTION 'The minimum deposit must be greater than zero and no greater than the outstanding balance.';
        END IF;
        v_deposit := round(v_deposit, 2);
    END IF;

    UPDATE public.invoices
    SET online_payment_enabled = v_online,
        online_payment_provider = v_provider,
        partial_payment_enabled = v_partial,
        deposit_amount = CASE WHEN v_online AND v_partial THEN v_deposit ELSE NULL END,
        updated_at = now()
    WHERE id = p_invoice_id;

    RETURN jsonb_build_object(
        'invoice_id', p_invoice_id,
        'online_payment_enabled', v_online,
        'online_payment_provider', v_provider,
        'partial_payment_enabled', v_partial,
        'deposit_amount', CASE WHEN v_online AND v_partial THEN v_deposit ELSE NULL END
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_invoice_payment_settings(uuid, boolean, boolean, numeric, text)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_invoice_payment_settings(uuid, boolean, boolean, numeric, text)
    TO authenticated;

-- Expose the provider on each invoice to the authenticated client portal.

CREATE OR REPLACE FUNCTION public.get_client_portal(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
                    'online_payment_enabled', coalesce(i.online_payment_enabled, false),
                    'online_payment_provider', coalesce(i.online_payment_provider, 'yoco'),
                    'partial_payment_enabled', coalesce(i.partial_payment_enabled, false),
                    'deposit_amount', coalesce(i.deposit_amount, 0),
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
                    'paid_at', pp.paid_at,
                    'receipt', (
                        select jsonb_build_object(
                            'receipt_number', pr.receipt_number,
                            'issued_at', pr.issued_at,
                            'snapshot', pr.snapshot
                        )
                        from public.payment_receipts pr
                        where pr.payment_id = pp.id
                        limit 1
                    ),
                    'refunds', coalesce((
                        select jsonb_agg(
                            jsonb_build_object(
                                'amount', rr.amount,
                                'currency', rr.currency,
                                'status', rr.status,
                                'processed_at', rr.processed_at
                            )
                            order by rr.processed_at desc nulls last, rr.created_at desc
                        )
                        from public.payment_refunds rr
                        where rr.payment_id = pp.id
                          and rr.status = 'succeeded'
                    ), '[]'::jsonb)
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
$function$

