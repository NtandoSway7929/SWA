-- Dedicated, admin-only prospecting workspace for the Tender & Corporate Groups campaign.
-- Campaign prospects remain separate from the general CRM leads table until qualified.
-- This avoids creating 59 unqualified CRM leads, triggering 59 lead notifications,
-- and assigning automatic follow-up dates before outreach is lawful or appropriate.

create table if not exists public.lead_campaigns (
    id uuid primary key default gen_random_uuid(),
    campaign_key text not null unique,
    name text not null,
    description text,
    status text not null default 'active'
        check (status in ('draft', 'active', 'paused', 'completed', 'archived')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint lead_campaigns_key_nonempty check (length(btrim(campaign_key)) between 1 and 100),
    constraint lead_campaigns_name_nonempty check (length(btrim(name)) between 1 and 160)
);

create table if not exists public.lead_campaign_prospects (
    id uuid primary key default gen_random_uuid(),
    campaign_id uuid not null references public.lead_campaigns(id) on delete cascade,
    lead_id uuid references public.leads(id) on delete set null,
    source_prospect_id text not null,
    business_name text not null,
    registered_company_name text,
    business_category text,
    industry text,
    province text,
    city text,
    registration_number text,
    website_url text,
    website_status text,
    website_issues text,
    affected_urls text,
    email text,
    additional_email text,
    phone text,
    whatsapp text,
    physical_address text,
    linkedin_url text,
    facebook_url text,
    other_social text,
    tender_participation_evidence text,
    tender_award_history text,
    tender_reference text,
    procuring_entity text,
    tender_award_value text,
    tender_award_date text,
    verified_award_count integer,
    tender_dependence_evidence text,
    subsidiaries text,
    company_scale text,
    digital_opportunity text,
    recommended_services text,
    original_priority text,
    original_score integer,
    outreach_angle text,
    research_notes text,
    source_urls text,
    contact_verification_status text,
    last_verified_at date,
    audit_status text,
    audit_notes text,
    audit_evidence_urls text,
    audit_outreach_disposition text,
    audit_date date,
    qualification_status text not null default 'research_required'
        check (qualification_status in ('research_required', 'qualified', 'disqualified')),
    stage text not null default 'research_required'
        check (stage in (
            'research_required', 'verified', 'consent_requested', 'consent_granted',
            'outreach_ready', 'engaged', 'preview_shared', 'proposal_sent',
            'negotiating', 'won', 'lost', 'nurture', 'do_not_contact'
        )),
    email_consent_status text not null default 'not_requested'
        check (email_consent_status in ('not_requested', 'requested', 'granted', 'declined', 'revoked')),
    email_consent_requested_at timestamptz,
    email_consent_granted_at timestamptz,
    email_consent_channel text,
    email_consent_evidence text,
    do_not_contact boolean not null default false,
    do_not_contact_reason text,
    last_outreach_at timestamptz,
    next_action text,
    next_action_date date,
    research_snapshot jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint lead_campaign_prospects_source_key_unique unique (campaign_id, source_prospect_id),
    constraint lead_campaign_prospects_score_range check (original_score is null or original_score between 0 and 100),
    constraint lead_campaign_prospects_award_count_nonnegative check (verified_award_count is null or verified_award_count >= 0),
    constraint lead_campaign_prospects_name_nonempty check (length(btrim(business_name)) between 1 and 240),
    constraint lead_campaign_prospects_no_contact_after_optout check (
        not do_not_contact or stage = 'do_not_contact'
    )
);

create unique index if not exists lead_campaign_prospects_campaign_lead_uidx
    on public.lead_campaign_prospects (campaign_id, lead_id)
    where lead_id is not null;

create index if not exists lead_campaign_prospects_campaign_stage_idx
    on public.lead_campaign_prospects (campaign_id, stage, business_name);

create index if not exists lead_campaign_prospects_campaign_province_idx
    on public.lead_campaign_prospects (campaign_id, province);

create index if not exists lead_campaign_prospects_campaign_industry_idx
    on public.lead_campaign_prospects (campaign_id, industry);

create index if not exists lead_campaign_prospects_campaign_email_consent_idx
    on public.lead_campaign_prospects (campaign_id, email_consent_status);

alter table public.lead_campaigns enable row level security;
alter table public.lead_campaign_prospects enable row level security;

revoke all on table public.lead_campaigns from anon, authenticated;
revoke all on table public.lead_campaign_prospects from anon, authenticated;
grant select, insert, update, delete on table public.lead_campaigns to authenticated;
grant select, insert, update, delete on table public.lead_campaign_prospects to authenticated;

drop policy if exists "Active Swayphics admins manage lead campaigns" on public.lead_campaigns;
create policy "Active Swayphics admins manage lead campaigns"
    on public.lead_campaigns
    for all
    to authenticated
    using ((select public.is_swayphics_admin()))
    with check ((select public.is_swayphics_admin()));

drop policy if exists "Active Swayphics admins manage campaign prospects" on public.lead_campaign_prospects;
create policy "Active Swayphics admins manage campaign prospects"
    on public.lead_campaign_prospects
    for all
    to authenticated
    using ((select public.is_swayphics_admin()))
    with check ((select public.is_swayphics_admin()));

insert into public.lead_campaigns (campaign_key, name, description, status)
values (
    'tender-corporate-groups-2026',
    'Tender & Corporate Groups',
    'South African holding companies and multi-company groups identified through tender and digital-presence research. Email-first campaign; marketing contact is gated by recorded consent.',
    'active'
)
on conflict (campaign_key) do update
set
    name = excluded.name,
    description = excluded.description,
    status = excluded.status,
    updated_at = now();
