-- Yoco webhook worker leases and fencing
-- Target branch: feature/yoco-client-payments
-- REVIEW-ONLY. Do not execute against production.
-- Requires migrations 001-004. Test environment only.

begin;

alter table public.payment_webhook_events
  add column if not exists processing_lease_token uuid,
  add column if not exists processing_lease_expires_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payment_webhook_events'::regclass
      and conname = 'payment_webhook_event_lease_pair'
  ) then
    alter table public.payment_webhook_events
      add constraint payment_webhook_event_lease_pair
      check ((processing_lease_token is null) = (processing_lease_expires_at is null));
  end if;
end;
$$;

create index if not exists payment_webhook_events_expired_lease_idx
  on public.payment_webhook_events (processing_lease_expires_at)
  where processing_status = 'processing';

create or replace function innerme_private.claim_yoco_webhook_event(
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
    and provider = 'yoco'
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

-- All non-financial event-state transitions are fenced by the current lease.
create or replace function innerme_private.update_yoco_webhook_event(
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
  if p_processing_status not in ('processing','processed','failed_retryable','requires_review','rejected') then
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
    and processing_status = 'processing';
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- Keep the established financial routines, but hold and validate the lease row
-- lock in the same transaction before invoking them. Their event updates are
-- therefore atomic with lease validation and cannot race a replacement worker.
create or replace function innerme_private.settle_yoco_payment_with_lease(
  p_attempt_id uuid,
  p_event_id uuid,
  p_lease_token uuid,
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
  v_event public.payment_webhook_events%rowtype;
  v_result jsonb;
begin
  perform 1 from public.payment_attempts where id = p_attempt_id for update;
  if not found then raise exception 'Payment attempt not found.'; end if;

  select * into v_event from public.payment_webhook_events
  where id = p_event_id for update;
  if not found
     or v_event.processing_status <> 'processing'
     or v_event.processing_lease_token is distinct from p_lease_token
     or v_event.processing_lease_expires_at <= now() then
    raise exception 'Webhook processing lease is missing, expired, or stale.';
  end if;

  v_result := innerme_private.settle_yoco_payment(
    p_attempt_id, p_event_id, p_provider_checkout_id, p_amount_cents,
    p_currency, p_processing_mode, p_provider_transaction_id
  );
  update public.payment_webhook_events
  set processing_lease_token = null, processing_lease_expires_at = null
  where id = p_event_id;
  return v_result;
end;
$$;

create or replace function innerme_private.record_yoco_refund_success_with_lease(
  p_event_id uuid,
  p_lease_token uuid,
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
  v_result jsonb;
begin
  perform 1 from public.payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found.'; end if;

  select * into v_event from public.payment_webhook_events
  where id = p_event_id for update;
  if not found
     or v_event.processing_status <> 'processing'
     or v_event.processing_lease_token is distinct from p_lease_token
     or v_event.processing_lease_expires_at <= now() then
    raise exception 'Webhook processing lease is missing, expired, or stale.';
  end if;

  v_result := innerme_private.record_yoco_refund_success(
    p_event_id, p_payment_id, p_provider_refund_id, p_amount_cents, p_currency
  );
  update public.payment_webhook_events
  set processing_lease_token = null, processing_lease_expires_at = null
  where id = p_event_id;
  return v_result;
end;
$$;

create or replace function public.yoco_claim_webhook_event(
  p_event_id uuid,
  p_lease_seconds integer default 120
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select innerme_private.claim_yoco_webhook_event(p_event_id, p_lease_seconds);
$$;

create or replace function public.yoco_update_webhook_event(
  p_event_id uuid,
  p_lease_token uuid,
  p_processing_status text,
  p_payment_attempt_id uuid default null,
  p_failure_code text default null,
  p_failure_message text default null
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select innerme_private.update_yoco_webhook_event(
    p_event_id, p_lease_token, p_processing_status,
    p_payment_attempt_id, p_failure_code, p_failure_message
  );
$$;

create or replace function public.yoco_settle_payment_with_lease(
  p_attempt_id uuid, p_event_id uuid, p_lease_token uuid,
  p_provider_checkout_id text, p_amount_cents bigint,
  p_currency text, p_processing_mode text,
  p_provider_transaction_id text default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select innerme_private.settle_yoco_payment_with_lease(
    p_attempt_id, p_event_id, p_lease_token, p_provider_checkout_id,
    p_amount_cents, p_currency, p_processing_mode, p_provider_transaction_id
  );
$$;

create or replace function public.yoco_record_refund_success_with_lease(
  p_event_id uuid, p_lease_token uuid, p_payment_id uuid,
  p_provider_refund_id text, p_amount_cents bigint, p_currency text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select innerme_private.record_yoco_refund_success_with_lease(
    p_event_id, p_lease_token, p_payment_id, p_provider_refund_id,
    p_amount_cents, p_currency
  );
$$;

revoke all on function innerme_private.claim_yoco_webhook_event(uuid, integer) from public, anon, authenticated;
revoke all on function innerme_private.update_yoco_webhook_event(uuid, uuid, text, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function innerme_private.settle_yoco_payment_with_lease(uuid, uuid, uuid, text, bigint, text, text, text) from public, anon, authenticated, service_role;
revoke all on function innerme_private.record_yoco_refund_success_with_lease(uuid, uuid, uuid, text, bigint, text) from public, anon, authenticated, service_role;

revoke all on function public.yoco_claim_webhook_event(uuid, integer) from public, anon, authenticated;
revoke all on function public.yoco_update_webhook_event(uuid, uuid, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.yoco_settle_payment_with_lease(uuid, uuid, uuid, text, bigint, text, text, text) from public, anon, authenticated;
revoke all on function public.yoco_record_refund_success_with_lease(uuid, uuid, uuid, text, bigint, text) from public, anon, authenticated;

grant execute on function public.yoco_claim_webhook_event(uuid, integer) to service_role;
grant execute on function public.yoco_update_webhook_event(uuid, uuid, text, uuid, text, text) to service_role;
grant execute on function public.yoco_settle_payment_with_lease(uuid, uuid, uuid, text, bigint, text, text, text) to service_role;
grant execute on function public.yoco_record_refund_success_with_lease(uuid, uuid, uuid, text, bigint, text) to service_role;

commit;
