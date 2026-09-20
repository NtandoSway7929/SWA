-- SWAYPHICS SOCIAL MEDIA
-- Foundation for official social-platform integrations and performance reporting.
-- This schema stores account metadata, content records and metric snapshots.
-- Platform access tokens must not be stored in these client-readable tables.

create table if not exists public.social_accounts (
    id uuid primary key default gen_random_uuid(),
    platform text not null
        check (platform in ('Instagram','Facebook','TikTok')),
    account_name text not null,
    handle text,
    external_account_id text,
    profile_url text,
    status text not null default 'disconnected'
        check (status in ('connected','disconnected','pending')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists social_accounts_platform_external_idx
    on public.social_accounts(platform, external_account_id)
    where external_account_id is not null;

create table if not exists public.social_posts (
    id uuid primary key default gen_random_uuid(),
    title text,
    caption text not null,
    platform text not null default 'Instagram'
        check (platform in ('Instagram','Facebook','TikTok','Multi-platform')),
    status text not null default 'draft'
        check (status in ('draft','scheduled','published','failed')),
    media_url text,
    scheduled_for timestamptz,
    published_at timestamptz,
    external_post_id text,
    external_post_url text,
    created_by uuid references public.admin_users(user_id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists social_posts_status_idx
    on public.social_posts(status);

create index if not exists social_posts_scheduled_idx
    on public.social_posts(scheduled_for);

create table if not exists public.social_metrics (
    id uuid primary key default gen_random_uuid(),
    social_account_id uuid not null references public.social_accounts(id) on delete cascade,
    metric_date date not null,
    followers bigint,
    following bigint,
    reach bigint,
    impressions bigint,
    views bigint,
    likes bigint,
    comments bigint,
    shares bigint,
    saves bigint,
    profile_visits bigint,
    website_clicks bigint,
    created_at timestamptz not null default now(),
    unique(social_account_id, metric_date)
);

create index if not exists social_metrics_account_date_idx
    on public.social_metrics(social_account_id, metric_date desc);

alter table public.social_accounts enable row level security;
alter table public.social_posts enable row level security;
alter table public.social_metrics enable row level security;

grant select, insert, update, delete
on table public.social_accounts, public.social_posts, public.social_metrics
to authenticated;

drop policy if exists "Swayphics admins can manage social accounts"
    on public.social_accounts;

create policy "Swayphics admins can manage social accounts"
on public.social_accounts
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

drop policy if exists "Swayphics admins can manage social posts"
    on public.social_posts;

create policy "Swayphics admins can manage social posts"
on public.social_posts
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

drop policy if exists "Swayphics admins can manage social metrics"
    on public.social_metrics;

create policy "Swayphics admins can manage social metrics"
on public.social_metrics
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

notify pgrst, 'reload schema';
