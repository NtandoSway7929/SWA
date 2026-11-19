BEGIN;

-- Paystack Live is the standard checkout for every invoice. The portal still
-- enforces invoice status, balance and ZAR eligibility before rendering checkout.
ALTER TABLE public.invoices
    ALTER COLUMN online_payment_enabled SET DEFAULT true;

ALTER TABLE public.invoices
    ALTER COLUMN online_payment_provider SET DEFAULT 'paystack';

-- Backfill existing invoices, including those previously assigned to Yoco.
-- Historical payments and payment attempts remain untouched.
UPDATE public.invoices
SET online_payment_enabled = true,
    online_payment_provider = 'paystack',
    updated_at = now()
WHERE online_payment_enabled IS DISTINCT FROM true
   OR online_payment_provider IS DISTINCT FROM 'paystack';

-- Keep the existing RPC signature so a stale dashboard build cannot break.
-- Its former online/provider inputs are now compatibility-only: this function
-- always preserves Paystack Live and only allows optional instalment settings.
CREATE OR REPLACE FUNCTION public.admin_set_invoice_payment_settings(
    p_invoice_id uuid,
    p_online_payment_enabled boolean,
    p_partial_payment_enabled boolean,
    p_deposit_amount numeric DEFAULT NULL,
    p_provider text DEFAULT 'paystack'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_invoice public.invoices%rowtype;
    v_online boolean := true;
    v_provider text := 'paystack';
    v_partial boolean := coalesce(p_partial_payment_enabled, false);
    v_deposit numeric(12,2) := p_deposit_amount;
BEGIN
    IF auth.uid() IS NULL OR NOT coalesce(public.is_swayphics_admin(), false) THEN
        RAISE EXCEPTION 'Administrator access is required.' USING errcode = '42501';
    END IF;

    IF p_invoice_id IS NULL THEN
        RAISE EXCEPTION 'A valid invoice is required.';
    END IF;

    SELECT *
    INTO v_invoice
    FROM public.invoices
    WHERE id = p_invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invoice not found.';
    END IF;

    IF v_invoice.status IN ('draft', 'cancelled', 'paid')
       OR coalesce(v_invoice.amount_outstanding, v_invoice.total, 0) <= 0 THEN
        RAISE EXCEPTION 'Only issued invoices with an outstanding balance can have payment terms configured.';
    END IF;

    IF v_partial AND upper(coalesce(v_invoice.currency, '')) <> 'ZAR' THEN
        RAISE EXCEPTION 'Partial payment terms are currently supported for ZAR invoices only.';
    END IF;

    IF v_deposit IS NOT NULL THEN
        IF NOT v_partial THEN
            RAISE EXCEPTION 'A minimum deposit can only be configured when partial payments are enabled.';
        END IF;

        IF v_deposit <= 0
           OR v_deposit > coalesce(v_invoice.amount_outstanding, v_invoice.total, 0) THEN
            RAISE EXCEPTION 'The minimum deposit must be greater than zero and no greater than the outstanding balance.';
        END IF;

        v_deposit := round(v_deposit, 2);
    END IF;

    UPDATE public.invoices
    SET online_payment_enabled = v_online,
        online_payment_provider = v_provider,
        partial_payment_enabled = v_partial,
        deposit_amount = CASE WHEN v_partial THEN v_deposit ELSE NULL END,
        updated_at = now()
    WHERE id = p_invoice_id;

    RETURN jsonb_build_object(
        'invoice_id', p_invoice_id,
        'online_payment_enabled', true,
        'online_payment_provider', 'paystack',
        'partial_payment_enabled', v_partial,
        'deposit_amount', CASE WHEN v_partial THEN v_deposit ELSE NULL END
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_invoice_payment_settings(uuid, boolean, boolean, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_invoice_payment_settings(uuid, boolean, boolean, numeric, text) TO authenticated;

COMMIT;
