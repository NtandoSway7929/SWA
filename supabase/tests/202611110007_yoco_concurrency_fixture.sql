-- Creates persistent fixtures for the two-session Yoco concurrency exercise.
-- RUN ONLY on a disposable local PostgreSQL/Supabase database after base schema
-- and Yoco migrations 001-005. This script commits its fixtures intentionally.
-- Reset the disposable database after the exercise; Yoco ledger rows are immutable.

do $$
declare
    v_client uuid;
    v_invoice uuid;
    v_attempt jsonb;
    v_attempt_id uuid;
    v_payment_event jsonb;
    v_refund_event_a jsonb;
    v_refund_event_b jsonb;
begin
    insert into public.clients (business_name, contact_name, email)
    values ('Yoco Concurrency Fixture', 'Race Test', 'yoco-race@example.invalid')
    returning id into v_client;

    insert into public.invoices (
        client_id, status, currency, subtotal, total,
        online_payment_enabled, partial_payment_enabled
    )
    values (v_client, 'sent', 'ZAR', 100, 100, true, true)
    returning id into v_invoice;

    v_attempt := innerme_private.create_yoco_payment_attempt(
        v_invoice, v_client, 6000, 'concurrency-settle-key-01'
    );
    v_attempt_id := (v_attempt->>'attempt_id')::uuid;

    perform innerme_private.attach_yoco_checkout(
        v_attempt_id, 'yoco_test_race_checkout_01',
        'https://payments.yoco.com/checkout/race-fixture', now() + interval '1 hour'
    );

    v_payment_event := innerme_private.record_verified_yoco_webhook(
        'evt_yoco_race_payment_01', 'payment.succeeded', repeat('d', 64)
    );

    v_refund_event_a := innerme_private.record_verified_yoco_webhook(
        'evt_yoco_race_refund_a', 'refund.succeeded', repeat('e', 64)
    );
    v_refund_event_b := innerme_private.record_verified_yoco_webhook(
        'evt_yoco_race_refund_b', 'refund.succeeded', repeat('f', 64)
    );

    update public.payment_webhook_events
    set payment_attempt_id = v_attempt_id
    where id in (
        (v_refund_event_a->>'event_id')::uuid,
        (v_refund_event_b->>'event_id')::uuid
    );

    raise notice 'RACE_FIXTURE client_id=% invoice_id=% attempt_id=% payment_event_id=% refund_event_a=% refund_event_b=%',
        v_client, v_invoice, v_attempt_id,
        v_payment_event->>'event_id',
        v_refund_event_a->>'event_id',
        v_refund_event_b->>'event_id';
end;
$$;
