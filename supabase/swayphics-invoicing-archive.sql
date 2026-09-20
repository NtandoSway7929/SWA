-- SWAYPHICS INVOICE ARCHIVING
-- Run once in Supabase SQL Editor.

alter table public.invoices
    add column if not exists archived boolean not null default false;

alter table public.invoices
    add column if not exists archived_at timestamptz;

create index if not exists invoices_archived_idx
    on public.invoices(archived, created_at desc);

grant select, update on table public.invoices to authenticated;

notify pgrst, 'reload schema';
