-- Targeted hardening for internal SECURITY DEFINER RPCs.
-- Public client-portal RPCs remain available and must continue validating their private token.
-- This migration intentionally does not change production by itself; apply through the normal reviewed migration process.

begin;

-- Internal helpers are callable only through trusted definer-owned triggers / routines.
revoke all privileges on function public.create_admin_notification(uuid,uuid,text,text,text,text,text,uuid,text,text) from public, anon, authenticated;
revoke all privileges on function public.notify_admins(uuid,text,text,text,text,text,uuid,text,text,boolean) from public, anon, authenticated;
revoke all privileges on function public.recalculate_swayphics_invoice_balance(uuid) from public, anon, authenticated;
revoke all privileges on function public.sync_swayphics_project_payment_status(uuid) from public, anon, authenticated;

-- Trigger and event-trigger functions are not application RPCs. Their attached triggers continue to run.
revoke all privileges on function public.auto_swayphics_project_completion() from public, anon, authenticated, service_role;
revoke all privileges on function public.enforce_swayphics_payment_invoice_integrity() from public, anon, authenticated, service_role;
revoke all privileges on function public.notify_client_document() from public, anon, authenticated, service_role;
revoke all privileges on function public.notify_client_events() from public, anon, authenticated, service_role;
revoke all privileges on function public.notify_enquiry_created() from public, anon, authenticated, service_role;
revoke all privileges on function public.notify_followup_events() from public, anon, authenticated, service_role;
revoke all privileges on function public.notify_inbound_email() from public, anon, authenticated, service_role;
revoke all privileges on function public.notify_invoice_events() from public, anon, authenticated, service_role;
revoke all privileges on function public.notify_lead_assessment() from public, anon, authenticated, service_role;
revoke all privileges on function public.notify_lead_events() from public, anon, authenticated, service_role;
revoke all privileges on function public.notify_payment_events() from public, anon, authenticated, service_role;
revoke all privileges on function public.notify_portal_request() from public, anon, authenticated, service_role;
revoke all privileges on function public.notify_project_events() from public, anon, authenticated, service_role;
revoke all privileges on function public.notify_quote_events() from public, anon, authenticated, service_role;
revoke all privileges on function public.notify_social_post_events() from public, anon, authenticated, service_role;
revoke all privileges on function public.notify_task_events() from public, anon, authenticated, service_role;
revoke all privileges on function public.notify_team_member_created() from public, anon, authenticated, service_role;
revoke all privileges on function public.record_lead_stage_change() from public, anon, authenticated, service_role;
revoke all privileges on function public.set_swayphics_portal_token_expiry() from public, anon, authenticated, service_role;
revoke all privileges on function public.sync_swayphics_invoice_after_change() from public, anon, authenticated, service_role;
revoke all privileges on function public.sync_swayphics_lead_contact_from_communication() from public, anon, authenticated, service_role;
revoke all privileges on function public.sync_swayphics_payment_after_change() from public, anon, authenticated, service_role;
revoke all privileges on function public.rls_auto_enable() from public, anon, authenticated, service_role;

-- Move the implementation behind a non-exposed internal helper so the scheduler can use it
-- without exposing the privileged implementation to Data API roles.
create or replace function innerme_private.generate_admin_due_notifications_internal()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_count integer := 0;
    r record;
begin
    for r in
        select t.id, t.title, t.assigned_to, t.due_date
        from public.tasks t
        where t.status <> 'completed'
          and t.assigned_to is not null
          and t.due_date is not null
          and t.due_date <= current_date
    loop
        perform public.create_admin_notification(
            r.assigned_to, null,
            case when r.due_date < current_date then 'danger' else 'warning' end,
            'task.due',
            case when r.due_date < current_date then 'Task overdue' else 'Task due today' end,
            coalesce(r.title, 'Task') || ' · ' || to_char(r.due_date, 'DD Mon YYYY'),
            'task', r.id, 'tasks',
            'task-due:' || r.id::text || ':' || r.due_date::text
        );
        v_count := v_count + 1;
    end loop;

    for r in
        select f.id, f.lead_id, f.client_id, f.assigned_to, f.scheduled_for
        from public.follow_ups f
        where f.status = 'pending'
          and f.assigned_to is not null
          and f.scheduled_for <= current_date
    loop
        perform public.create_admin_notification(
            r.assigned_to, null,
            case when r.scheduled_for < current_date then 'danger' else 'warning' end,
            'followup.due',
            case when r.scheduled_for < current_date then 'Follow-up overdue' else 'Follow-up due today' end,
            'A scheduled follow-up needs attention.',
            'follow_up', r.id, 'followups',
            'followup-due:' || r.id::text || ':' || r.scheduled_for::text
        );
        v_count := v_count + 1;
    end loop;

    for r in
        select i.id, i.invoice_number, i.client_id, i.due_date, i.amount_outstanding
        from public.invoices i
        where coalesce(i.status,'') not in ('paid','cancelled')
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
            to_char(coalesce(r.amount_outstanding,0), 'FM999G999G990D00'),
            'invoice', r.id, 'invoices',
            'invoice-due:' || r.id::text || ':' || r.due_date::text,
            false
        );
        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$$;

revoke all privileges on function innerme_private.generate_admin_due_notifications_internal() from public, anon, authenticated, service_role;

-- The dashboard-facing wrapper explicitly requires an active admin.
create or replace function public.generate_admin_due_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null or not exists (
        select 1
        from public.admin_users au
        where au.user_id = auth.uid()
          and au.active = true
    ) then
        raise exception 'Swayphics admin access required.';
    end if;

    return innerme_private.generate_admin_due_notifications_internal();
end;
$$;

revoke all privileges on function public.generate_admin_due_notifications() from public, anon;
grant execute on function public.generate_admin_due_notifications() to authenticated;

-- The scheduled InnerMe notification routine uses the private implementation directly.
create or replace function public.generate_innerme_proactive_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_count integer := 0;
    r record;
begin
    v_count := v_count + coalesce(innerme_private.generate_admin_due_notifications_internal(), 0);

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
    v_count := v_count + coalesce(public.refresh_innerme_incident_intelligence(), 0);

    return v_count;
end;
$$;

-- This routine is scheduler/internal-only, not a client-facing RPC.
revoke all privileges on function public.generate_innerme_proactive_notifications() from public, anon, authenticated;

commit;
