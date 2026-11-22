begin;

alter table public.payment_receipt_deliveries
  add column if not exists provider_delivery_status text not null default 'unknown'
    check (provider_delivery_status in ('unknown','delivered','delayed','bounced','complained')),
  add column if not exists provider_delivered_at timestamptz,
  add column if not exists provider_event_at timestamptz;

create table if not exists public.payment_receipt_provider_events (
  event_id text primary key,
  receipt_id uuid not null references public.payment_receipts(id) on delete cascade,
  event_type text not null,
  provider_message_id text,
  event_created_at timestamptz,
  received_at timestamptz not null default now()
);

create index if not exists payment_receipt_provider_events_receipt_idx
  on public.payment_receipt_provider_events(receipt_id, received_at desc);

alter table public.payment_receipt_provider_events enable row level security;
revoke all on public.payment_receipt_provider_events from public, anon, authenticated;
grant all on public.payment_receipt_provider_events to service_role;
grant all on public.payment_receipt_provider_events to service_role;

create or replace function public.claim_payment_receipt_delivery(
  p_receipt_id uuid,
  p_stale_before timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_count integer;
begin
  update public.payment_receipt_deliveries d
  set status = 'sending',
      attempt_count = d.attempt_count + 1,
      last_attempt_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp(),
      last_error = null
  where d.receipt_id = p_receipt_id
    and (
      d.status in ('pending','failed')
      or (d.status = 'sending' and d.updated_at < p_stale_before)
    )
  returning d.attempt_count into v_attempt_count;

  if not found then
    return pg_catalog.jsonb_build_object('claimed', false);
  end if;

  insert into public.payment_receipt_delivery_attempts(receipt_id,status)
  values (p_receipt_id,'sending');

  return pg_catalog.jsonb_build_object(
    'claimed', true,
    'attempt_count', v_attempt_count
  );
end;
$$;

revoke all on function public.claim_payment_receipt_delivery(uuid,timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_payment_receipt_delivery(uuid,timestamptz)
  to service_role;

commit;
