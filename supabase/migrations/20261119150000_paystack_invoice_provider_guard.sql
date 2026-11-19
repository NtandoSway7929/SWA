-- Enforce provider isolation at the server-side Paystack attempt boundary.
-- This corrects production activation drift: Paystack checkout must not be
-- created for an invoice assigned to Yoco (or any other provider).

CREATE OR REPLACE FUNCTION innerme_private.create_paystack_payment_attempt(
    p_invoice_id uuid,
    p_client_id uuid,
    p_amount_cents bigint,
    p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
    v_invoice public.invoices%rowtype;
    v_attempt public.payment_attempts%rowtype;
    v_outstanding_cents bigint;
begin
    if p_invoice_id is null or p_client_id is null then
        raise exception 'Invoice and client are required.';
    end if;
    if p_amount_cents is null or p_amount_cents < 200 then
        raise exception 'Payment amount is below the supported minimum.';
    end if;
    if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then
        raise exception 'A valid idempotency key is required.';
    end if;

    select *
    into v_invoice
    from public.invoices
    where id = p_invoice_id
      and client_id = p_client_id
    for update;

    if not found then
        raise exception 'Invoice not found for this client.';
    end if;
    if not coalesce(v_invoice.online_payment_enabled, false) then
        raise exception 'Online payment is not enabled for this invoice.';
    end if;
    if coalesce(v_invoice.online_payment_provider, 'yoco') <> 'paystack' then
        raise exception 'This invoice is not configured for Paystack checkout.';
    end if;
    if v_invoice.status in ('draft', 'cancelled') then
        raise exception 'This invoice cannot accept an online payment.';
    end if;

    v_outstanding_cents := round(
        greatest(coalesce(v_invoice.amount_outstanding, 0), 0) * 100
    )::bigint;

    if v_outstanding_cents < 200 or p_amount_cents > v_outstanding_cents then
        raise exception 'The requested amount exceeds the outstanding invoice balance.';
    end if;

    if p_amount_cents < v_outstanding_cents
       and not coalesce(v_invoice.partial_payment_enabled, false) then
        raise exception 'Partial payments are not enabled for this invoice.';
    end if;

    -- A configured deposit is the minimum first payment only. Once any
    -- payment has been recorded against the invoice, later instalments may be
    -- smaller than the initial deposit.
    if coalesce(v_invoice.deposit_amount, 0) > 0
       and not exists (
           select 1
           from public.payments p
           where p.invoice_id = v_invoice.id
             and p.status in ('paid', 'partially paid')
       )
       and p_amount_cents < round(v_invoice.deposit_amount * 100)::bigint then
        raise exception 'The requested first payment is below the required deposit.';
    end if;

    insert into public.payment_attempts (
        invoice_id, client_id, provider, environment, amount_cents,
        currency, idempotency_key, status
    )
    values (
        p_invoice_id, p_client_id, 'paystack', 'live', p_amount_cents,
        'ZAR', btrim(p_idempotency_key), 'created'
    )
    on conflict (provider, environment, client_id, idempotency_key)
    do nothing;

    select *
    into v_attempt
    from public.payment_attempts
    where provider = 'paystack'
      and environment = 'live'
      and client_id = p_client_id
      and idempotency_key = btrim(p_idempotency_key)
    for update;

    if v_attempt.invoice_id <> p_invoice_id
       or v_attempt.amount_cents <> p_amount_cents then
        raise exception 'Idempotency key was already used for a different payment request.';
    end if;

    return jsonb_build_object(
        'attempt_id', v_attempt.id,
        'invoice_id', v_attempt.invoice_id,
        'amount_cents', v_attempt.amount_cents,
        'currency', v_attempt.currency,
        'status', v_attempt.status,
        'provider_checkout_id', v_attempt.provider_checkout_id,
        'checkout_url', v_attempt.checkout_url
    );
end;
$function$;
