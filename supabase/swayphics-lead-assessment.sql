-- SWAYPHICS LEAD ASSESSMENT
-- Run this migration once in Supabase SQL Editor.

alter table public.leads
    add column if not exists business_assessment text;

alter table public.leads
    add column if not exists research_findings text;

alter table public.leads
    add column if not exists swayphics_solution text;

alter table public.leads
    add column if not exists recommended_services text;

alter table public.leads
    add column if not exists research_sources text;

alter table public.leads
    add column if not exists assessment_updated_at timestamptz;

alter table public.leads
    add column if not exists assessment_updated_by uuid
        references public.admin_users(user_id) on delete set null;

notify pgrst, 'reload schema';
