-- Escalate due work when its assignee is missing or inactive.
-- Active assignees continue receiving personal notifications; otherwise all
-- active admins receive the same deduplicated task/follow-up alert.
begin;

create or replace function innerme_private.generate_admin_due_notifications_internal()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_count integer := 0;
    r record;
    v_type text;
    v_event_type text;
    v_title text;
    v_message text;
    v_dedupe_key text;
begin
    for r in
        select
            t.id,
            t.title,
            t.assigned_to,
            t.due_date,
            exists (
                select 1
                from public.admin_users au
                where au.user_id = t.assigned_to
                  and au.active = true
            ) as assignee_active
        from public.tasks t
        where t.status <> 'completed'
          and t.due_date is not null
          and t.due_date <= current_date
    loop
        v_type := case when r.due_date < current_date then 'danger' else 'warning' end;
        v_event_type := 'task.due';
        v_title := case when r.due_date < current_date then 'Task overdue' else 'Task due today' end;
        v_message := coalesce(r.title, 'Task') || ' · ' || to_char(r.due_date, 'DD Mon YYYY');
        v_dedupe_key := 'task-due:' || r.id::text || ':' || r.due_date::text;

        if r.assignee_active then
            perform public.create_admin_notification(
                r.assigned_to, null, v_type, v_event_type, v_title, v_message,
                'task', r.id, 'tasks', v_dedupe_key
            );
        else
            perform public.notify_admins(
                null, v_type, v_event_type, v_title,
                v_message || ' · No active assignee; administrator attention required.',
                'task', r.id, 'tasks', v_dedupe_key, false
            );
        end if;

        v_count := v_count + 1;
    end loop;

    for r in
        select
            f.id,
            f.lead_id,
            f.client_id,
            f.assigned_to,
            f.scheduled_for,
            exists (
                select 1
                from public.admin_users au
                where au.user_id = f.assigned_to
                  and au.active = true
            ) as assignee_active
        from public.follow_ups f
        where f.status = 'pending'
          and f.scheduled_for <= current_date
    loop
        v_type := case when r.scheduled_for < current_date then 'danger' else 'warning' end;
        v_event_type := 'followup.due';
        v_title := case when r.scheduled_for < current_date then 'Follow-up overdue' else 'Follow-up due today' end;
        v_message := 'A scheduled follow-up needs attention.';
        v_dedupe_key := 'followup-due:' || r.id::text || ':' || r.scheduled_for::text;

        if r.assignee_active then
            perform public.create_admin_notification(
                r.assigned_to, null, v_type, v_event_type, v_title, v_message,
                'follow_up', r.id, 'followups', v_dedupe_key
            );
        else
            perform public.notify_admins(
                null, v_type, v_event_type, v_title,
                v_message || ' No active assignee; administrator attention required.',
                'follow_up', r.id, 'followups', v_dedupe_key, false
            );
        end if;

        v_count := v_count + 1;
    end loop;

    for r in
        select i.id, i.invoice_number, i.client_id, i.due_date, i.amount_outstanding
        from public.invoices i
        where coalesce(i.status, '') not in ('paid', 'cancelled')
          and i.due_date is not null
          and i.due_date <= current_date
          and coalesce(i.amount_outstanding, i.total, 0) > 0
    loop
        perform public.notify_admins(
            null,
            case when r.due_date < current_date then 'danger' else 'warning' end,
            'invoice.due',
            case when r.due_date < current_date then 'Invoice overdue' else 'Invoice due today' end,
            coalesce(r.invoice_number, 'Invoice') || ' · R ' ||
                to_char(coalesce(r.amount_outstanding, 0), 'FM999G999G990D00'),
            'invoice', r.id, 'invoices',
            'invoice-due:' || r.id::text || ':' || r.due_date::text,
            false
        );
        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$$;

revoke all privileges
    on function innerme_private.generate_admin_due_notifications_internal()
    from public, anon, authenticated, service_role;

commit;
