-- SWAYPHICS ADMIN NOTIFICATIONS
-- Run once in Supabase SQL Editor after the admin workspace migrations.
-- Creates persistent, user-specific notifications and event triggers.

create table if not exists public.admin_notifications (
    id uuid primary key default gen_random_uuid(),
    recipient_id uuid not null references public.admin_users(user_id) on delete cascade,
    actor_id uuid references public.admin_users(user_id) on delete set null,
    type text not null default 'info'
        check (type in ('info','success','warning','danger')),
    event_type text not null,
    title text not null,
    message text not null default '',
    entity_type text,
    entity_id uuid,
    view text,
    dedupe_key text,
    is_read boolean not null default false,
    read_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists admin_notifications_recipient_idx
    on public.admin_notifications(recipient_id, created_at desc);

create index if not exists admin_notifications_unread_idx
    on public.admin_notifications(recipient_id, is_read, created_at desc);

create unique index if not exists admin_notifications_dedupe_idx
    on public.admin_notifications(recipient_id, dedupe_key)
    where dedupe_key is not null;

alter table public.admin_notifications enable row level security;

grant select, insert, update on table public.admin_notifications to authenticated;

drop policy if exists "Swayphics admins can read own notifications" on public.admin_notifications;
create policy "Swayphics admins can read own notifications"
on public.admin_notifications
for select to authenticated
using (
    recipient_id = auth.uid()
    and public.is_swayphics_admin()
);

drop policy if exists "Swayphics admins can update own notifications" on public.admin_notifications;
create policy "Swayphics admins can update own notifications"
on public.admin_notifications
for update to authenticated
using (
    recipient_id = auth.uid()
    and public.is_swayphics_admin()
)
with check (
    recipient_id = auth.uid()
    and public.is_swayphics_admin()
);

create or replace function public.create_admin_notification(
    p_recipient_id uuid,
    p_actor_id uuid,
    p_type text,
    p_event_type text,
    p_title text,
    p_message text,
    p_entity_type text default null,
    p_entity_id uuid default null,
    p_view text default null,
    p_dedupe_key text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_recipient_id is null then
        return;
    end if;

    if not exists (
        select 1
        from public.admin_users
        where user_id = p_recipient_id
          and active = true
    ) then
        return;
    end if;

    if p_actor_id is not null and p_recipient_id = p_actor_id then
        return;
    end if;

    insert into public.admin_notifications (
        recipient_id,
        actor_id,
        type,
        event_type,
        title,
        message,
        entity_type,
        entity_id,
        view,
        dedupe_key
    )
    values (
        p_recipient_id,
        p_actor_id,
        coalesce(p_type, 'info'),
        p_event_type,
        p_title,
        coalesce(p_message, ''),
        p_entity_type,
        p_entity_id,
        p_view,
        p_dedupe_key
    )
    on conflict (recipient_id, dedupe_key)
    where dedupe_key is not null
    do nothing;
end;
$$;

create or replace function public.notify_admins(
    p_actor_id uuid,
    p_type text,
    p_event_type text,
    p_title text,
    p_message text,
    p_entity_type text default null,
    p_entity_id uuid default null,
    p_view text default null,
    p_dedupe_key text default null,
    p_owner_only boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_admin public.admin_users%rowtype;
begin
    for v_admin in
        select *
        from public.admin_users
        where active = true
          and (
              not p_owner_only
              or role = 'owner'
          )
    loop
        perform public.create_admin_notification(
            v_admin.user_id,
            p_actor_id,
            p_type,
            p_event_type,
            p_title,
            p_message,
            p_entity_type,
            p_entity_id,
            p_view,
            case
                when p_dedupe_key is null then null
                else p_dedupe_key || ':' || v_admin.user_id::text
            end
        );
    end loop;
end;
$$;

-- Leads: assigned member receives new lead/assignment/stage-change alerts.
create or replace function public.notify_lead_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor uuid := auth.uid();
    v_recipient uuid;
begin
    if tg_op = 'INSERT' then
        if new.assigned_to is not null then
            perform public.create_admin_notification(
                new.assigned_to, v_actor, 'info', 'lead.created',
                'New lead assigned to you',
                coalesce(new.business_name, 'A new lead') ||
                case when new.contact_name is not null then ' · ' || new.contact_name else '' end,
                'lead', new.id, 'leads',
                'lead-created:' || new.id::text || ':' || new.assigned_to::text
            );
        else
            perform public.notify_admins(
                v_actor, 'info', 'lead.created',
                'New lead added',
                coalesce(new.business_name, 'A new lead') ||
                case when new.contact_name is not null then ' · ' || new.contact_name else '' end,
                'lead', new.id, 'leads',
                'lead-created:' || new.id::text,
                true
            );
        end if;
        return new;
    end if;

    if tg_op = 'UPDATE' then
        if new.assigned_to is distinct from old.assigned_to
           and new.assigned_to is not null then
            perform public.create_admin_notification(
                new.assigned_to, v_actor, 'info', 'lead.assigned',
                'Lead assigned to you',
                coalesce(new.business_name, 'Lead'),
                'lead', new.id, 'leads',
                'lead-assigned:' || new.id::text || ':' || new.assigned_to::text
            );
        end if;

        if new.status is distinct from old.status then
            v_recipient := coalesce(new.assigned_to, old.assigned_to);
            if v_recipient is not null then
                perform public.create_admin_notification(
                    v_recipient, v_actor,
                    case when new.status = 'won' then 'success' else 'info' end,
                    'lead.stage_changed',
                    'Lead stage updated',
                    coalesce(new.business_name, 'Lead') || ' → ' || new.status,
                    'lead', new.id, 'leads',
                    'lead-stage:' || new.id::text || ':' || new.status
                );
            end if;
        end if;
        return new;
    end if;

    return new;
end;
$$;

drop trigger if exists admin_notify_leads on public.leads;
create trigger admin_notify_leads
after insert or update of assigned_to, status
on public.leads
for each row execute function public.notify_lead_events();

-- Tasks: notify assignees, reassignment, completion and urgent/high-priority work.
create or replace function public.notify_task_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor uuid := auth.uid();
begin
    if tg_op = 'INSERT' and new.assigned_to is not null then
        perform public.create_admin_notification(
            new.assigned_to, v_actor,
            case when new.priority in ('urgent','high') then 'warning' else 'info' end,
            'task.created',
            'New task assigned to you',
            coalesce(new.title, 'New task') ||
            case when new.due_date is not null then ' · Due ' || to_char(new.due_date, 'DD Mon') else '' end,
            'task', new.id, 'tasks',
            'task-created:' || new.id::text || ':' || new.assigned_to::text
        );
    end if;

    if tg_op = 'UPDATE' then
        if new.assigned_to is distinct from old.assigned_to
           and new.assigned_to is not null then
            perform public.create_admin_notification(
                new.assigned_to, v_actor, 'info', 'task.assigned',
                'Task assigned to you',
                coalesce(new.title, 'Task'),
                'task', new.id, 'tasks',
                'task-assigned:' || new.id::text || ':' || new.assigned_to::text
            );
        end if;

        if new.status = 'completed' and old.status is distinct from new.status then
            perform public.notify_admins(
                v_actor, 'success', 'task.completed',
                'Task completed',
                coalesce(new.title, 'Task') || ' was marked complete.',
                'task', new.id, 'tasks',
                'task-completed:' || new.id::text,
                true
            );
        end if;
    end if;

    return new;
end;
$$;

drop trigger if exists admin_notify_tasks on public.tasks;
create trigger admin_notify_tasks
after insert or update of assigned_to, status
on public.tasks
for each row execute function public.notify_task_events();

-- Projects: assignment, completion and approaching delivery work.
create or replace function public.notify_project_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor uuid := auth.uid();
begin
    if tg_op = 'INSERT' and new.assigned_to is not null then
        perform public.create_admin_notification(
            new.assigned_to, v_actor, 'info', 'project.created',
            'New project assigned to you',
            coalesce(new.name, 'New project'),
            'project', new.id, 'projects',
            'project-created:' || new.id::text || ':' || new.assigned_to::text
        );
    end if;

    if tg_op = 'UPDATE' then
        if new.assigned_to is distinct from old.assigned_to
           and new.assigned_to is not null then
            perform public.create_admin_notification(
                new.assigned_to, v_actor, 'info', 'project.assigned',
                'Project assigned to you',
                coalesce(new.name, 'Project'),
                'project', new.id, 'projects',
                'project-assigned:' || new.id::text || ':' || new.assigned_to::text
            );
        end if;

        if new.status = 'completed' and old.status is distinct from new.status then
            perform public.notify_admins(
                v_actor, 'success', 'project.completed',
                'Project completed',
                coalesce(new.name, 'Project') || ' was completed.',
                'project', new.id, 'projects',
                'project-completed:' || new.id::text,
                true
            );
        end if;
    end if;

    return new;
end;
$$;

drop trigger if exists admin_notify_projects on public.client_projects;
create trigger admin_notify_projects
after insert or update of assigned_to, status
on public.client_projects
for each row execute function public.notify_project_events();

-- Website enquiries are shared sales alerts.
create or replace function public.notify_enquiry_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.notify_admins(
        auth.uid(), 'info', 'enquiry.created',
        'New website enquiry',
        coalesce(new.business_name, new.name, 'A website visitor') ||
        case when new.service is not null then ' · ' || new.service else '' end,
        'website_enquiry', new.id, 'enquiries',
        'enquiry-created:' || new.id::text,
        false
    );
    return new;
end;
$$;

drop trigger if exists admin_notify_enquiries on public.website_enquiries;
create trigger admin_notify_enquiries
after insert on public.website_enquiries
for each row execute function public.notify_enquiry_created();

-- Client portal requests go to the client's assigned team member, otherwise owners.
create or replace function public.notify_portal_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_assigned uuid;
begin
    select assigned_to into v_assigned
    from public.clients
    where id = new.client_id;

    if v_assigned is not null then
        perform public.create_admin_notification(
            v_assigned, auth.uid(), 'info', 'portal.request',
            'New client portal request',
            coalesce(new.subject, 'Client request'),
            'portal_request', new.id, 'portal-requests',
            'portal-request:' || new.id::text || ':' || v_assigned::text
        );
    else
        perform public.notify_admins(
            auth.uid(), 'info', 'portal.request',
            'New client portal request',
            coalesce(new.subject, 'Client request'),
            'portal_request', new.id, 'portal-requests',
            'portal-request:' || new.id::text,
            true
        );
    end if;
    return new;
end;
$$;

drop trigger if exists admin_notify_portal_requests on public.client_portal_requests;
create trigger admin_notify_portal_requests
after insert on public.client_portal_requests
for each row execute function public.notify_portal_request();

-- Payments: notify owners/assigned client manager when money is received.
create or replace function public.notify_payment_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_assigned uuid;
begin
    if new.status = 'paid'
       and (tg_op = 'INSERT' or old.status is distinct from new.status) then
        select assigned_to into v_assigned
        from public.clients
        where id = new.client_id;

        if v_assigned is not null then
            perform public.create_admin_notification(
                v_assigned, auth.uid(), 'success', 'payment.received',
                'Payment received',
                coalesce(new.reference, 'Client payment') || ' · R ' ||
                to_char(coalesce(new.amount,0), 'FM999G999G990D00'),
                'payment', new.id, 'payments',
                'payment-paid:' || new.id::text || ':' || v_assigned::text
            );
        else
            perform public.notify_admins(
                auth.uid(), 'success', 'payment.received',
                'Payment received',
                coalesce(new.reference, 'Client payment'),
                'payment', new.id, 'payments',
                'payment-paid:' || new.id::text,
                true
            );
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists admin_notify_payments on public.payments;
create trigger admin_notify_payments
after insert or update of status on public.payments
for each row execute function public.notify_payment_events();

-- Quotes: important status changes.
create or replace function public.notify_quote_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_assigned uuid;
begin
    if new.status is distinct from coalesce(old.status, '') then
        select assigned_to into v_assigned
        from public.clients
        where id = new.client_id;

        if new.status in ('accepted','rejected') then
            if v_assigned is not null then
                perform public.create_admin_notification(
                    v_assigned, auth.uid(), 
                    case when new.status = 'accepted' then 'success' else 'warning' end,
                    'quote.' || new.status,
                    case when new.status = 'accepted' then 'Quote accepted' else 'Quote rejected' end,
                    coalesce(new.quote_number, new.title, 'Quote'),
                    'quote', new.id, 'quotes',
                    'quote-status:' || new.id::text || ':' || new.status
                );
            else
                perform public.notify_admins(
                    auth.uid(),
                    case when new.status = 'accepted' then 'success' else 'warning' end,
                    'quote.' || new.status,
                    case when new.status = 'accepted' then 'Quote accepted' else 'Quote rejected' end,
                    coalesce(new.quote_number, new.title, 'Quote'),
                    'quote', new.id, 'quotes',
                    'quote-status:' || new.id::text || ':' || new.status,
                    true
                );
            end if;
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists admin_notify_quotes on public.quotes;
create trigger admin_notify_quotes
after update of status on public.quotes
for each row execute function public.notify_quote_events();

-- Incoming email: notify the assigned lead/client manager, otherwise owners.
create or replace function public.notify_inbound_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_recipient uuid;
begin
    if new.direction <> 'inbound' or new.is_read = true then
        return new;
    end if;

    if new.lead_id is not null then
        select assigned_to into v_recipient from public.leads where id = new.lead_id;
    elsif new.client_id is not null then
        select assigned_to into v_recipient from public.clients where id = new.client_id;
    end if;

    if v_recipient is not null then
        perform public.create_admin_notification(
            v_recipient, null, 'info', 'email.unread',
            'New unread email',
            coalesce(new.from_name, new.from_email, 'New email') ||
            case when new.subject is not null then ' · ' || new.subject else '' end,
            'email', new.id, 'email',
            'email-unread:' || new.id::text || ':' || v_recipient::text
        );
    else
        perform public.notify_admins(
            null, 'info', 'email.unread',
            'New unread email',
            coalesce(new.from_name, new.from_email, 'New email') ||
            case when new.subject is not null then ' · ' || new.subject else '' end,
            'email', new.id, 'email',
            'email-unread:' || new.id::text,
            false
        );
    end if;

    return new;
end;
$$;

drop trigger if exists admin_notify_inbound_email on public.email_messages;
create trigger admin_notify_inbound_email
after insert on public.email_messages
for each row execute function public.notify_inbound_email();

-- Team changes.
create or replace function public.notify_team_member_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.active = true then
        perform public.notify_admins(
            auth.uid(), 'info', 'team.member_added',
            'New team member added',
            coalesce(new.full_name, new.email, 'A team member') || ' joined the workspace.',
            'admin_user', new.user_id, 'team',
            'team-member:' || new.user_id::text,
            true
        );
    end if;
    return new;
end;
$$;

drop trigger if exists admin_notify_team_member on public.admin_users;
create trigger admin_notify_team_member
after insert on public.admin_users
for each row execute function public.notify_team_member_created();

-- Generate recurring operational reminders from the dashboard.
create or replace function public.generate_admin_due_notifications()
returns integer
language plpgsql
security definer
set search_path = public
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

grant execute on function public.generate_admin_due_notifications() to authenticated;

-- Enable realtime delivery for notification rows.
do $$
begin
    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'admin_notifications'
    ) then
        alter publication supabase_realtime add table public.admin_notifications;
    end if;
end
$$;

notify pgrst, 'reload schema';

-- Clients: assignment and creation.
create or replace function public.notify_client_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_op = 'INSERT' then
        if new.assigned_to is not null then
            perform public.create_admin_notification(
                new.assigned_to, auth.uid(), 'info', 'client.created',
                'New client assigned to you',
                coalesce(new.business_name, 'New client'),
                'client', new.id, 'clients',
                'client-created:' || new.id::text || ':' || new.assigned_to::text
            );
        else
            perform public.notify_admins(
                auth.uid(), 'info', 'client.created',
                'New client added',
                coalesce(new.business_name, 'New client'),
                'client', new.id, 'clients',
                'client-created:' || new.id::text,
                true
            );
        end if;
    elsif tg_op = 'UPDATE'
       and new.assigned_to is distinct from old.assigned_to
       and new.assigned_to is not null then
        perform public.create_admin_notification(
            new.assigned_to, auth.uid(), 'info', 'client.assigned',
            'Client assigned to you',
            coalesce(new.business_name, 'Client'),
            'client', new.id, 'clients',
            'client-assigned:' || new.id::text || ':' || new.assigned_to::text
        );
    end if;

    return new;
end;
$$;

drop trigger if exists admin_notify_clients on public.clients;
create trigger admin_notify_clients
after insert or update of assigned_to
on public.clients
for each row execute function public.notify_client_events();

-- Follow-ups: new assignment and reassignment.
create or replace function public.notify_followup_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_op = 'INSERT'
       and new.assigned_to is not null then
        perform public.create_admin_notification(
            new.assigned_to, auth.uid(), 'info', 'followup.created',
            'New follow-up assigned to you',
            coalesce(new.channel, 'Follow-up') ||
            case when new.scheduled_for is not null
                then ' · ' || to_char(new.scheduled_for, 'DD Mon')
                else '' end,
            'follow_up', new.id, 'followups',
            'followup-created:' || new.id::text || ':' || new.assigned_to::text
        );
    elsif tg_op = 'UPDATE'
       and new.assigned_to is distinct from old.assigned_to
       and new.assigned_to is not null then
        perform public.create_admin_notification(
            new.assigned_to, auth.uid(), 'info', 'followup.assigned',
            'Follow-up assigned to you',
            coalesce(new.channel, 'Follow-up') ||
            case when new.scheduled_for is not null
                then ' · ' || to_char(new.scheduled_for, 'DD Mon')
                else '' end,
            'follow_up', new.id, 'followups',
            'followup-assigned:' || new.id::text || ':' || new.assigned_to::text
        );
    end if;

    return new;
end;
$$;

drop trigger if exists admin_notify_followups on public.follow_ups;
create trigger admin_notify_followups
after insert or update of assigned_to
on public.follow_ups
for each row execute function public.notify_followup_events();

-- Invoices: important status transitions.
create or replace function public.notify_invoice_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_assigned uuid;
begin
    if new.status is distinct from coalesce(old.status, '') then
        select assigned_to into v_assigned
        from public.clients
        where id = new.client_id;

        if new.status in ('paid','overdue') then
            if v_assigned is not null then
                perform public.create_admin_notification(
                    v_assigned, auth.uid(),
                    case when new.status = 'paid' then 'success' else 'danger' end,
                    'invoice.' || new.status,
                    case when new.status = 'paid'
                        then 'Invoice paid'
                        else 'Invoice overdue' end,
                    coalesce(new.invoice_number, 'Invoice'),
                    'invoice', new.id, 'invoices',
                    'invoice-status:' || new.id::text || ':' || new.status
                );
            else
                perform public.notify_admins(
                    auth.uid(),
                    case when new.status = 'paid' then 'success' else 'danger' end,
                    'invoice.' || new.status,
                    case when new.status = 'paid'
                        then 'Invoice paid'
                        else 'Invoice overdue' end,
                    coalesce(new.invoice_number, 'Invoice'),
                    'invoice', new.id, 'invoices',
                    'invoice-status:' || new.id::text || ':' || new.status,
                    true
                );
            end if;
        end if;
    end if;

    return new;
end;
$$;

drop trigger if exists admin_notify_invoices on public.invoices;
create trigger admin_notify_invoices
after update of status
on public.invoices
for each row execute function public.notify_invoice_events();

-- Documents: notify the client manager when a new client/project document is uploaded.
create or replace function public.notify_client_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_assigned uuid;
begin
    select assigned_to into v_assigned
    from public.clients
    where id = new.client_id;

    if v_assigned is not null then
        perform public.create_admin_notification(
            v_assigned,
            coalesce(new.uploaded_by, auth.uid()),
            'info',
            'document.uploaded',
            'New client document',
            coalesce(new.file_name, 'A document') || ' was uploaded.',
            'document', new.id, 'documents',
            'document-uploaded:' || new.id::text || ':' || v_assigned::text
        );
    else
        perform public.notify_admins(
            coalesce(new.uploaded_by, auth.uid()),
            'info',
            'document.uploaded',
            'New client document',
            coalesce(new.file_name, 'A document') || ' was uploaded.',
            'document', new.id, 'documents',
            'document-uploaded:' || new.id::text,
            true
        );
    end if;

    return new;
end;
$$;

drop trigger if exists admin_notify_client_documents on public.client_documents;
create trigger admin_notify_client_documents
after insert on public.client_documents
for each row execute function public.notify_client_document();

-- Social publishing: surface failures immediately and successful publishing to the creator/owners.
create or replace function public.notify_social_post_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.status is distinct from coalesce(old.status, '')
       and new.status in ('published','failed') then
        if new.created_by is not null then
            perform public.create_admin_notification(
                new.created_by, auth.uid(),
                case when new.status = 'published' then 'success' else 'danger' end,
                'social.' || new.status,
                case when new.status = 'published'
                    then 'Social post published'
                    else 'Social post failed' end,
                coalesce(new.title, new.caption, 'Social post'),
                'social_post', new.id, 'content',
                'social-post:' || new.id::text || ':' || new.status
            );
        else
            perform public.notify_admins(
                auth.uid(),
                case when new.status = 'published' then 'success' else 'danger' end,
                'social.' || new.status,
                case when new.status = 'published'
                    then 'Social post published'
                    else 'Social post failed' end,
                coalesce(new.title, new.caption, 'Social post'),
                'social_post', new.id, 'content',
                'social-post:' || new.id::text || ':' || new.status,
                false
            );
        end if;
    end if;

    return new;
end;
$$;

drop trigger if exists admin_notify_social_posts on public.social_posts;
create trigger admin_notify_social_posts
after update of status
on public.social_posts
for each row execute function public.notify_social_post_events();

-- Lead assessments: alert the assigned member when someone else updates research/assessment data.
create or replace function public.notify_lead_assessment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.assessment_updated_at is distinct from old.assessment_updated_at
       and new.assessment_updated_by is not null
       and new.assigned_to is not null then
        perform public.create_admin_notification(
            new.assigned_to,
            new.assessment_updated_by,
            'info',
            'lead.assessment_updated',
            'Lead assessment updated',
            coalesce(new.business_name, 'Lead') || ' has new assessment information.',
            'lead', new.id, 'leads',
            'lead-assessment:' || new.id::text || ':' ||
            coalesce(new.assessment_updated_at::text, now()::text)
        );
    end if;

    return new;
end;
$$;

drop trigger if exists admin_notify_lead_assessment on public.leads;
create trigger admin_notify_lead_assessment
after update of assessment_updated_at, assessment_updated_by
on public.leads
for each row execute function public.notify_lead_assessment();

-- Quote status "sent" is also useful because it starts the client-response clock.
drop trigger if exists admin_notify_quotes on public.quotes;
create trigger admin_notify_quotes
after insert or update of status
on public.quotes
for each row execute function public.notify_quote_events();

-- Quote notification function: add sent status handling to the existing trigger.
create or replace function public.notify_quote_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_assigned uuid;
    v_title text;
begin
    if tg_op = 'INSERT' or new.status is distinct from coalesce(old.status, '') then
        select assigned_to into v_assigned
        from public.clients
        where id = new.client_id;

        v_title := case
            when new.status = 'sent' then 'Quote sent'
            when new.status = 'accepted' then 'Quote accepted'
            when new.status = 'rejected' then 'Quote rejected'
            else null
        end;

        if v_title is not null then
            if v_assigned is not null then
                perform public.create_admin_notification(
                    v_assigned, auth.uid(),
                    case
                        when new.status = 'accepted' then 'success'
                        when new.status = 'rejected' then 'warning'
                        else 'info'
                    end,
                    'quote.' || new.status,
                    v_title,
                    coalesce(new.quote_number, new.title, 'Quote'),
                    'quote', new.id, 'quotes',
                    'quote-status:' || new.id::text || ':' || new.status
                );
            else
                perform public.notify_admins(
                    auth.uid(),
                    case
                        when new.status = 'accepted' then 'success'
                        when new.status = 'rejected' then 'warning'
                        else 'info'
                    end,
                    'quote.' || new.status,
                    v_title,
                    coalesce(new.quote_number, new.title, 'Quote'),
                    'quote', new.id, 'quotes',
                    'quote-status:' || new.id::text || ':' || new.status,
                    true
                );
            end if;
        end if;
    end if;

    return new;
end;
$$;

notify pgrst, 'reload schema';
