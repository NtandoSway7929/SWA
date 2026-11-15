-- Paystack test-mode refund lifecycle and shared refund ledger support.
-- Additive only: preserves Yoco refund behavior and history.
-- Production/live refund processing is not enabled by this migration.

begin;

alter table public.payment_refunds
  add column if not exists provider_refund_reference text,
  add column if not exists provider_status text,
  add column if not exists idempotency_key text;

alter table public.payment_refunds
  drop constraint if exists payment_refunds_provider_check;
alter table public.payment_refunds
  add constraint payment_refunds_provider_check
  check (provider in ('yoco', 'paystack'));

create unique index if not exists payment_refunds_provider_reference_uidx
  on public.payment_refunds(provider, environment, provider_refund_reference)
  where provider_refund_reference is not null;

create unique index if not exists payment_refunds_idempotency_uidx
  on public.payment_refunds(provider, environment, payment_id, idempotency_key)
  where idempotency_key is not null;

-- A completed refund is immutable for both providers. A pending Paystack refund
-- may transition to succeeded only after the verified refund.processed event
-- has been bound to the same payment attempt and payment.
create or replace function innerme_private.guard_yoco_financial_ledger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'payments' then
    if tg_op = 'DELETE' then
      if old.provider in ('yoco', 'paystack') then
        raise exception 'Provider payment ledger entries are immutable.';
      end if;
      return old;
    end if;

    if old.provider in ('yoco', 'paystack')
       or new.provider in ('yoco', 'paystack') then
      raise exception 'Provider payment ledger entries are immutable.';
    end if;
    return new;
  end if;

  if tg_table_name = 'payment_refunds' then
    if tg_op = 'DELETE' then
      if old.provider in ('yoco', 'paystack') and old.status = 'succeeded' then
        raise exception 'Successful provider refund ledger entries are immutable.';
      end if;
      return old;
    end if;

    if old.provider in ('yoco', 'paystack') and old.status = 'succeeded' then
      raise exception 'Successful provider refund ledger entries are immutable.';
    end if;

    if new.provider in ('yoco', 'paystack') and new.status = 'succeeded' then
      if row(new.provider, new.environment, new.payment_id, new.amount, new.currency)
         is distinct from
         row(old.provider, old.environment, old.payment_id, old.amount, old.currency) then
        raise exception 'Refund identity and amount cannot change when a refund is completed.';
      end if;
    end if;
    return new;
  end if;

  if tg_table_name = 'payment_receipts' then
    raise exception 'Issued payment receipts are immutable.';
  end if;

  raise exception 'Unsupported financial ledger trigger target.';
end;
$$;

-- Keep the established trigger name so existing Yoco protections remain in place.
-- Validate both providers when a refund enters the completed/succeeded state.
create or replace function innerme_private.validate_yoco_refund_event_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.payment_webhook_events%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_expected_event text;
begin
  if new.status <> 'succeeded' then
    return new;
  end if;

  if new.provider = 'yoco' then
    v_expected_event := 'refund.succeeded';
  elsif new.provider = 'paystack' then
    v_expected_event := 'refund.processed';
  else
    raise exception 'Only supported provider refunds may enter this ledger.';
  end if;

  if new.environment <> 'test' or new.provider_event_id is null
     or length(btrim(new.provider_event_id)) = 0 then
    raise exception 'A verified test refund event is required.';
  end if;

  select * into v_event
  from public.payment_webhook_events
  where provider = new.provider
    and environment = 'test'
    and provider_event_id = new.provider_event_id
  for update;

  if not found
     or not v_event.signature_verified
     or v_event.event_type <> v_expected_event
     or v_event.processing_status not in ('received', 'processing') then
    raise exception 'Refund does not reference an eligible verified provider event.';
  end if;

  if v_event.payment_attempt_id is null then
    raise exception 'Refund event is not bound to a local payment attempt.';
  end if;

  select * into v_attempt
  from public.payment_attempts
  where id = v_event.payment_attempt_id
    and provider = new.provider
    and environment = 'test'
    and payment_id = new.payment_id;

  if not found then
    raise exception 'Refund event payment attempt does not match the payment ledger entry.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_yoco_refund_event_binding
  on public.payment_refunds;
create trigger trg_validate_yoco_refund_event_binding
before insert or update on public.payment_refunds
for each row
execute function innerme_private.validate_yoco_refund_event_binding();

-- Reserve a partial or full refund before calling Paystack. The UUID-based
-- reference is stable across retries and satisfies Paystack's reference format.
create or replace function innerme_private.create_paystack_refund_request(
  p_payment_id uuid,
  p_amount_cents bigint,
  p_idempotency_key uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
    and environment = 'test'
    and status = 'succeeded'
  for update;

  if not found or v_attempt.provider_checkout_id is null then
    raise exception 'A matching successful Paystack test attempt is required.';
  end if;

  v_amount := (p_amount_cents::numeric / 100)::numeric(12,2);

  select * into v_refund
  from public.payment_refunds
  where provider = 'paystack'
    and environment = 'test'
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
    and environment = 'test'
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
    v_payment.id, 'paystack', 'test', v_amount, 'ZAR', 'pending',
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
$$;

-- Save the authenticated Create Refund API response. "processed" is deliberately
-- kept pending until the signed refund.processed webhook arrives and is bound.
create or replace function innerme_private.record_paystack_refund_initialization(
  p_refund_id uuid,
  p_refund_reference text,
  p_provider_refund_id text,
  p_provider_status text,
  p_failure_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
     or v_refund.environment <> 'test'
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
$$;

-- Process signed refund lifecycle events under the same leased webhook inbox
-- used by Paystack charge.success. Only refund.processed reduces invoice net paid.
create or replace function innerme_private.apply_paystack_refund_webhook_with_lease(
  p_event_id uuid,
  p_lease_token uuid,
  p_attempt_id uuid,
  p_payment_id uuid,
  p_transaction_reference text,
  p_provider_refund_id text,
  p_provider_refund_reference text,
  p_amount_cents bigint,
  p_currency text,
  p_provider_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

  v_refund_amount := (p_amount_cents::numeric / 100)::numeric(12,2);

  if p_provider_refund_reference is not null then
    select * into v_refund
    from public.payment_refunds
    where provider = 'paystack'
      and environment = 'test'
      and provider_refund_reference = btrim(p_provider_refund_reference)
    for update;
    v_has_refund := found;
  end if;

  if not v_has_refund and p_provider_refund_id is not null then
    select * into v_refund
    from public.payment_refunds
    where provider = 'paystack'
      and environment = 'test'
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
      and environment = 'test'
      and payment_id = p_payment_id
      and amount = v_refund_amount
      and status in ('pending', 'requires_review');

    if v_candidate_count = 1 then
      select * into v_refund
      from public.payment_refunds
      where provider = 'paystack'
        and environment = 'test'
        and payment_id = p_payment_id
        and amount = v_refund_amount
        and status in ('pending', 'requires_review')
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
    and environment = 'test'
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
      p_payment_id, 'paystack', 'test', p_provider_refund_id,
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
$$;


  select * into v_attempt
  from public.payment_attempts
  where id = p_attempt_id
  for update;

  if not found or v_attempt.provider <> 'paystack'
     or v_attempt.environment <> 'test'
     or v_attempt.payment_id is distinct from p_payment_id
     or v_attempt.provider_checkout_id is distinct from p_transaction_reference then
    raise exception 'Paystack refund does not match its successful payment attempt.';
  end if;

  select * into v_event
  from public.payment_webhook_events
  where id = p_event_id
  for update;

  if not found or v_event.provider <> 'paystack'
     or v_event.environment <> 'test'
     or not v_event.signature_verified
     or v_event.event_type <> v_expected_event
     or v_event.processing_status <> 'processing'
     or v_event.processing_lease_token is distinct from p_lease_token
     or v_event.processing_lease_expires_at is null
     or v_event.processing_lease_expires_at <= now() then
    raise exception 'Paystack refund webhook lease or event is invalid.';
  end if;

create or replace function public.paystack_create_refund_request(
  p_payment_id uuid,
  p_amount_cents bigint,
  p_idempotency_key uuid,
  p_reason text default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select innerme_private.create_paystack_refund_request(
    p_payment_id, p_amount_cents, p_idempotency_key, p_reason
  );
$$;

create or replace function public.paystack_record_refund_initialization(
  p_refund_id uuid,
  p_refund_reference text,
  p_provider_refund_id text,
  p_provider_status text,
  p_failure_message text default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select innerme_private.record_paystack_refund_initialization(
    p_refund_id, p_refund_reference, p_provider_refund_id,
    p_provider_status, p_failure_message
  );
$$;

create or replace function public.paystack_apply_refund_webhook_with_lease(
  p_event_id uuid,
  p_lease_token uuid,
  p_attempt_id uuid,
  p_payment_id uuid,
  p_transaction_reference text,
  p_provider_refund_id text,
  p_provider_refund_reference text,
  p_amount_cents bigint,
  p_currency text,
  p_provider_status text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select innerme_private.apply_paystack_refund_webhook_with_lease(
    p_event_id, p_lease_token, p_attempt_id, p_payment_id,
    p_transaction_reference, p_provider_refund_id,
    p_provider_refund_reference, p_amount_cents,
    p_currency, p_provider_status
  );
$$;

revoke all on function innerme_private.create_paystack_refund_request(uuid,bigint,uuid,text)
  from public, anon, authenticated;
revoke all on function innerme_private.record_paystack_refund_initialization(uuid,text,text,text,text)
  from public, anon, authenticated;
revoke all on function innerme_private.apply_paystack_refund_webhook_with_lease(uuid,uuid,uuid,uuid,text,text,text,bigint,text,text)
  from public, anon, authenticated, service_role;

revoke all on function public.paystack_create_refund_request(uuid,bigint,uuid,text)
  from public, anon, authenticated;
revoke all on function public.paystack_record_refund_initialization(uuid,text,text,text,text)
  from public, anon, authenticated;
revoke all on function public.paystack_apply_refund_webhook_with_lease(uuid,uuid,uuid,uuid,text,text,text,bigint,text,text)
  from public, anon, authenticated;

grant execute on function innerme_private.create_paystack_refund_request(uuid,bigint,uuid,text)
  to service_role;
grant execute on function innerme_private.record_paystack_refund_initialization(uuid,text,text,text,text)
  to service_role;
grant execute on function innerme_private.apply_paystack_refund_webhook_with_lease(uuid,uuid,uuid,uuid,text,text,text,bigint,text,text)
  to service_role;

grant execute on function public.paystack_create_refund_request(uuid,bigint,uuid,text)
  to service_role;
grant execute on function public.paystack_record_refund_initialization(uuid,text,text,text,text)
  to service_role;
grant execute on function public.paystack_apply_refund_webhook_with_lease(uuid,uuid,uuid,uuid,text,text,text,bigint,text,text)
  to service_role;

commit;
