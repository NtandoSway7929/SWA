-- SWAYPHICS DELETE PERMISSIONS FIX
-- Run once in Supabase SQL Editor.
-- This aligns Data API grants and RLS policies with the dashboard's delete actions.

grant usage on schema public to authenticated;

grant select, insert, update, delete on table public.services to authenticated;
grant select, update on table public.invoice_settings to authenticated;
grant select, insert, update, delete on table public.invoices to authenticated;
grant select, insert, update, delete on table public.invoice_items to authenticated;
grant select, insert, update, delete on table public.communication_logs to authenticated;
grant select, insert, update, delete on table public.client_documents to authenticated;
grant select, insert, update, delete on table public.client_portal_requests to authenticated;
grant select, insert, update, delete on table public.lead_stage_history to authenticated;
grant select, insert, update, delete on table public.social_accounts to authenticated;
grant select, insert, update, delete on table public.social_posts to authenticated;
grant select, insert, update, delete on table public.social_metrics to authenticated;

drop policy if exists "Swayphics admins can manage invoices" on public.invoices;
create policy "Swayphics admins can manage invoices"
on public.invoices
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

drop policy if exists "Swayphics admins can manage invoice items" on public.invoice_items;
create policy "Swayphics admins can manage invoice items"
on public.invoice_items
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

drop policy if exists "Swayphics admins can manage client documents" on public.client_documents;
create policy "Swayphics admins can manage client documents"
on public.client_documents
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

drop policy if exists "Swayphics admins can manage portal requests" on public.client_portal_requests;
create policy "Swayphics admins can manage portal requests"
on public.client_portal_requests
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

drop policy if exists "Swayphics admins can manage lead stage history" on public.lead_stage_history;
create policy "Swayphics admins can manage lead stage history"
on public.lead_stage_history
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

drop policy if exists "Swayphics admins can manage social accounts" on public.social_accounts;
create policy "Swayphics admins can manage social accounts"
on public.social_accounts
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

drop policy if exists "Swayphics admins can manage social posts" on public.social_posts;
create policy "Swayphics admins can manage social posts"
on public.social_posts
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

drop policy if exists "Swayphics admins can manage social metrics" on public.social_metrics;
create policy "Swayphics admins can manage social metrics"
on public.social_metrics
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

drop policy if exists "Swayphics owners can delete services" on public.services;
create policy "Swayphics owners can delete services"
on public.services
for delete
to authenticated
using (public.is_swayphics_owner());

notify pgrst, 'reload schema';
