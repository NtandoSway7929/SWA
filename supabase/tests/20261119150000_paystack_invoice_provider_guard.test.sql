-- Paystack must only create attempts for invoices explicitly assigned to Paystack.
-- Runs only against a disposable PostgreSQL database created by the QA workflow.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_condition IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'ASSERTION FAILED: %', p_message;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.expect_message(
    p_statement text,
    p_expected_message text,
    p_assertion text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_actual_message text;
BEGIN
    BEGIN
        EXECUTE p_statement;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_actual_message = MESSAGE_TEXT;
        IF v_actual_message = p_expected_message THEN
            RETURN;
        END IF;
        RAISE EXCEPTION 'ASSERTION FAILED: % (expected %, received %)',
            p_assertion, p_expected_message, v_actual_message;
    END;
    RAISE EXCEPTION 'ASSERTION FAILED: expected rejection: %', p_assertion;
END;
$$;

DO $test$
DECLARE
    v_client_id uuid := gen_random_uuid();
    v_yoco_invoice_id uuid;
    v_paystack_invoice_id uuid;
    v_attempt jsonb;
    v_attempt_id uuid;
BEGIN
    INSERT INTO public.invoices (
        client_id, status, currency, total, amount_outstanding,
        online_payment_enabled, online_payment_provider
    )
    VALUES (
        v_client_id, 'sent', 'ZAR', 100, 100,
        true, 'yoco'
    )
    RETURNING id INTO v_yoco_invoice_id;

    PERFORM pg_temp.expect_message(
        format(
            'SELECT innerme_private.create_paystack_payment_attempt(%L::uuid, %L::uuid, 10000, %L)',
            v_yoco_invoice_id, v_client_id, 'provider-isolation-yoco-001'
        ),
        'This invoice is not configured for Paystack checkout.',
        'Paystack rejects an enabled invoice assigned to Yoco'
    );

    PERFORM pg_temp.assert_true(
        NOT EXISTS (
            SELECT 1
            FROM public.payment_attempts
            WHERE invoice_id = v_yoco_invoice_id
              AND provider = 'paystack'
        ),
        'a Yoco invoice must not receive a Paystack payment attempt'
    );

    INSERT INTO public.invoices (
        client_id, status, currency, total, amount_outstanding,
        online_payment_enabled, online_payment_provider
    )
    VALUES (
        v_client_id, 'sent', 'ZAR', 100, 100,
        true, 'paystack'
    )
    RETURNING id INTO v_paystack_invoice_id;

    v_attempt := innerme_private.create_paystack_payment_attempt(
        v_paystack_invoice_id,
        v_client_id,
        10000,
        'provider-isolation-paystack-001'
    );
    v_attempt_id := (v_attempt->>'attempt_id')::uuid;

    PERFORM pg_temp.assert_true(
        v_attempt_id IS NOT NULL,
        'Paystack creates an attempt for an enabled Paystack invoice'
    );
    PERFORM pg_temp.assert_true(
        EXISTS (
            SELECT 1
            FROM public.payment_attempts
            WHERE id = v_attempt_id
              AND invoice_id = v_paystack_invoice_id
              AND provider = 'paystack'
              AND environment = 'live'
              AND amount_cents = 10000
        ),
        'the accepted attempt is attached to the Paystack invoice in Live mode'
    );
END;
$test$;

ROLLBACK;
