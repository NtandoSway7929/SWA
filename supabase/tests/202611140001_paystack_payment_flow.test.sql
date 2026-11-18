-- Paystack test-mode payment flow integration test.
-- DESTRUCTIVE-SAFETY: run ONLY on a disposable local Supabase database.
-- The event is inserted through the post-HMAC-verification SQL boundary.
-- This test does not call Paystack or make any external requests.
-- All fixtures are rolled back.

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
  v_reference text;
  v_event jsonb;
  v_event_id uuid;
  v_claim jsonb;
  v_lease uuid;
  v_settlement jsonb;
  v_duplicate jsonb;
  v_payment uuid;
  v_receipt_count integer;
  v_paid numeric(12,2);
  v_outstanding numeric(12,2);
  v_method text;
  v_provider text;
  v_snapshot jsonb;
  v_failed_invoice uuid;
  v_failed_attempt jsonb;
  v_failed_attempt_id uuid;
  v_failed_reference text;
  v_failed_result jsonb;
  v_failed_duplicate jsonb;
  v_failed_payment_count integer;
  v_failed_receipt_count integer;
  v_failed_invoice_status text;
  v_failed_paid numeric(12,2);
  v_failed_outstanding numeric(12,2);
begin
  insert into public.clients (business_name, contact_name, email)
  values ('Paystack Disposable Test Client', 'Test Contact', 'paystack-test@example.invalid')
  returning id into v_client;

  insert into public.invoices (
    client_id, status, currency, subtotal, total,
    online_payment_enabled, partial_payment_enabled, deposit_amount
  )
  values (v_client, 'sent', 'ZAR', 100, 100, true, true, 25)
  returning id into v_invoice;

  v_attempt := innerme_private.create_paystack_payment_attempt(
    v_invoice, v_client, 2500, 'paystack-test-flow-key-0001'
  );
  v_attempt_id := (v_attempt->>'attempt_id')::uuid;
  perform pg_temp.assert_true(v_attempt_id is not null, 'Paystack payment attempt is created');

  select provider into v_provider
  from public.payment_attempts where id = v_attempt_id;
  perform pg_temp.assert_true(v_provider = 'paystack', 'attempt is stored under Paystack provider');
  v_reference := 'SWP-' || v_attempt_id::text;

  perform innerme_private.attach_paystack_checkout(
    v_attempt_id, v_reference,
    'https://checkout.paystack.com/disposable-test-session',
    now() + interval '1 hour'
  );

  v_event := innerme_private.record_verified_paystack_webhook(
    'charge.success:900001:' || v_reference,
    'charge.success',
    repeat('a', 64)
  );
  v_event_id := (v_event->>'event_id')::uuid;
  perform pg_temp.assert_true(v_event_id is not null, 'verified Paystack webhook is recorded');

  v_claim := innerme_private.claim_paystack_webhook_event(v_event_id, 120);
  v_lease := (v_claim->>'lease_token')::uuid;
  perform pg_temp.assert_true((v_claim->>'claimed')::boolean, 'Paystack webhook worker lease is acquired');

  v_settlement := innerme_private.settle_paystack_payment_with_lease(
    v_attempt_id, v_event_id, v_lease, v_reference,
    2500, 'ZAR', 'test', '900001', 'eft'
  );
  perform pg_temp.assert_true(
    coalesce((v_settlement->>'settled')::boolean, false),
    'verified Paystack transaction settles successfully'
  );
  v_payment := (v_settlement->>'payment_id')::uuid;
  perform pg_temp.assert_true(v_payment is not null, 'settlement creates a payment ledger record');

  select provider, method into v_provider, v_method
  from public.payments where id = v_payment;
  perform pg_temp.assert_true(v_provider = 'paystack', 'payment is linked to Paystack');
  perform pg_temp.assert_true(v_method = 'EFT', 'Paystack EFT channel is mapped to the existing EFT method');

  select count(*) into v_receipt_count
  from public.payment_receipts where payment_id = v_payment;
  perform pg_temp.assert_true(v_receipt_count = 1, 'one immutable receipt is issued');

  select snapshot into v_snapshot
  from public.payment_receipts where payment_id = v_payment;
  perform pg_temp.assert_true(v_snapshot->>'provider' = 'Paystack', 'receipt snapshot identifies Paystack');
  perform pg_temp.assert_true(v_snapshot->>'method' = 'EFT', 'receipt snapshot records EFT as the channel');

  select amount_paid, amount_outstanding
  into v_paid, v_outstanding
  from public.invoices where id = v_invoice;
  perform pg_temp.assert_true(v_paid = 25 and v_outstanding = 75, 'invoice balance reflects the confirmed partial payment');

  v_duplicate := innerme_private.record_verified_paystack_webhook(
    'charge.success:900001:' || v_reference,
    'charge.success',
    repeat('a', 64)
  );
  perform pg_temp.assert_true(
    coalesce((v_duplicate->>'duplicate')::boolean, false) and
      v_duplicate->>'processing_status' = 'processed',
    'replayed provider event is recognized as a processed duplicate'
  );

  select count(*) into v_receipt_count
  from public.payment_receipts where payment_id = v_payment;
  perform pg_temp.assert_true(v_receipt_count = 1, 'duplicate event does not issue another receipt');

  perform pg_temp.assert_true(
    (select status = 'succeeded' from public.payment_attempts where id = v_attempt_id),
    'payment attempt reaches succeeded state'
  );
  perform pg_temp.assert_true(
    (select processing_status = 'processed' and processing_lease_token is null
       from public.payment_webhook_events where id = v_event_id),
    'processed webhook releases its worker lease'
  );

  -- A failed/abandoned provider verification must close the attempt without
  -- recording money or issuing an immutable receipt. Paystack does not send
  -- transaction webhooks for failed payments, so the status endpoint invokes
  -- this narrowly scoped routine after independently verifying the transaction.
  insert into public.invoices (
    client_id, status, currency, subtotal, total,
    online_payment_enabled, partial_payment_enabled
  )
  values (v_client, 'sent', 'ZAR', 100, 100, true, false)
  returning id into v_failed_invoice;

  v_failed_attempt := innerme_private.create_paystack_payment_attempt(
    v_failed_invoice, v_client, 10000, 'paystack-test-failed-key-0002'
  );
  v_failed_attempt_id := (v_failed_attempt->>'attempt_id')::uuid;
  v_failed_reference := 'SWP-' || v_failed_attempt_id::text;

  perform innerme_private.attach_paystack_checkout(
    v_failed_attempt_id, v_failed_reference,
    'https://checkout.paystack.com/disposable-failed-session',
    now() + interval '1 hour'
  );

  v_failed_result := innerme_private.record_paystack_failed_attempt_status(
    v_failed_attempt_id, v_failed_reference, 10000,
    'ZAR', 'test', '900002', 'failed'
  );
  perform pg_temp.assert_true(
    v_failed_result->>'status' = 'failed' and
      coalesce((v_failed_result->>'updated')::boolean, false),
    'verified failed Paystack transaction closes the local attempt as failed'
  );

  v_failed_duplicate := innerme_private.record_paystack_failed_attempt_status(
    v_failed_attempt_id, v_failed_reference, 10000,
    'ZAR', 'test', '900002', 'failed'
  );
  perform pg_temp.assert_true(
    v_failed_duplicate->>'status' = 'failed' and
      coalesce((v_failed_duplicate->>'duplicate')::boolean, false),
    'repeated failed-status verification is idempotent'
  );

  select count(*) into v_failed_payment_count
  from public.payments where invoice_id = v_failed_invoice and provider = 'paystack';
  select count(*) into v_failed_receipt_count
  from public.payment_receipts r
  join public.payments p on p.id = r.payment_id
  where p.invoice_id = v_failed_invoice and p.provider = 'paystack';
  select status, amount_paid, amount_outstanding
  into v_failed_invoice_status, v_failed_paid, v_failed_outstanding
  from public.invoices where id = v_failed_invoice;

  perform pg_temp.assert_true(v_failed_payment_count = 0, 'failed Paystack transaction creates no payment ledger row');
  perform pg_temp.assert_true(v_failed_receipt_count = 0, 'failed Paystack transaction creates no receipt');
  perform pg_temp.assert_true(
    v_failed_invoice_status = 'sent' and v_failed_paid = 0 and v_failed_outstanding = 100,
    'failed Paystack transaction leaves the invoice balance unchanged'
  );
end;
$$;

rollback;
