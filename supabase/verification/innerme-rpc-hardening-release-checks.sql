-- InnerMe RPC-hardening release checks (read-only).
-- Run ONLY after applying the hardening migration to a production-schema staging database.
-- This script performs catalog reads only; it does not update application data.
-- Every row should return PASS. A missing routine is treated as FAIL.

with
privilege_targets(signature, role_names, should_execute, purpose) as (
    values
      ('public.create_admin_notification(uuid,uuid,text,text,text,text,text,uuid,text,text)', array['anon','authenticated']::text[], false, 'Internal notification helper'),
      ('public.notify_admins(uuid,text,text,text,text,text,uuid,text,text,boolean)', array['anon','authenticated']::text[], false, 'Internal notification helper'),
      ('public.recalculate_swayphics_invoice_balance(uuid)', array['anon','authenticated']::text[], false, 'Internal invoice mutation helper'),
      ('public.sync_swayphics_project_payment_status(uuid)', array['anon','authenticated']::text[], false, 'Internal project-payment mutation helper'),
      ('innerme_private.generate_admin_due_notifications_internal()', array['anon','authenticated','service_role']::text[], false, 'Private due-notification helper'),
      ('public.generate_admin_due_notifications()', array['anon']::text[], false, 'Dashboard wrapper is not anonymous'),
      ('public.generate_admin_due_notifications()', array['authenticated']::text[], true, 'Authenticated can reach the wrapper; the function body must enforce admin authorization'),
      ('public.generate_innerme_proactive_notifications()', array['anon','authenticated']::text[], false, 'Scheduled routine is not a client RPC')
),
trigger_targets(function_name, is_event_trigger) as (
    values
      ('auto_swayphics_project_completion', false),
      ('enforce_swayphics_payment_invoice_integrity', false),
      ('notify_client_document', false),
      ('notify_client_events', false),
      ('notify_enquiry_created', false),
      ('notify_followup_events', false),
      ('notify_inbound_email', false),
      ('notify_invoice_events', false),
      ('notify_lead_assessment', false),
      ('notify_lead_events', false),
      ('notify_payment_events', false),
      ('notify_portal_request', false),
      ('notify_project_events', false),
      ('notify_quote_events', false),
      ('notify_social_post_events', false),
      ('notify_task_events', false),
      ('notify_team_member_created', false),
      ('record_lead_stage_change', false),
      ('set_swayphics_portal_token_expiry', false),
      ('sync_swayphics_invoice_after_change', false),
      ('sync_swayphics_lead_contact_from_communication', false),
      ('sync_swayphics_payment_after_change', false),
      ('rls_auto_enable', true)
),
portal_targets(function_name) as (
    values
      ('get_client_onboarding'),
      ('get_client_onboarding_assets'),
      ('get_client_portal'),
      ('save_client_onboarding'),
      ('submit_client_portal_request')
),
privilege_checks as (
    select
      format('%s execute privilege: %s', r.role_name, t.signature) as check_name,
      coalesce(
        to_regprocedure(t.signature) is not null
        and has_function_privilege(r.role_name, to_regprocedure(t.signature)::oid, 'EXECUTE') = t.should_execute,
        false
      ) as passed,
      t.purpose as detail
    from privilege_targets t
    cross join lateral unnest(t.role_names) as r(role_name)
),
trigger_privilege_checks as (
    select
      format('%s cannot directly execute trigger routine public.%s()', r.role_name, t.function_name) as check_name,
      coalesce(
        to_regprocedure(format('public.%I()', t.function_name)) is not null
        and not has_function_privilege(r.role_name, to_regprocedure(format('public.%I()', t.function_name))::oid, 'EXECUTE'),
        false
      ) as passed,
      'Revoking EXECUTE must not drop or disable the attached trigger.' as detail
    from trigger_targets t
    cross join unnest(array['anon','authenticated','service_role']::text[]) as r(role_name)
),
trigger_attachment_checks as (
    select
      format('Trigger routine public.%s() remains attached', t.function_name) as check_name,
      case
        when t.is_event_trigger then exists (
          select 1
          from pg_catalog.pg_event_trigger e
          where e.evtfoid = to_regprocedure(format('public.%I()', t.function_name))::oid
        )
        else exists (
          select 1
          from pg_catalog.pg_trigger g
          where g.tgfoid = to_regprocedure(format('public.%I()', t.function_name))::oid
            and not g.tgisinternal
        )
      end as passed,
      case when t.is_event_trigger then 'Event-trigger attachment' else 'Table-trigger attachment' end as detail
    from trigger_targets t
),
portal_checks as (
    select
      format('Token-validated portal RPC public.%s remains callable by anon', t.function_name) as check_name,
      exists (
        select 1
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = t.function_name
          and has_function_privilege('anon', p.oid, 'EXECUTE')
      ) as passed,
      'The RPC must continue validating its private client token in its function body.' as detail
    from portal_targets t
),
guard_check as (
    select
      'Due-notification wrapper enforces active admin authorization'::text as check_name,
      exists (
        select 1
        from pg_catalog.pg_proc p
        where p.oid = to_regprocedure('public.generate_admin_due_notifications()')::oid
          and p.prosecdef
          and position('auth.uid()' in pg_get_functiondef(p.oid)) > 0
          and position('public.admin_users' in pg_get_functiondef(p.oid)) > 0
          and position('active = true' in pg_get_functiondef(p.oid)) > 0
          and position('Swayphics admin access required.' in pg_get_functiondef(p.oid)) > 0
      ) as passed,
      'Catalog/source assertion only; separately test a non-admin JWT against a staging database.'::text as detail
),
search_path_targets(signature, check_name) as (
    values
      ('innerme_private.generate_admin_due_notifications_internal()', 'Private helper has an empty search_path'),
      ('public.generate_admin_due_notifications()', 'Dashboard wrapper has an empty search_path'),
      ('public.generate_innerme_proactive_notifications()', 'Scheduled routine has an empty search_path')
),
search_path_checks as (
    select
      t.check_name,
      coalesce(p.oid is not null and p.proconfig @> array['search_path=""']::text[], false) as passed,
      'Empty search_path plus schema-qualified references.'::text as detail
    from search_path_targets t
    left join pg_catalog.pg_proc p
      on p.oid = to_regprocedure(t.signature)::oid
),
checks as (
    select * from privilege_checks
    union all select * from trigger_privilege_checks
    union all select * from trigger_attachment_checks
    union all select * from portal_checks
    union all select * from guard_check
    union all select * from search_path_checks
)
select
  case when passed then 'PASS' else 'FAIL' end as status,
  check_name,
  detail
from checks
order by passed asc, check_name;
