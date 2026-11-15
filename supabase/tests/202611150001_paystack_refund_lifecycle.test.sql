-- Paystack test-mode refund lifecycle regression scenarios.
-- DESTRUCTIVE-SAFETY: run only on a disposable local Supabase database.
-- No provider API calls are made; webhook calls begin after the signature-verification SQL boundary.
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

create or replace function pg_temp.expect_error(p_statement text, p_message text)
returns void language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when others then
    return;
  end;
  raise exception 'ASSERTION FAILED: expected an error: %', p_message;
end;
$$;

create or replace function pg_temp.apply_paystack_refund_event(
  p_seed text,
  p_attempt_id uuid,
  p_payment_id uuid,
  p_transaction_reference text,
  p_provider_refund_id text,
  p_refund_reference text,
  p_amount_cents bigint,
  p_provider_status text
)
returns jsonb
language plpgsql
as $$
declare
  v_event_type text;
  v_event jsonb;
  v_event_id uuid;
  v_claim jsonb;
  v_lease uuid;
  v_result jsonb;
begin
  v_event_type := case p_provider_status
    when 'pending' then 'refund.pending'
    when 'processing' then 'refund.processing'
    when 'needs-attention' then 'refund.needs-attention'
    when 'failed' then 'refund.failed'
    when 'processed' then 'refund.processed'
    else null
  end;

  if v_event_type is null then
    raise exception 'Unsupported refund test status.';
  end if;

  v_event := innerme_private.record_verified_paystack_webhook(
    v_event_type || ':' || p_seed,
    v_event_type,
    repeat(substr(md5(p_seed), 1, 1), 64)
  );
  v_event_id := (v_event->>'event_id')::uuid;

  v_claim := innerme_private.claim_paystack_webhook_event(v_event_id, 120);
  v_lease := (v_claim->>'lease_token')::uuid;
  if coalesce((v_claim->>'claimed')::boolean, false) is distinct from true
     or v_lease is null then
    raise exception 'Could not claim Paystack refund webhook test event.';
  end if;

  v_result := innerme_private.apply_paystack_refund_webhook_with_lease(
    v_event_id,
    v_lease,
    p_attempt_id,
    p_payment_id,
    p_transaction_reference,
    p_provider_refund_id,
    p_refund_reference,
    p_amount_cents,
    'ZAR',
    p_provider_status
  );
  return v_result;
end;
$$;

do $$
declare
  v_client uuid;
  v_invoice uuid;
  v_attempt jsonb;
  v_attempt_id uuid;
  v_transaction_reference text;
  v_event jsonb;
  v_event_id uuid;
  v_claim jsonb;
  v_lease uuid;
  v_settlement jsonb;
  v_payment_id uuid;
  v_refund jsonb;
  v_same_refund jsonb;
  v_pending_result jsonb;
  v_attention_result jsonb;
  v_failed_result jsonb;
  v_success_result jsonb;
  v_duplicate_result jsonb;
  v_refund_id uuid;
  v_refund_reference text;
  v_second_refund jsonb;
  v_second_refund_id uuid;
  v_second_refund_reference text;
  v_paid numeric(12,2);
  v_outstanding numeric(12,2);
  v_refund_count integer;
  v_status text;
  v_provider_refund_id text;
begin
  insert into public.clients (business_name, contact_name, email)
  values ('Paystack Refund Test Client', 'Refund Test Contact', 'paystack-refund-test@example.invalid')
  returning id into v_client;

  insert into public.invoices (
    client_id, status, currency, subtotal, total,
    online_payment_enabled, partial_payment_enabled
  )
  values (v_client, 'sent', 'ZAR', 100, 100, true, true)
  returning id into v_invoice;

  v_attempt := innerme_private.create_paystack_payment_attempt(
    v_invoice, v_client, 10000, 'paystack-refund-payment-key-001'
  );
  v_attempt_id := (v_attempt->>'attempt_id')::uuid;
  v_transaction_reference := 'SWP-' || v_attempt_id::text;

  perform innerme_private.attach_paystack_checkout(
    v_attempt_id,
    v_transaction_reference,
    'https://checkout.paystack.com/paystack-refund-disposable-test',
    now() + interval '1 hour'
  );

  v_event := innerme_private.record_verified_paystack_webhook(
    'charge.success:refund-test-payment-001',
    'charge.success',
    repeat('a', 64)
  );
  v_event_id := (v_event->>'event_id')::uuid;
  v_claim := innerme_private.claim_paystack_webhook_event(v_event_id, 120);
  v_lease := (v_claim->>'lease_token')::uuid;

  v_settlement := innerme_private.settle_paystack_payment_with_lease(
    v_attempt_id,
    v_event_id,
    v_lease,
    v_transaction_reference,
    10000,
    'ZAR',
    'test',
    '987654321',
    'card'
  );
  perform pg_temp.assert_true(
    coalesce((v_settlement->>'settled')::boolean, false),
    'Paystack test payment settles before refund tests'
  );
  v_payment_id := (v_settlement->>'payment_id')::uuid;
  perform pg_temp.assert_true(v_payment_id is not null, 'settled payment ID exists');

  -- Reserve a partial refund and verify the idempotency key creates only one row.
  v_refund := innerme_private.create_paystack_refund_request(
    v_payment_id, 2500,
    '52345678-1234-4234-8234-123456789012'::uuid,
    'Test partial refund'
  );
  v_refund_id := (v_refund->>'refund_id')::uuid;
  v_refund_reference := v_refund->>'refund_reference';
  perform pg_temp.assert_true(v_refund_id is not null, 'partial refund reservation is created');
  perform pg_temp.assert_true(v_refund->>'status' = 'pending', 'new refund is pending');
  perform pg_temp.assert_true(length(v_refund_reference) between 8 and 64, 'refund reference meets Paystack requirements');

  v_same_refund := innerme_private.create_paystack_refund_request(
    v_payment_id, 2500,
    '52345678-1234-4234-8234-123456789012'::uuid,
    'Test partial refund'
  );
  perform pg_temp.assert_true(
    coalesce((v_same_refund->>'reused')::boolean, false)
      and (v_same_refund->>'refund_id')::uuid = v_refund_id,
    'repeated idempotency key reuses the same refund reservation'
  );

  perform pg_temp.expect_error(
    format(
      'select innerme_private.create_paystack_refund_request(%L::uuid, 7600, %L::uuid, %L)',
      v_payment_id,
      '62345678-1234-4234-8234-123456789012',
      'Over refund test'
    ),
    'pending refund reservations count towards the refundable payment balance'
  );

  -- The Create Refund API response stores its numeric refund ID and pending status.
  perform innerme_private.record_paystack_refund_initialization(
    v_refund_id, v_refund_reference, '7654321', 'pending', null
  );

  v_pending_result := pg_temp.apply_paystack_refund_event(
    'refund-pending-001', v_attempt_id, v_payment_id,
    v_transaction_reference, '7654321', v_refund_reference, 2500, 'pending'
  );
  perform pg_temp.assert_true(
    v_pending_result->>'status' = 'pending',
    'refund.pending remains pending in the refund ledger'
  );

  select amount_paid, amount_outstanding into v_paid, v_outstanding
  from public.invoices where id = v_invoice;
  perform pg_temp.assert_true(
    v_paid = 100 and v_outstanding = 0,
    'pending refund does not reduce invoice net paid'
  );

  v_attention_result := pg_temp.apply_paystack_refund_event(
    'refund-needs-attention-001', v_attempt_id, v_payment_id,
    v_transaction_reference, '7654321', v_refund_reference, 2500, 'needs-attention'
  );
  perform pg_temp.assert_true(
    v_attention_result->>'status' = 'requires_review',
    'refund.needs-attention enters a manual review state'
  );

  select amount_paid, amount_outstanding into v_paid, v_outstanding
  from public.invoices where id = v_invoice;
  perform pg_temp.assert_true(
    v_paid = 100 and v_outstanding = 0,
    'needs-attention refund does not reduce invoice net paid'
  );

  v_failed_result := pg_temp.apply_paystack_refund_event(
    'refund-failed-001', v_attempt_id, v_payment_id,
    v_transaction_reference, '7654321', v_refund_reference, 2500, 'failed'
  );
  perform pg_temp.assert_true(
    v_failed_result->>'status' = 'failed',
    'refund.failed releases the refundable reservation as failed'
  );

  select status, provider_refund_id into v_status, v_provider_refund_id
  from public.payment_refunds where id = v_refund_id;
  perform pg_temp.assert_true(
    v_status = 'failed' and v_provider_refund_id = '7654321',
    'failed refund retains the provider refund identity'
  );

  select amount_paid, amount_outstanding into v_paid, v_outstanding
  from public.invoices where id = v_invoice;
  perform pg_temp.assert_true(
    v_paid = 100 and v_outstanding = 0,
    'failed refund restores no invoice balance because it was never deducted'
  );

  -- A failed refund can be re-requested with a new idempotency key.
  v_second_refund := innerme_private.create_paystack_refund_request(
    v_payment_id, 10000,
    '72345678-1234-4234-8234-123456789012'::uuid,
    'Test full refund after failed partial refund'
  );
  v_second_refund_id := (v_second_refund->>'refund_id')::uuid;
  v_second_refund_reference := v_second_refund->>'refund_reference';
  perform pg_temp.assert_true(
    v_second_refund_id is not null and v_second_refund_id <> v_refund_id,
    'a new idempotency key permits a new refund after the failed refund'
  );

  perform innerme_private.record_paystack_refund_initialization(
    v_second_refund_id, v_second_refund_reference, '7654322', 'pending', null
  );

  -- The documented webhook payload may have a null refund_reference.
  -- A single open payment+amount match is safe; ambiguous matches are not.
  v_success_result := pg_temp.apply_paystack_refund_event(
    'refund-processed-001', v_attempt_id, v_payment_id,
    v_transaction_reference, null, null, 10000, 'processed'
  );
  perform pg_temp.assert_true(
    v_success_result->>'status' = 'succeeded',
    'only refund.processed moves the refund into the completed ledger state'
  );

  select amount_paid, amount_outstanding into v_paid, v_outstanding
  from public.invoices where id = v_invoice;
  perform pg_temp.assert_true(
    v_paid = 0 and v_outstanding = 100,
    'processed full refund restores the entire invoice balance'
  );

  select count(*) into v_refund_count
  from public.payment_refunds
  where payment_id = v_payment_id
    and provider = 'paystack'
    and status = 'succeeded';
  perform pg_temp.assert_true(v_refund_count = 1, 'only the completed refund is counted as succeeded');

  -- A second signed event for the same completed refund is deduplicated by the
  -- merchant refund reference retained from the Create Refund API response.
  v_duplicate_result := pg_temp.apply_paystack_refund_event(
    'refund-processed-duplicate-001', v_attempt_id, v_payment_id,
    v_transaction_reference, null, null, 10000, 'processed'
  );
  perform pg_temp.assert_true(
    coalesce((v_duplicate_result->>'duplicate')::boolean, false),
    'a duplicate processed event does not create a second refund'
  );

  select count(*) into v_refund_count
  from public.payment_refunds
  where payment_id = v_payment_id and provider = 'paystack';
  perform pg_temp.assert_true(v_refund_count = 2, 'only two refund reservations exist across the failed and succeeded requests');

  perform pg_temp.expect_error(
    format(
      'update public.payment_refunds set reason = %L where id = %L::uuid',
      'tamper', v_second_refund_id
    ),
    'successful Paystack refund ledger rows are immutable'
  );
end;
$$;

rollback;
