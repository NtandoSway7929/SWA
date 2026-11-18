-- Persistent monthly operating-expense allocations for the owner-only Budget workspace.
-- Actual expenses remain in public.budget_entries; this table stores plan values only.

begin;

create table public.budget_category_allocations (
    id uuid primary key default gen_random_uuid(),
    period_month date not null
        check (extract(day from period_month) = 1),
    category text not null
        check (length(btrim(category)) between 1 and 80),
    allocated_amount numeric(12,2) not null
        check (allocated_amount > 0),
    currency text not null default 'ZAR'
        check (currency = 'ZAR'),
    notes text,
    created_by uuid not null default auth.uid()
        references auth.users(id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint budget_category_allocations_period_category_key
        unique (period_month, category)
);

create index budget_category_allocations_period_idx
    on public.budget_category_allocations (period_month desc);

alter table public.budget_category_allocations enable row level security;

revoke all privileges on table public.budget_category_allocations
    from public, anon, authenticated;
grant select, insert, update, delete
    on table public.budget_category_allocations to authenticated;

create policy "Swayphics owners can manage category allocations"
    on public.budget_category_allocations
    for all
    to authenticated
    using ((select public.is_swayphics_owner()))
    with check ((select public.is_swayphics_owner()));

create or replace function public.set_budget_category_allocation_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

revoke all on function public.set_budget_category_allocation_updated_at()
    from public, anon, authenticated, service_role;

create trigger trg_budget_category_allocations_updated_at
before update on public.budget_category_allocations
for each row
execute function public.set_budget_category_allocation_updated_at();

commit;
