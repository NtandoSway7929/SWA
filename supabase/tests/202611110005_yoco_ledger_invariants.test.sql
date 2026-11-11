-- Yoco ledger invariants: catalog/privilege regression tests.
-- Run ONLY against a disposable local Supabase database after migrations 001-005.
-- This test creates no business fixtures and rolls back its transaction.
begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(32);

-- Operational tables must exist and have RLS enabled.
select extensions.has_table('public', 'payment_attempts', 'payment_attempts exists');
select extensions.has_table('public', 'payment_webhook_events', 'payment_webhook_events exists');
select extensions.has_table('public', 'payment_refunds', 'payment_refunds exists');
select extensions.has_table('public', 'payment_receipts', 'payment_receipts exists');
select extensions.has_table('public', 'payment_reconciliation', 'payment_reconciliation exists');

select extensions.ok((select c.relrowsecurity from pg_class c where c.oid = 'public.payment_attempts'::regclass), 'attempts RLS enabled');
select extensions.ok((select c.relrowsecurity from pg_class c where c.oid = 'public.payment_webhook_events'::regclass), 'webhook event RLS enabled');
select extensions.ok((select c.relrowsecurity from pg_class c where c.oid = 'public.payment_refunds'::regclass), 'refund RLS enabled');
select extensions.ok((select c.relrowsecurity from pg_class c where c.oid = 'public.payment_receipts'::regclass), 'receipt RLS enabled');
select extensions.ok((select c.relrowsecurity from pg_class c where c.oid = 'public.payment_reconciliation'::regclass), 'reconciliation RLS enabled');

-- Browser roles must not have direct table access.
select extensions.ok(not has_table_privilege('anon', 'public.payment_attempts', 'select'), 'anon cannot read attempts');
select extensions.ok(not has_table_privilege('authenticated', 'public.payment_attempts', 'select'), 'authenticated cannot read attempts');
select extensions.ok(not has_table_privilege('anon', 'public.payment_webhook_events', 'select'), 'anon cannot read webhook events');
select extensions.ok(not has_table_privilege('authenticated', 'public.payment_webhook_events', 'select'), 'authenticated cannot read webhook events');
select extensions.ok(not has_table_privilege('anon', 'public.payment_refunds', 'select'), 'anon cannot read refunds');
select extensions.ok(not has_table_privilege('authenticated', 'public.payment_refunds', 'select'), 'authenticated cannot read refunds');
select extensions.ok(not has_table_privilege('anon', 'public.payment_receipts', 'select'), 'anon cannot read receipts');
select extensions.ok(not has_table_privilege('authenticated', 'public.payment_receipts', 'select'), 'authenticated cannot read receipts');

-- Private schema and internal functions must not be callable by browser roles.
select extensions.ok(not has_schema_privilege('anon', 'innerme_private', 'usage'), 'anon has no private schema usage');
select extensions.ok(not has_schema_privilege('authenticated', 'innerme_private', 'usage'), 'authenticated has no private schema usage');
select extensions.ok(has_schema_privilege('service_role', 'innerme_private', 'usage'), 'service_role has private schema usage');

select extensions.ok(not has_function_privilege('anon', 'innerme_private.create_yoco_payment_attempt(uuid,uuid,bigint,text)', 'execute'), 'anon cannot execute private attempt function');
select extensions.ok(not has_function_privilege('authenticated', 'innerme_private.create_yoco_payment_attempt(uuid,uuid,bigint,text)', 'execute'), 'authenticated cannot execute private attempt function');
select extensions.ok(has_function_privilege('service_role', 'innerme_private.create_yoco_payment_attempt(uuid,uuid,bigint,text)', 'execute'), 'service_role can execute private attempt function');

-- Public RPC boundary is service-role-only.
select extensions.ok(not has_function_privilege('anon', 'public.yoco_create_payment_attempt(uuid,uuid,bigint,text)', 'execute'), 'anon cannot call payment attempt RPC');
select extensions.ok(not has_function_privilege('authenticated', 'public.yoco_create_payment_attempt(uuid,uuid,bigint,text)', 'execute'), 'authenticated cannot call payment attempt RPC');
select extensions.ok(has_function_privilege('service_role', 'public.yoco_create_payment_attempt(uuid,uuid,bigint,text)', 'execute'), 'service_role can call payment attempt RPC');

-- Financial ledger protection and event binding triggers must be installed.
select extensions.has_trigger('public', 'payments', 'trg_guard_yoco_payment_ledger', 'Yoco payment immutability trigger exists');
select extensions.has_trigger('public', 'payment_refunds', 'trg_guard_yoco_refund_ledger', 'refund immutability trigger exists');
select extensions.has_trigger('public', 'payment_receipts', 'trg_guard_yoco_receipt_ledger', 'receipt immutability trigger exists');
select extensions.has_trigger('public', 'payment_refunds', 'trg_validate_yoco_refund_event_binding', 'refund event/payment binding trigger exists');

-- A provider event can only be used for one successful refund ledger entry.
select extensions.has_index('public', 'payment_refunds', 'payment_refunds_provider_event_uidx', 'unique refund provider-event index exists');

select * from finish();
rollback;
