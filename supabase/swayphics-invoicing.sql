-- SWAYPHICS INVOICING & BILLING
-- Run once in Supabase SQL Editor after the admin workspace SQL.
-- Creates the service catalogue, branded invoice records, invoice line items,
-- invoice settings, payment linkage, RLS, API grants and Realtime publication.

create sequence if not exists public.swayphics_invoice_number_seq
    start 1
    increment 1;

create or replace function public.next_swayphics_invoice_number()
returns text
language sql
volatile
as $$
    select
        'SWY-' ||
        to_char(current_date, 'YYYY') ||
        '-' ||
        lpad(nextval('public.swayphics_invoice_number_seq')::text, 4, '0');
$$;

create table if not exists public.services (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    description text,
    category text,
    pricing_type text not null default 'fixed'
        check (pricing_type in ('fixed','range','from','custom')),
    default_price numeric(12,2),
    minimum_price numeric(12,2),
    maximum_price numeric(12,2),
    price_label text,
    recurring_interval text not null default 'none'
        check (recurring_interval in ('none','monthly','yearly')),
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists services_active_idx
    on public.services(active);

create unique index if not exists services_name_unique_idx
    on public.services(lower(name));

create table if not exists public.invoice_settings (
    id smallint primary key default 1 check (id = 1),
    business_name text not null default 'Swayphics',
    slogan text,
    email text,
    phone text,
    website text,
    address text,
    bank_name text,
    account_name text,
    account_number text,
    account_type text,
    branch_code text,
    payment_instructions text,
    vat_registered boolean not null default false,
    vat_number text,
    updated_at timestamptz not null default now()
);

create table if not exists public.invoices (
    id uuid primary key default gen_random_uuid(),
    invoice_number text not null unique default (
        'SWY-' ||
        to_char(current_date, 'YYYY') ||
        '-' ||
        lpad(nextval('public.swayphics_invoice_number_seq')::text, 4, '0')
    ),
    client_id uuid not null references public.clients(id) on delete restrict,
    project_id uuid references public.client_projects(id) on delete set null,
    issue_date date not null default current_date,
    due_date date,
    status text not null default 'draft'
        check (status in ('draft','sent','partially paid','paid','overdue','cancelled')),
    currency text not null default 'ZAR',
    subtotal numeric(12,2) not null default 0,
    discount numeric(12,2) not null default 0,
    vat_rate numeric(5,2) not null default 0,
    vat_amount numeric(12,2) not null default 0,
    total numeric(12,2) not null default 0,
    notes text,
    email_status text not null default 'not sent'
        check (email_status in ('not sent','sending','sent','failed')),
    sent_at timestamptz,
    email_id text,
    email_error text,
    created_by uuid references public.admin_users(user_id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists invoices_client_idx
    on public.invoices(client_id);

create index if not exists invoices_status_idx
    on public.invoices(status);

create index if not exists invoices_created_idx
    on public.invoices(created_at desc);

create table if not exists public.invoice_items (
    id uuid primary key default gen_random_uuid(),
    invoice_id uuid not null references public.invoices(id) on delete cascade,
    service_id uuid references public.services(id) on delete set null,
    description text not null,
    quantity numeric(10,2) not null default 1 check (quantity > 0),
    unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
    line_total numeric(12,2)
        generated always as (quantity * unit_price) stored,
    created_at timestamptz not null default now()
);

create index if not exists invoice_items_invoice_idx
    on public.invoice_items(invoice_id);

alter table public.payments
    add column if not exists invoice_id uuid
    references public.invoices(id)
    on delete set null;

create index if not exists payments_invoice_idx
    on public.payments(invoice_id);

insert into public.invoice_settings (
    id,
    business_name,
    slogan,
    email,
    website
)
values (
    1,
    'Swayphics',
    'EMPOWERING THROUGH DESIGN',
    'info@swayphics.co.za',
    'https://swayphics.co.za'
)
on conflict (id) do nothing;

insert into public.services (
    name,
    description,
    category,
    pricing_type,
    default_price,
    minimum_price,
    maximum_price,
    price_label,
    recurring_interval,
    active
)
values
    ('Logo', 'Custom logo design.', 'Branding', 'fixed', 250, 250, 250, 'R250', 'none', true),
    ('Flyer / Poster', 'Marketing flyer or poster design.', 'Design', 'range', 200, 150, 250, 'R150–R250', 'none', true),
    ('Letterhead', 'Professional business letterhead.', 'Business stationery', 'fixed', 150, 150, 150, 'R150', 'none', true),
    ('Company Registration', 'Company registration service including CIPC-related costs.', 'Business setup', 'fixed', 500, 500, 500, 'R500', 'none', true),
    ('Business Identity Kit', 'Custom business identity package.', 'Branding', 'custom', null, null, null, 'Custom quote', 'none', true),
    ('Packaging', 'Packaging design.', 'Design', 'fixed', 150, 150, 150, 'R150', 'none', true),
    ('Apparel', 'Apparel design.', 'Design', 'range', 75, 50, 100, 'R50–R100', 'none', true),
    ('Business Card', 'Professional business card design.', 'Business stationery', 'fixed', 100, 100, 100, 'R100', 'none', true),
    ('Social Media Management', 'Social media management.', 'Marketing', 'fixed', 500, 500, 500, 'R500 / month', 'monthly', true),
    ('Google Business Profile Setup', 'Google Business Profile setup.', 'Digital presence', 'range', 700, 500, 900, 'R500–R900', 'none', true),
    ('Professional Email Setup', 'Professional business email setup.', 'Digital presence', 'range', 450, 300, 600, 'R300–R600', 'none', true),
    ('Appointment / Booking Setup', 'Online appointment or booking setup.', 'Web & systems', 'range', 900, 600, 1200, 'R600–R1200', 'none', true),
    ('Website Design', 'Website design and development.', 'Web & systems', 'from', 1500, 1500, null, 'From R1,500', 'none', true)
on conflict do nothing;

alter table public.services enable row level security;
alter table public.invoice_settings enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;

grant usage on schema public to authenticated;

grant select on table public.services to authenticated;
grant insert, update, delete on table public.services to authenticated;

grant select, update on table public.invoice_settings to authenticated;

grant select, insert, update, delete on table public.invoices to authenticated;
grant select, insert, update, delete on table public.invoice_items to authenticated;

grant select, update on table public.payments to authenticated;

drop policy if exists "Swayphics admins can view services" on public.services;
create policy "Swayphics admins can view services"
on public.services
for select
to authenticated
using (public.is_swayphics_admin());

drop policy if exists "Swayphics owners can create services" on public.services;
create policy "Swayphics owners can create services"
on public.services
for insert
to authenticated
with check (public.is_swayphics_owner());

drop policy if exists "Swayphics owners can update services" on public.services;
create policy "Swayphics owners can update services"
on public.services
for update
to authenticated
using (public.is_swayphics_owner())
with check (public.is_swayphics_owner());

drop policy if exists "Swayphics owners can delete services" on public.services;
create policy "Swayphics owners can delete services"
on public.services
for delete
to authenticated
using (public.is_swayphics_owner());

drop policy if exists "Swayphics admins can view invoice settings" on public.invoice_settings;
create policy "Swayphics admins can view invoice settings"
on public.invoice_settings
for select
to authenticated
using (public.is_swayphics_admin());

drop policy if exists "Swayphics owners can update invoice settings" on public.invoice_settings;
create policy "Swayphics owners can update invoice settings"
on public.invoice_settings
for update
to authenticated
using (public.is_swayphics_owner())
with check (public.is_swayphics_owner());

drop policy if exists "Swayphics admins can manage invoices" on public.invoices;
create policy "Swayphics admins can manage invoices"
on public.invoices
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

drop policy if exists "Swayphics admins can manage invoice items" on public.invoice_items;
create policy "Swayphics admins can manage invoice items"
on public.invoice_items
for all
to authenticated
using (
    public.is_swayphics_admin()
    and exists (
        select 1
        from public.invoices
        where invoices.id = invoice_items.invoice_id
    )
)
with check (
    public.is_swayphics_admin()
    and exists (
        select 1
        from public.invoices
        where invoices.id = invoice_items.invoice_id
    )
);

do $
begin
    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'invoices'
    ) then
        alter publication supabase_realtime add table public.invoices;
    end if;

    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'invoice_items'
    ) then
        alter publication supabase_realtime add table public.invoice_items;
    end if;

    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'services'
    ) then
        alter publication supabase_realtime add table public.services;
    end if;

    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'invoice_settings'
    ) then
        alter publication supabase_realtime add table public.invoice_settings;
    end if;
end
$;
