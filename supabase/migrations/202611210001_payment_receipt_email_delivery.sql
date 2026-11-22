begin;

create table if not exists public.payment_receipt_deliveries (
  receipt_id uuid primary key references public.payment_receipts(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','sending','sent','failed')),
  recipient_email text,
  provider_message_id text,
  pdf_storage_path text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_receipt_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.payment_receipts(id) on delete cascade,
  status text not null check (status in ('sending','sent','failed')),
  recipient_email text,
  provider_message_id text,
  error_message text,
  attempted_at timestamptz not null default now()
);

create index if not exists payment_receipt_delivery_attempts_receipt_idx
  on public.payment_receipt_delivery_attempts(receipt_id, attempted_at desc);

alter table public.payment_receipt_deliveries enable row level security;
alter table public.payment_receipt_delivery_attempts enable row level security;
revoke all on public.payment_receipt_deliveries from public, anon, authenticated;
revoke all on public.payment_receipt_delivery_attempts from public, anon, authenticated;
grant all on public.payment_receipt_deliveries to service_role;
grant all on public.payment_receipt_delivery_attempts to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('swayphics-payment-receipts','swayphics-payment-receipts',false,2097152,array['application/pdf']::text[])
on conflict (id) do update
set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

create or replace function innerme_private.enqueue_payment_receipt_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.payment_receipt_deliveries(receipt_id,status)
  values (new.id,'pending')
  on conflict (receipt_id) do nothing;
  return new;
end;
$$;

revoke all on function innerme_private.enqueue_payment_receipt_delivery() from public, anon, authenticated;

drop trigger if exists trg_enqueue_payment_receipt_delivery on public.payment_receipts;
create trigger trg_enqueue_payment_receipt_delivery
after insert on public.payment_receipts
for each row execute function innerme_private.enqueue_payment_receipt_delivery();

-- Backfill delivery queue rows for receipts already issued before this feature.
insert into public.payment_receipt_deliveries(receipt_id,status)
select pr.id,'pending'
from public.payment_receipts pr
on conflict (receipt_id) do nothing;

commit;
