-- Verify Paystack Live is enabled by default for all existing and new invoices.
-- Run only in the disposable PostgreSQL fixture used by Paystack Live QA.

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

DO $test$
DECLARE
    v_existing_invoice uuid := '00000000-0000-4000-8000-000000000001';
    v_new_invoice uuid;
    v_result jsonb;
    v_enabled boolean;
    v_provider text;
    v_partial boolean;
    v_deposit numeric(12,2);
BEGIN
    PERFORM pg_temp.assert_true(
        (SELECT column_default LIKE 'true%' FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'online_payment_enabled'),
        'new invoices default to online payments enabled'
    );
    PERFORM pg_temp.assert_true(
        (SELECT column_default LIKE '''paystack''' || '%' FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'online_payment_provider'),
        'new invoices default to Paystack'
    );

    SELECT online_payment_enabled, online_payment_provider
    INTO v_enabled, v_provider
    FROM public.invoices
    WHERE id = v_existing_invoice;

    PERFORM pg_temp.assert_true(v_enabled IS TRUE, 'legacy invoice is online-payment enabled after backfill');
    PERFORM pg_temp.assert_true(v_provider = 'paystack', 'legacy Yoco invoice is migrated to Paystack');

    INSERT INTO public.invoices (client_id, status, currency, total, amount_outstanding)
    VALUES ('00000000-0000-4000-8000-000000000003', 'sent', 'ZAR', 500, 500)
    RETURNING id INTO v_new_invoice;

    SELECT online_payment_enabled, online_payment_provider
    INTO v_enabled, v_provider
    FROM public.invoices
    WHERE id = v_new_invoice;

    PERFORM pg_temp.assert_true(v_enabled IS TRUE, 'new invoice gets online payment automatically');
    PERFORM pg_temp.assert_true(v_provider = 'paystack', 'new invoice gets Paystack automatically');

    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', true);

    PERFORM pg_temp.assert_true(
        has_function_privilege(
            'authenticated',
            'public.admin_set_invoice_payment_settings(uuid,boolean,boolean,numeric,text)',
            'EXECUTE'
        ),
        'authenticated administrators retain execute permission on the guarded settings RPC'
    );
    PERFORM pg_temp.assert_true(
        NOT has_function_privilege(
            'anon',
            'public.admin_set_invoice_payment_settings(uuid,boolean,boolean,numeric,text)',
            'EXECUTE'
        ),
        'anonymous users cannot execute the settings RPC'
    );

    -- Even a stale caller that supplies false/Yoco cannot disable Paystack or
    -- assign another provider. The only mutable settings are instalments/deposit.
    v_result := public.admin_set_invoice_payment_settings(v_new_invoice, false, true, 100, 'yoco');

    PERFORM pg_temp.assert_true((v_result->>'online_payment_enabled')::boolean, 'legacy false input cannot disable Paystack');
    PERFORM pg_temp.assert_true(v_result->>'online_payment_provider' = 'paystack', 'legacy Yoco input cannot change provider');
    PERFORM pg_temp.assert_true((v_result->>'partial_payment_enabled')::boolean, 'partial-payment preference remains configurable');
    PERFORM pg_temp.assert_true((v_result->>'deposit_amount')::numeric = 100, 'minimum first deposit is saved');

    SELECT online_payment_enabled, online_payment_provider, partial_payment_enabled, deposit_amount
    INTO v_enabled, v_provider, v_partial, v_deposit
    FROM public.invoices
    WHERE id = v_new_invoice;

    PERFORM pg_temp.assert_true(v_enabled IS TRUE AND v_provider = 'paystack', 'database row keeps Paystack enabled after settings save');
    PERFORM pg_temp.assert_true(v_partial IS TRUE AND v_deposit = 100, 'optional instalment/deposit settings are persisted');

    v_result := public.admin_set_invoice_payment_settings(v_new_invoice, false, false, NULL, 'yoco');
    PERFORM pg_temp.assert_true((v_result->>'online_payment_enabled')::boolean, 'legacy false input remains ignored when instalments are disabled');
    PERFORM pg_temp.assert_true(v_result->>'online_payment_provider' = 'paystack', 'provider remains Paystack when instalments are disabled');

    SELECT partial_payment_enabled, deposit_amount
    INTO v_partial, v_deposit
    FROM public.invoices
    WHERE id = v_new_invoice;

    PERFORM pg_temp.assert_true(v_partial IS FALSE AND v_deposit IS NULL, 'turning off instalments clears their deposit rule');
END;
$test$;

ROLLBACK;
