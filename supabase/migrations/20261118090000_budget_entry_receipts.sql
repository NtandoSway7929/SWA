-- Owner-only receipt evidence for posted operating expenses.
-- Files are stored in a dedicated private bucket and linked to immutable budget entries.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'swayphics-budget-receipts',
    'swayphics-budget-receipts',
    false,
    10485760,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
    name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.budget_entry_receipts (
    id uuid primary key default gen_random_uuid(),
    budget_entry_id uuid not null
        references public.budget_entries(id) on delete restrict,
    storage_path text not null unique
        check (length(btrim(storage_path)) between 1 and 500),
    original_filename text not null
        check (length(btrim(original_filename)) between 1 and 255),
    mime_type text not null
        check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
    size_bytes bigint not null
        check (size_bytes between 1 and 10485760),
    uploaded_by uuid not null default auth.uid()
        references auth.users(id) on delete restrict,
    uploaded_at timestamptz not null default now()
);

create index if not exists budget_entry_receipts_entry_idx
    on public.budget_entry_receipts (budget_entry_id, uploaded_at desc);

create index if not exists budget_entry_receipts_uploaded_by_idx
    on public.budget_entry_receipts (uploaded_by);

alter table public.budget_entry_receipts enable row level security;

revoke all privileges on table public.budget_entry_receipts
    from public, anon, authenticated;
grant select, insert, delete on table public.budget_entry_receipts
    to authenticated;

drop policy if exists "Swayphics owners can view budget receipts"
    on public.budget_entry_receipts;
create policy "Swayphics owners can view budget receipts"
    on public.budget_entry_receipts
    for select
    to authenticated
    using ((select public.is_swayphics_owner()));

drop policy if exists "Swayphics owners can attach budget receipts"
    on public.budget_entry_receipts;
create policy "Swayphics owners can attach budget receipts"
    on public.budget_entry_receipts
    for insert
    to authenticated
    with check (
        (select public.is_swayphics_owner())
        and uploaded_by = (select auth.uid())
    );

drop policy if exists "Swayphics owners can remove budget receipts"
    on public.budget_entry_receipts;
create policy "Swayphics owners can remove budget receipts"
    on public.budget_entry_receipts
    for delete
    to authenticated
    using ((select public.is_swayphics_owner()));

create or replace function public.validate_budget_entry_receipt()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_entry_type text;
    v_status text;
begin
    select entry_type, status
      into v_entry_type, v_status
      from public.budget_entries
     where id = new.budget_entry_id;

    if not found then
        raise exception 'The linked budget entry does not exist.';
    end if;

    if v_entry_type is distinct from 'expense' or v_status is distinct from 'posted' then
        raise exception 'Receipts can only be attached to posted operating expenses.';
    end if;

    if new.uploaded_by is distinct from auth.uid() then
        raise exception 'Receipt uploader must match the authenticated user.';
    end if;

    return new;
end;
$$;

drop trigger if exists trg_validate_budget_entry_receipt
    on public.budget_entry_receipts;
create trigger trg_validate_budget_entry_receipt
before insert on public.budget_entry_receipts
for each row execute function public.validate_budget_entry_receipt();

revoke all on function public.validate_budget_entry_receipt()
    from public, anon, authenticated, service_role;

drop policy if exists "Swayphics owners can read budget receipt files"
    on storage.objects;
create policy "Swayphics owners can read budget receipt files"
    on storage.objects
    for select
    to authenticated
    using (
        bucket_id = 'swayphics-budget-receipts'
        and (select public.is_swayphics_owner())
    );

drop policy if exists "Swayphics owners can upload budget receipt files"
    on storage.objects;
create policy "Swayphics owners can upload budget receipt files"
    on storage.objects
    for insert
    to authenticated
    with check (
        bucket_id = 'swayphics-budget-receipts'
        and (select public.is_swayphics_owner())
    );

drop policy if exists "Swayphics owners can delete budget receipt files"
    on storage.objects;
create policy "Swayphics owners can delete budget receipt files"
    on storage.objects
    for delete
    to authenticated
    using (
        bucket_id = 'swayphics-budget-receipts'
        and (select public.is_swayphics_owner())
    );

commit;
