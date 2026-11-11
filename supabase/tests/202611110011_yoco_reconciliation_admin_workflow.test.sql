-- Stage 1.52: reconciliation evidence/action history and RPC security tests.
-- Run only in the disposable local Supabase database after migration 009.
begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(21);

select extensions.has_table('public','payment_reconciliation_evidence',
    'append-only reconciliation evidence table exists');
select extensions.has_table('public','payment_reconciliation_actions',
    'append-only reconciliation action history exists');

select extensions.has_function('public','admin_add_payment_reconciliation_evidence',
    array['uuid','text','text','text'],'evidence RPC exists');
select extensions.has_function('public','admin_set_payment_reconciliation_status',
    array['uuid','text','text','text','uuid','uuid'],'status RPC exists');

select extensions.ok(
    (select relrowsecurity from pg_class where oid='public.payment_reconciliation_evidence'::regclass),
    'evidence table has RLS enabled');
select extensions.ok(
    (select relrowsecurity from pg_class where oid='public.payment_reconciliation_actions'::regclass),
    'action history table has RLS enabled');

select extensions.ok(
    not has_table_privilege('authenticated','public.payment_reconciliation_evidence','select'),
    'authenticated role cannot read evidence directly');
select extensions.ok(
    not has_table_privilege('anon','public.payment_reconciliation_evidence','select'),
    'anonymous role cannot read evidence');
select extensions.ok(
    has_table_privilege('service_role','public.payment_reconciliation_evidence','select'),
    'service role can read evidence for the guarded admin read model');
select extensions.ok(
    has_table_privilege('service_role','public.payment_reconciliation_actions','select'),
    'service role can read action history for the guarded admin read model');

select extensions.ok(
    has_function_privilege('authenticated',
      'public.admin_add_payment_reconciliation_evidence(uuid,text,text,text)','execute'),
    'authenticated role can call the guarded evidence RPC');
select extensions.ok(
    not has_function_privilege('anon',
      'public.admin_add_payment_reconciliation_evidence(uuid,text,text,text)','execute'),
    'anonymous role cannot call the evidence RPC');
select extensions.ok(
    not exists (
      select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where p.oid='public.admin_add_payment_reconciliation_evidence(uuid,text,text,text)'::regprocedure
        and acl.grantee=0 and acl.privilege_type='EXECUTE'
    ),
    'PUBLIC cannot call the evidence RPC');

select extensions.ok(
    (select prosecdef from pg_proc
     where oid='public.admin_add_payment_reconciliation_evidence(uuid,text,text,text)'::regprocedure),
    'evidence RPC executes as SECURITY DEFINER');
select extensions.ok(
    (select proconfig @> array['search_path=""'] from pg_proc
     where oid='public.admin_add_payment_reconciliation_evidence(uuid,text,text,text)'::regprocedure),
    'evidence RPC pins an empty search_path');

select extensions.ok(
    (select prosecdef from pg_proc
     where oid='public.admin_set_payment_reconciliation_status(uuid,text,text,text,uuid,uuid)'::regprocedure),
    'status RPC executes as SECURITY DEFINER');
select extensions.ok(
    (select proconfig @> array['search_path=""'] from pg_proc
     where oid='public.admin_set_payment_reconciliation_status(uuid,text,text,text,uuid,uuid)'::regprocedure),
    'status RPC pins an empty search_path');

select extensions.ok(
    exists (select 1 from pg_trigger
      where tgrelid='public.payment_reconciliation_evidence'::regclass
        and tgname='payment_reconciliation_evidence_immutable' and not tgisinternal),
    'evidence UPDATE/DELETE immutability trigger exists');
select extensions.ok(
    exists (select 1 from pg_trigger
      where tgrelid='public.payment_reconciliation_actions'::regclass
        and tgname='payment_reconciliation_actions_immutable' and not tgisinternal),
    'action history UPDATE/DELETE immutability trigger exists');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select extensions.throws_ok(
    $$ select public.admin_add_payment_reconciliation_evidence(null, null, null, null) $$,
    '42501','Administrator access is required.',
    'non-admin authenticated caller cannot add evidence');
select extensions.throws_ok(
    $$ select public.admin_set_payment_reconciliation_status(null, null, null, null, null, null) $$,
    '42501','Administrator access is required.',
    'non-admin authenticated caller cannot change case status');
reset role;

select * from extensions.finish();
rollback;
