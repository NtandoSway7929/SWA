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

-- Existing installations: add the placement field used by the public site.
alter table public.site_announcements
    add column if not exists placement text not null default 'top-bar';

alter table public.site_announcements
    drop constraint if exists site_announcements_placement_check;

alter table public.site_announcements
    add constraint site_announcements_placement_check
    check (placement in ('top-bar','hero','bottom'));

-- Grant Data API privileges for the authenticated workspace role.
-- RLS policies below still control which rows this role may access.
grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.admin_users to authenticated;
grant select, insert, update, delete on table public.clients to authenticated;
grant select, insert, update, delete on table public.leads to authenticated;
grant select, insert, update, delete on table public.client_projects to authenticated;
grant select, insert, update, delete on table public.tasks to authenticated;
grant select, insert, update, delete on table public.follow_ups to authenticated;
grant select, insert, update, delete on table public.quotes to authenticated;
grant select, insert, update, delete on table public.payments to authenticated;
grant select, insert, update, delete on table public.website_enquiries to authenticated;
grant select, insert, update, delete on table public.site_announcements to authenticated;
grant select on table public.site_announcements to anon;
grant select, insert, update, delete on table public.activity_log to authenticated;grant select, insert, update, delete on table public.communication_logs to authenticated;


-- The public contact form is handled by the submit-enquiry Edge Function.
-- It uses the server-side service_role key to insert enquiries without exposing
-- write access to the browser.
grant insert on table public.website_enquiries to service_role;

-- Existing public-facing tables also need SELECT privileges for browser reads.
grant select on table public.portfolio_projects to anon, authenticated;

grant select, insert, update, delete
on table public.testimonials
to authenticated;

grant select
on table public.testimonials
to anon;

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


drop policy if exists "Public can view published announcements" on public.site_announcements;
create policy "Public can view published announcements"
on public.site_announcements
for select
to anon
using (published = true);

drop policy if exists "Swayphics admins can manage announcements" on public.site_announcements;
create policy "Swayphics admins can manage announcements"
on public.site_announcements
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

drop policy if exists "Swayphics admins can manage communication logs" on public.communication_logs;
create policy "Swayphics admins can manage communication logs"
on public.communication_logs
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
