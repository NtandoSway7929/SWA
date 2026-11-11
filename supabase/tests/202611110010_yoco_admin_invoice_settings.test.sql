-- Stage 1.49: administrator invoice payment-settings RPC boundary tests.
-- Run only in the disposable local Supabase database after migrations.
begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(12);

select extensions.has_function(
  'public',
  'admin_set_invoice_yoco_settings',
  array['uuid','boolean','boolean','numeric'],
  'administrator invoice payment settings RPC exists'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.admin_set_invoice_yoco_settings(uuid,boolean,boolean,numeric)',
    'execute'
  ),
  'authenticated role can invoke the guarded RPC'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.admin_set_invoice_yoco_settings(uuid,boolean,boolean,numeric)',
    'execute'
  ),
  'anonymous role cannot invoke the RPC'
);
select extensions.ok(
  not not exists (
    select 1
    from pg_proc p,
         lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = 'public.admin_set_invoice_yoco_settings(uuid,boolean,boolean,numeric)'::regprocedure
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot invoke the RPC'
);

select extensions.ok(
  (select p.prosecdef from pg_proc p
   where p.oid = 'public.admin_set_invoice_yoco_settings(uuid,boolean,boolean,numeric)'::regprocedure),
  'RPC executes as SECURITY DEFINER'
);
select extensions.ok(
  (select p.proconfig @> array['search_path=""'] from pg_proc p
   where p.oid = 'public.admin_set_invoice_yoco_settings(uuid,boolean,boolean,numeric)'::regprocedure),
  'RPC pins an empty search_path'
);

select extensions.has_column('public','invoices','online_payment_enabled','online payment flag exists');
select extensions.has_column('public','invoices','partial_payment_enabled','partial payment flag exists');
select extensions.has_column('public','invoices','deposit_amount','deposit amount exists');

select extensions.ok(
  (select column_default like 'false%' from information_schema.columns
   where table_schema='public' and table_name='invoices' and column_name='online_payment_enabled'),
  'online payments default to disabled'
);
select extensions.ok(
  (select column_default like 'false%' from information_schema.columns
   where table_schema='public' and table_name='invoices' and column_name='partial_payment_enabled'),
  'partial payments default to disabled'
);

-- No JWT subject means no authenticated administrator. The RPC must reject
-- before it can inspect or mutate any invoice.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select extensions.throws_ok(
  $$ select public.admin_set_invoice_yoco_settings(null, false, false, null) $$,
  '42501',
  'Administrator access is required.',
  'unauthenticated caller is rejected'
);
reset role;

select * from extensions.finish();
rollback;
