-- SWAYPHICS ADMIN PUSH NOTIFICATIONS
-- Run once in Supabase SQL Editor after the admin notification migration.

create table if not exists public.admin_push_subscriptions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.admin_users(user_id) on delete cascade,
    endpoint text not null,
    p256dh text not null,
    auth text not null,
    user_agent text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists admin_push_subscriptions_user_endpoint_idx
    on public.admin_push_subscriptions(user_id, endpoint);

create index if not exists admin_push_subscriptions_user_idx
    on public.admin_push_subscriptions(user_id);

alter table public.admin_push_subscriptions enable row level security;

grant select, insert, update, delete on table public.admin_push_subscriptions to authenticated;

drop policy if exists "Swayphics admins can manage own push subscriptions"
    on public.admin_push_subscriptions;

create policy "Swayphics admins can manage own push subscriptions"
on public.admin_push_subscriptions
for all to authenticated
using (
    user_id = auth.uid()
    and public.is_swayphics_admin()
)
with check (
    user_id = auth.uid()
    and public.is_swayphics_admin()
);

create or replace function public.touch_admin_push_subscription()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists admin_push_subscription_updated_at
    on public.admin_push_subscriptions;

create trigger admin_push_subscription_updated_at
before update on public.admin_push_subscriptions
for each row execute function public.touch_admin_push_subscription();
