-- Owner-only permanent deletion workflow for archived test invoices.
-- Run in the disposable local Supabase database after the migration.
begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(30);

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
    position('public.is_swayphics_owner()' in pg_get_functiondef(
        'innerme_private.purge_archived_invoice_test_data(uuid,text)'::regprocedure
    )) > 0,
    'purge helper verifies the active Swayphics owner'
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

set local role authenticated;
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999999',true);
select extensions.throws_ok(
    $$ select public.admin_permanently_delete_archived_invoice(null, null) $$,
    '42501',
    'Owner access is required.',
    'non-owner authenticated users cannot permanently purge archived invoices'
);
reset role;

select * from extensions.finish();
rollback;
