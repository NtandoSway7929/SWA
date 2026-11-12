-- Yoco migration preflight: READ-ONLY catalog and dependency checks.
-- Run ONLY against a disposable local PostgreSQL/Supabase database.
-- This file does not apply migrations, create objects, or modify data.
-- A PASS here is only a prerequisite check; it does not validate migration SQL.

with required_objects(object_type, object_name, present) as (
    values
      ('table', 'public.clients', to_regclass('public.clients') is not null),
      ('table', 'public.client_projects', to_regclass('public.client_projects') is not null),
      ('table', 'public.invoices', to_regclass('public.invoices') is not null),
      ('table', 'public.payments', to_regclass('public.payments') is not null),
      ('function', 'public.recalculate_swayphics_invoice_balance(uuid)',
        to_regprocedure('public.recalculate_swayphics_invoice_balance(uuid)') is not null),
      ('function', 'public.sync_swayphics_project_payment_status(uuid)',
        to_regprocedure('public.sync_swayphics_project_payment_status(uuid)') is not null),
      ('function', 'public.sync_swayphics_payment_after_change()',
        to_regprocedure('public.sync_swayphics_payment_after_change()') is not null),
      ('function', 'public.sync_swayphics_invoice_after_change()',
        to_regprocedure('public.sync_swayphics_invoice_after_change()') is not null),
      ('function', 'public.enforce_swayphics_payment_invoice_integrity()',
        to_regprocedure('public.enforce_swayphics_payment_invoice_integrity()') is not null),
      ('function', 'public.get_client_portal(text)',
        to_regprocedure('public.get_client_portal(text)') is not null),
      ('function', 'extensions.digest(bytea,text)',
        to_regprocedure('extensions.digest(bytea,text)') is not null),
      ('role', 'anon', exists (select 1 from pg_roles where rolname = 'anon')),
      ('role', 'authenticated', exists (select 1 from pg_roles where rolname = 'authenticated')),
      ('role', 'service_role', exists (select 1 from pg_roles where rolname = 'service_role'))
),
required_columns(table_name, column_name) as (
    values
      ('clients', 'id'),
      ('client_projects', 'id'),
      ('invoices', 'id'),
      ('invoices', 'client_id'),
      ('invoices', 'project_id'),
      ('invoices', 'total'),
      ('invoices', 'status'),
      ('invoices', 'due_date'),
      ('invoices', 'amount_paid'),
      ('invoices', 'amount_outstanding'),
      ('invoices', 'currency'),
      ('payments', 'id'),
      ('payments', 'client_id'),
      ('payments', 'project_id'),
      ('payments', 'invoice_id'),
      ('payments', 'amount'),
      ('payments', 'status'),
      ('payments', 'method'),
      ('payments', 'reference'),
      ('payments', 'paid_at'),
      ('payments', 'notes')
),
column_checks as (
    select
      'column'::text as object_type,
      'public.' || rc.table_name || '.' || rc.column_name as object_name,
      exists (
        select 1
        from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = rc.table_name
          and c.column_name = rc.column_name
      ) as present
    from required_columns rc
),
required_triggers(table_name, trigger_name) as (
    values
      ('invoices', 'trg_sync_swayphics_invoice_before_change'),
      ('invoices', 'trg_sync_swayphics_project_after_invoice_change'),
      ('payments', 'trg_enforce_swayphics_payment_invoice_integrity'),
      ('payments', 'trg_sync_swayphics_payment_after_change')
),
trigger_checks as (
    select
      'trigger'::text as object_type,
      'public.' || rt.table_name || '.' || rt.trigger_name as object_name,
      exists (
        select 1
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = rt.table_name
          and t.tgname = rt.trigger_name
          and not t.tgisinternal
      ) as present
    from required_triggers rt
),
all_checks as (
    select * from required_objects
    union all
    select * from column_checks
    union all
    select * from trigger_checks
)
select
  object_type,
  object_name,
  case when present then 'PASS' else 'BLOCK' end as result
from all_checks
order by
  case when present then 1 else 0 end,
  object_type,
  object_name;

-- Operational sizing only; this SELECT is read-only.
select count(*) as invoice_rows_to_be_recalculated_by_migration_002
from public.invoices;

-- Extension placement check for pgcrypto.
select
  e.extname,
  n.nspname as extension_schema,
  e.extversion
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
where e.extname = 'pgcrypto';
