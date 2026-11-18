-- Index the authenticated uploader for owner-only receipt audit queries.

begin;

create index if not exists budget_entry_receipts_uploaded_by_idx
    on public.budget_entry_receipts (uploaded_by);

commit;
