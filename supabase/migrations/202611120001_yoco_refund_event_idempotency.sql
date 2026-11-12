-- Use Yoco's documented webhook event ID for refund idempotency.
-- The current Checkout API refund notification sample does not expose a
-- separate refund-resource ID; payload.id repeats the top-level event ID.
-- Keep provider_refund_id optional and anchor this record to provider_event_id.
-- REVIEW-ONLY: requires the complete verified Swayphics base schema.

begin;

create or replace function innerme_private.record_yoco_refund_success(
    p_event_id uuid,
    p_payment_id uuid,
    p_provider_refund_id text,
    p_amount_cents bigint,
    p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_event public.payment_webhook_events%rowtype;
    v_payment public.payments%rowtype;
    v_refund public.payment_refunds%rowtype;
    v_refund_by_event public.payment_refunds%rowtype;
    v_refund_by_provider_id public.payment_refunds%rowtype;
    v_found_event_refund boolean := false;
    v_found_provider_refund boolean := false;
    v_existing_refunds numeric(12,2);
    v_refund_amount numeric(12,2);
begin
    select * into v_payment
    from public.payments
    where id = p_payment_id
    for update;

    if not found or v_payment.provider <> 'yoco' then
        raise exception 'Yoco payment not found.';
    end if;

    select * into v_event
    from public.payment_webhook_events
    where id = p_event_id
    for update;

    if not found
       or v_event.provider <> 'yoco'
       or v_event.environment <> 'test'
       or not v_event.signature_verified
       or v_event.event_type <> 'refund.succeeded' then
        raise exception 'Webhook event is not an eligible verified refund success.';
    end if;

    if v_event.payment_attempt_id is null
       or not exists (
           select 1
           from public.payment_attempts a
           where a.id = v_event.payment_attempt_id
             and a.provider = 'yoco'
             and a.environment = 'test'
             and a.payment_id = v_payment.id
       ) then
        raise exception 'Refund event is not bound to the matching Yoco payment attempt.';
    end if;

    if (p_provider_refund_id is not null
        and length(btrim(p_provider_refund_id)) = 0)
       or p_amount_cents is null
       or p_amount_cents < 1
       or upper(coalesce(p_currency, '')) <> v_payment.currency then
        raise exception 'Refund reference, amount, or currency is invalid.';
    end if;

    v_refund_amount := (p_amount_cents::numeric / 100)::numeric(12,2);

    -- A replay of the same Yoco event is deduplicated by provider_event_id.
    -- If a separate provider refund ID is actually supplied, that key also
    -- protects against the same refund being notified through another event.
    select * into v_refund_by_event
    from public.payment_refunds
    where provider = 'yoco'
      and environment = 'test'
      and provider_event_id = v_event.provider_event_id
    for update;
    v_found_event_refund := found;

    if p_provider_refund_id is not null then
        select * into v_refund_by_provider_id
        from public.payment_refunds
        where provider = 'yoco'
          and environment = 'test'
          and provider_refund_id = btrim(p_provider_refund_id)
        for update;
        v_found_provider_refund := found;
    end if;

    if v_found_event_refund and v_found_provider_refund
       and v_refund_by_event.id <> v_refund_by_provider_id.id then
        raise exception 'Refund event and provider refund ID resolve to different ledger records.';
    end if;

    if v_found_event_refund then
        v_refund := v_refund_by_event;
    elsif v_found_provider_refund then
        v_refund := v_refund_by_provider_id;
    end if;

    if v_found_event_refund or v_found_provider_refund then
        if v_refund.payment_id <> v_payment.id
           or v_refund.amount <> v_refund_amount then
            raise exception 'Refund reference conflicts with an existing refund record.';
        end if;

        update public.payment_webhook_events
        set processing_status = 'processed',
            processed_at = now()
        where id = v_event.id;

        return jsonb_build_object(
            'recorded', true,
            'duplicate', true,
            'refund_id', v_refund.id
        );
    end if;

    if v_event.processing_status not in ('received', 'processing') then
        raise exception 'Refund event is not available for a new ledger entry.';
    end if;

    select coalesce(sum(r.amount), 0)
    into v_existing_refunds
    from public.payment_refunds r
    where r.payment_id = v_payment.id
      and r.status = 'succeeded';

    if v_existing_refunds + v_refund_amount > v_payment.amount then
        update public.payment_webhook_events
        set processing_status = 'requires_review',
            failure_code = 'refund_exceeds_payment',
            failure_message = 'Verified refund amount exceeds the remaining refundable payment amount.',
            processed_at = now()
        where id = v_event.id;

        return jsonb_build_object(
            'recorded', false,
            'requires_review', true,
            'reason', 'refund_exceeds_payment'
        );
    end if;

    insert into public.payment_refunds (
        payment_id, provider, environment, provider_refund_id,
        amount, currency, status, provider_event_id, processed_at
    )
    values (
        v_payment.id, 'yoco', 'test',
        nullif(btrim(p_provider_refund_id), ''),
        v_refund_amount, v_payment.currency, 'succeeded',
        v_event.provider_event_id, now()
    )
    returning * into v_refund;

    update public.payment_webhook_events
    set processing_status = 'processed',
        processed_at = now()
    where id = v_event.id;

    return jsonb_build_object(
        'recorded', true,
        'duplicate', false,
        'refund_id', v_refund.id,
        'amount', v_refund.amount,
        'currency', v_refund.currency
    );
end;
$$;

commit;
