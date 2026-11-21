-- Owner-authorized, atomic deletion of a client and all linked local financial records.
-- This does not cancel or reverse transactions held by external payment providers.
begin;

create or replace function innerme_private.guard_yoco_financial_ledger()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
    -- This transaction-local flag is set only by the owner-checked purge RPC below.
    if current_setting('app.client_financial_purge', true) = 'true'
       and current_user = 'postgres' then
        if tg_op = 'DELETE' then
            return old;
        end if;
        return new;
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
$function$;

create or replace function public.prevent_yoco_reconciliation_history_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
    -- Reconciliation history remains append-only except inside the owner-checked purge RPC.
    if current_setting('app.client_financial_purge', true) = 'true'
       and current_user = 'postgres' then
        if tg_op = 'DELETE' then
            return old;
        end if;
        return new;
    end if;

    raise exception 'Reconciliation evidence and action history are append-only.'
        using errcode = '55000';
end;
$function$;

create or replace function innerme_private.delete_swayphics_client(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_storage_objects jsonb := '[]'::jsonb;
    v_invoice_items_deleted integer := 0;
    v_invoices_deleted integer := 0;
    v_payments_deleted integer := 0;
    v_attempts_deleted integer := 0;
    v_receipts_deleted integer := 0;
    v_refunds_deleted integer := 0;
    v_webhooks_deleted integer := 0;
    v_reconciliation_deleted integer := 0;
    v_reconciliation_actions_deleted integer := 0;
    v_reconciliation_evidence_deleted integer := 0;
    v_bank_submissions_deleted integer := 0;
begin
    if auth.uid() is null or not public.is_swayphics_owner() then
        raise exception 'Only an active Swayphics owner can permanently delete a client and financial history.'
            using errcode = '42501';
    end if;

    if p_client_id is null then
        raise exception 'A client ID is required.';
    end if;

    perform 1
    from public.clients
    where id = p_client_id
    for update;

    if not found then
        raise exception 'Client not found or already deleted.';
    end if;

    -- Do not erase a checkout attempt while the provider may still accept payment.
    if exists (
        select 1
        from public.payment_attempts pa
        where pa.client_id = p_client_id
          and pa.status in ('created', 'pending', 'requires_review')
    ) or exists (
        select 1
        from public.payment_webhook_events pwe
        join public.payment_attempts pa on pa.id = pwe.payment_attempt_id
        where pa.client_id = p_client_id
          and pwe.processing_status in ('received', 'processing', 'failed_retryable', 'requires_review')
    ) then
        raise exception 'This client has an active checkout or unresolved provider event. Resolve it before permanently deleting the client.'
            using errcode = '55000';
    end if;

    select coalesce(
        jsonb_agg(jsonb_build_object('bucket', file_ref.bucket, 'path', file_ref.path)),
        '[]'::jsonb
    )
    into v_storage_objects
    from (
        select 'swayphics-payment-proofs'::text as bucket, bts.proof_storage_path as path
        from public.bank_transfer_submissions bts
        where bts.client_id = p_client_id
        union all
        select 'swayphics-client-files'::text, cd.storage_path
        from public.client_documents cd
        where cd.client_id = p_client_id
        union all
        select 'swayphics-client-files'::text, coa.file_path
        from public.client_onboarding_assets coa
        where coa.client_id = p_client_id
    ) as file_ref
    where nullif(btrim(file_ref.path), '') is not null;

    -- Transaction-scoped exception to ledger immutability. The RPC is owner-checked,
    -- SECURITY DEFINER, and not executable by anon or PUBLIC.
    perform pg_catalog.set_config('app.client_financial_purge', 'true', true);

    -- Bank-statement evidence is retained, but links to deleted ledger rows are cleared.
    update public.bank_statement_lines bsl
    set match_status = 'unmatched',
        matched_source_type = null,
        matched_source_id = null,
        matched_by = null,
        matched_at = null
    where bsl.matched_source_type in ('payment', 'refund')
      and bsl.matched_source_id in (
          select p.id from public.payments p where p.client_id = p_client_id
          union
          select pr.id
          from public.payment_refunds pr
          join public.payments p on p.id = pr.payment_id
          where p.client_id = p_client_id
      );

    delete from public.bank_transfer_submissions
    where client_id = p_client_id;
    get diagnostics v_bank_submissions_deleted = row_count;

    delete from public.payment_webhook_events pwe
    where pwe.payment_attempt_id in (
        select pa.id from public.payment_attempts pa where pa.client_id = p_client_id
    );
    get diagnostics v_webhooks_deleted = row_count;

    delete from public.payment_reconciliation_actions pra
    where pra.reconciliation_id in (
        select r.id
        from public.payment_reconciliation r
        where r.payment_id in (select p.id from public.payments p where p.client_id = p_client_id)
           or r.payment_attempt_id in (select pa.id from public.payment_attempts pa where pa.client_id = p_client_id)
           or r.refund_id in (
               select pr.id
               from public.payment_refunds pr
               join public.payments p on p.id = pr.payment_id
               where p.client_id = p_client_id
           )
    )
    or pra.related_payment_id in (
        select p.id from public.payments p where p.client_id = p_client_id
    )
    or pra.related_refund_id in (
        select pr.id
        from public.payment_refunds pr
        join public.payments p on p.id = pr.payment_id
        where p.client_id = p_client_id
    );
    get diagnostics v_reconciliation_actions_deleted = row_count;

    delete from public.payment_reconciliation_evidence pre
    where pre.reconciliation_id in (
        select r.id
        from public.payment_reconciliation r
        where r.payment_id in (select p.id from public.payments p where p.client_id = p_client_id)
           or r.payment_attempt_id in (select pa.id from public.payment_attempts pa where pa.client_id = p_client_id)
           or r.refund_id in (
               select pr.id
               from public.payment_refunds pr
               join public.payments p on p.id = pr.payment_id
               where p.client_id = p_client_id
           )
    );
    get diagnostics v_reconciliation_evidence_deleted = row_count;

    delete from public.payment_reconciliation r
    where r.payment_id in (select p.id from public.payments p where p.client_id = p_client_id)
       or r.payment_attempt_id in (select pa.id from public.payment_attempts pa where pa.client_id = p_client_id)
       or r.refund_id in (
           select pr.id
           from public.payment_refunds pr
           join public.payments p on p.id = pr.payment_id
           where p.client_id = p_client_id
       );
    get diagnostics v_reconciliation_deleted = row_count;

    delete from public.payment_receipts pr
    where pr.payment_id in (
        select p.id from public.payments p where p.client_id = p_client_id
    );
    get diagnostics v_receipts_deleted = row_count;

    delete from public.payment_refunds pr
    where pr.payment_id in (
        select p.id from public.payments p where p.client_id = p_client_id
    );
    get diagnostics v_refunds_deleted = row_count;

    delete from public.payment_attempts
    where client_id = p_client_id;
    get diagnostics v_attempts_deleted = row_count;

    delete from public.payments
    where client_id = p_client_id;
    get diagnostics v_payments_deleted = row_count;

    delete from public.invoice_items ii
    where ii.invoice_id in (
        select i.id from public.invoices i where i.client_id = p_client_id
    );
    get diagnostics v_invoice_items_deleted = row_count;

    delete from public.invoices
    where client_id = p_client_id;
    get diagnostics v_invoices_deleted = row_count;

    delete from public.clients
    where id = p_client_id;

    perform pg_catalog.set_config('app.client_financial_purge', '', true);

    return jsonb_build_object(
        'ok', true,
        'client_id', p_client_id,
        'deleted', jsonb_build_object(
            'invoices', v_invoices_deleted,
            'invoice_items', v_invoice_items_deleted,
            'payments', v_payments_deleted,
            'payment_attempts', v_attempts_deleted,
            'payment_receipts', v_receipts_deleted,
            'payment_refunds', v_refunds_deleted,
            'payment_webhook_events', v_webhooks_deleted,
            'payment_reconciliation', v_reconciliation_deleted,
            'payment_reconciliation_actions', v_reconciliation_actions_deleted,
            'payment_reconciliation_evidence', v_reconciliation_evidence_deleted,
            'bank_transfer_submissions', v_bank_submissions_deleted
        ),
        'storage_objects', v_storage_objects
    );
end;
$function$;

-- Keep the privileged implementation outside PostgREST's exposed public schema.
revoke all on function innerme_private.delete_swayphics_client(uuid) from public, anon, authenticated;

-- Public API wrapper is owner-checked and is the only callable entry point.
-- The private implementation remains inaccessible to ordinary authenticated callers.
create or replace function public.delete_swayphics_client(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
    if auth.uid() is null or not public.is_swayphics_owner() then
        raise exception 'Only an active Swayphics owner can permanently delete a client and financial history.'
            using errcode = '42501';
    end if;

    return innerme_private.delete_swayphics_client(p_client_id);
end;
$function$;

revoke all on function public.delete_swayphics_client(uuid) from public, anon;
grant execute on function public.delete_swayphics_client(uuid) to authenticated;
revoke all on function public.prevent_yoco_reconciliation_history_mutation() from public, anon, authenticated;

commit;
