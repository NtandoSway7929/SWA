-- SWAYPHICS SALES CAMPAIGN ATTRIBUTION
-- Forward-only and idempotent. Apply only after the core admin workspace schema
-- exists. This file is not applied to production by this feature branch.
-- Campaign spend records always keep their own currency; never add unlike currencies
-- together or claim conversion attribution without verified cohort/stage dates.

create table if not exists public.sales_campaigns (
    id uuid primary key default gen_random_uuid(),
    name text not null check (length(trim(name)) > 0),
    channel text not null check (channel in ('email','whatsapp','facebook','instagram','tiktok','website','referral','networking','other')),
    target_segment text not null default 'unknown'
        check (target_segment in ('unknown','professional_services','creative','beauty_wellness','food_hospitality','retail_ecommerce','events_entertainment','education','other')),
    status text not null default 'draft'
        check (status in ('draft','active','paused','completed','archived')),
    start_date date not null default current_date,
    end_date date,
    currency text not null default 'ZAR'
        check (currency in ('ZAR','USD','EUR','GBP')),
    budget_amount numeric(12,2) check (budget_amount is null or budget_amount >= 0),
    objective text,
    notes text,
    created_by uuid references public.admin_users(user_id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint sales_campaigns_date_check check (end_date is null or end_date >= start_date)
);

create table if not exists public.sales_campaign_leads (
    id uuid primary key default gen_random_uuid(),
    campaign_id uuid not null references public.sales_campaigns(id) on delete cascade,
    lead_id uuid not null references public.leads(id) on delete cascade,
    attribution_type text not null default 'assisted'
        check (attribution_type in ('primary','assisted')),
    linked_at timestamptz not null default now(),
    linked_by uuid references public.admin_users(user_id) on delete set null,
    notes text,
    created_at timestamptz not null default now(),
    constraint sales_campaign_leads_pair_unique unique (campaign_id, lead_id)
);

-- One lead has at most one explicitly declared primary acquisition campaign.
-- Assisted campaign links may coexist with a primary link.
create unique index if not exists sales_campaign_leads_primary_unique_idx
    on public.sales_campaign_leads(lead_id)
    where attribution_type = 'primary';

create table if not exists public.sales_campaign_spend (
    id uuid primary key default gen_random_uuid(),
    campaign_id uuid not null references public.sales_campaigns(id) on delete cascade,
    spent_on date not null default current_date,
    category text not null
        check (category in ('paid_ads','creative_production','printing','event_or_networking','software','transport','other')),
    amount numeric(12,2) not null check (amount > 0),
    currency text not null default 'ZAR'
        check (currency in ('ZAR','USD','EUR','GBP')),
    description text,
    evidence_url text,
    created_by uuid references public.admin_users(user_id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists sales_campaigns_status_start_idx
    on public.sales_campaigns(status, start_date desc);
create index if not exists sales_campaign_leads_campaign_idx
    on public.sales_campaign_leads(campaign_id, linked_at desc);
create index if not exists sales_campaign_leads_lead_idx
    on public.sales_campaign_leads(lead_id, linked_at desc);
create index if not exists sales_campaign_spend_campaign_date_idx
    on public.sales_campaign_spend(campaign_id, spent_on desc);

alter table public.sales_campaigns enable row level security;
alter table public.sales_campaign_leads enable row level security;
alter table public.sales_campaign_spend enable row level security;

drop policy if exists "Swayphics admins can manage sales campaigns" on public.sales_campaigns;
create policy "Swayphics admins can manage sales campaigns"
on public.sales_campaigns for all to authenticated
using (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true))
with check (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true));

drop policy if exists "Swayphics admins can manage sales campaign lead links" on public.sales_campaign_leads;
create policy "Swayphics admins can manage sales campaign lead links"
on public.sales_campaign_leads for all to authenticated
using (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true))
with check (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true));

drop policy if exists "Swayphics admins can manage sales campaign spend" on public.sales_campaign_spend;
create policy "Swayphics admins can manage sales campaign spend"
on public.sales_campaign_spend for all to authenticated
using (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true))
with check (exists (select 1 from public.admin_users where user_id = auth.uid() and active = true));

grant select, insert, update, delete
on public.sales_campaigns, public.sales_campaign_leads, public.sales_campaign_spend
to authenticated;
grant all privileges
on public.sales_campaigns, public.sales_campaign_leads, public.sales_campaign_spend
to service_role;

comment on table public.sales_campaigns is
    'Manually managed Swayphics sales campaigns. Status and current lead status are not by themselves evidence of causal campaign conversion.';
comment on table public.sales_campaign_leads is
    'Explicit manual campaign association. Primary means campaign originated lead; assisted means it supported an existing lead. One primary campaign per lead.';
comment on table public.sales_campaign_spend is
    'Manually logged campaign spend. Amounts remain in their recorded currency and must not be summed across currencies without a sourced exchange rate.';

-- Add campaign tables to Supabase Realtime where the standard publication exists.
-- The application also subscribes to these tables for cross-session refreshes.
do $
declare
    table_name text;
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        foreach table_name in array array[
            'sales_campaigns',
            'sales_campaign_leads',
            'sales_campaign_spend'
        ]
        loop
            if not exists (
                select 1
                from pg_publication_tables
                where pubname = 'supabase_realtime'
                  and schemaname = 'public'
                  and tablename = table_name
            ) then
                execute format(
                    'alter publication supabase_realtime add table public.%I',
                    table_name
                );
            end if;
        end loop;
    end if;
end
$;

notify pgrst, 'reload schema';
