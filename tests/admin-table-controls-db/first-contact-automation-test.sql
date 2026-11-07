-- CI-only RPC wrapper for the first-contact automation database smoke test.
-- Copied only into a disposable local Supabase project by GitHub Actions.
create or replace function public.run_swayphics_first_contact_automation_test()
returns integer
language sql
security definer
set search_path = ''
as $$
    select innerme_private.process_swayphics_stale_leads_internal();
$$;

revoke all privileges
    on function public.run_swayphics_first_contact_automation_test()
    from public, anon, authenticated;
grant execute
    on function public.run_swayphics_first_contact_automation_test()
    to service_role;

-- CI-only wrapper for due-work notification routing.
create or replace function public.run_swayphics_due_work_notification_test()
returns integer
language sql
security definer
set search_path = ''
as $due_work$
    select innerme_private.generate_admin_due_notifications_internal();
$due_work$;

revoke all privileges
    on function public.run_swayphics_due_work_notification_test()
    from public, anon, authenticated;
grant execute
    on function public.run_swayphics_due_work_notification_test()
    to service_role;

notify pgrst, 'reload schema';
