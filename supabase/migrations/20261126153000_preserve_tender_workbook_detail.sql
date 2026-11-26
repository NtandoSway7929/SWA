-- Preserve the full prospect workbook and its row-level procurement evidence.
alter table public.lead_campaign_prospects
  add column if not exists contact_person text,
  add column if not exists contact_source text,
  add column if not exists website_audit_problem text,
  add column if not exists website_audit_evidence text,
  add column if not exists website_recommended_improvement text,
  add column if not exists website_commercial_opportunity text,
  add column if not exists website_audit_priority text,
  add column if not exists website_audit_score integer,
  add column if not exists commercial_intelligence_assessment text,
  add column if not exists score_breakdown text,
  add column if not exists recommended_outreach_approach text;

create table if not exists public.lead_campaign_tender_evidence (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.lead_campaigns(id) on delete cascade,
  prospect_id uuid not null references public.lead_campaign_prospects(id) on delete cascade,
  source_prospect_id text not null,
  tender_record_id text not null,
  company_name text,
  tender_reference text,
  procuring_institution text,
  tender_description text,
  award_value text,
  award_date text,
  procurement_role text,
  company_award_count integer,
  evidence_url text,
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_campaign_tender_evidence_unique unique (campaign_id, tender_record_id),
  constraint lead_campaign_tender_evidence_award_count check (company_award_count is null or company_award_count >= 0)
);

create index if not exists lead_campaign_tender_evidence_prospect_idx
  on public.lead_campaign_tender_evidence (prospect_id, tender_reference);
create index if not exists lead_campaign_tender_evidence_campaign_role_idx
  on public.lead_campaign_tender_evidence (campaign_id, procurement_role);

alter table public.lead_campaign_tender_evidence enable row level security;
revoke all on table public.lead_campaign_tender_evidence from anon, authenticated;
grant select, insert, update, delete on table public.lead_campaign_tender_evidence to authenticated;

drop policy if exists "Active Swayphics admins manage campaign tender evidence" on public.lead_campaign_tender_evidence;
create policy "Active Swayphics admins manage campaign tender evidence"
  on public.lead_campaign_tender_evidence
  for all
  to authenticated
  using ((select public.is_swayphics_admin()))
  with check ((select public.is_swayphics_admin()));
