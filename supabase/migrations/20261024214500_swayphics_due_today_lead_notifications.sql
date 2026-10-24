-- Separate first-contact/due-today notifications from the no-response follow-up worker.
-- This creates internal admin notifications only; it never sends messages to leads.

begin;

create extension if not exists pg_cron;
create schema if not exists innerme_private;

create or replace function innerme_private.generate_swayphics_due_lead_notifications_internal()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_today date := (now() at time zone 'Africa/Johannesburg')::date;
    v_count integer := 0;
    r record;
    v_title text;
    v_message text;
    v_dedupe_key text;
begin
    for r in
        select l.id, l.business_name, l.contact_name, l.status, l.assigned_to
        from public.leads l
        where l.status not in ('won', 'lost')
          and l.next_follow_up = v_today
        order by l.business_name, l.id
    loop
        if r.status = 'new' then
            v_title := 'First contact due today';
            v_message := coalesce(
                nullif(trim(r.business_name), ''),
                nullif(trim(r.contact_name), ''),
                'Lead'
            ) || ' is scheduled for first contact today.';
        else
            v_title := 'Lead follow-up due today';
            v_message := coalesce(
                nullif(trim(r.business_name), ''),
                nullif(trim(r.contact_name), ''),
                'Lead'
            ) || ' has a follow-up scheduled for today.';
        end if;

        v_dedupe_key := 'swayphics-lead-due-today:' ||
            r.id::text || ':' || v_today::text;

        if r.assigned_to is not null then
            perform public.create_admin_notification(
                r.assigned_to, null,
                'warning',
                'lead.due_today',
                v_title,
                v_message,
                'lead',
                r.id,
                'leads',
                v_dedupe_key
            );
        else
            perform public.notify_admins(
                null,
                'warning',
                'lead.due_today',
                v_title,
                v_message,
                'lead',
                r.id,
                'leads',
                v_dedupe_key,
                true
            );
        end if;

        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$$;

revoke all privileges
    on function innerme_private.generate_swayphics_due_lead_notifications_internal()
    from public, anon, authenticated, service_role;

do $$
declare
    v_job_id bigint;
begin
    for v_job_id in
        select jobid
        from cron.job
        where jobname = 'swayphics-leads-due-today'
    loop
        perform cron.unschedule(v_job_id);
    end loop;

    perform cron.schedule(
        'swayphics-leads-due-today',
        '*/15 * * * *',
        'select innerme_private.generate_swayphics_due_lead_notifications_internal();'
    );
end;
$$;

notify pgrst, 'reload schema';

commit;
