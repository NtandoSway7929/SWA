-- Add a per-administrator control for the authenticated-session welcome animation.
-- Existing administrators retain the current animated behaviour by default.

begin;

alter table public.admin_dashboard_preferences
    add column if not exists welcome_animation_enabled boolean not null default true;

comment on column public.admin_dashboard_preferences.welcome_animation_enabled
    is 'Whether the animated Swayphics sign-in greeting is shown for this administrator.';

commit;
