-- Atomic permanent client deletion, including all linked financial records.
-- This is an explicitly administrator-authorised destructive operation.
begin;

-- A transaction-scoped, server-owned marker allows the controlled deletion RPC
-- to remove otherwise immutable ledger and reconciliation records. Browser
-- roles cannot read or write this table.
create table if not exists innerme_private.client_financial_deletion_context (
    backend_pid integer not null,
    transaction_id bigint not null,
    actor_id uuid not null,
    primary key (backend_pid, transaction_id)
);

alter table innerme_private.client_financial_deletion_context enable row level security;
revoke all on table innerme_private.client_financial_deletion_context
    from public, anon, authenticated, service_role;

create or replace function innerme_private.client_financial_deletion_is_authorized()
returns boolean
language sql
security definer
set search_path = ''
as $$
    select auth.uid() is not null
       and exists (
           select 1
           from innerme_private.client_financial_deletion_context context
           where context.backend_pid = pg_backend_pid()
             and context.transaction_id = txid_current()
             and context.actor_id = auth.uid()
       );
$$;

revoke all on function innerme_private.client_financial_deletion_is_authorized()
    from public, anon, authenticated, service_role;

-- Queue private bank-transfer proof objects for Storage API deletion after
-- the database transaction commits. Failed removals remain retryable.
create table if not exists public.client_deletion_storage_cleanup (
    id uuid primary key default gen_random_uuid(),
    bucket_id text not null check (bucket_id = 'swayphics-payment-proofs'),
    object_path text not null check (length(btrim(object_path)) between 1 and 1024),
    attempts integer not null default 0 check (attempts >= 0),
    last_error text,
    created_at timestamptz not null default now(),
    constraint client_deletion_storage_cleanup_object_uidx unique (bucket_id, object_path)
);

alter table public.client_deletion_storage_cleanup enable row level security;
revoke all privileges on table public.client_deletion_storage_cleanup
    from public, anon, authenticated;
grant select, update, delete on table public.client_deletion_storage_cleanup
    to service_role;

-- Keep the existing Yoco immutability rules for all normal operations. Only
-- DELETEs executed inside the authenticated client-deletion transaction may
-- remove provider ledger rows or issued receipt snapshots.
create or replace function innerme_private.guard_yoco_financial_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'DELETE'
       and innerme_private.client_financial_deletion_is_authorized() then
        return old;
    end if;

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

-- Reconciliation evidence and action history remain append-only outside the
-- same narrowly-scoped, transaction-bound client deletion operation.
create or replace function public.prevent_yoco_reconciliation_history_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'DELETE'
       and innerme_private.client_financial_deletion_is_authorized() then
        return old;
    end if;

    raise exception 'Reconciliation evidence and action history are append-only.'
        using errcode = '55000';
end;
$$;

revoke all on function public.prevent_yoco_reconciliation_history_mutation()
    from public, anon, authenticated, service_role;

create or replace function public.admin_delete_client_with_financial_records(
    p_client_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := auth.uid();
    v_client_name text;
    v_project_ids uuid[] := array[]::uuid[];
    v_invoice_ids uuid[] := array[]::uuid[];
    v_payment_ids uuid[] := array[]::uuid[];
    v_attempt_ids uuid[] := array[]::uuid[];
    v_refund_ids uuid[] := array[]::uuid[];
    v_reconciliation_ids uuid[] := array[]::uuid[];
    v_projects_deleted integer := 0;
    v_invoices_deleted integer := 0;
    v_invoice_items_deleted integer := 0;
    v_payments_deleted integer := 0;
    v_attempts_deleted integer := 0;
    v_receipts_deleted integer := 0;
    v_refunds_deleted integer := 0;
    v_reconciliations_deleted integer := 0;
    v_reconciliation_actions_deleted integer := 0;
    v_reconciliation_evidence_deleted integer := 0;
    v_webhook_events_deleted integer := 0;
    v_bank_transfers_deleted integer := 0;
    v_proof_files_queued integer := 0;
begin
    if v_actor is null
       or not coalesce(public.is_swayphics_admin(), false) then
        raise exception 'Administrator access is required.'
            using errcode = '42501';
    end if;

    if p_client_id is null then
        raise exception 'A client is required.';
    end if;

    select c.business_name
    into v_client_name
    from public.clients c
    where c.id = p_client_id
    for update;

    if not found then
        raise exception 'Client not found.';
    end if;

    insert into innerme_private.client_financial_deletion_context (
        backend_pid, transaction_id, actor_id
    )
    values (pg_backend_pid(), txid_current(), v_actor)
    on conflict (backend_pid, transaction_id)
    do update set actor_id = excluded.actor_id;

    select coalesce(array_agg(p.id), array[]::uuid[])
    into v_project_ids
    from public.client_projects p
    where p.client_id = p_client_id;

    select coalesce(array_agg(i.id), array[]::uuid[])
    into v_invoice_ids
    from public.invoices i
    where i.client_id = p_client_id
       or i.project_id = any(v_project_ids);

    select coalesce(array_agg(p.id), array[]::uuid[])
    into v_payment_ids
    from public.payments p
    where p.client_id = p_client_id
       or p.invoice_id = any(v_invoice_ids)
       or p.project_id = any(v_project_ids);

    select coalesce(array_agg(a.id), array[]::uuid[])
    into v_attempt_ids
    from public.payment_attempts a
    where a.client_id = p_client_id
       or a.invoice_id = any(v_invoice_ids)
       or a.payment_id = any(v_payment_ids);

    select coalesce(array_agg(r.id), array[]::uuid[])
    into v_refund_ids
    from public.payment_refunds r
    where r.payment_id = any(v_payment_ids);

    select coalesce(array_agg(distinct r.id), array[]::uuid[])
    into v_reconciliation_ids
    from public.payment_reconciliation r
    where r.payment_id = any(v_payment_ids)
       or r.payment_attempt_id = any(v_attempt_ids)
       or r.refund_id = any(v_refund_ids)
       or exists (
           select 1
           from public.payment_reconciliation_actions a
           where a.reconciliation_id = r.id
             and (
                 a.related_payment_id = any(v_payment_ids)
                 or a.related_refund_id = any(v_refund_ids)
             )
       );

    select count(*)::integer
    into v_invoice_items_deleted
    from public.invoice_items items
    where items.invoice_id = any(v_invoice_ids);

    -- Store proof object paths before deleting the submission rows. The Edge
    -- Function removes the objects through Supabase Storage after commit.
    insert into public.client_deletion_storage_cleanup (bucket_id, object_path)
    select distinct 'swayphics-payment-proofs', b.proof_storage_path
    from public.bank_transfer_submissions b
    where (
        b.client_id = p_client_id
        or b.invoice_id = any(v_invoice_ids)
        or b.payment_id = any(v_payment_ids)
    )
      and b.proof_storage_path is not null
    on conflict (bucket_id, object_path) do nothing;
    get diagnostics v_proof_files_queued = row_count;

    delete from public.bank_transfer_submissions b
    where b.client_id = p_client_id
       or b.invoice_id = any(v_invoice_ids)
       or b.payment_id = any(v_payment_ids);
    get diagnostics v_bank_transfers_deleted = row_count;

    delete from public.payment_webhook_events e
    where e.payment_attempt_id = any(v_attempt_ids);
    get diagnostics v_webhook_events_deleted = row_count;

    delete from public.payment_reconciliation_evidence e
    where e.reconciliation_id = any(v_reconciliation_ids);
    get diagnostics v_reconciliation_evidence_deleted = row_count;

    delete from public.payment_reconciliation_actions a
    where a.reconciliation_id = any(v_reconciliation_ids)
       or a.related_payment_id = any(v_payment_ids)
       or a.related_refund_id = any(v_refund_ids);
    get diagnostics v_reconciliation_actions_deleted = row_count;

    delete from public.payment_reconciliation r
    where r.id = any(v_reconciliation_ids);
    get diagnostics v_reconciliations_deleted = row_count;

    delete from public.payment_refunds r
    where r.id = any(v_refund_ids);
    get diagnostics v_refunds_deleted = row_count;

    delete from public.payment_attempts a
    where a.id = any(v_attempt_ids);
    get diagnostics v_attempts_deleted = row_count;

    delete from public.payment_receipts r
    where r.payment_id = any(v_payment_ids);
    get diagnostics v_receipts_deleted = row_count;

    delete from public.payments p
    where p.id = any(v_payment_ids);
    get diagnostics v_payments_deleted = row_count;

    delete from public.invoices i
    where i.id = any(v_invoice_ids);
    get diagnostics v_invoices_deleted = row_count;

    delete from public.clients c
    where c.id = p_client_id;

    delete from innerme_private.client_financial_deletion_context
    where backend_pid = pg_backend_pid()
      and transaction_id = txid_current()
      and actor_id = v_actor;

    select count(*)::integer
    into v_projects_deleted
    from unnest(v_project_ids) as project_id;

    return jsonb_build_object(
        'client_id', p_client_id,
        'client_name', v_client_name,
        'projects_deleted', v_projects_deleted,
        'invoices_deleted', v_invoices_deleted,
        'invoice_items_deleted', v_invoice_items_deleted,
        'payments_deleted', v_payments_deleted,
        'payment_attempts_deleted', v_attempts_deleted,
        'payment_receipts_deleted', v_receipts_deleted,
        'payment_refunds_deleted', v_refunds_deleted,
        'payment_reconciliations_deleted', v_reconciliations_deleted,
        'payment_reconciliation_actions_deleted', v_reconciliation_actions_deleted,
        'payment_reconciliation_evidence_deleted', v_reconciliation_evidence_deleted,
        'payment_webhook_events_deleted', v_webhook_events_deleted,
        'bank_transfer_submissions_deleted', v_bank_transfers_deleted,
        'payment_proof_files_queued_for_deletion', v_proof_files_queued
    );
end;
$$;

revoke all on function public.admin_delete_client_with_financial_records(uuid)
    from public, anon, service_role;
grant execute on function public.admin_delete_client_with_financial_records(uuid)
    to authenticated;

commit;
