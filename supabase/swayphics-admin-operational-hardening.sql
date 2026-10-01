-- Swayphics admin operational workspace hardening
-- Safe to run repeatedly on the existing production schema.

create index if not exists communication_logs_lead_idx on public.communication_logs(lead_id);
create index if not exists communication_logs_client_idx on public.communication_logs(client_id);
create index if not exists communication_logs_created_at_idx on public.communication_logs(created_at desc);
create index if not exists email_messages_lead_idx on public.email_messages(lead_id);
create index if not exists email_messages_client_idx on public.email_messages(client_id);
create index if not exists follow_ups_lead_idx on public.follow_ups(lead_id);
create index if not exists follow_ups_client_idx on public.follow_ups(client_id);
create index if not exists follow_ups_assigned_to_idx on public.follow_ups(assigned_to);
create index if not exists follow_ups_scheduled_status_idx on public.follow_ups(scheduled_for,status);
create index if not exists client_documents_client_idx on public.client_documents(client_id);
create index if not exists client_documents_project_idx on public.client_documents(project_id);
create index if not exists admin_notifications_recipient_created_idx on public.admin_notifications(recipient_id,created_at desc);
create index if not exists admin_notifications_unread_idx on public.admin_notifications(recipient_id,is_read,created_at desc);
create index if not exists lead_proposals_lead_created_idx on public.lead_proposals(lead_id,created_at desc);
create index if not exists lead_stage_history_lead_changed_idx on public.lead_stage_history(lead_id,changed_at desc);
create index if not exists leads_assigned_to_idx on public.leads(assigned_to);
create index if not exists leads_converted_client_idx on public.leads(converted_client_id);
create index if not exists leads_followup_status_idx on public.leads(next_follow_up,status);
create index if not exists client_portal_requests_client_status_idx on public.client_portal_requests(client_id,status,created_at desc);

drop policy if exists "Swayphics admins can manage lead proposals" on public.lead_proposals;
create policy "Swayphics admins can manage lead proposals"
on public.lead_proposals
for all
to authenticated
using ((select public.is_swayphics_admin()))
with check ((select public.is_swayphics_admin()));
