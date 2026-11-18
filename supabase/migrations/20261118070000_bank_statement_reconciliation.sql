-- Stage 2.1: owner-only bank statement import and reconciliation ledger.
-- This migration stores normalized statement rows only. It does not create
-- payments, refunds, or budget entries; reconciliation is a separate review action.

begin;

create table public.bank_statement_imports (
    id uuid primary key default gen_random_uuid(),
    account_label text not null
        check (length(btrim(account_label)) between 1 and 100),
    source_file_name text not null
        check (length(btrim(source_file_name)) between 1 and 240),
    source_file_sha256 text not null
        check (source_file_sha256 ~ '^[a-f0-9]{64}$'),
    period_start date not null,
    period_end date not null,
    currency text not null default 'ZAR'
        check (currency = 'ZAR'),
    row_count integer not null default 0
        check (row_count >= 0),
    status text not null default 'imported'
        check (status in ('imported', 'reviewed', 'archived')),
    imported_by uuid not null default auth.uid()
        references auth.users(id) on delete restrict,
    imported_at timestamptz not null default now(),
    constraint bank_statement_imports_period_check
        check (period_end >= period_start),
    constraint bank_statement_imports_file_once
        unique (account_label, source_file_sha256)
);

create index bank_statement_imports_imported_at_idx
    on public.bank_statement_imports(imported_at desc);

create table public.bank_statement_lines (
    id uuid primary key default gen_random_uuid(),
    import_id uuid not null
        references public.bank_statement_imports(id) on delete restrict,
    row_number integer not null check (row_number > 0),
    transaction_date date not null,
    description text not null
        check (length(btrim(description)) between 1 and 500),
    bank_reference text,
    amount numeric(12,2) not null check (amount <> 0),
    currency text not null default 'ZAR'
        check (currency = 'ZAR'),
    line_fingerprint text not null
        check (line_fingerprint ~ '^[a-f0-9]{64}$'),
    match_status text not null default 'unmatched'
        check (match_status in ('unmatched', 'matched', 'ignored')),
    matched_source_type text
        check (matched_source_type in ('payment', 'refund', 'budget_entry')),
    matched_source_id uuid,
    matched_by uuid references auth.users(id) on delete restrict,
    matched_at timestamptz,
    ignore_reason text,
    created_at timestamptz not null default now(),
    constraint bank_statement_lines_row_once
        unique (import_id, row_number),
    constraint bank_statement_lines_match_state_check check (
        (match_status = 'unmatched'
            and matched_source_type is null
            and matched_source_id is null
            and matched_by is null
            and matched_at is null
            and ignore_reason is null)
        or
        (match_status = 'matched'
            and matched_source_type is not null
            and matched_source_id is not null
            and matched_by is not null
            and matched_at is not null
            and ignore_reason is null)
        or
        (match_status = 'ignored'
            and matched_source_type is null
            and matched_source_id is null
            and matched_by is not null
            and matched_at is not null
            and length(btrim(ignore_reason)) between 1 and 1000)
    )
);

create index bank_statement_lines_import_date_idx
    on public.bank_statement_lines(import_id, transaction_date desc, row_number);
create index bank_statement_lines_fingerprint_idx
    on public.bank_statement_lines(line_fingerprint);
create index bank_statement_lines_review_idx
    on public.bank_statement_lines(match_status, transaction_date desc);

alter table public.bank_statement_imports enable row level security;
alter table public.bank_statement_lines enable row level security;

revoke all privileges on table
    public.bank_statement_imports,
    public.bank_statement_lines
from public, anon, authenticated;

grant select, insert on table public.bank_statement_imports to authenticated;
grant select, insert, update on table public.bank_statement_lines to authenticated;

create policy "Swayphics owners can view and import bank statements"
    on public.bank_statement_imports
    for select
    to authenticated
    using ((select public.is_swayphics_owner()));

create policy "Swayphics owners can create bank statement imports"
    on public.bank_statement_imports
    for insert
    to authenticated
    with check (
        (select public.is_swayphics_owner())
        and imported_by = (select auth.uid())
    );

create policy "Swayphics owners can view bank statement lines"
    on public.bank_statement_lines
    for select
    to authenticated
    using (
        exists (
            select 1
            from public.bank_statement_imports i
            where i.id = import_id
              and i.imported_by = (select auth.uid())
              and (select public.is_swayphics_owner())
        )
    );

create policy "Swayphics owners can import bank statement lines"
    on public.bank_statement_lines
    for insert
    to authenticated
    with check (
        exists (
            select 1
            from public.bank_statement_imports i
            where i.id = import_id
              and i.imported_by = (select auth.uid())
              and (select public.is_swayphics_owner())
        )
        and match_status = 'unmatched'
        and matched_source_type is null
        and matched_source_id is null
        and matched_by is null
        and matched_at is null
        and ignore_reason is null
    );

create policy "Swayphics owners can review bank statement lines"
    on public.bank_statement_lines
    for update
    to authenticated
    using (
        exists (
            select 1
            from public.bank_statement_imports i
            where i.id = import_id
              and i.imported_by = (select auth.uid())
              and (select public.is_swayphics_owner())
        )
    )
    with check (
        exists (
            select 1
            from public.bank_statement_imports i
            where i.id = import_id
              and i.imported_by = (select auth.uid())
              and (select public.is_swayphics_owner())
        )
    );

create or replace function public.guard_bank_statement_line_ledger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if tg_op = 'DELETE' then
        raise exception 'Imported bank statement lines cannot be deleted.';
    end if;

    if row(
        new.import_id, new.row_number, new.transaction_date, new.description,
        new.bank_reference, new.amount, new.currency, new.line_fingerprint,
        new.created_at
    ) is distinct from row(
        old.import_id, old.row_number, old.transaction_date, old.description,
        old.bank_reference, old.amount, old.currency, old.line_fingerprint,
        old.created_at
    ) then
        raise exception 'Imported bank statement source data is immutable.';
    end if;

    if old.match_status <> 'unmatched' then
        raise exception 'A reviewed bank statement line cannot be changed again.';
    end if;

    if new.match_status not in ('matched', 'ignored') then
        raise exception 'A statement line can only be matched or ignored during review.';
    end if;

    new.matched_by := auth.uid();
    new.matched_at := now();

    if new.match_status = 'matched' then
        if new.matched_source_type is null or new.matched_source_id is null then
            raise exception 'A matched line requires a source record.';
        end if;
        new.ignore_reason := null;
    elsif new.match_status = 'ignored' then
        if new.ignore_reason is null or length(btrim(new.ignore_reason)) not between 1 and 1000 then
            raise exception 'Ignoring a line requires a reason between 1 and 1000 characters.';
        end if;
        new.matched_source_type := null;
        new.matched_source_id := null;
    end if;

    return new;
end;
$$;

revoke all on function public.guard_bank_statement_line_ledger()
    from public, anon, authenticated, service_role;

create trigger trg_guard_bank_statement_line_ledger
before update or delete on public.bank_statement_lines
for each row execute function public.guard_bank_statement_line_ledger();

create or replace function public.guard_bank_statement_import_ledger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    raise exception 'Bank statement import records cannot be changed or deleted.';
end;
$$;

revoke all on function public.guard_bank_statement_import_ledger()
    from public, anon, authenticated, service_role;

create trigger trg_guard_bank_statement_import_ledger
before update or delete on public.bank_statement_imports
for each row execute function public.guard_bank_statement_import_ledger();

commit;
