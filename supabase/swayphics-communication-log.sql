-- SWAYPHICS COMMUNICATION LOG
-- Run this migration once in Supabase SQL Editor.

create table if not exists public.communication_logs (
    id uuid primary key default gen_random_uuid(),
    client_id uuid references public.clients(id) on delete cascade,
    lead_id uuid references public.leads(id) on delete cascade,
    channel text not null default 'WhatsApp'
        check (channel in ('Email','WhatsApp','Phone','Meeting','SMS','Other')),
    direction text not null default 'outbound'
        check (direction in ('inbound','outbound')),
    subject text,
    message text not null,
    contacted_at timestamptz not null default now(),
    created_by uuid references public.admin_users(user_id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint communication_logs_contact_check
        check (client_id is not null or lead_id is not null)
);

create index if not exists communication_logs_client_idx
    on public.communication_logs(client_id, contacted_at desc);

create index if not exists communication_logs_lead_idx
    on public.communication_logs(lead_id, contacted_at desc);

create index if not exists communication_logs_contacted_idx
    on public.communication_logs(contacted_at desc);

alter table public.communication_logs enable row level security;

grant select, insert, update, delete
on table public.communication_logs
to authenticated;

drop policy if exists "Swayphics admins can manage communication logs"
    on public.communication_logs;

create policy "Swayphics admins can manage communication logs"
on public.communication_logs
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

notify pgrst, 'reload schema';
