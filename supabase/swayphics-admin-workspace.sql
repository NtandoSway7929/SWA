-- SWAYPHICS ADMIN WORKSPACE
-- Run once in Supabase SQL Editor.
-- Creates the operational layer around the existing portfolio/testimonial managers.

create extension if not exists pgcrypto;

create table if not exists public.admin_users (
    user_id uuid primary key references auth.users(id) on delete cascade,
    full_name text not null,
    email text,
    role text not null default 'team_member' check (role in ('owner','team_member')),
    active boolean not null default true,
    created_at timestamptz not null default now()
);

create table if not exists public.clients (
    id uuid primary key default gen_random_uuid(),
    business_name text not null,
    contact_name text,
    email text,
    phone text,
    status text not null default 'active' check (status in ('active','archived')),
    assigned_to uuid references public.admin_users(user_id) on delete set null,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.leads (
    id uuid primary key default gen_random_uuid(),
    business_name text not null,
    contact_name text,
    email text,
    phone text,
    service_interest text,
    source text,
    status text not null default 'new' check (status in ('new','contacted','interested','proposal sent','negotiating','won','lost')),
    estimated_value numeric(12,2) default 0,
    assigned_to uuid references public.admin_users(user_id) on delete set null,
    next_follow_up date,
    notes text,
    converted_client_id uuid references public.clients(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.client_projects (
    id uuid primary key default gen_random_uuid(),
    client_id uuid references public.clients(id) on delete cascade,
    name text not null,
    service text,
    description text,
    status text not null default 'planning' check (status in ('planning','in progress','review','completed','paused','cancelled')),
    value numeric(12,2) default 0,
    due_date date,
    assigned_to uuid references public.admin_users(user_id) on delete set null,
    payment_status text not null default 'not invoiced' check (payment_status in ('not invoiced','invoice sent','partially paid','paid','overdue')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    description text,
    assigned_to uuid references public.admin_users(user_id) on delete set null,
    client_id uuid references public.clients(id) on delete cascade,
    project_id uuid references public.client_projects(id) on delete cascade,
    lead_id uuid references public.leads(id) on delete set null,
    priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
    status text not null default 'todo' check (status in ('todo','in progress','review','completed')),
    due_date date,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.follow_ups (
    id uuid primary key default gen_random_uuid(),
    lead_id uuid references public.leads(id) on delete cascade,
    client_id uuid references public.clients(id) on delete cascade,
    assigned_to uuid references public.admin_users(user_id) on delete set null,
    scheduled_for date not null,
    channel text default 'WhatsApp' check (channel in ('WhatsApp','Phone','Email','Meeting','Other')),
    status text not null default 'pending' check (status in ('pending','completed','skipped')),
    note text,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    constraint follow_up_contact_check check (lead_id is not null or client_id is not null)
);

create table if not exists public.quotes (
    id uuid primary key default gen_random_uuid(),
    quote_number text,
    title text not null,
    lead_id uuid references public.leads(id) on delete set null,
    client_id uuid references public.clients(id) on delete set null,
    amount numeric(12,2) not null default 0,
    status text not null default 'draft' check (status in ('draft','sent','accepted','rejected','expired')),
    valid_until date,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.payments (
    id uuid primary key default gen_random_uuid(),
    client_id uuid references public.clients(id) on delete cascade,
    project_id uuid references public.client_projects(id) on delete set null,
    amount numeric(12,2) not null default 0,
    status text not null default 'due' check (status in ('due','partially paid','paid','overdue')),
    method text check (method in ('EFT','Cash','Card','PayFast','Other')),
    reference text,
    due_date date,
    paid_at date,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.website_enquiries (
    id uuid primary key default gen_random_uuid(),
    name text,
    business_name text,
    email text,
    phone text,
    service text,
    message text,
    status text not null default 'new' check (status in ('new','contacted','converted','closed')),
    created_at timestamptz not null default now()
);

create table if not exists public.site_announcements (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    message text,
    placement text not null default 'top-bar'
        check (placement in ('top-bar','hero','bottom')),
    published boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.communication_logs (
    id uuid primary key default gen_random_uuid(),
    client_id uuid references public.clients(id) on delete cascade,
    lead_id uuid references public.leads(id) on delete cascade,
    channel text not null default 'WhatsApp'
        check (channel in ('Email','WhatsApp','Phone','Meeting','SMS','Other')),
    direction text not null default 'outbound'
        check (direction in ('inbound','outbound')),
    subject text,
    message text not null,
    contacted_at timestamptz not null default now(),
    created_by uuid references public.admin_users(user_id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint communication_logs_contact_check
        check (client_id is not null or lead_id is not null)
);

create table if not exists public.activity_log (
    id uuid primary key default gen_random_uuid(),
    actor_id uuid references public.admin_users(user_id) on delete set null,
    action text not null,
    entity_type text,
    entity_id uuid,
    created_at timestamptz not null default now()
);

create index if not exists leads_status_idx on public.leads(status);
create index if not exists leads_followup_idx on public.leads(next_follow_up);
create index if not exists tasks_assignee_idx on public.tasks(assigned_to);
create index if not exists tasks_due_idx on public.tasks(due_date);
create index if not exists followups_scheduled_idx on public.follow_ups(scheduled_for);
create index if not exists projects_assignee_idx on public.client_projects(assigned_to);
create index if not exists enquiries_status_idx on public.website_enquiries(status);
create index if not exists activity_created_idx on public.activity_log(created_at desc);
create index if not exists communication_logs_client_idx on public.communication_logs(client_id, contacted_at desc);
create index if not exists communication_logs_lead_idx on public.communication_logs(lead_id, contacted_at desc);
create index if not exists communication_logs_contacted_idx on public.communication_logs(contacted_at desc);

alter table public.admin_users enable row level security;
alter table public.clients enable row level security;
alter table public.leads enable row level security;
alter table public.client_projects enable row level security;
alter table public.tasks enable row level security;
alter table public.follow_ups enable row level security;
alter table public.quotes enable row level security;
alter table public.payments enable row level security;
alter table public.website_enquiries enable row level security;
alter table public.site_announcements enable row level security;
alter table public.activity_log enable row level security;
alter table public.communication_logs enable row level security;

drop policy if exists "Swayphics admins can manage admin users" on public.admin_users;
create policy "Swayphics admins can manage admin users"
on public.admin_users for all to authenticated
using (
    exists (
        select 1 from public.admin_users me
        where me.user_id = auth.uid() and me.active = true
    )
)
with check (
    exists (
        select 1 from public.admin_users me
        where me.user_id = auth.uid() and me.active = true
    )
);

drop policy if exists "Swayphics admins can manage clients" on public.clients;
create policy "Swayphics admins can manage clients"
on public.clients for all to authenticated
using (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true))
with check (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true));

drop policy if exists "Swayphics admins can manage leads" on public.leads;
create policy "Swayphics admins can manage leads"
on public.leads for all to authenticated
using (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true))
with check (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true));

drop policy if exists "Swayphics admins can manage projects" on public.client_projects;
create policy "Swayphics admins can manage projects"
on public.client_projects for all to authenticated
using (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true))
with check (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true));

drop policy if exists "Swayphics admins can manage tasks" on public.tasks;
create policy "Swayphics admins can manage tasks"
on public.tasks for all to authenticated
using (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true))
with check (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true));

drop policy if exists "Swayphics admins can manage follow ups" on public.follow_ups;
create policy "Swayphics admins can manage follow ups"
on public.follow_ups for all to authenticated
using (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true))
with check (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true));

drop policy if exists "Swayphics admins can manage quotes" on public.quotes;
create policy "Swayphics admins can manage quotes"
on public.quotes for all to authenticated
using (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true))
with check (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true));

drop policy if exists "Swayphics admins can manage payments" on public.payments;
create policy "Swayphics admins can manage payments"
on public.payments for all to authenticated
using (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true))
with check (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true));

drop policy if exists "Swayphics admins can manage enquiries" on public.website_enquiries;
create policy "Swayphics admins can manage enquiries"
on public.website_enquiries for all to authenticated
using (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true))
with check (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true));

drop policy if exists "Swayphics admins can manage announcements" on public.site_announcements;
create policy "Swayphics admins can manage announcements"
on public.site_announcements for all to authenticated
using (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true))
with check (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true));

drop policy if exists "Swayphics admins can manage communication logs" on public.communication_logs;
create policy "Swayphics admins can manage communication logs"
on public.communication_logs for all to authenticated
using (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true))
with check (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true));

drop policy if exists "Swayphics admins can manage activity" on public.activity_log;
create policy "Swayphics admins can manage activity"
on public.activity_log for all to authenticated
using (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true))
with check (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true));

-- Seed the currently known owner. The UUID is the existing owner from the
-- portfolio RLS policy. Run this statement only if that Auth user still exists.
insert into public.admin_users (user_id, full_name, role, active)
values ('c3fc6ca5-8785-4948-88a7-a208652cf9a0', 'Swayphics Owner', 'owner', true)
on conflict (user_id) do update
set role = 'owner', active = true;

-- IMPORTANT:
-- Add the second team member after confirming their Auth UUID:
--
-- insert into public.admin_users (user_id, full_name, email, role)
-- values ('NEW-USER-UUID', 'Team Member Name', 'email@example.com', 'team_member');
