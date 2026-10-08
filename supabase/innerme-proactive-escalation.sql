-- InnerMe Phase 17: proactive escalation
-- Deterministic exception notifications run from Supabase Cron.
-- No autonomous business mutation is performed by these jobs.

create extension if not exists pg_cron;

create or replace function public.generate_innerme_proactive_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_count integer := 0;
    r record;
begin
    v_count := v_count + coalesce(public.generate_admin_due_notifications(), 0);

    for r in
        select id, business_name, contact_name, assigned_to
        from public.leads
        where status not in ('won','lost')
          and next_follow_up is not null
          and next_follow_up < current_date
    loop
        if r.assigned_to is not null then
            perform public.create_admin_notification(
                r.assigned_to, null, 'danger', 'innerme.monitor.lead_overdue',
                'Lead follow-up overdue',
                coalesce(r.business_name, r.contact_name, 'Lead') || ' requires follow-up attention.',
                'lead', r.id, 'leads',
                'innerme-lead-overdue:' || r.id::text || ':' || current_date::text
            );
        else
            perform public.notify_admins(
                null, 'danger', 'innerme.monitor.lead_overdue',
                'Lead follow-up overdue',
                coalesce(r.business_name, r.contact_name, 'Lead') || ' requires follow-up attention.',
                'lead', r.id, 'leads',
                'innerme-lead-overdue:' || r.id::text || ':' || current_date::text,
                true
            );
        end if;
        v_count := v_count + 1;
    end loop;

    for r in
        select id, business_name, assigned_to
        from public.leads
        where status in ('contacted','interested','proposal sent','negotiating','follow-up')
          and coalesce(last_contacted_at, created_at) <= now() - interval '14 days'
    loop
        if r.assigned_to is not null then
            perform public.create_admin_notification(
                r.assigned_to, null, 'warning', 'innerme.monitor.lead_quiet',
                'Lead has gone quiet',
                coalesce(r.business_name, 'Lead') || ' has had no recorded contact activity for at least 14 days.',
                'lead', r.id, 'leads',
                'innerme-lead-quiet:' || r.id::text || ':' ||
                to_char(date_trunc('week', current_date), 'YYYY-MM-DD')
            );
        else
            perform public.notify_admins(
                null, 'warning', 'innerme.monitor.lead_quiet',
                'Lead has gone quiet',
                coalesce(r.business_name, 'Lead') || ' has had no recorded contact activity for at least 14 days.',
                'lead', r.id, 'leads',
                'innerme-lead-quiet:' || r.id::text || ':' ||
                to_char(date_trunc('week', current_date), 'YYYY-MM-DD'),
                true
            );
        end if;
        v_count := v_count + 1;
    end loop;

    for r in
        select id, title, assigned_to, priority
        from public.tasks
        where status <> 'completed'
          and due_date is not null
          and due_date < current_date
    loop
        if r.assigned_to is not null then
            perform public.create_admin_notification(
                r.assigned_to, null,
                case when r.priority in ('urgent','high') then 'danger' else 'warning' end,
                'innerme.monitor.task_overdue',
                'Overdue task',
                coalesce(r.title, 'Task') || ' is past its due date.',
                'task', r.id, 'tasks',
                'innerme-task-overdue:' || r.id::text || ':' || current_date::text
            );
        else
            perform public.notify_admins(
                null,
                case when r.priority in ('urgent','high') then 'danger' else 'warning' end,
                'innerme.monitor.task_overdue',
                'Overdue task',
                coalesce(r.title, 'Task') || ' is past its due date.',
                'task', r.id, 'tasks',
                'innerme-task-overdue:' || r.id::text || ':' || current_date::text,
                true
            );
        end if;
        v_count := v_count + 1;
    end loop;

    for r in
        select id, invoice_number, due_date, amount_outstanding
        from public.invoices
        where archived = false
          and coalesce(amount_outstanding, total, 0) > 0
          and due_date is not null
          and due_date < current_date
          and coalesce(status,'') not in ('paid','cancelled')
    loop
        perform public.notify_admins(
            null, 'danger', 'innerme.monitor.invoice_overdue',
            'Invoice overdue',
            coalesce(r.invoice_number, 'Invoice') || ' has an outstanding overdue balance of R ' ||
            to_char(coalesce(r.amount_outstanding,0), 'FM999G999G990D00') || '.',
            'invoice', r.id, 'invoices',
            'innerme-invoice-overdue:' || r.id::text || ':' || current_date::text,
            false
        );
        v_count := v_count + 1;
    end loop;

    for r in
        select id, title, action_type, updated_at
        from public.innerme_action_proposals
        where status = 'failed'
          and updated_at >= now() - interval '7 days'
    loop
        perform public.notify_admins(
            null, 'danger', 'innerme.monitor.action_failed',
            'InnerMe action failed',
            coalesce(r.title, r.action_type, 'An InnerMe action') ||
            ' requires inspection before retry.',
            'innerme_action_proposal', r.id, 'innerme',
            'innerme-action-failed:' || r.id::text || ':' ||
            to_char(r.updated_at, 'YYYY-MM-DD-HH24'),
            true
        );
        v_count := v_count + 1;
    end loop;

    for r in
        select id, title, action_type
        from public.innerme_action_proposals
        where status = 'approved'
    loop
        perform public.notify_admins(
            null, 'warning', 'innerme.monitor.action_waiting',
            'Approved InnerMe action awaiting execution',
            coalesce(r.title, r.action_type, 'Approved action') ||
            ' is waiting for execution review.',
            'innerme_action_proposal', r.id, 'innerme',
            'innerme-action-waiting:' || r.id::text || ':' || current_date::text,
            true
        );
        v_count := v_count + 1;
    end loop;

    for r in
        select id
        from public.innerme_action_execution_logs
        where status = 'started'
          and started_at < now() - interval '7 days'
    loop
        perform public.notify_admins(
            null, 'danger', 'innerme.monitor.execution_stalled',
            'InnerMe execution appears stalled',
            'An execution record has remained in started state for more than seven days.',
            'innerme_action_execution_log', r.id, 'innerme',
            'innerme-execution-stalled:' || r.id::text || ':' || current_date::text,
            true
        );
        v_count := v_count + 1;
    end loop;

    for r in
        select id, title
        from public.innerme_knowledge
        where status = 'active'
          and (
              verification_status in ('stale','needs_review','unverified')
              or review_after <= now()
          )
    loop
        perform public.notify_admins(
            null, 'warning', 'innerme.monitor.knowledge_due',
            'InnerMe knowledge verification due',
            coalesce(r.title, 'Knowledge record') || ' is outside its verified retrieval window.',
            'innerme_knowledge', r.id, 'innerme',
            'innerme-knowledge-due:' || r.id::text || ':' || current_date::text,
            true
        );
        v_count := v_count + 1;
    end loop;

    for r in
        select id, title, urgency
        from public.innerme_strategic_recommendations
        where status = 'candidate'
    loop
        perform public.notify_admins(
            null,
            case when urgency in ('critical','high') then 'danger' else 'warning' end,
            'innerme.monitor.strategy_waiting',
            'Strategic recommendation awaiting review',
            coalesce(r.title, 'Strategic recommendation') || ' remains an unreviewed candidate.',
            'innerme_strategic_recommendation', r.id, 'innerme',
            'innerme-strategy-waiting:' || r.id::text || ':' || current_date::text,
            true
        );
        v_count := v_count + 1;
    end loop;

    v_count := v_count + coalesce(public.generate_innerme_operational_incidents(), 0);

    return v_count;
end;
$;

revoke all on function public.generate_innerme_proactive_notifications() from public;
revoke all on function public.generate_innerme_proactive_notifications() from anon;

-- Active jobs are intentionally narrow:
-- every 15 minutes for prompt operational escalation
-- daily at 06:15 UTC (08:15 SAST) for a second sweep.
select cron.schedule(
  'innerme-proactive-escalation',
  '*/15 * * * *',
  'select public.generate_innerme_proactive_notifications();'
);

select cron.schedule(
  'innerme-proactive-daily-review',
  '15 6 * * *',
  'select public.generate_innerme_proactive_notifications();'
);
