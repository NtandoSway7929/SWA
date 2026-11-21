-- Permanent client financial cascade deletion regression tests.
-- Run only against the disposable Supabase database used by yoco-disposable-qa.
begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(32);

select extensions.has_table('innerme_private', 'client_financial_deletion_context',
    'transaction-scoped deletion authorisation table exists');
select extensions.ok(
    (select relrowsecurity from pg_class
     where oid = 'innerme_private.client_financial_deletion_context'::regclass),
    'deletion authorisation context has RLS enabled'
);
select extensions.ok(
    not has_table_privilege('authenticated', 'innerme_private.client_financial_deletion_context', 'select')
    and not has_table_privilege('authenticated', 'innerme_private.client_financial_deletion_context', 'insert'),
    'authenticated users cannot inspect or forge deletion context'
);
select extensions.has_table('public', 'client_deletion_storage_cleanup',
    'proof-file cleanup queue exists');
select extensions.ok(
    (select relrowsecurity from pg_class
     where oid = 'public.client_deletion_storage_cleanup'::regclass),
    'proof-file cleanup queue has RLS enabled'
);
select extensions.ok(
    not has_table_privilege('authenticated', 'public.client_deletion_storage_cleanup', 'select')
    and has_table_privilege('service_role', 'public.client_deletion_storage_cleanup', 'select'),
    'only service role can read queued proof-file cleanup records'
);
select extensions.has_function('public', 'admin_delete_client_with_financial_records',
    array['uuid'], 'atomic client financial deletion RPC exists');
select extensions.ok(
    (select prosecdef and proconfig @> array['search_path=""']
     from pg_proc
     where oid = 'public.admin_delete_client_with_financial_records(uuid)'::regprocedure),
    'deletion RPC uses SECURITY DEFINER and an empty search path'
);
select extensions.ok(
    not has_function_privilege('anon',
        'public.admin_delete_client_with_financial_records(uuid)', 'execute')
    and has_function_privilege('authenticated',
        'public.admin_delete_client_with_financial_records(uuid)', 'execute')
    and not has_function_privilege('service_role',
        'public.admin_delete_client_with_financial_records(uuid)', 'execute'),
    'only authenticated administrators can invoke the deletion RPC'
);
select extensions.ok(
    not has_function_privilege('authenticated',
        'innerme_private.client_financial_deletion_is_authorized()', 'execute'),
    'browser users cannot invoke the internal deletion-context checker'
);
select extensions.has_trigger('public', 'payments', 'trg_guard_yoco_payment_ledger',
    'Yoco payment immutability trigger remains installed');
select extensions.has_trigger('public', 'payment_receipts', 'trg_guard_yoco_receipt_ledger',
    'issued receipt immutability trigger remains installed');
select extensions.has_trigger('public', 'payment_refunds', 'trg_guard_yoco_refund_ledger',
    'successful refund immutability trigger remains installed');
select extensions.has_trigger('public', 'payment_reconciliation_actions',
    'payment_reconciliation_actions_immutable',
    'reconciliation action history trigger remains installed');
select extensions.has_trigger('public', 'payment_reconciliation_evidence',
    'payment_reconciliation_evidence_immutable',
    'reconciliation evidence trigger remains installed');

create temp table client_financial_deletion_test_ids (
    client_id uuid,
    invoice_id uuid,
    payment_id uuid,
    paystack_payment_id uuid,
    paystack_refund_id uuid,
    paystack_event_id uuid,
    attempt_id uuid,
    refund_id uuid,
    reconciliation_id uuid,
    bank_submission_id uuid,
    proof_path text,
    keep_client_id uuid,
    keep_invoice_id uuid,
    keep_payment_id uuid,
    keep_attempt_id uuid,
    cross_reconciliation_id uuid,
    cross_action_id uuid,
    cross_evidence_id uuid,
    unauthorised_client_id uuid
);

do $$
declare
    v_admin_id uuid := gen_random_uuid();
    v_client_id uuid;
    v_project_id uuid;
    v_invoice_id uuid;
    v_payment_id uuid;
    v_paystack_payment_id uuid;
    v_paystack_refund_id uuid;
    v_paystack_event_id uuid;
    v_paystack_event_reference text;
    v_attempt_id uuid;
    v_event_id uuid;
    v_refund_id uuid;
    v_receipt_id uuid;
    v_reconciliation_id uuid;
    v_action_id uuid;
    v_evidence_id uuid;
    v_submission_id uuid;
    v_proof_path text;
    v_keep_client_id uuid;
    v_keep_invoice_id uuid;
    v_keep_payment_id uuid;
    v_keep_attempt_id uuid;
    v_cross_reconciliation_id uuid;
    v_cross_action_id uuid;
    v_cross_evidence_id uuid;
    v_unauthorised_client_id uuid;
    v_result jsonb;
begin
    insert into auth.users (
        id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    )
    values (
        v_admin_id, 'authenticated', 'authenticated',
        'client-delete-owner@example.invalid', '', now(),
        '{}'::jsonb, '{}'::jsonb, now(), now()
    );

    insert into public.admin_users (user_id, full_name, email, role, active)
    values (
        v_admin_id, 'Deletion Test Owner',
        'client-delete-owner@example.invalid', 'owner', true
    );

    insert into public.clients (business_name, contact_name, email)
    values ('Client to permanently delete', 'Test Contact', 'delete-target@example.invalid')
    returning id into v_client_id;

    insert into public.client_projects (client_id, name, service)
    values (v_client_id, 'Deletion test project', 'Website')
    returning id into v_project_id;

    insert into public.invoices (
        client_id, project_id, status, currency, subtotal, total,
        amount_paid, amount_outstanding
    )
    values (v_client_id, v_project_id, 'paid', 'ZAR', 100, 100, 100, 0)
    returning id into v_invoice_id;

    insert into public.invoice_items (invoice_id, description, quantity, unit_price)
    values (v_invoice_id, 'Deletion test line item', 1, 100);

    insert into public.payments (
        client_id, project_id, invoice_id, amount, status, method,
        provider, provider_transaction_id, currency
    )
    values (
        v_client_id, v_project_id, v_invoice_id, 100, 'paid', 'Card',
        'yoco', 'client-delete-yoco-payment-' || gen_random_uuid()::text, 'ZAR'
    )
    returning id into v_payment_id;

    insert into public.payments (
        client_id, amount, status, method,
        provider, provider_transaction_id, currency
    )
    values (
        v_client_id, 20, 'paid', 'Card',
        'paystack', 'client-delete-paystack-payment-' || gen_random_uuid()::text, 'ZAR'
    )
    returning id into v_paystack_payment_id;

    insert into public.payment_attempts (
        invoice_id, client_id, provider, environment, amount_cents,
        currency, idempotency_key, status, payment_id
    )
    values (
        v_invoice_id, v_client_id, 'yoco', 'test', 10000,
        'ZAR', 'client-delete-attempt-' || gen_random_uuid()::text,
        'succeeded', v_payment_id
    )
    returning id into v_attempt_id;

    insert into public.payment_webhook_events (
        provider, environment, provider_event_id, event_type,
        payment_attempt_id, signature_verified, processing_status
    )
    values (
        'yoco', 'test', 'client-delete-refund-event-' || gen_random_uuid()::text,
        'refund.succeeded', v_attempt_id, true, 'received'
    )
    returning id into v_event_id;

    insert into public.payment_refunds (
        payment_id, provider, environment, provider_refund_id,
        amount, currency, status, provider_event_id
    )
    values (
        v_payment_id, 'yoco', 'test',
        'client-delete-refund-' || gen_random_uuid()::text,
        10, 'ZAR', 'succeeded',
        (select provider_event_id from public.payment_webhook_events where id = v_event_id)
    )
    returning id into v_refund_id;

    v_paystack_event_reference := 'client-delete-paystack-refund-event-' || gen_random_uuid()::text;
    insert into public.payment_webhook_events (
        provider, environment, provider_event_id, event_type,
        payment_attempt_id, signature_verified, processing_status
    )
    values (
        'paystack', 'live', v_paystack_event_reference,
        'refund.processed', null, true, 'received'
    )
    returning id into v_paystack_event_id;

    insert into public.payment_refunds (
        payment_id, provider, environment, provider_refund_id,
        amount, currency, status, provider_event_id
    )
    values (
        v_paystack_payment_id, 'paystack', 'live',
        'client-delete-paystack-refund-' || gen_random_uuid()::text,
        5, 'ZAR', 'pending', v_paystack_event_reference
    )
    returning id into v_paystack_refund_id;

    insert into public.payment_receipts (payment_id, receipt_number, snapshot)
    values (
        v_payment_id,
        'DEL-' || upper(substr(gen_random_uuid()::text, 1, 12)),
        jsonb_build_object('payment_id', v_payment_id, 'invoice_id', v_invoice_id)
    )
    returning id into v_receipt_id;

    insert into public.payment_reconciliation (
        payment_attempt_id, payment_id, refund_id, provider, environment,
        discrepancy_type, summary
    )
    values (
        v_attempt_id, v_payment_id, v_refund_id, 'yoco', 'test',
        'other', 'Client deletion test reconciliation case'
    )
    returning id into v_reconciliation_id;

    insert into public.payment_reconciliation_actions (
        reconciliation_id, action, previous_status, new_status,
        related_payment_id, related_refund_id, actor_user_id
    )
    values (
        v_reconciliation_id, 'evidence_added', 'open', 'open',
        v_payment_id, v_refund_id, v_admin_id
    )
    returning id into v_action_id;

    insert into public.payment_reconciliation_evidence (
        reconciliation_id, evidence_type, note, created_by
    )
    values (
        v_reconciliation_id, 'internal_review',
        'Client deletion test evidence', v_admin_id
    )
    returning id into v_evidence_id;

    v_submission_id := gen_random_uuid();
    v_proof_path := v_client_id::text || '/' || v_submission_id::text || '/proof.pdf';
    insert into public.bank_transfer_submissions (
        id, invoice_id, client_id, amount, bank_reference, proof_storage_path,
        proof_file_name, proof_mime_type, proof_size_bytes, status, payment_id
    )
    values (
        v_submission_id, v_invoice_id, v_client_id, 10,
        'CLIENT-DELETE-BANK-' || substr(gen_random_uuid()::text, 1, 12),
        v_proof_path, 'proof.pdf', 'application/pdf', 128, 'pending_review', v_payment_id
    );

    insert into public.clients (business_name, contact_name, email)
    values ('Unaffected client', 'Keep Contact', 'keep-client@example.invalid')
    returning id into v_keep_client_id;

    insert into public.invoices (client_id, status, currency, subtotal, total)
    values (v_keep_client_id, 'draft', 'ZAR', 25, 25)
    returning id into v_keep_invoice_id;

    insert into public.payments (
        client_id, invoice_id, amount, status, method, provider,
        provider_transaction_id, currency
    )
    values (
        v_keep_client_id, v_keep_invoice_id, 25, 'paid', 'Card', 'yoco',
        'client-delete-keep-payment-' || gen_random_uuid()::text, 'ZAR'
    )
    returning id into v_keep_payment_id;

    insert into public.payment_attempts (
        invoice_id, client_id, provider, environment, amount_cents,
        currency, idempotency_key, status, payment_id
    )
    values (
        v_keep_invoice_id, v_keep_client_id, 'yoco', 'test', 2500,
        'ZAR', 'client-delete-keep-attempt-' || gen_random_uuid()::text,
        'pending', v_keep_payment_id
    )
    returning id into v_keep_attempt_id;

    -- A reconciliation case can reference more than one financial anchor.
    -- Deleting this client must detach its payment without destroying the
    -- independently-linked other client's attempt, action, or evidence.
    insert into public.payment_reconciliation (
        payment_attempt_id, payment_id, provider, environment,
        discrepancy_type, summary
    )
    values (
        v_keep_attempt_id, v_payment_id, 'yoco', 'test',
        'other', 'Cross-client reconciliation preservation test'
    )
    returning id into v_cross_reconciliation_id;

    insert into public.payment_reconciliation_actions (
        reconciliation_id, action, previous_status, new_status,
        related_payment_id, actor_user_id
    )
    values (
        v_cross_reconciliation_id, 'investigation_started', 'open', 'investigating',
        v_keep_payment_id, v_admin_id
    )
    returning id into v_cross_action_id;

    insert into public.payment_reconciliation_evidence (
        reconciliation_id, evidence_type, note, created_by
    )
    values (
        v_cross_reconciliation_id, 'internal_review',
        'Evidence belonging to the independently anchored case', v_admin_id
    )
    returning id into v_cross_evidence_id;

    insert into public.clients (business_name, contact_name, email)
    values ('Unauthorised deletion target', 'Keep Contact', 'unauthorised@example.invalid')
    returning id into v_unauthorised_client_id;

    perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
    v_result := public.admin_delete_client_with_financial_records(v_client_id);

    if (v_result->>'client_id')::uuid is distinct from v_client_id
       or (v_result->>'invoices_deleted')::integer <> 1
       or (v_result->>'invoice_items_deleted')::integer <> 1
       or (v_result->>'payments_deleted')::integer <> 2
       or (v_result->>'payment_attempts_deleted')::integer <> 1
       or (v_result->>'payment_receipts_deleted')::integer <> 1
       or (v_result->>'payment_refunds_deleted')::integer <> 2
       or (v_result->>'payment_reconciliations_deleted')::integer <> 1
       or (v_result->>'payment_reconciliation_actions_deleted')::integer <> 1
       or (v_result->>'payment_reconciliation_evidence_deleted')::integer <> 1
       or (v_result->>'payment_webhook_events_deleted')::integer <> 2
       or (v_result->>'bank_transfer_submissions_deleted')::integer <> 1
       or (v_result->>'payment_proof_files_queued_for_deletion')::integer <> 1 then
        raise exception 'Unexpected deletion counts: %', v_result;
    end if;

    perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
    begin
        perform public.admin_delete_client_with_financial_records(v_unauthorised_client_id);
        raise exception 'Unauthorised client deletion unexpectedly succeeded.';
    exception
        when insufficient_privilege then
            null;
    end;

    insert into client_financial_deletion_test_ids (
        client_id, invoice_id, payment_id, paystack_payment_id,
        paystack_refund_id, paystack_event_id, attempt_id, refund_id,
        reconciliation_id, bank_submission_id, proof_path,
        keep_client_id, keep_invoice_id, keep_payment_id, keep_attempt_id,
        cross_reconciliation_id, cross_action_id, cross_evidence_id,
        unauthorised_client_id
    )
    values (
        v_client_id, v_invoice_id, v_payment_id, v_paystack_payment_id,
        v_paystack_refund_id, v_paystack_event_id, v_attempt_id, v_refund_id,
        v_reconciliation_id, v_submission_id, v_proof_path,
        v_keep_client_id, v_keep_invoice_id, v_keep_payment_id, v_keep_attempt_id,
        v_cross_reconciliation_id, v_cross_action_id, v_cross_evidence_id,
        v_unauthorised_client_id
    );
end;
$$;

select extensions.ok(
    not exists (select 1 from public.clients where id = (select client_id from client_financial_deletion_test_ids)),
    'target client is permanently deleted'
);
select extensions.ok(
    not exists (select 1 from public.invoices where id = (select invoice_id from client_financial_deletion_test_ids)),
    'all linked invoices are deleted'
);
select extensions.ok(
    not exists (select 1 from public.invoice_items where invoice_id = (select invoice_id from client_financial_deletion_test_ids)),
    'all linked invoice items are deleted'
);
select extensions.ok(
    not exists (
        select 1 from public.payments
        where id in (
            (select payment_id from client_financial_deletion_test_ids),
            (select paystack_payment_id from client_financial_deletion_test_ids)
        )
    ),
    'all linked payments are deleted'
);
select extensions.ok(
    not exists (select 1 from public.payment_attempts where id = (select attempt_id from client_financial_deletion_test_ids)),
    'all linked payment attempts are deleted'
);
select extensions.ok(
    not exists (select 1 from public.payment_receipts where payment_id = (select payment_id from client_financial_deletion_test_ids)),
    'all linked issued receipt snapshots are deleted'
);
select extensions.ok(
    not exists (
        select 1 from public.payment_webhook_events
        where id = (select paystack_event_id from client_financial_deletion_test_ids)
    ),
    'Paystack refund webhook linked by provider event reference is deleted even without an attempt foreign key'
);
select extensions.ok(
    not exists (
        select 1 from public.payment_refunds
        where id in (
            (select refund_id from client_financial_deletion_test_ids),
            (select paystack_refund_id from client_financial_deletion_test_ids)
        )
    ),
    'all linked refunds are deleted'
);
select extensions.ok(
    not exists (
        select 1 from public.payment_webhook_events
        where payment_attempt_id = (select attempt_id from client_financial_deletion_test_ids)
           or id = (select paystack_event_id from client_financial_deletion_test_ids)
    ),
    'all linked provider webhook events are deleted'
);
select extensions.ok(
    not exists (select 1 from public.payment_reconciliation where id = (select reconciliation_id from client_financial_deletion_test_ids)),
    'all linked reconciliation cases are deleted'
);
select extensions.ok(
    not exists (select 1 from public.payment_reconciliation_actions where reconciliation_id = (select reconciliation_id from client_financial_deletion_test_ids)),
    'all linked reconciliation action history is deleted'
);
select extensions.ok(
    not exists (select 1 from public.payment_reconciliation_evidence where reconciliation_id = (select reconciliation_id from client_financial_deletion_test_ids)),
    'all linked reconciliation evidence is deleted'
);
select extensions.ok(
    not exists (select 1 from public.bank_transfer_submissions where id = (select bank_submission_id from client_financial_deletion_test_ids)),
    'all linked bank-transfer submissions are deleted'
);
select extensions.ok(
    exists (
        select 1 from public.client_deletion_storage_cleanup
        where bucket_id = 'swayphics-payment-proofs'
          and object_path = (select proof_path from client_financial_deletion_test_ids)
    ),
    'bank-transfer proof object is queued for secure Storage API deletion'
);
select extensions.ok(
    exists (select 1 from public.clients where id = (select keep_client_id from client_financial_deletion_test_ids))
    and exists (select 1 from public.invoices where id = (select keep_invoice_id from client_financial_deletion_test_ids)),
    'unrelated client and invoice records remain untouched'
);
select extensions.ok(
    exists (
        select 1
        from public.payment_reconciliation r
        where r.id = (select cross_reconciliation_id from client_financial_deletion_test_ids)
          and r.payment_id is null
          and r.payment_attempt_id = (select keep_attempt_id from client_financial_deletion_test_ids)
    )
    and exists (
        select 1 from public.payment_reconciliation_actions a
        where a.id = (select cross_action_id from client_financial_deletion_test_ids)
          and a.related_payment_id = (select keep_payment_id from client_financial_deletion_test_ids)
    )
    and exists (
        select 1 from public.payment_reconciliation_evidence e
        where e.id = (select cross_evidence_id from client_financial_deletion_test_ids)
    ),
    'independently anchored reconciliation case, action and evidence survive with the target payment reference detached'
);
select extensions.ok(
    exists (select 1 from public.clients where id = (select unauthorised_client_id from client_financial_deletion_test_ids)),
    'unauthorised deletion attempt leaves its client untouched'
);

select * from extensions.finish();
rollback;
