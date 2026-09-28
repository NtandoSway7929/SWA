-- SWAYPHICS LEAD CONTACT STATUS
-- Run once in Supabase SQL Editor.
--
-- A lead is considered contacted in the dashboard when:
-- 1. an outbound communication_logs entry is linked to the lead, or
-- 2. an admin manually sets contacted_manually = true.

alter table public.leads
    add column if not exists contacted_manually boolean not null default false;

alter table public.leads
    add column if not exists contacted_manually_at timestamptz;

alter table public.leads
    add column if not exists contacted_manually_by uuid
        references public.admin_users(user_id)
        on delete set null;

create index if not exists leads_contacted_manually_idx
    on public.leads(contacted_manually);

create index if not exists leads_contacted_manually_at_idx
    on public.leads(contacted_manually_at desc);

notify pgrst, 'reload schema';
