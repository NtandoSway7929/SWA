-- Yoco payment/refund functional integration test.
-- DESTRUCTIVE-SAFETY: run ONLY on a disposable local Supabase database.
-- Prerequisites: full base schema plus Yoco migrations 001-005 and pgcrypto.
-- The test creates isolated fixtures and rolls the transaction back.
-- It does NOT call Yoco or send external network requests.

begin;

create or replace function pg_temp.assert_true(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
    if p_condition is distinct from true then
        raise exception 'ASSERTION FAILED: %', p_message;
    end if;
end;
$$;

create or replace function pg_temp.expect_error(p_statement text, p_message text)
returns void
language plpgsql
as $$
begin
    begin
        execute p_statement;
    exception when others then
        return;
    end;
    raise exception 'ASSERTION FAILED: expected an error: %', p_message;
end;
$$;

do $$
declare
    v_client_id uuid;
    v_invoice_id uuid;
    v_attempt jsonb;
    v_attempt_id uuid;
    v_event jsonb;
    v_event_id uuid;
    v_settlement jsonb;
    v_duplicate jsonb;
    v_payment_id uuid;
    v_receipt_count integer;
    v_refund_event jsonb;
    v_refund_event_id uuid;
    v_refund jsonb;
    v_net_paid numeric(12,2);
    v_outstanding numeric(12,2);
begin
    insert into public.clients (business_name, contact_name, email)
    values ('Yoco Disposable Test Client', 'Test Contact', 'yoco-test@example.invalid')
    returning id into v_client_id;

    insert into public.invoices (
        client_id, status, currency, subtotal, total,
        online_payment_enabled, partial_payment_enabled
    )
    values (
        v_client_id, 'sent', 'ZAR', 100, 100, true, true
    )
    returning id into v_invoice_id;

    select amount_outstanding into v_outstanding
    from public.invoices where id = v_invoice_id;
    perform pg_temp.assert_true(v_outstanding = 100, 'new invoice starts with full outstanding balance');

    v_attempt := innerme_private.create_yoco_payment_attempt(
        v_invoice_id, v_client_id, 6000, 'test-flow-key-0001'
    );
    v_attempt_id := (v_attempt->>'attempt_id')::uuid;
    perform pg_temp.assert_true(v_attempt_id is not null, 'payment attempt created for the invoice');

    perform innerme_private.attach_yoco_checkout(
        v_attempt_id, 'yoco_test_checkout_0001',
        'https://payments.yoco.com/checkout/test-flow-0001', now() + interval '1 hour'
    );

    v_event := innerme_private.record_verified_yoco_webhook(
        'evt_test_payment_0001', 'payment.succeeded',
        repeat('a', 64)
    );
    v_event_id := (v_event->>'event_id')::uuid;

    v_settlement := innerme_private.settle_yoco_payment(
        v_attempt_id, v_event_id, 'yoco_test_checkout_0001',
        6000, 'ZAR', 'test', 'yoco_test_txn_0001'
    );
    perform pg_temp.assert_true((v_settlement->>'settled')::boolean, 'verified payment settles');
    perform pg_temp.assert_true(coalesce((v_settlement->>'duplicate')::boolean, false) = false, 'first settlement is not marked duplicate');
    v_payment_id := (v_settlement->>'payment_id')::uuid;
    perform pg_temp.assert_true(v_payment_id is not null, 'settlement creates a payment ledger row');

    v_duplicate := innerme_private.settle_yoco_payment(
        v_attempt_id, v_event_id, 'yoco_test_checkout_0001',
        6000, 'ZAR', 'test', 'yoco_test_txn_0001'
    );
    perform pg_temp.assert_true((v_duplicate->>'settled')::boolean, 'replayed settlement remains successful');
    perform pg_temp.assert_true((v_duplicate->>'duplicate')::boolean, 'replayed settlement is idempotently identified');

    select count(*) into v_receipt_count
    from public.payment_receipts where payment_id = v_payment_id;
    perform pg_temp.assert_true(v_receipt_count = 1, 'exactly one receipt exists after duplicate settlement');

    select amount_paid, amount_outstanding
    into v_net_paid, v_outstanding
    from public.invoices where id = v_invoice_id;
    perform pg_temp.assert_true(v_net_paid = 60 and v_outstanding = 40, 'invoice balance reflects the settled partial payment');

    -- An attempt cannot exceed the remaining invoice balance.
    perform pg_temp.expect_error(
        format(
            'select innerme_private.create_yoco_payment_attempt(%L::uuid, %L::uuid, 4001, %L)',
            v_invoice_id, v_client_id, 'test-flow-overpay-0001'
        ),
        'attempt over outstanding balance rejected'
    );

    -- Refund event must be associated with the same attempt/payment.
    v_refund_event := innerme_private.record_verified_yoco_webhook(
        'evt_test_refund_0001', 'refund.succeeded',
        repeat('b', 64)
    );
    v_refund_event_id := (v_refund_event->>'event_id')::uuid;

    update public.payment_webhook_events
    set payment_attempt_id = v_attempt_id
    where id = v_refund_event_id;

    v_refund := innerme_private.record_yoco_refund_success(
        v_refund_event_id, v_payment_id,
        'yoco_test_refund_0001', 2000, 'ZAR'
    );
    perform pg_temp.assert_true((v_refund->>'recorded')::boolean, 'verified partial refund is recorded');

    select amount_paid, amount_outstanding
    into v_net_paid, v_outstanding
    from public.invoices where id = v_invoice_id;
    perform pg_temp.assert_true(v_net_paid = 40 and v_outstanding = 60, 'successful refund restores invoice outstanding balance');

    -- Replaying the same provider refund ID must not create another ledger row.
    v_refund := innerme_private.record_yoco_refund_success(
        v_refund_event_id, v_payment_id,
        'yoco_test_refund_0001', 2000, 'ZAR'
    );
    perform pg_temp.assert_true((v_refund->>'duplicate')::boolean, 'refund replay is idempotent');

    -- A distinct refund cannot exceed the unrefunded payment remainder (R40).
    v_refund_event := innerme_private.record_verified_yoco_webhook(
        'evt_test_refund_0002', 'refund.succeeded',
        repeat('c', 64)
    );
    v_refund_event_id := (v_refund_event->>'event_id')::uuid;
    update public.payment_webhook_events
    set payment_attempt_id = v_attempt_id
    where id = v_refund_event_id;

    perform pg_temp.expect_error(
        format(
            'select innerme_private.record_yoco_refund_success(%L::uuid, %L::uuid, %L, 4001, %L)',
            v_refund_event_id, v_payment_id, 'yoco_test_refund_0002', 'ZAR'
        ),
        'cumulative refunds above original payment rejected'
    );

    -- Financial records are append-only after confirmation/issuance.
    perform pg_temp.expect_error(
        format('update public.payments set notes = %L where id = %L::uuid', 'tamper', v_payment_id),
        'Yoco payment update rejected'
    );
    perform pg_temp.expect_error(
        format('delete from public.payments where id = %L::uuid', v_payment_id),
        'Yoco payment delete rejected'
    );
    perform pg_temp.expect_error(
        format('update public.payment_receipts set snapshot = %L::jsonb where payment_id = %L::uuid',
               '{"tampered":true}', v_payment_id),
        'issued receipt update rejected'
    );
    perform pg_temp.expect_error(
        format('update public.payment_refunds set reason = %L where provider_refund_id = %L',
               'tamper', 'yoco_test_refund_0001'),
        'successful refund update rejected'
    );

    -- Portal token isolation is covered by separate RPC/auth tests; this test
    -- verifies the invoice balance itself after the refund.
    perform pg_temp.assert_true(
        (select count(*) = 1 from public.payments where id = v_payment_id and client_id = v_client_id),
        'settled payment remains attached to the invoice owner'
    );
end;
$$;

rollback;
