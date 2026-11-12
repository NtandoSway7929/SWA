-- Yoco client payments: immutable financial records and refund-event binding
-- Target branch: feature/yoco-client-payments
-- REVIEW-ONLY. Requires migrations 001-004. Do not execute against production.

begin;

-- A provider event can create at most one refund ledger record.
create unique index if not exists payment_refunds_provider_event_uidx
    on public.payment_refunds(provider, environment, provider_event_id)
    where provider_event_id is not null;

create or replace function innerme_private.guard_yoco_financial_ledger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if tg_table_name = 'payments' then
        if tg_op = 'DELETE' then
            if old.provider = 'yoco' then
                raise exception 'Yoco payment ledger entries are immutable.';
            end if;
            return old;
        end if;

        if old.provider = 'yoco' or new.provider = 'yoco' then
            raise exception 'Yoco payment ledger entries are immutable.';
        end if;
        return new;
    end if;

    if tg_table_name = 'payment_refunds' then
        if tg_op = 'DELETE' then
            if old.provider = 'yoco' and old.status = 'succeeded' then
                raise exception 'Successful Yoco refund ledger entries are immutable.';
            end if;
            return old;
        end if;

        if (old.provider = 'yoco' and old.status = 'succeeded')
           or (new.provider = 'yoco' and new.status = 'succeeded') then
            raise exception 'Successful Yoco refund ledger entries are immutable.';
        end if;
        return new;
    end if;

    if tg_table_name = 'payment_receipts' then
        raise exception 'Issued payment receipts are immutable.';
    end if;

    raise exception 'Unsupported Yoco ledger trigger target.';
end;
$$;

revoke all on function innerme_private.guard_yoco_financial_ledger()
    from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_yoco_payment_ledger on public.payments;
create trigger trg_guard_yoco_payment_ledger
before update or delete on public.payments
for each row execute function innerme_private.guard_yoco_financial_ledger();

drop trigger if exists trg_guard_yoco_refund_ledger on public.payment_refunds;
create trigger trg_guard_yoco_refund_ledger
before update or delete on public.payment_refunds
for each row execute function innerme_private.guard_yoco_financial_ledger();

drop trigger if exists trg_guard_yoco_receipt_ledger on public.payment_receipts;
create trigger trg_guard_yoco_receipt_ledger
before update or delete on public.payment_receipts
for each row execute function innerme_private.guard_yoco_financial_ledger();

-- Require a refund event to be explicitly bound to the same Yoco payment
-- attempt before its financial record can be inserted.
create or replace function innerme_private.validate_yoco_refund_event_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_event public.payment_webhook_events%rowtype;
    v_attempt public.payment_attempts%rowtype;
begin
    if new.provider <> 'yoco' or new.environment <> 'test'
       or new.status <> 'succeeded' then
        raise exception 'Only verified successful Yoco test refunds may enter this ledger.';
    end if;

    if new.provider_event_id is null or length(btrim(new.provider_event_id)) = 0 then
        raise exception 'A provider event reference is required for a successful refund.';
    end if;

    select * into v_event
    from public.payment_webhook_events
    where provider = 'yoco'
      and environment = 'test'
      and provider_event_id = new.provider_event_id
    for update;

    if not found
       or not v_event.signature_verified
       or v_event.event_type <> 'refund.succeeded'
       or v_event.processing_status not in ('received', 'processing') then
        raise exception 'Refund does not reference an eligible verified provider event.';
    end if;

    if v_event.payment_attempt_id is null then
        raise exception 'Refund event is not bound to a local payment attempt.';
    end if;

    select * into v_attempt
    from public.payment_attempts
    where id = v_event.payment_attempt_id
      and provider = 'yoco'
      and environment = 'test'
      and payment_id = new.payment_id;

    if not found then
        raise exception 'Refund event payment attempt does not match the payment ledger entry.';
    end if;

    return new;
end;
$$;

revoke all on function innerme_private.validate_yoco_refund_event_binding()
    from public, anon, authenticated, service_role;

drop trigger if exists trg_validate_yoco_refund_event_binding on public.payment_refunds;
create trigger trg_validate_yoco_refund_event_binding
before insert on public.payment_refunds
for each row execute function innerme_private.validate_yoco_refund_event_binding();

commit;

-- This migration adds database-level immutability for Yoco payments, successful
-- refunds and issued receipts. It also binds refund ledger inserts to the
-- verified event and payment attempt. It remains unexecuted pending disposable
-- PostgreSQL validation.
