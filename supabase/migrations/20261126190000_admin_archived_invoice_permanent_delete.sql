-- Permanently purge one archived invoice only after explicit owner confirmation.
-- Financial trigger protections remain in place for every normal write path.

begin;

create or replace function innerme_private.guard_yoco_financial_ledger()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
    if tg_op = 'DELETE'
       and current_setting('innerme_private.allow_archived_invoice_purge', true) = 'on'
       and coalesce(public.is_swayphics_owner(), false) then
        return old;
    end if;

    if tg_table_name = 'payments' then
        if tg_op = 'DELETE' then
            if old.provider = 'yoco' then
                raise exception 'Yoco payment ledger entries are immutable.'
                    using errcode = '55000';
            end if;
            return old;
        end if;

        if old.provider = 'yoco' or new.provider = 'yoco' then
            raise exception 'Yoco payment ledger entries are immutable.'
                using errcode = '55000';
        end if;
        return new;
    end if;

    if tg_table_name = 'payment_refunds' then
        if tg_op = 'DELETE' then
            if old.provider = 'yoco' and old.status = 'succeeded' then
                raise exception 'Successful Yoco refund ledger entries are immutable.'
                    using errcode = '55000';
            end if;
            return old;
        end if;

        if (old.provider = 'yoco' and old.status = 'succeeded')
           or (new.provider = 'yoco' and new.status = 'succeeded') then
            raise exception 'Successful Yoco refund ledger entries are immutable.'
                using errcode = '55000';
        end if;
        return new;
    end if;

    if tg_table_name = 'payment_receipts' then
        raise exception 'Issued payment receipts are immutable.'
            using errcode = '55000';
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
    if tg_op = 'DELETE'
       and current_setting('innerme_private.allow_archived_invoice_purge', true) = 'on'
       and coalesce(public.is_swayphics_owner(), false) then
        return old;
    end if;

    raise exception 'Reconciliation evidence and action history are append-only.'
        using errcode = '55000';
end;
$function$;

create or replace function innerme_private.purge_archived_invoice_test_data(
    p_invoice_id uuid,
    p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_invoice public.invoices%rowtype;
    v_payment_ids uuid[] := array[]::uuid[];
    v_attempt_ids uuid[] := array[]::uuid[];
    v_refund_ids uuid[] := array[]::uuid[];
    v_reconciliation_ids uuid[] := array[]::uuid[];
    v_deleted_payments integer := 0;
    v_deleted_attempts integer := 0;
    v_deleted_refunds integer := 0;
    v_deleted_receipts integer := 0;
    v_deleted_webhooks integer := 0;
    v_deleted_reconciliation integer := 0;
    v_deleted_actions integer := 0;
    v_deleted_evidence integer := 0;
    v_deleted_manual_requests integer := 0;
    v_previous_purge_setting text;
begin
    if auth.uid() is null
       or not coalesce(public.is_swayphics_owner(), false) then
        raise exception 'Owner access is required.'
            using errcode = '42501';
    end if;

    if p_invoice_id is null then
        raise exception 'An invoice must be selected.';
    end if;

    select i.*
      into v_invoice
      from public.invoices i
     where i.id = p_invoice_id
     for update;

    if not found then
        raise exception 'The selected invoice no longer exists.';
    end if;

    if v_invoice.archived is distinct from true then
        raise exception 'Only archived invoices can be permanently purged.';
    end if;

    if p_confirmation is null
       or btrim(p_confirmation) <> v_invoice.invoice_number then
        raise exception 'The invoice-number confirmation does not match.';
    end if;

    -- Lock the financial parents before collecting their dependent records.
    perform 1
      from public.payments p
     where p.invoice_id = p_invoice_id
     for update;

    select coalesce(array_agg(p.id), array[]::uuid[])
      into v_payment_ids
      from public.payments p
     where p.invoice_id = p_invoice_id;

    perform 1
      from public.payment_attempts pa
     where pa.invoice_id = p_invoice_id
        or pa.payment_id = any(v_payment_ids)
     for update;

    -- A cross-invoice attempt/payment binding is a data-integrity exception,
    -- not something a purge operation should silently remove.
    if exists (
        select 1
          from public.payment_attempts pa
         where (pa.invoice_id = p_invoice_id or pa.payment_id = any(v_payment_ids))
           and (
                (pa.invoice_id is not null and pa.invoice_id <> p_invoice_id)
                or (pa.payment_id is not null and not (pa.payment_id = any(v_payment_ids)))
           )
    ) then
        raise exception 'A payment attempt is linked across invoices. Resolve the data-integrity issue before deleting.';
    end if;

    select coalesce(array_agg(pa.id), array[]::uuid[])
      into v_attempt_ids
      from public.payment_attempts pa
     where pa.invoice_id = p_invoice_id
        or pa.payment_id = any(v_payment_ids);

    perform 1
      from public.payment_refunds r
     where r.payment_id = any(v_payment_ids)
     for update;

    select coalesce(array_agg(r.id), array[]::uuid[])
      into v_refund_ids
      from public.payment_refunds r
     where r.payment_id = any(v_payment_ids);

    perform 1
      from public.payment_receipts pr
     where pr.payment_id = any(v_payment_ids)
     for update;

    perform 1
      from public.payment_reconciliation rc
     where rc.payment_attempt_id = any(v_attempt_ids)
        or rc.payment_id = any(v_payment_ids)
        or rc.refund_id = any(v_refund_ids)
     for update;

    select coalesce(array_agg(rc.id), array[]::uuid[])
      into v_reconciliation_ids
      from public.payment_reconciliation rc
     where rc.payment_attempt_id = any(v_attempt_ids)
        or rc.payment_id = any(v_payment_ids)
        or rc.refund_id = any(v_refund_ids);

    -- A transfer submission can own a private proof file in Storage. Stop
    -- rather than leave an orphaned object; it needs a storage-aware workflow.
    if exists (
        select 1
          from public.bank_transfer_submissions bts
         where bts.invoice_id = p_invoice_id
            or bts.payment_id = any(v_payment_ids)
    ) then
        raise exception 'This invoice has bank-transfer proof attached. Remove the proof through the storage-aware workflow before purging the invoice.';
    end if;

    -- Do not delete an action that belongs to a separate reconciliation case.
    if exists (
        select 1
          from public.payment_reconciliation_actions a
         where (
                a.related_payment_id = any(v_payment_ids)
                or a.related_refund_id = any(v_refund_ids)
               )
           and not (a.reconciliation_id = any(v_reconciliation_ids))
    ) then
        raise exception 'A financial reference is attached to a separate reconciliation case. Resolve that reference before purging the invoice.';
    end if;

    v_previous_purge_setting :=
        current_setting('innerme_private.allow_archived_invoice_purge', true);

    perform set_config(
        'innerme_private.allow_archived_invoice_purge',
        'on',
        true
    );

    delete from public.payment_reconciliation_actions a
     where a.reconciliation_id = any(v_reconciliation_ids);
    get diagnostics v_deleted_actions = row_count;

    delete from public.payment_reconciliation_evidence e
     where e.reconciliation_id = any(v_reconciliation_ids);
    get diagnostics v_deleted_evidence = row_count;

    delete from public.payment_reconciliation rc
     where rc.id = any(v_reconciliation_ids);
    get diagnostics v_deleted_reconciliation = row_count;

    delete from public.payment_webhook_events we
     where we.payment_attempt_id = any(v_attempt_ids);
    get diagnostics v_deleted_webhooks = row_count;

    delete from public.payment_receipts pr
     where pr.payment_id = any(v_payment_ids);
    get diagnostics v_deleted_receipts = row_count;

    delete from public.payment_refunds r
     where r.id = any(v_refund_ids);
    get diagnostics v_deleted_refunds = row_count;

    delete from public.payment_attempts pa
     where pa.id = any(v_attempt_ids);
    get diagnostics v_deleted_attempts = row_count;

    delete from public.manual_payment_record_requests mpr
     where mpr.invoice_id = p_invoice_id
        or mpr.payment_id = any(v_payment_ids);
    get diagnostics v_deleted_manual_requests = row_count;

    delete from public.payments p
     where p.id = any(v_payment_ids);
    get diagnostics v_deleted_payments = row_count;

    delete from public.invoices i
     where i.id = p_invoice_id
       and i.archived is true;

    if not found then
        raise exception 'The archived invoice could not be deleted.';
    end if;

    perform set_config(
        'innerme_private.allow_archived_invoice_purge',
        coalesce(v_previous_purge_setting, 'off'),
        true
    );

    return jsonb_build_object(
        'deleted', true,
        'invoice_id', p_invoice_id,
        'invoice_number', v_invoice.invoice_number,
        'payments_deleted', v_deleted_payments,
        'payment_attempts_deleted', v_deleted_attempts,
        'refunds_deleted', v_deleted_refunds,
        'receipts_deleted', v_deleted_receipts,
        'webhook_events_deleted', v_deleted_webhooks,
        'reconciliation_cases_deleted', v_deleted_reconciliation,
        'reconciliation_actions_deleted', v_deleted_actions,
        'reconciliation_evidence_deleted', v_deleted_evidence,
        'manual_payment_requests_deleted', v_deleted_manual_requests
    );
end;
$function$;

create or replace function public.admin_permanently_delete_archived_invoice(
    p_invoice_id uuid,
    p_confirmation text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
    select innerme_private.purge_archived_invoice_test_data(
        p_invoice_id,
        p_confirmation
    );
$function$;

revoke all on function innerme_private.purge_archived_invoice_test_data(uuid, text)
    from public, anon;
grant execute on function innerme_private.purge_archived_invoice_test_data(uuid, text)
    to authenticated;

revoke all on function public.admin_permanently_delete_archived_invoice(uuid, text)
    from public, anon;
grant execute on function public.admin_permanently_delete_archived_invoice(uuid, text)
    to authenticated;

commit;
