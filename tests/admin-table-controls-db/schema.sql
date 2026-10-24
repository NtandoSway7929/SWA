-- CI-only local Supabase schema contract for Admin Table Controls.
-- This is deliberately isolated under tests/ and is copied into a throwaway
-- local Supabase project by the CI workflow. Never apply it to a hosted project.
-- The admin/lead/task/follow-up columns, status checks, and admin RLS functions
-- mirror the current Swayphics Web schema metadata checked on 2026-10-23.

create extension if not exists pgcrypto;

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text,
  role text not null default 'team_member' check (role in ('owner', 'team_member')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.client_projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  name text not null,
  status text not null default 'planning'
    check (status in ('planning', 'in progress', 'review', 'completed', 'paused', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  contact_name text,
  email text,
  phone text,
  service_interest text,
  source text,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'interested', 'proposal sent', 'negotiating', 'follow-up', 'not interested', 'won', 'lost')),
  estimated_value numeric(12,2) default 0,
  assigned_to uuid references public.admin_users(user_id) on delete set null,
  next_follow_up date,
  notes text,
  business_assessment text,
  research_findings text,
  swayphics_solution text,
  recommended_services text,
  research_sources text,
    business_segment text not null default 'unknown'
        check (business_segment in ('unknown','professional_services','creative','beauty_wellness','food_hospitality','retail_ecommerce','events_entertainment','education','other')),
    website_need text not null default 'unknown'
        check (website_need in ('unknown','no_website','verified_improvement','no_clear_need')),
    contactability text not null default 'unknown'
        check (contactability in ('unknown','verified','invalid')),
    buying_signal text not null default 'unknown'
        check (buying_signal in ('unknown','present','absent')),
    qualification_priority text not null default 'unassessed'
        check (qualification_priority in ('unassessed','A','B','C')),
    qualification_evidence_url text,
    qualification_reviewed_at timestamptz,
    qualification_reviewed_by uuid references public.admin_users(user_id) on delete set null,
  assessment_updated_at timestamptz,
  assessment_updated_by uuid references public.admin_users(user_id) on delete set null,
  converted_client_id uuid references public.clients(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_contacted_at timestamptz,
  contacted_manually boolean not null default false,
  contacted_manually_at timestamptz,
  contacted_manually_by uuid references public.admin_users(user_id) on delete set null
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  assigned_to uuid references public.admin_users(user_id) on delete set null,
  client_id uuid references public.clients(id) on delete cascade,
  project_id uuid references public.client_projects(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'todo'
    check (status in ('todo', 'in progress', 'review', 'completed')),
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  assigned_to uuid references public.admin_users(user_id) on delete set null,
  scheduled_for date not null,
  channel text default 'WhatsApp'
    check (channel in ('WhatsApp', 'Phone', 'Email', 'Meeting', 'Other')),
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'skipped')),
  note text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint follow_up_contact_check check (lead_id is not null or client_id is not null)
);

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.admin_users(user_id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  created_at timestamptz not null default now()
);

create or replace function public.is_swayphics_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and exists (
       select 1 from public.admin_users
       where user_id = auth.uid() and active = true
     );
$$;

create or replace function public.is_swayphics_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and exists (
       select 1 from public.admin_users
       where user_id = auth.uid() and active = true and role = 'owner'
     );
$$;

revoke all on function public.is_swayphics_admin() from public;
revoke all on function public.is_swayphics_owner() from public;
grant execute on function public.is_swayphics_admin() to authenticated, service_role;
grant execute on function public.is_swayphics_owner() to authenticated, service_role;

alter table public.admin_users enable row level security;
alter table public.leads enable row level security;
alter table public.tasks enable row level security;
alter table public.follow_ups enable row level security;
alter table public.activity_log enable row level security;

create policy "Local test admins can view admin users"
on public.admin_users for select to authenticated
using (public.is_swayphics_admin());

create policy "Local test owners can create admin users"
on public.admin_users for insert to authenticated
with check (public.is_swayphics_owner());

create policy "Local test owners can update admin users"
on public.admin_users for update to authenticated
using (public.is_swayphics_owner())
with check (public.is_swayphics_owner());

create policy "Local test owners can delete admin users"
on public.admin_users for delete to authenticated
using (public.is_swayphics_owner());

create policy "Local test admins can manage leads"
on public.leads for all to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

create policy "Local test admins can manage tasks"
on public.tasks for all to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

create policy "Local test admins can manage follow ups"
on public.follow_ups for all to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

create policy "Local test admins can manage activity"
on public.activity_log for all to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete
on public.admin_users, public.leads, public.tasks, public.follow_ups, public.activity_log
to authenticated;
grant all privileges on all tables in schema public to service_role;
