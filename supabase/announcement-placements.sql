-- SWAYPHICS PUBLIC ANNOUNCEMENT PLACEMENTS
-- Run this once in the Supabase SQL Editor for the live project.
-- Safe to run even if the placement column already exists.

alter table public.site_announcements
    add column if not exists placement text not null default 'top-bar';

alter table public.site_announcements
    drop constraint if exists site_announcements_placement_check;

alter table public.site_announcements
    add constraint site_announcements_placement_check
    check (placement in ('top-bar','hero','bottom'));

grant select on table public.site_announcements to anon;

drop policy if exists "Public can view published announcements"
    on public.site_announcements;

create policy "Public can view published announcements"
on public.site_announcements
for select
to anon
using (published = true);

notify pgrst, 'reload schema';
