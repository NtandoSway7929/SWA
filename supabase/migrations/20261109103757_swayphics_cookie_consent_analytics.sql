begin;

create table if not exists public.swayphics_cookie_consent_events (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null,
    event_type text not null
        check (event_type in ('accepted', 'rejected', 'changed', 'withdrawn')),
    analytics_consent boolean not null,
    source text not null default 'banner'
        check (source in ('banner', 'preferences')),
    policy_version text not null default '2026-11-09'
        check (length(policy_version) between 1 and 40),
    page_path text
        check (
            page_path is null
            or (
                length(page_path) <= 240
                and left(page_path, 1) = '/'
                and position('?' in page_path) = 0
                and position('#' in page_path) = 0
            )
        ),
    created_at timestamptz not null default now(),
    constraint swayphics_cookie_consent_event_choice_consistency
        check (
            (event_type in ('accepted', 'changed') and analytics_consent = true)
            or
            (event_type in ('rejected', 'withdrawn') and analytics_consent = false)
        )
);

comment on table public.swayphics_cookie_consent_events is
    'Anonymous cookie-consent decision events. Deliberately excludes names, email addresses, IP addresses, user agents and persistent visitor identifiers.';

create index if not exists swayphics_cookie_consent_events_created_at_idx
    on public.swayphics_cookie_consent_events (created_at desc);

create index if not exists swayphics_cookie_consent_events_session_created_idx
    on public.swayphics_cookie_consent_events (session_id, created_at desc);

alter table public.swayphics_cookie_consent_events enable row level security;

revoke all privileges on table public.swayphics_cookie_consent_events
    from anon, authenticated;

grant insert on table public.swayphics_cookie_consent_events to anon;

drop policy if exists "Public can record cookie consent decisions"
    on public.swayphics_cookie_consent_events;

create policy "Public can record cookie consent decisions"
    on public.swayphics_cookie_consent_events
    for insert
    to anon
    with check (
        event_type in ('accepted', 'rejected', 'changed', 'withdrawn')
        and (
            (event_type in ('accepted', 'changed') and analytics_consent = true)
            or
            (event_type in ('rejected', 'withdrawn') and analytics_consent = false)
        )
        and source in ('banner', 'preferences')
        and length(policy_version) between 1 and 40
        and (
            page_path is null
            or (
                length(page_path) <= 240
                and left(page_path, 1) = '/'
                and position('?' in page_path) = 0
                and position('#' in page_path) = 0
            )
        )
        and created_at >= now() - interval '5 minutes'
        and created_at <= now() + interval '1 minute'
    );

create or replace function public.get_swayphics_cookie_analytics(
    p_days integer default 30
)
returns table (
    consent_date date,
    accepted bigint,
    rejected bigint,
    changed bigint,
    withdrawn bigint,
    total_decisions bigint,
    decision_sessions bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
    v_days integer := coalesce(p_days, 30);
begin
    if auth.uid() is null or not public.is_swayphics_admin() then
        raise exception using
            errcode = '42501',
            message = 'Active Swayphics admin access required.';
    end if;

    if v_days not in (7, 30, 90) then
        raise exception using
            errcode = '22023',
            message = 'Choose a reporting window of 7, 30 or 90 days.';
    end if;

    return query
    select
        (e.created_at at time zone 'Africa/Johannesburg')::date as consent_date,
        count(*) filter (where e.event_type = 'accepted')::bigint as accepted,
        count(*) filter (where e.event_type = 'rejected')::bigint as rejected,
        count(*) filter (where e.event_type = 'changed')::bigint as changed,
        count(*) filter (where e.event_type = 'withdrawn')::bigint as withdrawn,
        count(*)::bigint as total_decisions,
        count(distinct e.session_id)::bigint as decision_sessions
    from public.swayphics_cookie_consent_events e
    where e.created_at >= now() - make_interval(days => v_days)
    group by 1
    order by 1;
end;
$function$;

revoke all privileges on function public.get_swayphics_cookie_analytics(integer)
    from public, anon, service_role;

grant execute on function public.get_swayphics_cookie_analytics(integer)
    to authenticated;

notify pgrst, 'reload schema';

commit;
