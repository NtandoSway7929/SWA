-- Yoco webhook lease/fencing integration tests.
-- RUN ONLY on a disposable local PostgreSQL/Supabase database.
-- Requires full Swayphics base schema and Yoco migrations 001-007.
-- No network calls. Transaction rolls back all fixture data.

begin;

create or replace function pg_temp.assert_true(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_condition is distinct from true then
    raise exception 'ASSERTION FAILED: %', p_message;
  end if;
end;
$$;

do $$
declare
  v_client uuid;
  v_invoice uuid;
  v_attempt jsonb;
  v_attempt_id uuid;
  v_event jsonb;
  v_event_id uuid;
  v_claim jsonb;
  v_claim2 jsonb;
  v_claim3 jsonb;
  v_token uuid;
  v_token2 uuid;
  v_failure_event jsonb;
  v_failure_event_id uuid;
  v_failure_claim jsonb;
  v_failure_result jsonb;
  v_status text;
  v_lease uuid;
begin
  insert into public.clients (business_name, contact_name, email)
  values ('Yoco Lease Test Fixture', 'Lease Test', 'yoco-lease@example.invalid')
  returning id into v_client;

  insert into public.invoices (
    client_id, status, currency, subtotal, total,
    online_payment_enabled, partial_payment_enabled
  )
  values (v_client, 'sent', 'ZAR', 100, 100, true, true)
  returning id into v_invoice;

  v_attempt := innerme_private.create_yoco_payment_attempt(
    v_invoice, v_client, 2500, 'lease-claim-test-key-001'
  );
  v_attempt_id := (v_attempt->>'attempt_id')::uuid;
  perform innerme_private.attach_yoco_checkout(
    v_attempt_id, 'yoco_test_lease_checkout_001',
    'https://payments.yoco.com/checkout/lease-test', now() + interval '1 hour'
  );

  v_event := innerme_private.record_verified_yoco_webhook(
    'evt_yoco_lease_claim_001', 'payment.succeeded', repeat('a', 64)
  );
  v_event_id := (v_event->>'event_id')::uuid;

  -- First claim succeeds; a simultaneous/second claim cannot steal a live lease.
  v_claim := public.yoco_claim_webhook_event(v_event_id, 120);
  perform pg_temp.assert_true((v_claim->>'claimed')::boolean, 'first worker obtains a lease');
  v_token := (v_claim->>'lease_token')::uuid;

  v_claim2 := public.yoco_claim_webhook_event(v_event_id, 120);
  perform pg_temp.assert_true(
    coalesce((v_claim2->>'claimed')::boolean, false) = false
      and v_claim2->>'reason' = 'lease_active',
    'second worker is rejected while first lease is active'
  );

  perform pg_temp.assert_true(
    not public.yoco_update_webhook_event(
      v_event_id, gen_random_uuid(), 'requires_review', null,
      'stale_token', 'must not write'
    ),
    'stale token cannot change event state'
  );

  -- Simulate worker crash/expiry. The next worker receives a new fencing token.
  update public.payment_webhook_events
  set processing_lease_expires_at = now() - interval '1 second'
  where id = v_event_id;

  v_claim3 := public.yoco_claim_webhook_event(v_event_id, 120);
  perform pg_temp.assert_true((v_claim3->>'claimed')::boolean, 'expired lease can be reclaimed');
  v_token2 := (v_claim3->>'lease_token')::uuid;
  perform pg_temp.assert_true(v_token2 is distinct from v_token, 'takeover issues a new fencing token');

  perform pg_temp.assert_true(
    not public.yoco_update_webhook_event(
      v_event_id, v_token, 'requires_review', null,
      'stale_worker', 'old worker must not finish'
    ),
    'expired worker cannot mutate event after takeover'
  );

  perform pg_temp.assert_true(
    public.yoco_update_webhook_event(
      v_event_id, v_token2, 'requires_review', null,
      'test_review', 'terminal test transition'
    ),
    'current lease holder can persist terminal review state'
  );

  select processing_status, processing_lease_token
  into v_status, v_lease
  from public.payment_webhook_events where id = v_event_id;
  perform pg_temp.assert_true(v_status = 'requires_review', 'terminal review status persisted');
  perform pg_temp.assert_true(v_lease is null, 'terminal transition clears lease');

  -- Payment failure must mutate attempt and event atomically under the lease.
  v_attempt := innerme_private.create_yoco_payment_attempt(
    v_invoice, v_client, 2500, 'lease-failure-test-key-001'
  );
  v_attempt_id := (v_attempt->>'attempt_id')::uuid;
  perform innerme_private.attach_yoco_checkout(
    v_attempt_id, 'yoco_test_lease_checkout_002',
    'https://payments.yoco.com/checkout/lease-test-2', now() + interval '1 hour'
  );
  v_failure_event := innerme_private.record_verified_yoco_webhook(
    'evt_yoco_lease_failure_001', 'payment.failed', repeat('b', 64)
  );
  v_failure_event_id := (v_failure_event->>'event_id')::uuid;
  v_failure_claim := public.yoco_claim_webhook_event(v_failure_event_id, 120);
  perform pg_temp.assert_true((v_failure_claim->>'claimed')::boolean, 'failure event obtains lease');

  v_failure_result := public.yoco_record_payment_failure_with_lease(
    v_failure_event_id, (v_failure_claim->>'lease_token')::uuid, v_attempt_id
  );
  perform pg_temp.assert_true(
    coalesce((v_failure_result->>'payment_failed')::boolean, false),
    'payment failure operation records attempt failure'
  );

  select status into v_status from public.payment_attempts where id = v_attempt_id;
  perform pg_temp.assert_true(v_status = 'failed', 'attempt transitions to failed');
  select processing_status, processing_lease_token
  into v_status, v_lease
  from public.payment_webhook_events where id = v_failure_event_id;
  perform pg_temp.assert_true(v_status = 'processed', 'failure event becomes processed');
  perform pg_temp.assert_true(v_lease is null, 'failure transaction clears lease');
end;
$$;

rollback;
