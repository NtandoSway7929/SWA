-- Minimal Swayphics CRM schema for isolated lead-proposal revision tests.
begin;

create table public.admin_users (
    user_id uuid primary key references auth.users(id) on delete cascade,
    full_name text,
    email text,
    role text not null default 'admin',
    active boolean not null default true
);

create or replace function public.is_swayphics_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
    select exists (
        select 1
          from public.admin_users au
         where au.user_id = auth.uid()
           and au.active = true
           and au.role in ('owner', 'admin')
    );
$function$;

create table public.leads (
    id uuid primary key default gen_random_uuid(),
    business_name text not null
);

create table public.lead_proposals (
    id uuid primary key default gen_random_uuid(),
    lead_id uuid not null references public.leads(id) on delete cascade,
    title text not null default 'Swayphics Proposal',
    subject text,
    content text not null,
    status text not null default 'draft'
        check (status = any (array['draft','approved','rejected']::text[])),
    assessment_snapshot jsonb not null default '{}'::jsonb,
    created_by uuid references public.admin_users(user_id) on delete set null,
    approved_by uuid references public.admin_users(user_id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    approved_at timestamptz
);

alter table public.lead_proposals enable row level security;
create policy "Swayphics admins can manage lead proposals"
    on public.lead_proposals
    for all
    to authenticated
    using (public.is_swayphics_admin())
    with check (public.is_swayphics_admin());

grant select, insert, update, delete on public.leads, public.lead_proposals
    to authenticated;
grant execute on function public.is_swayphics_admin() to authenticated;

commit;
