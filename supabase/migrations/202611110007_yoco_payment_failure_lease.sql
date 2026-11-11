-- Atomic Yoco payment.failed processing under the webhook worker lease.
-- Target branch: feature/yoco-client-payments
-- REVIEW-ONLY. Do not execute against production. Requires migrations 001-006.

begin;

create or replace function innerme_private.record_yoco_payment_failure_with_lease(
  p_event_id uuid,
  p_lease_token uuid,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.payment_webhook_events%rowtype;
  v_attempt public.payment_attempts%rowtype;
begin
  -- Preserve the established attempt-then-event lock order.
  select * into v_attempt
  from public.payment_attempts
  where id = p_attempt_id
    and provider = 'yoco'
    and environment = 'test'
  for update;

  if not found then
    raise exception 'Yoco payment attempt not found.';
  end if;

  select * into v_event
  from public.payment_webhook_events
  where id = p_event_id
  for update;

  if not found
     or v_event.provider <> 'yoco'
     or v_event.environment <> 'test'
     or not v_event.signature_verified
     or v_event.event_type <> 'payment.failed'
     or v_event.processing_status <> 'processing'
     or v_event.processing_lease_token is distinct from p_lease_token
     or v_event.processing_lease_expires_at is null
     or v_event.processing_lease_expires_at <= now() then
    raise exception 'Webhook processing lease is missing, expired, or stale.';
  end if;

  if v_event.payment_attempt_id is not null
     and v_event.payment_attempt_id <> v_attempt.id then
    raise exception 'Webhook event is already bound to another payment attempt.';
  end if;

  if v_attempt.provider_checkout_id is null then
    raise exception 'Payment attempt has no provider checkout.';
  end if;

  if v_attempt.status = 'succeeded' then
    update public.payment_webhook_events
    set payment_attempt_id = v_attempt.id,
        processing_status = 'requires_review',
        failure_code = 'conflicting_payment_events',
        failure_message = 'A failure event arrived after the payment attempt had settled.',
        processed_at = now(),
        processing_lease_token = null,
        processing_lease_expires_at = null
    where id = p_event_id;

    return jsonb_build_object('payment_failed', false, 'requires_review', true);
  end if;

  if v_attempt.status not in ('created','pending','requires_review','failed') then
    raise exception 'Payment attempt is not eligible for a failure notification.';
  end if;

  update public.payment_attempts
  set status = 'failed',
      failure_code = 'provider_payment_failed',
      failure_message = 'Yoco reported that the payment failed.',
      updated_at = now()
  where id = v_attempt.id;

  update public.payment_webhook_events
  set payment_attempt_id = v_attempt.id,
      processing_status = 'processed',
      processed_at = now(),
      failure_code = null,
      failure_message = null,
      processing_lease_token = null,
      processing_lease_expires_at = null
  where id = p_event_id;

  return jsonb_build_object('payment_failed', true, 'attempt_id', v_attempt.id);
end;
$$;

create or replace function public.yoco_record_payment_failure_with_lease(
  p_event_id uuid,
  p_lease_token uuid,
  p_attempt_id uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select innerme_private.record_yoco_payment_failure_with_lease(
    p_event_id, p_lease_token, p_attempt_id
  );
$$;

revoke all on function innerme_private.record_yoco_payment_failure_with_lease(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.yoco_record_payment_failure_with_lease(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.yoco_record_payment_failure_with_lease(uuid, uuid, uuid)
  to service_role;

commit;
