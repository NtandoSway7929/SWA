-- SWAYPHICS ADMIN WORKSPACE REALTIME
-- Run after the core admin workspace and sales campaign attribution SQL are in place.
-- Enables Postgres Changes for the business tables used by the live
-- Insights dashboard. RLS still controls which authenticated admins
-- are allowed to receive row-change events.

do $$
declare
    table_name text;
begin
    foreach table_name in array array[
        'admin_users',
        'clients',
        'leads',
        'client_projects',
        'tasks',
        'follow_ups',
        'quotes',
        'payments',
        'website_enquiries',
        'site_announcements',
        'activity_log',
        'communication_logs',
        'sales_campaigns',
        'sales_campaign_leads',
        'sales_campaign_spend',
        'email_messages'
    ]
    loop
        if not exists (
            select 1
            from pg_publication_tables
            where pubname = 'supabase_realtime'
              and schemaname = 'public'
              and tablename = table_name
        ) then
            execute format(
                'alter publication supabase_realtime add table public.%I',
                table_name
            );
        end if;
    end loop;
end
$$;

-- Confirm the enabled realtime tables.
select
    schemaname,
    tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename in (
      'admin_users',
      'clients',
      'leads',
      'client_projects',
      'tasks',
      'follow_ups',
      'quotes',
      'payments',
      'website_enquiries',
      'site_announcements',
      'activity_log',
      'communication_logs',
      'sales_campaigns',
      'sales_campaign_leads',
      'sales_campaign_spend',
      'email_messages'
  )
order by tablename;
