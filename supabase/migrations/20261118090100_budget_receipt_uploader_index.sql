-- Index the uploader foreign key on the owner-only receipt metadata table.
create index if not exists budget_entry_receipts_uploaded_by_idx
    on public.budget_entry_receipts (uploaded_by);