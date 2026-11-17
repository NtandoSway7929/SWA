-- Owner-only cash-basis budget ledger for Swayphics.
-- Client receipts remain in public.payments; successful refunds remain in
-- public.payment_refunds. This table is only for separately entered income
-- and operating expenses, so invoices and payments are never double-counted.

begin;

create table if not exists public.budget_entries (
    id uuid primary key default gen_random_uuid(),
    entry_type text not null
        check (entry_type in ('income', 'expense')),
    category text not null
        check (length(btrim(category)) between 1 and 80),
    description text not null
        check (length(btrim(description)) between 1 and 240),
    amount numeric(12,2) not null
        check (amount > 0),
    currency text not null default 'ZAR'
        check (currency = 'ZAR'),
    transaction_date date not null default current_date,
    payment_method text not null default 'Other'
        check (payment_method in ('EFT', 'Card', 'Cash', 'Debit order', 'Other')),
    counterparty text,
    reference text,
    notes text,
    status text not null default 'posted'
        check (status in ('posted', 'void')),
    created_by uuid not null default auth.uid()
        references auth.users(id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    voided_at timestamptz,
    voided_by uuid references auth.users(id) on delete restrict,
    constraint budget_entries_void_audit_check check (
        (status = 'posted' and voided_at is null and voided_by is null)
        or
        (status = 'void' and voided_at is not null and voided_by is not null)
    )
);

create index if not exists budget_entries_date_idx
    on public.budget_entries (transaction_date desc, created_at desc);
create index if not exists budget_entries_type_date_idx
    on public.budget_entries (entry_type, transaction_date desc);
create index if not exists budget_entries_category_date_idx
    on public.budget_entries (category, transaction_date desc);

alter table public.budget_entries enable row level security;
alter table public.payment_refunds enable row level security;

revoke all privileges on table public.budget_entries
    from public, anon, authenticated;
grant select, insert, update on table public.budget_entries
    to authenticated;

drop policy if exists "Swayphics owners can manage budget entries"
    on public.budget_entries;
create policy "Swayphics owners can manage budget entries"
    on public.budget_entries
    for all
    to authenticated
    using ((select public.is_swayphics_owner()))
    with check ((select public.is_swayphics_owner()));

revoke all privileges on table public.payment_refunds from public, anon, authenticated;
grant select on table public.payment_refunds to authenticated;

drop policy if exists "Swayphics owners can view payment refunds"
    on public.payment_refunds;
create policy "Swayphics owners can view payment refunds"
    on public.payment_refunds
    for select
    to authenticated
    using ((select public.is_swayphics_owner()));

-- Posted entries are corrected by voiding and recording a replacement, not
-- by editing or deleting the original financial event.
create or replace function public.guard_budget_entry_ledger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if tg_op = 'DELETE' then
        raise exception 'Budget ledger entries cannot be deleted. Void the entry and record a correction instead.';
    end if;

    if old.status <> 'posted' or new.status <> 'void' then
        raise exception 'A posted budget entry can only be voided once.';
    end if;

    if row(
        new.entry_type, new.category, new.description, new.amount,
        new.currency, new.transaction_date, new.payment_method,
        new.counterparty, new.reference, new.notes, new.created_by,
        new.created_at
    ) is distinct from row(
        old.entry_type, old.category, old.description, old.amount,
        old.currency, old.transaction_date, old.payment_method,
        old.counterparty, old.reference, old.notes, old.created_by,
        old.created_at
    ) then
        raise exception 'Posted budget entry details are immutable.';
    end if;

    if new.voided_at is null or new.voided_by is null then
        raise exception 'Voiding a budget entry requires an audit timestamp and user.';
    end if;

    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists trg_guard_budget_entry_ledger
    on public.budget_entries;
create trigger trg_guard_budget_entry_ledger
before update or delete on public.budget_entries
for each row execute function public.guard_budget_entry_ledger();

revoke all on function public.guard_budget_entry_ledger()
    from public, anon, authenticated, service_role;

-- Ensure relevant changes are streamed to the owner-only dashboard. The
-- payment table may already be published; only add tables that are missing.
do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime'
              and schemaname = 'public' and tablename = 'payments'
        ) then
            execute 'alter publication supabase_realtime add table public.payments';
        end if;

        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime'
              and schemaname = 'public' and tablename = 'payment_refunds'
        ) then
            execute 'alter publication supabase_realtime add table public.payment_refunds';
        end if;

        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime'
              and schemaname = 'public' and tablename = 'budget_entries'
        ) then
            execute 'alter publication supabase_realtime add table public.budget_entries';
        end if;
    end if;
end;
$$;

commit;
