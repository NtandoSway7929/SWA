-- Owner-only permanent deletion workflow for archived test invoices.
-- Run in the disposable local Supabase database after the migration.
begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(44);

select extensions.has_function(
    'innerme_private',
    'purge_archived_invoice_test_data',
    array['uuid','text'],
    'private purge implementation exists'
);
select extensions.has_function(
    'public',
    'admin_permanently_delete_archived_invoice',
    array['uuid','text'],
    'public PostgREST RPC wrapper exists'
);

select extensions.ok(
    not (select prosecdef from pg_proc
         where oid='public.admin_permanently_delete_archived_invoice(uuid,text)'::regprocedure),
    'public RPC wrapper is SECURITY INVOKER'
);
select extensions.ok(
    (select prosecdef from pg_proc
     where oid='innerme_private.purge_archived_invoice_test_data(uuid,text)'::regprocedure),
    'private purge implementation is SECURITY DEFINER'
);
select extensions.ok(
    (select proconfig @> array['search_path=""'] from pg_proc
     where oid='innerme_private.purge_archived_invoice_test_data(uuid,text)'::regprocedure),
    'private purge implementation pins an empty search_path'
);
select extensions.ok(
    (select proconfig @> array['search_path=""'] from pg_proc
     where oid='public.admin_permanently_delete_archived_invoice(uuid,text)'::regprocedure),
    'public wrapper pins an empty search_path'
);

select extensions.ok(
    has_function_privilege(
        'authenticated',
        'public.admin_permanently_delete_archived_invoice(uuid,text)',
        'execute'
    ),
    'authenticated role can invoke the owner-checked RPC'
);
select extensions.ok(
    not has_function_privilege(
        'anon',
        'public.admin_permanently_delete_archived_invoice(uuid,text)',
        'execute'
    ),
    'anonymous role cannot invoke the RPC'
);
select extensions.ok(
    not exists (
        select 1
          from pg_proc p,
               lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
         where p.oid='public.admin_permanently_delete_archived_invoice(uuid,text)'::regprocedure
           and acl.grantee=0
           and acl.privilege_type='EXECUTE'
    ),
    'PUBLIC cannot invoke the RPC'
);
select extensions.ok(
    has_function_privilege(
        'authenticated',
        'innerme_private.purge_archived_invoice_test_data(uuid,text)',
        'execute'
    ),
    'authenticated RPC execution can reach the private helper'
);
select extensions.ok(
    not has_function_privilege(
        'anon',
        'innerme_private.purge_archived_invoice_test_data(uuid,text)',
        'execute'
    ),
    'anonymous role cannot invoke the private helper'
);

select extensions.ok(
    not exists (
        select 1
          from pg_proc p,
               lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
         where p.oid='innerme_private.purge_archived_invoice_test_data(uuid,text)'::regprocedure
           and acl.grantee=0
           and acl.privilege_type='EXECUTE'
    ),
    'PUBLIC cannot invoke the private helper'
);

select extensions.ok(
    position('public.is_swayphics_owner()' in pg_get_functiondef(
        'innerme_private.purge_archived_invoice_test_data(uuid,text)'::regprocedure
    )) > 0,
    'purge helper verifies the active Swayphics owner'
);

select extensions.ok(
    (select prosecdef and proconfig @> array['search_path=""'] from pg_proc
     where oid='public.is_swayphics_owner()'::regprocedure),
    'owner predicate is SECURITY DEFINER with an empty search_path'
);
select extensions.ok(
    position('v_invoice.archived is distinct from true' in pg_get_functiondef(
        'innerme_private.purge_archived_invoice_test_data(uuid,text)'::regprocedure
    )) > 0,
    'purge helper refuses invoices that are not archived'
);
select extensions.ok(
    position('btrim(p_confirmation) <> v_invoice.invoice_number' in pg_get_functiondef(
        'innerme_private.purge_archived_invoice_test_data(uuid,text)'::regprocedure
    )) > 0,
    'purge helper requires the exact invoice number as confirmation'
);
select extensions.ok(
    position('for update' in lower(pg_get_functiondef(
        'innerme_private.purge_archived_invoice_test_data(uuid,text)'::regprocedure
    ))) > 0,
    'purge helper locks the invoice and associated financial rows before deletion'
);
select extensions.ok(
    position('public.bank_transfer_submissions' in pg_get_functiondef(
        'innerme_private.purge_archived_invoice_test_data(uuid,text)'::regprocedure
    )) > 0
    and position('storage-aware workflow' in pg_get_functiondef(
        'innerme_private.purge_archived_invoice_test_data(uuid,text)'::regprocedure
    )) > 0,
    'purge helper blocks invoices with bank-transfer proof files'
);
select extensions.ok(
    position('cross-invoice' in pg_get_functiondef(
        'innerme_private.purge_archived_invoice_test_data(uuid,text)'::regprocedure
    )) > 0,
    'purge helper refuses cross-invoice payment-attempt bindings'
);

select extensions.ok(
    position('delete from public.payment_webhook_events' in lower(pg_get_functiondef(
        'innerme_private.purge_archived_invoice_test_data(uuid,text)'::regprocedure
    ))) > 0,
    'linked webhook events are removed before attempts'
);
select extensions.ok(
    position('delete from public.payment_receipts' in lower(pg_get_functiondef(
        'innerme_private.purge_archived_invoice_test_data(uuid,text)'::regprocedure
    ))) > 0,
    'linked receipts are removed through the privileged purge path'
);
select extensions.ok(
    position('delete from public.payment_refunds' in lower(pg_get_functiondef(
        'innerme_private.purge_archived_invoice_test_data(uuid,text)'::regprocedure
    ))) > 0,
    'linked refunds are removed before their payment parents'
);
select extensions.ok(
    position('delete from public.payment_attempts' in lower(pg_get_functiondef(
        'innerme_private.purge_archived_invoice_test_data(uuid,text)'::regprocedure
    ))) > 0,
    'linked checkout attempts are removed'
);
select extensions.ok(
    position('delete from public.manual_payment_record_requests' in lower(pg_get_functiondef(
        'innerme_private.purge_archived_invoice_test_data(uuid,text)'::regprocedure
    ))) > 0,
    'manual-payment idempotency records are removed'
);
select extensions.ok(
    position('delete from public.payments' in lower(pg_get_functiondef(
        'innerme_private.purge_archived_invoice_test_data(uuid,text)'::regprocedure
    ))) > 0,
    'linked payment rows are removed after their dependent ledger records'
);
select extensions.ok(
    position('delete from public.payment_reconciliation_actions' in lower(pg_get_functiondef(
        'innerme_private.purge_archived_invoice_test_data(uuid,text)'::regprocedure
    ))) > 0
    and position('delete from public.payment_reconciliation_evidence' in lower(pg_get_functiondef(
        'innerme_private.purge_archived_invoice_test_data(uuid,text)'::regprocedure
    ))) > 0,
    'dependent reconciliation action and evidence history are removed'
);
select extensions.ok(
    position('delete from public.payment_reconciliation rc' in lower(pg_get_functiondef(
        'innerme_private.purge_archived_invoice_test_data(uuid,text)'::regprocedure
    ))) > 0,
    'linked reconciliation cases are removed after their child history'
);

select extensions.ok(
    position('set_config(' in lower(pg_get_functiondef(
        'innerme_private.purge_archived_invoice_test_data(uuid,text)'::regprocedure
    ))) > 0,
    'privileged delete permission is scoped to the current transaction'
);
select extensions.ok(
    position('current_setting(' in lower(pg_get_functiondef(
        'innerme_private.guard_yoco_financial_ledger()'::regprocedure
    ))) > 0
    and position('public.is_swayphics_owner()' in pg_get_functiondef(
        'innerme_private.guard_yoco_financial_ledger()'::regprocedure
    )) > 0,
    'financial ledger trigger permits deletes only inside the owner purge context'
);
select extensions.ok(
    position('current_setting(' in lower(pg_get_functiondef(
        'public.prevent_yoco_reconciliation_history_mutation()'::regprocedure
    ))) > 0
    and position('public.is_swayphics_owner()' in pg_get_functiondef(
        'public.prevent_yoco_reconciliation_history_mutation()'::regprocedure
    )) > 0,
    'reconciliation history trigger permits deletes only inside the owner purge context'
);

-- Seed one isolated graph of synthetic test-only financial records. The
-- entire spec rolls back, including the fake auth/admin user and every row.
insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at
) values (
    '99999999-9999-4999-8999-999999999998',
    'authenticated',
    'authenticated',
    'archived-invoice-purge-qa@example.invalid',
    '',
    now()
);

insert into public.admin_users (user_id, full_name, email, role, active)
values (
    '99999999-9999-4999-8999-999999999998',
    'Invoice Purge QA Owner',
    'archived-invoice-purge-qa@example.invalid',
    'owner',
    true
);

insert into public.clients (id, business_name, status)
values (
    '10000000-0000-4000-8000-000000000001',
    'Archived Invoice Purge QA Client',
    'active'
);

insert into public.invoices (
    id, invoice_number, client_id, status, subtotal, total, archived
) values (
    '10000000-0000-4000-8000-000000000002',
    'SWY-PURGE-QA-0001',
    '10000000-0000-4000-8000-000000000001',
    'sent',
    2.00,
    2.00,
    true
);

insert into public.payments (
    id, client_id, amount, status, method, reference, paid_at,
    invoice_id, provider, currency
) values (
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    2.00,
    'paid',
    'Card',
    'PURGE-QA-PAYMENT',
    current_date,
    '10000000-0000-4000-8000-000000000002',
    'yoco',
    'ZAR'
);

insert into public.payment_attempts (
    id, invoice_id, client_id, provider, environment, amount_cents,
    idempotency_key, status, payment_id
) values (
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'yoco',
    'test',
    200,
    'purge-qa-attempt-0001',
    'succeeded',
    '10000000-0000-4000-8000-000000000003'
);

insert into public.payment_webhook_events (
    id, provider, environment, provider_event_id, event_type,
    payment_attempt_id, signature_verified, processing_status
) values (
    '10000000-0000-4000-8000-000000000005',
    'yoco',
    'test',
    'purge-qa-webhook-0001',
    'payment.succeeded',
    '10000000-0000-4000-8000-000000000004',
    true,
    'processed'
);

insert into public.payment_receipts (
    id, payment_id, receipt_number, snapshot
) values (
    '10000000-0000-4000-8000-000000000006',
    '10000000-0000-4000-8000-000000000003',
    'RCPT-PURGE-QA-0001',
    '{}'::jsonb
);

insert into public.payment_refunds (
    id, payment_id, provider, environment, amount, status
) values (
    '10000000-0000-4000-8000-000000000007',
    '10000000-0000-4000-8000-000000000003',
    'yoco',
    'test',
    1.00,
    'pending'
);

insert into public.payment_reconciliation (
    id, payment_attempt_id, payment_id, refund_id,
    provider, environment, discrepancy_type, summary
) values (
    '10000000-0000-4000-8000-000000000008',
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000007',
    'yoco',
    'test',
    'other',
    'Synthetic invoice purge QA case'
);

insert into public.payment_reconciliation_actions (
    id, reconciliation_id, action, previous_status, new_status,
    outcome, reason, related_payment_id, related_refund_id, actor_user_id
) values (
    '10000000-0000-4000-8000-000000000009',
    '10000000-0000-4000-8000-000000000008',
    'investigation_started',
    'open',
    'investigating',
    'no_financial_effect',
    'Synthetic invoice purge QA action',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000007',
    '99999999-9999-4999-8999-999999999998'
);

insert into public.payment_reconciliation_evidence (
    id, reconciliation_id, evidence_type, note, created_by
) values (
    '10000000-0000-4000-8000-000000000010',
    '10000000-0000-4000-8000-000000000008',
    'internal_review',
    'Synthetic invoice purge QA evidence',
    '99999999-9999-4999-8999-999999999998'
);

-- A non-owner cannot purge the seeded invoice, even with its correct number.
set local role authenticated;
select set_config(
    'request.jwt.claim.sub',
    '99999999-9999-4999-8999-999999999999',
    true
);
select extensions.throws_ok(
    $$ select public.admin_permanently_delete_archived_invoice(
        '10000000-0000-4000-8000-000000000002',
        'SWY-PURGE-QA-0001'
    ) $$,
    '42501',
    'Owner access is required.',
    'non-owner authenticated users cannot permanently purge archived invoices'
);
reset role;

select extensions.ok(
    exists (
        select 1 from public.invoices
         where id='10000000-0000-4000-8000-000000000002'
    ),
    'a rejected non-owner purge leaves the invoice intact'
);

-- An owner must still supply the exact invoice number.
set local role authenticated;
select set_config(
    'request.jwt.claim.sub',
    '99999999-9999-4999-8999-999999999998',
    true
);
select extensions.throws_ok(
    $$ select public.admin_permanently_delete_archived_invoice(
        '10000000-0000-4000-8000-000000000002',
        'NOT-THE-INVOICE-NUMBER'
    ) $$,
    'P0001',
    'The invoice-number confirmation does not match.',
    'owner confirmation mismatch is rejected'
);
reset role;

select extensions.ok(
    exists (
        select 1 from public.invoices
         where id='10000000-0000-4000-8000-000000000002'
    ),
    'a rejected confirmation leaves the invoice and linked records intact'
);

-- The authorized owner can now purge the complete synthetic graph atomically.
set local role authenticated;
select set_config(
    'request.jwt.claim.sub',
    '99999999-9999-4999-8999-999999999998',
    true
);
select extensions.ok(
    (
        select
            result->>'deleted' = 'true'
            and (result->>'payments_deleted')::integer = 1
            and (result->>'payment_attempts_deleted')::integer = 1
            and (result->>'refunds_deleted')::integer = 1
            and (result->>'receipts_deleted')::integer = 1
            and (result->>'webhook_events_deleted')::integer = 1
            and (result->>'reconciliation_cases_deleted')::integer = 1
            and (result->>'reconciliation_actions_deleted')::integer = 1
            and (result->>'reconciliation_evidence_deleted')::integer = 1
        from (
            select public.admin_permanently_delete_archived_invoice(
                '10000000-0000-4000-8000-000000000002',
                'SWY-PURGE-QA-0001'
            ) as result
        ) purge
    ),
    'the owner purge returns successful deletion counts for every linked record type'
);
reset role;

select extensions.ok(
    not exists (select 1 from public.invoices where id='10000000-0000-4000-8000-000000000002'),
    'the archived invoice is permanently deleted'
);
select extensions.ok(
    not exists (select 1 from public.payments where id='10000000-0000-4000-8000-000000000003'),
    'the linked payment is permanently deleted'
);
select extensions.ok(
    not exists (select 1 from public.payment_attempts where id='10000000-0000-4000-8000-000000000004'),
    'the linked payment attempt is permanently deleted'
);
select extensions.ok(
    not exists (select 1 from public.payment_refunds where id='10000000-0000-4000-8000-000000000007'),
    'the linked refund is permanently deleted'
);
select extensions.ok(
    not exists (select 1 from public.payment_receipts where id='10000000-0000-4000-8000-000000000006'),
    'the linked receipt is permanently deleted'
);
select extensions.ok(
    not exists (select 1 from public.payment_webhook_events where id='10000000-0000-4000-8000-000000000005'),
    'the linked webhook event is permanently deleted'
);
select extensions.ok(
    not exists (select 1 from public.payment_reconciliation where id='10000000-0000-4000-8000-000000000008'),
    'the linked reconciliation case is permanently deleted'
);
select extensions.ok(
    not exists (select 1 from public.payment_reconciliation_actions where id='10000000-0000-4000-8000-000000000009'),
    'the linked reconciliation action is permanently deleted'
);
select extensions.ok(
    not exists (select 1 from public.payment_reconciliation_evidence where id='10000000-0000-4000-8000-000000000010'),
    'the linked reconciliation evidence is permanently deleted'
);

select * from extensions.finish();
rollback;
