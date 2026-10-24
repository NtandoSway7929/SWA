-- Store each administrator's greeting preference separately from their account name.
-- A missing preference means the greeting falls back to public.admin_users.full_name.

create table if not exists public.admin_user_preferences (
    user_id uuid primary key
        references public.admin_users(user_id)
        on delete cascade,
    greeting_name text not null
        check (
            char_length(btrim(greeting_name)) between 1 and 60
        ),
    updated_at timestamptz not null default now()
);

alter table public.admin_user_preferences enable row level security;

grant select, insert, update, delete
    on table public.admin_user_preferences
    to authenticated;

drop policy if exists "Admins can read own greeting preference"
    on public.admin_user_preferences;
create policy "Admins can read own greeting preference"
    on public.admin_user_preferences
    for select to authenticated
    using (user_id = (select auth.uid()));

drop policy if exists "Admins can create own greeting preference"
    on public.admin_user_preferences;
create policy "Admins can create own greeting preference"
    on public.admin_user_preferences
    for insert to authenticated
    with check (user_id = (select auth.uid()));

drop policy if exists "Admins can update own greeting preference"
    on public.admin_user_preferences;
create policy "Admins can update own greeting preference"
    on public.admin_user_preferences
    for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

drop policy if exists "Admins can delete own greeting preference"
    on public.admin_user_preferences;
create policy "Admins can delete own greeting preference"
    on public.admin_user_preferences
    for delete to authenticated
    using (user_id = (select auth.uid()));
