-- Minimal disposable baseline for the Business Opportunity Finder evidence migration.
-- This is a test-only stand-in for the production assessment table and admin predicate.
create table public.business_assessments (
    id uuid primary key default gen_random_uuid()
);

create or replace function public.is_swayphics_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
    select coalesce(
        current_setting('request.jwt.claim.sub', true) =
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        false
    );
$$;

grant execute on function public.is_swayphics_admin() to authenticated;
