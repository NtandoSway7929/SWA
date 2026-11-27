create table public.business_assessment_inspections (
    id uuid primary key default gen_random_uuid(),
    assessment_id uuid not null
        references public.business_assessments(id) on delete cascade,
    inspection_version text not null
        check (length(btrim(inspection_version)) between 1 and 64),
    status text not null default 'queued'
        check (status in ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled')),
    requested_sources jsonb not null default '[]'::jsonb,
    idempotency_key uuid not null,
    requested_by uuid references auth.users(id) on delete set null,
    consent_version text not null
        check (length(btrim(consent_version)) between 1 and 64),
    provider text not null default 'tinyfish'
        check (provider in ('tinyfish')),
    provider_agreement_reference text not null
        constraint business_assessment_inspections_agreement_reference_nonblank
        check (length(btrim(provider_agreement_reference)) between 1 and 128),
    provider_request_id text,
    failure_code text,
    failure_summary text,
    queued_at timestamptz not null default now(),
    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint business_assessment_inspections_sources_array
        check (jsonb_typeof(requested_sources) = 'array'),
    constraint business_assessment_inspections_idempotency_unique
        unique (assessment_id, idempotency_key)
);

create index business_assessment_inspections_assessment_created_idx
    on public.business_assessment_inspections (assessment_id, created_at desc);
create index business_assessment_inspections_status_created_idx
    on public.business_assessment_inspections (status, created_at);
create index business_assessment_inspections_admin_created_idx
    on public.business_assessment_inspections (requested_by, created_at desc)
    where requested_by is not null;

create unique index business_assessment_inspections_one_active_idx
    on public.business_assessment_inspections (assessment_id)
    where status in ('queued', 'running');

create table public.business_assessment_evidence (
    id uuid primary key default gen_random_uuid(),
    inspection_id uuid not null
        references public.business_assessment_inspections(id) on delete cascade,
    source_type text not null
        check (source_type in ('website', 'google_business_profile', 'social_profile')),
    source_status text not null
        check (source_status in (
            'candidate_found', 'needs_admin_review', 'observed', 'not_found_in_search',
            'unverifiable', 'blocked', 'unreachable', 'timeout', 'fetch_error'
        )),
    platform text,
    requested_url text,
    source_url text,
    final_url text,
    source_title text,
    observations jsonb not null default '{}'::jsonb,
    evidence_excerpt text,
    identity_match_status text not null default 'not_checked'
        check (identity_match_status in ('confirmed', 'ambiguous', 'rejected', 'not_checked')),
    identity_match_basis jsonb not null default '[]'::jsonb,
    provider_error_code text,
    upstream_status integer,
    provider_request_id text,
    content_sha256 text
        check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'),
    observed_at timestamptz,
    created_at timestamptz not null default now(),
    constraint business_assessment_evidence_observations_object
        check (jsonb_typeof(observations) = 'object'),
    constraint business_assessment_evidence_match_basis_array
        check (jsonb_typeof(identity_match_basis) = 'array'),
    constraint business_assessment_evidence_excerpt_length
        check (evidence_excerpt is null or char_length(evidence_excerpt) <= 500)
);

create index business_assessment_evidence_inspection_created_idx
    on public.business_assessment_evidence (inspection_id, created_at);
create index business_assessment_evidence_type_status_idx
    on public.business_assessment_evidence (source_type, source_status);

alter table public.business_assessment_inspections enable row level security;
revoke all on table public.business_assessment_inspections from public, anon, authenticated;
grant select on table public.business_assessment_inspections to authenticated;
grant all on table public.business_assessment_inspections to service_role;

create policy "Swayphics admins can view business assessment inspections"
    on public.business_assessment_inspections
    for select
    to authenticated
    using (public.is_swayphics_admin());

alter table public.business_assessment_evidence enable row level security;
revoke all on table public.business_assessment_evidence from public, anon, authenticated;
grant select on table public.business_assessment_evidence to authenticated;
grant all on table public.business_assessment_evidence to service_role;

create policy "Swayphics admins can view business assessment evidence"
    on public.business_assessment_evidence
    for select
    to authenticated
    using (
        exists (
            select 1
            from public.business_assessment_inspections as inspection
            where inspection.id = inspection_id
              and public.is_swayphics_admin()
        )
    );

comment on table public.business_assessment_inspections is
    'Private, versioned independent public-presence inspection runs linked to Business Opportunity Finder assessments.';
comment on table public.business_assessment_evidence is
    'Source-specific, bounded evidence captured during an independent Business Opportunity Finder inspection.';
