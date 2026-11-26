-- Business Opportunity Finder independent public-presence evidence storage.
-- Run after the inspection migration in the disposable local Supabase database.
begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(26);

select extensions.has_table(
    'public',
    'business_assessment_inspections',
    'inspection run table exists'
);
select extensions.has_table(
    'public',
    'business_assessment_evidence',
    'inspection evidence table exists'
);

select extensions.ok(
    (select relrowsecurity from pg_class where oid='public.business_assessment_inspections'::regclass),
    'inspection runs have row-level security enabled'
);
select extensions.ok(
    (select relrowsecurity from pg_class where oid='public.business_assessment_evidence'::regclass),
    'inspection evidence has row-level security enabled'
);

select extensions.ok(
    has_table_privilege('authenticated', 'public.business_assessment_inspections', 'SELECT'),
    'authenticated users have SELECT privilege so the admin RLS policy can be applied'
);
select extensions.ok(
    not has_table_privilege('authenticated', 'public.business_assessment_inspections', 'INSERT'),
    'authenticated users cannot insert inspection runs directly'
);
select extensions.ok(
    not has_table_privilege('authenticated', 'public.business_assessment_inspections', 'UPDATE'),
    'authenticated users cannot update inspection runs directly'
);
select extensions.ok(
    not has_table_privilege('authenticated', 'public.business_assessment_inspections', 'DELETE'),
    'authenticated users cannot delete inspection runs directly'
);
select extensions.ok(
    not has_table_privilege('anon', 'public.business_assessment_inspections', 'SELECT'),
    'anonymous users cannot read inspection runs'
);
select extensions.ok(
    has_table_privilege('service_role', 'public.business_assessment_inspections', 'INSERT'),
    'service role can create inspection runs'
);
select extensions.ok(
    has_table_privilege('service_role', 'public.business_assessment_inspections', 'UPDATE')
    and has_table_privilege('service_role', 'public.business_assessment_inspections', 'DELETE'),
    'service role can manage inspection lifecycle records'
);

select extensions.ok(
    has_table_privilege('authenticated', 'public.business_assessment_evidence', 'SELECT'),
    'authenticated users have SELECT privilege so the evidence admin RLS policy can be applied'
);
select extensions.ok(
    not has_table_privilege('authenticated', 'public.business_assessment_evidence', 'INSERT'),
    'authenticated users cannot insert evidence directly'
);
select extensions.ok(
    not has_table_privilege('anon', 'public.business_assessment_evidence', 'SELECT'),
    'anonymous users cannot read inspection evidence'
);
select extensions.ok(
    has_table_privilege('service_role', 'public.business_assessment_evidence', 'INSERT'),
    'service role can insert source-specific evidence'
);
select extensions.ok(
    has_table_privilege('service_role', 'public.business_assessment_evidence', 'UPDATE')
    and has_table_privilege('service_role', 'public.business_assessment_evidence', 'DELETE'),
    'service role can manage evidence records'
);

select extensions.ok(
    exists (
        select 1 from pg_policies
        where schemaname='public'
          and tablename='business_assessment_inspections'
          and cmd='SELECT'
          and 'authenticated'=any(roles)
          and coalesce(qual, '') ilike '%is_swayphics_admin%'
    ),
    'inspection run reads are restricted by the Swayphics admin predicate'
);
select extensions.ok(
    exists (
        select 1 from pg_policies
        where schemaname='public'
          and tablename='business_assessment_evidence'
          and cmd='SELECT'
          and 'authenticated'=any(roles)
          and coalesce(qual, '') ilike '%is_swayphics_admin%'
          and coalesce(qual, '') ilike '%business_assessment_inspections%'
    ),
    'evidence reads are restricted through the parent inspection and admin predicate'
);

select extensions.ok(
    exists (
        select 1 from pg_indexes
        where schemaname='public'
          and indexname='business_assessment_inspections_idempotency_unique'
          and indexdef ilike '%unique%'
    ),
    'inspection idempotency is protected by a unique constraint'
);
select extensions.ok(
    exists (
        select 1 from pg_indexes
        where schemaname='public'
          and indexname='business_assessment_inspections_one_active_idx'
          and indexdef ilike '%unique%'
          and indexdef ilike '%queued%'
          and indexdef ilike '%running%'
    ),
    'only one queued or running inspection can exist per assessment'
);
select extensions.ok(
    to_regclass('public.business_assessment_inspections_admin_created_idx') is not null,
    'the per-admin rate-limit lookup has a supporting index'
);
select extensions.ok(
    to_regclass('public.business_assessment_evidence_inspection_created_idx') is not null,
    'the source evidence history has a supporting inspection index'
);

select extensions.ok(
    exists (
        select 1 from pg_constraint
        where conrelid='public.business_assessment_evidence'::regclass
          and conname='business_assessment_evidence_excerpt_length'
          and pg_get_constraintdef(oid) ilike '%500%'
    ),
    'stored excerpts are limited to 500 characters'
);
select extensions.ok(
    exists (
        select 1 from pg_constraint
        where conrelid='public.business_assessment_inspections'::regclass
          and conname='business_assessment_inspections_sources_array'
    ),
    'requested source metadata must be a JSON array'
);
select extensions.ok(
    exists (
        select 1 from pg_constraint
        where conrelid='public.business_assessment_evidence'::regclass
          and conname='business_assessment_evidence_observations_object'
    ),
    'evidence observations must be a JSON object'
);
select extensions.ok(
    exists (
        select 1 from pg_constraint
        where conrelid='public.business_assessment_evidence'::regclass
          and conname='business_assessment_evidence_match_basis_array'
    ),
    'identity match explanations must be a JSON array'
);

select * from extensions.finish();
rollback;
