-- Route due lead and quote notifications away from inactive assignees.
-- Active assignees retain personal alerts; missing/inactive assignees are
-- escalated to all active administrators. This does not contact clients.
begin;

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
        select
            l.id,
            l.business_name,
            l.contact_name,
            l.status,
            l.assigned_to,
            exists (
                select 1
                from public.admin_users au
                where au.user_id = l.assigned_to
                  and au.active = true
            ) as assignee_active
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

        if r.assignee_active then
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
                v_message || ' No active assignee; administrator attention required.',
                'lead',
                r.id,
                'leads',
                v_dedupe_key,
                false
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

create or replace function innerme_private.generate_swayphics_quote_expiry_notifications_internal()
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
    v_severity text;
    v_event_type text;
    v_dedupe_key text;
begin
    for r in
        select
            q.id,
            q.quote_number,
            q.title,
            q.valid_until,
            coalesce(l.assigned_to, c.assigned_to) as assigned_to,
            exists (
                select 1
                from public.admin_users au
                where au.user_id = coalesce(l.assigned_to, c.assigned_to)
                  and au.active = true
            ) as assignee_active
        from public.quotes q
        left join public.leads l on l.id = q.lead_id
        left join public.clients c on c.id = q.client_id
        where q.status = 'sent'
          and q.valid_until is not null
          and q.valid_until <= v_today
        order by q.valid_until asc, q.id
    loop
        if r.valid_until = v_today then
            v_title := 'Quote expires today';
            v_severity := 'warning';
            v_event_type := 'quote.expiry_due';
            v_message := coalesce(
                nullif(trim(r.quote_number), ''),
                nullif(trim(r.title), ''),
                'Quote'
            ) || ' is due to expire today. Review the prospect and decide whether to follow up.';
        else
            v_title := 'Quote has expired';
            v_severity := 'danger';
            v_event_type := 'quote.expired';
            v_message := coalesce(
                nullif(trim(r.quote_number), ''),
                nullif(trim(r.title), ''),
                'Quote'
            ) || ' expired on ' || to_char(r.valid_until, 'DD Mon YYYY') ||
            '. Verify its current status before re-engaging the prospect.';
        end if;

        v_dedupe_key := 'swayphics-quote-validity:' ||
            r.id::text || ':' || r.valid_until::text || ':' ||
            case when r.valid_until = v_today then 'due' else 'expired' end;

        if r.assignee_active then
            perform public.create_admin_notification(
                r.assigned_to, null,
                v_severity,
                v_event_type,
                v_title,
                v_message,
                'quote',
                r.id,
                'quotes',
                v_dedupe_key
            );
        else
            perform public.notify_admins(
                null,
                v_severity,
                v_event_type,
                v_title,
                v_message || ' No active assignee; administrator attention required.',
                'quote',
                r.id,
                'quotes',
                v_dedupe_key,
                false
            );
        end if;

        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$$;

revoke all privileges
    on function innerme_private.generate_swayphics_quote_expiry_notifications_internal()
    from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
