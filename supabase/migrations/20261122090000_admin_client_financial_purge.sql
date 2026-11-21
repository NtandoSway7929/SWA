-- Permanently delete a client and its complete financial dependency graph.
-- Only active Swayphics administrators may invoke the RPC.
-- The operation is one PostgreSQL transaction; any failed dependency/trigger rolls it all back.

begin;

create or replace function innerme_private.guard_yoco_financial_ledger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    -- The only supported bypass is the transaction-local marker set by the
    -- authenticated, administrator-only client purge RPC below.
    if current_setting('swayphics.client_purge', true)
       = txid_current()::text || ':' || coalesce(auth.uid()::text, '') then
        if tg_op = 'DELETE' then
            return old;
        end if;
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

create or replace function public.prevent_yoco_reconciliation_history_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if current_setting('swayphics.client_purge', true)
       = txid_current()::text || ':' || coalesce(auth.uid()::text, '') then
        if tg_op = 'DELETE' then
            return old;
        end if;
    end if;

    raise exception 'Reconciliation evidence and action history are append-only.'
        using errcode = '55000';
end;
$$;

create or replace function public.admin_delete_client_financial_bundle(
    p_client_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := auth.uid();
    v_invoice_ids uuid[];
    v_project_ids uuid[];
    v_payment_ids uuid[];
    v_attempt_ids uuid[];
    v_refund_ids uuid[];
    v_reconciliation_ids uuid[];
    v_invoice_count integer := 0;
    v_invoice_item_count integer := 0;
    v_payment_count integer := 0;
    v_attempt_count integer := 0;
    v_refund_count integer := 0;
    v_receipt_count integer := 0;
    v_webhook_count integer := 0;
    v_bank_submission_count integer := 0;
    v_reconciliation_count integer := 0;
    v_action_count integer := 0;
    v_evidence_count integer := 0;
    v_client_count integer := 0;
    v_proof_paths jsonb := '[]'::jsonb;
begin
    if v_actor is null or not coalesce(public.is_swayphics_admin(), false) then
        raise exception 'Administrator access is required.' using errcode = '42501';
    end if;
    if p_client_id is null then
        raise exception 'A valid client is required.';
    end if;

    perform 1 from public.clients where id = p_client_id for update;
    if not found then
        raise exception 'Client not found.';
    end if;

    select coalesce(array_agg(id), '{}'::uuid[])
      into v_invoice_ids
      from public.invoices where client_id = p_client_id;

    select coalesce(array_agg(id), '{}'::uuid[])
      into v_project_ids
      from public.client_projects where client_id = p_client_id;

    select coalesce(array_agg(id), '{}'::uuid[])
      into v_payment_ids
      from public.payments
     where client_id = p_client_id
        or project_id = any(v_project_ids)
        or invoice_id = any(v_invoice_ids);

    select coalesce(array_agg(id), '{}'::uuid[])
      into v_attempt_ids
      from public.payment_attempts
     where client_id = p_client_id
        or invoice_id = any(v_invoice_ids)
        or payment_id = any(v_payment_ids);

    select coalesce(array_agg(id), '{}'::uuid[])
      into v_refund_ids
      from public.payment_refunds
     where payment_id = any(v_payment_ids);

    select coalesce(array_agg(distinct c.id), '{}'::uuid[])
      into v_reconciliation_ids
      from public.payment_reconciliation c
      left join public.payment_reconciliation_actions a
        on a.reconciliation_id = c.id
     where c.payment_id = any(v_payment_ids)
        or c.payment_attempt_id = any(v_attempt_ids)
        or c.refund_id = any(v_refund_ids)
        or a.related_payment_id = any(v_payment_ids)
        or a.related_refund_id = any(v_refund_ids);

    select coalesce(jsonb_agg(proof_storage_path), '[]'::jsonb)
      into v_proof_paths
      from public.bank_transfer_submissions
     where (client_id = p_client_id
        or invoice_id = any(v_invoice_ids)
        or payment_id = any(v_payment_ids))
       and proof_storage_path is not null;

    -- A transaction-scoped authorization marker allows this administrator-only
    -- purge to remove otherwise immutable ledger and reconciliation rows.
    perform set_config(
        'swayphics.client_purge',
        txid_current()::text || ':' || v_actor::text,
        true
    );

    delete from public.bank_transfer_submissions
     where client_id = p_client_id
        or invoice_id = any(v_invoice_ids)
        or payment_id = any(v_payment_ids);
    get diagnostics v_bank_submission_count = row_count;

    delete from public.payment_webhook_events
     where payment_attempt_id = any(v_attempt_ids);
    get diagnostics v_webhook_count = row_count;

    delete from public.payment_reconciliation_evidence
     where reconciliation_id = any(v_reconciliation_ids);
    get diagnostics v_evidence_count = row_count;

    delete from public.payment_reconciliation_actions
     where reconciliation_id = any(v_reconciliation_ids)
        or related_payment_id = any(v_payment_ids)
        or related_refund_id = any(v_refund_ids);
    get diagnostics v_action_count = row_count;

    delete from public.payment_reconciliation
     where id = any(v_reconciliation_ids);
    get diagnostics v_reconciliation_count = row_count;

    delete from public.payment_refunds
     where id = any(v_refund_ids);
    get diagnostics v_refund_count = row_count;

    delete from public.payment_receipts
     where payment_id = any(v_payment_ids);
    get diagnostics v_receipt_count = row_count;

    delete from public.payment_attempts
     where id = any(v_attempt_ids);
    get diagnostics v_attempt_count = row_count;

    delete from public.payments
     where id = any(v_payment_ids);
    get diagnostics v_payment_count = row_count;

    select count(*)::integer into v_invoice_item_count
      from public.invoice_items where invoice_id = any(v_invoice_ids);

    delete from public.invoices
     where id = any(v_invoice_ids);
    get diagnostics v_invoice_count = row_count;
    -- invoice_items are removed by the existing invoice_items.invoice_id
    -- ON DELETE CASCADE constraint.

    delete from public.clients where id = p_client_id;
    get diagnostics v_client_count = row_count;

    if v_client_count <> 1 then
        raise exception 'Client deletion did not complete; the transaction has been rolled back.';
    end if;

    return jsonb_build_object(
        'ok', true,
        'client_id', p_client_id,
        'clients_deleted', v_client_count,
        'invoices_deleted', v_invoice_count,
        'invoice_items_deleted', v_invoice_item_count,
        'payments_deleted', v_payment_count,
        'payment_attempts_deleted', v_attempt_count,
        'payment_refunds_deleted', v_refund_count,
        'payment_receipts_deleted', v_receipt_count,
        'payment_webhook_events_deleted', v_webhook_count,
        'bank_transfer_submissions_deleted', v_bank_submission_count,
        'payment_reconciliation_deleted', v_reconciliation_count,
        'payment_reconciliation_actions_deleted', v_action_count,
        'payment_reconciliation_evidence_deleted', v_evidence_count,
        'private_proof_storage_paths', v_proof_paths
    );
end;
$$;

revoke all on function public.admin_delete_client_financial_bundle(uuid)
    from public, anon;
grant execute on function public.admin_delete_client_financial_bundle(uuid)
    to authenticated;

commit;
