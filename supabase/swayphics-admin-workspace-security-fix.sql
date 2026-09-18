-- SWAYPHICS ADMIN WORKSPACE SECURITY FIX
-- Run after swayphics-admin-workspace.sql.
-- Replaces recursive admin_users RLS with SECURITY DEFINER helper functions
-- and connects portfolio/testimonial administration to the admin allowlist.

create or replace function public.is_swayphics_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.admin_users
        where user_id = auth.uid()
          and active = true
    );
$$;

create or replace function public.is_swayphics_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.admin_users
        where user_id = auth.uid()
          and active = true
          and role = 'owner'
    );
$$;

revoke all on function public.is_swayphics_admin() from public;
revoke all on function public.is_swayphics_owner() from public;

grant execute on function public.is_swayphics_admin() to authenticated;
grant execute on function public.is_swayphics_owner() to authenticated;

alter table public.admin_users enable row level security;

drop policy if exists "Swayphics admins can manage admin users" on public.admin_users;
drop policy if exists "Swayphics admins can view admin users" on public.admin_users;
drop policy if exists "Swayphics owners can create admin users" on public.admin_users;
drop policy if exists "Swayphics owners can update admin users" on public.admin_users;
drop policy if exists "Swayphics owners can delete admin users" on public.admin_users;

create policy "Swayphics admins can view admin users"
on public.admin_users
for select
to authenticated
using (public.is_swayphics_admin());

create policy "Swayphics owners can create admin users"
on public.admin_users
for insert
to authenticated
with check (public.is_swayphics_owner());

create policy "Swayphics owners can update admin users"
on public.admin_users
for update
to authenticated
using (public.is_swayphics_owner())
with check (public.is_swayphics_owner());

create policy "Swayphics owners can delete admin users"
on public.admin_users
for delete
to authenticated
using (public.is_swayphics_owner());

drop policy if exists "Swayphics admins can manage clients" on public.clients;
create policy "Swayphics admins can manage clients"
on public.clients
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

drop policy if exists "Swayphics admins can manage leads" on public.leads;
create policy "Swayphics admins can manage leads"
on public.leads
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

drop policy if exists "Swayphics admins can manage projects" on public.client_projects;
create policy "Swayphics admins can manage projects"
on public.client_projects
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

drop policy if exists "Swayphics admins can manage tasks" on public.tasks;
create policy "Swayphics admins can manage tasks"
on public.tasks
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

drop policy if exists "Swayphics admins can manage follow ups" on public.follow_ups;
create policy "Swayphics admins can manage follow ups"
on public.follow_ups
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

drop policy if exists "Swayphics admins can manage quotes" on public.quotes;
create policy "Swayphics admins can manage quotes"
on public.quotes
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

drop policy if exists "Swayphics admins can manage payments" on public.payments;
create policy "Swayphics admins can manage payments"
on public.payments
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

drop policy if exists "Swayphics admins can manage enquiries" on public.website_enquiries;
create policy "Swayphics admins can manage enquiries"
on public.website_enquiries
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

drop policy if exists "Swayphics admins can manage announcements" on public.site_announcements;
create policy "Swayphics admins can manage announcements"
on public.site_announcements
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

drop policy if exists "Swayphics admins can manage activity" on public.activity_log;
create policy "Swayphics admins can manage activity"
on public.activity_log
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

-- Portfolio: allow every active Swayphics admin to manage projects.
drop policy if exists "Admin can manage portfolio projects" on public.portfolio_projects;
drop policy if exists "Admins can manage portfolio projects" on public.portfolio_projects;
drop policy if exists "Swayphics admins can manage portfolio projects" on public.portfolio_projects;

create policy "Swayphics admins can manage portfolio projects"
on public.portfolio_projects
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

-- Testimonials: keep the existing public-read policy and give active admins
-- management access without hard-coding one user UUID.
drop policy if exists "Swayphics admins can manage testimonials" on public.testimonials;

create policy "Swayphics admins can manage testimonials"
on public.testimonials
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());
