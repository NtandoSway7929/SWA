-- SWAYPHICS SALES QUALIFICATION
-- Forward-only, idempotent migration. Apply only after swayphics-admin-workspace.sql
-- has created public.leads and public.admin_users. Do not apply as part of this PR.
-- Existing records receive explicit unknown/unassessed values; missing evidence is
-- never inferred as a negative fact.

alter table public.leads
    add column if not exists business_segment text not null default 'unknown'
        check (business_segment in ('unknown','professional_services','creative','beauty_wellness','food_hospitality','retail_ecommerce','events_entertainment','education','other')),
    add column if not exists website_need text not null default 'unknown'
        check (website_need in ('unknown','no_website','verified_improvement','no_clear_need')),
    add column if not exists contactability text not null default 'unknown'
        check (contactability in ('unknown','verified','invalid')),
    add column if not exists buying_signal text not null default 'unknown'
        check (buying_signal in ('unknown','present','absent')),
    add column if not exists qualification_priority text not null default 'unassessed'
        check (qualification_priority in ('unassessed','A','B','C')),
    add column if not exists qualification_evidence_url text,
    add column if not exists qualification_reviewed_at timestamptz,
    add column if not exists qualification_reviewed_by uuid
        references public.admin_users(user_id) on delete set null;

comment on column public.leads.source is
    'Original acquisition source/channel only; not campaign membership, spend, or outreach history.';
comment on column public.leads.qualification_priority is
    'Human-set qualification band (A/B/C) based on documented evidence, not an automated score.';
comment on column public.leads.qualification_evidence_url is
    'Primary public URL that supports the qualification decision; verify the actual observation before outreach.';

notify pgrst, 'reload schema';
