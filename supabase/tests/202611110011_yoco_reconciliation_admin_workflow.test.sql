-- Stage 1.52: reconciliation evidence/action history and RPC security tests.
-- Run only in the disposable local Supabase database after migration 009.
begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(36);

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
    not has_function_privilege('anon',
      'public.admin_set_payment_reconciliation_status(uuid,text,text,text,uuid,uuid)','execute'),
    'anonymous role cannot call the status RPC');
select extensions.ok(
    not exists (
      select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where p.oid='public.admin_set_payment_reconciliation_status(uuid,text,text,text,uuid,uuid)'::regprocedure
        and acl.grantee=0 and acl.privilege_type='EXECUTE'
    ),
    'PUBLIC cannot call the status RPC');

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


select extensions.ok(
    position('v_case_invoice_id' in pg_get_functiondef(
      'public.admin_set_payment_reconciliation_status(uuid,text,text,text,uuid,uuid)'::regprocedure
    )) > 0,
    'status RPC derives the invoice anchor from the reconciliation case'
);
select extensions.ok(
    position('p.invoice_id = v_case_invoice_id' in pg_get_functiondef(
      'public.admin_set_payment_reconciliation_status(uuid,text,text,text,uuid,uuid)'::regprocedure
    )) > 0,
    'financial correction payment and refund references are bound to the case invoice'
);
select extensions.ok(
    position('v_case.provider <> ''yoco''' in pg_get_functiondef(
      'public.admin_set_payment_reconciliation_status(uuid,text,text,text,uuid,uuid)'::regprocedure
    )) > 0,
    'status RPC rejects reconciliation cases outside the Yoco test environment'
);


select extensions.ok(
    position('v_case.provider <> ''yoco''' in pg_get_functiondef(
      'public.admin_add_payment_reconciliation_evidence(uuid,text,text,text)'::regprocedure
    )) > 0,
    'evidence RPC is restricted to Yoco test reconciliation cases'
);

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


select extensions.has_function('public','admin_set_payment_reconciliation_status_v2',
    array['uuid','text','text','text','uuid','uuid','timestamp with time zone'],
    'version-checked status RPC exists');

select extensions.ok(
    (select prosecdef from pg_proc
     where oid='public.admin_set_payment_reconciliation_status_v2(uuid,text,text,text,uuid,uuid,timestamptz)'::regprocedure),
    'version-checked status RPC executes as SECURITY DEFINER');

select extensions.ok(
    (select proconfig @> array['search_path=""'] from pg_proc
     where oid='public.admin_set_payment_reconciliation_status_v2(uuid,text,text,text,uuid,uuid,timestamptz)'::regprocedure),
    'version-checked status RPC pins an empty search_path');

select extensions.ok(
    has_function_privilege('authenticated',
      'public.admin_set_payment_reconciliation_status_v2(uuid,text,text,text,uuid,uuid,timestamptz)','execute'),
    'authenticated role can call the guarded version-checked RPC');

select extensions.ok(
    not has_function_privilege('anon',
      'public.admin_set_payment_reconciliation_status_v2(uuid,text,text,text,uuid,uuid,timestamptz)','execute'),
    'anonymous role cannot call the version-checked RPC');

select extensions.ok(
    not has_function_privilege('authenticated',
      'public.admin_set_payment_reconciliation_status(uuid,text,text,text,uuid,uuid)','execute'),
    'authenticated role cannot bypass version checks through the legacy status RPC');

select extensions.ok(
    position('v_case.updated_at is distinct from p_expected_updated_at' in pg_get_functiondef(
      'public.admin_set_payment_reconciliation_status_v2(uuid,text,text,text,uuid,uuid,timestamptz)'::regprocedure
    )) > 0,
    'status RPC rejects stale or missing case versions');

select extensions.ok(
    position('using errcode = ''40001''' in pg_get_functiondef(
      'public.admin_set_payment_reconciliation_status_v2(uuid,text,text,text,uuid,uuid,timestamptz)'::regprocedure
    )) > 0,
    'stale status decisions return the serialization failure SQLSTATE');

select extensions.ok(
    position('set updated_at = now()' in pg_get_functiondef(
      'public.admin_add_payment_reconciliation_evidence(uuid,text,text,text)'::regprocedure
    )) > 0,
    'adding evidence advances the parent case version');

select * from extensions.finish();
rollback;
