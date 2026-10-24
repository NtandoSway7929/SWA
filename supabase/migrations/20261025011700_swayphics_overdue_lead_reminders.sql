-- Repair active contact records created before next-follow-up dates were auto-populated.
do $$
declare
    v_days integer;
begin
    select coalesce(
        (select ws.lead_no_response_days
         from public.workflow_settings ws
         where ws.id = 1),
        7
    )
    into v_days;

    update public.leads l
    set next_follow_up =
        (l.last_contacted_at at time zone 'Africa/Johannesburg')::date + v_days
    where l.next_follow_up is null
      and l.last_contacted_at is not null
      and l.status in (
          'contacted',
          'interested',
          'proposal sent',
          'negotiating',
          'follow-up'
      );
end;
$$;

-- Notify admins about first contact/follow-ups due today or already overdue.
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
    v_event_type text;
    v_title text;
    v_message text;
    v_dedupe_key text;
begin
    for r in
        select l.id, l.business_name, l.contact_name, l.status,
               l.assigned_to, l.next_follow_up
        from public.leads l
        where l.status not in ('won', 'lost', 'not interested')
          and l.next_follow_up <= v_today
        order by l.next_follow_up, l.business_name, l.id
    loop
        if r.next_follow_up < v_today then
            v_event_type := 'lead.overdue';
            if r.status = 'new' then
                v_title := 'First contact overdue';
                v_message := coalesce(
                    nullif(trim(r.business_name), ''),
                    nullif(trim(r.contact_name), ''),
                    'Lead'
                ) || ' was due for first contact on ' ||
                    to_char(r.next_follow_up, 'DD Mon YYYY') || '.';
            else
                v_title := 'Lead follow-up overdue';
                v_message := coalesce(
                    nullif(trim(r.business_name), ''),
                    nullif(trim(r.contact_name), ''),
                    'Lead'
                ) || ' had a follow-up due on ' ||
                    to_char(r.next_follow_up, 'DD Mon YYYY') || '.';
            end if;
        else
            v_event_type := 'lead.due_today';
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
        end if;

        v_dedupe_key := 'swayphics-lead-schedule:' ||
            r.id::text || ':' || v_today::text;

        if r.assigned_to is not null then
            perform public.create_admin_notification(
                r.assigned_to, null,
                'warning',
                v_event_type,
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
                v_event_type,
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

notify pgrst, 'reload schema';
