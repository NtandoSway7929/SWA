-- Resolve Paystack failed and abandoned transactions after a client returns.
-- Paystack currently emits transaction webhooks for successful transactions only.
-- This routine records a provider-verified non-success state without touching the invoice,
-- payments ledger, or immutable receipts.

begin;

create or replace function innerme_private.record_paystack_failed_attempt_status(
    p_attempt_id uuid,
    p_provider_checkout_id text,
    p_amount_cents bigint,
    p_currency text,
    p_processing_mode text,
    p_provider_transaction_id text,
    p_provider_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_attempt public.payment_attempts%rowtype;
    v_target_status text;
    v_failure_code text;
    v_failure_message text;
begin
    if p_attempt_id is null
       or p_provider_checkout_id is null
       or length(btrim(p_provider_checkout_id)) < 8
       or p_amount_cents is null
       or p_amount_cents < 200
       or upper(coalesce(p_currency, '')) <> 'ZAR'
       or lower(coalesce(p_processing_mode, '')) <> 'test'
       or p_provider_transaction_id is null
       or p_provider_transaction_id !~ '^[0-9]+$'
       or p_provider_status not in ('failed', 'abandoned') then
        raise exception 'Verified Paystack transaction status is invalid.';
    end if;

    v_target_status := p_provider_status;
    v_failure_code := case v_target_status
        when 'failed' then 'provider_transaction_failed'
        else 'provider_transaction_abandoned'
    end;
    v_failure_message := case v_target_status
        when 'failed' then 'Paystack confirmed that the transaction failed.'
        else 'Paystack confirmed that the checkout was abandoned.'
    end;

    select *
    into v_attempt
    from public.payment_attempts
    where id = p_attempt_id
    for update;

    if not found then
        raise exception 'Paystack payment attempt not found.';
    end if;

    if v_attempt.provider <> 'paystack'
       or v_attempt.environment <> 'test'
       or v_attempt.provider_checkout_id is distinct from p_provider_checkout_id
       or v_attempt.amount_cents <> p_amount_cents
       or v_attempt.currency <> upper(p_currency) then
        raise exception 'Verified Paystack transaction does not match the payment attempt.';
    end if;

    -- Never downgrade an attempt that was settled by a concurrent success webhook.
    if v_attempt.status = 'succeeded' or v_attempt.payment_id is not null then
        return jsonb_build_object(
            'attempt_id', v_attempt.id,
            'status', 'succeeded',
            'payment_id', v_attempt.payment_id,
            'updated', false,
            'reason', 'already_settled'
        );
    end if;

    -- Idempotent read-after-write behavior for repeated status checks.
    if v_attempt.status = v_target_status then
        return jsonb_build_object(
            'attempt_id', v_attempt.id,
            'status', v_attempt.status,
            'payment_id', v_attempt.payment_id,
            'updated', false,
            'duplicate', true
        );
    end if;

    if v_attempt.status not in ('created', 'pending') then
        return jsonb_build_object(
            'attempt_id', v_attempt.id,
            'status', v_attempt.status,
            'payment_id', v_attempt.payment_id,
            'updated', false,
            'reason', 'attempt_not_transitionable'
        );
    end if;

    update public.payment_attempts
    set status = v_target_status,
        failure_code = v_failure_code,
        failure_message = v_failure_message,
        updated_at = now()
    where id = v_attempt.id
    returning * into v_attempt;

    return jsonb_build_object(
        'attempt_id', v_attempt.id,
        'status', v_attempt.status,
        'payment_id', v_attempt.payment_id,
        'updated', true
    );
end;
$$;

create or replace function public.paystack_record_failed_attempt_status(
    p_attempt_id uuid,
    p_provider_checkout_id text,
    p_amount_cents bigint,
    p_currency text,
    p_processing_mode text,
    p_provider_transaction_id text,
    p_provider_status text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
    select innerme_private.record_paystack_failed_attempt_status(
        p_attempt_id,
        p_provider_checkout_id,
        p_amount_cents,
        p_currency,
        p_processing_mode,
        p_provider_transaction_id,
        p_provider_status
    );
$$;

revoke all on function innerme_private.record_paystack_failed_attempt_status(
    uuid, text, bigint, text, text, text, text
) from public, anon, authenticated;
grant execute on function innerme_private.record_paystack_failed_attempt_status(
    uuid, text, bigint, text, text, text, text
) to service_role;

revoke all on function public.paystack_record_failed_attempt_status(
    uuid, text, bigint, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.paystack_record_failed_attempt_status(
    uuid, text, bigint, text, text, text, text
) to service_role;

commit;
