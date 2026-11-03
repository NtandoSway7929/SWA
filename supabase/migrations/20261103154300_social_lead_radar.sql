-- Swayphics Social Lead Radar — Stage 1
-- Intentionally staged in Git only. Do not apply to the live project without approval.

create table if not exists public.social_lead_signals (
    id uuid primary key default gen_random_uuid(),
    platform text not null default 'x'
        check (platform = 'x'),
    external_post_id text not null,
    external_post_url text not null,
    post_created_at timestamptz not null,
    discovered_at timestamptz not null default now(),
    age_seconds integer not null
        check (age_seconds >= 0 and age_seconds <= 300),
    intent_score smallint not null
        check (intent_score >= 0 and intent_score <= 100),
    intent_tier text not null
        check (intent_tier in ('high', 'medium')),
    intent_type text not null
        check (intent_type in (
            'direct_need',
            'recommendation_request',
            'pricing_request',
            'website_improvement',
            'ecommerce_or_booking'
        )),
    market_hint text not null default 'unconfirmed'
        check (market_hint in ('likely_south_africa', 'unconfirmed')),
    match_reasons jsonb not null default '[]'::jsonb,
    review_status text not null default 'new'
        check (review_status in ('new', 'qualified', 'dismissed')),
    expires_at timestamptz not null default (now() + interval '30 days'),
    created_at timestamptz not null default now(),
    unique (platform, external_post_id)
);

create index if not exists social_lead_signals_created_idx
    on public.social_lead_signals(post_created_at desc);

create index if not exists social_lead_signals_review_idx
    on public.social_lead_signals(review_status, intent_score desc, discovered_at desc);

alter table public.social_lead_signals enable row level security;

revoke all on table public.social_lead_signals from anon;
revoke all on table public.social_lead_signals from authenticated;
grant select, update (review_status) on table public.social_lead_signals to authenticated;
grant all on table public.social_lead_signals to service_role;

drop policy if exists "Swayphics admins can view social lead signals"
    on public.social_lead_signals;

create policy "Swayphics admins can view social lead signals"
on public.social_lead_signals
for select
to authenticated
using (public.is_swayphics_admin());

drop policy if exists "Swayphics admins can update social lead signals"
    on public.social_lead_signals;

create policy "Swayphics admins can update social lead signals"
on public.social_lead_signals
for update
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

-- Checkpoint table contains only a monitor name and opaque X post ID.
-- It is not readable or writable by anon/authenticated users.
create table if not exists public.social_radar_state (
    monitor_key text primary key,
    since_id text,
    last_success_at timestamptz,
    last_error text,
    updated_at timestamptz not null default now()
);

alter table public.social_radar_state enable row level security;

revoke all on table public.social_radar_state from anon;
revoke all on table public.social_radar_state from authenticated;
grant all on table public.social_radar_state to service_role;

notify pgrst, 'reload schema';
