-- Minimal CRM, service catalogue and billing schema for quote pricing tests.
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
        select 1 from public.admin_users au
        where au.user_id = auth.uid()
          and au.active = true
          and au.role in ('owner','admin')
    );
$function$;

create table public.leads (
    id uuid primary key default gen_random_uuid(),
    business_name text not null
);

create table public.clients (
    id uuid primary key default gen_random_uuid(),
    business_name text not null,
    source_lead_id uuid references public.leads(id) on delete set null
);

create table public.services (
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

create table public.invoice_settings (
    id smallint primary key default 1,
    vat_registered boolean not null default false,
    vat_number text
);
insert into public.invoice_settings (id,vat_registered) values (1,true);

create table public.client_projects (
    id uuid primary key default gen_random_uuid(),
    client_id uuid references public.clients(id) on delete cascade,
    name text not null
);

create sequence public.swayphics_invoice_number_seq start 1;

create table public.invoices (
    id uuid primary key default gen_random_uuid(),
    invoice_number text not null unique default (
        'SWY-' || to_char(current_date,'YYYY') || '-' ||
        lpad(nextval('public.swayphics_invoice_number_seq')::text,4,'0')
    ),
    client_id uuid not null references public.clients(id) on delete restrict,
    project_id uuid references public.client_projects(id) on delete set null,
    issue_date date not null default current_date,
    due_date date,
    status text not null default 'draft',
    currency text not null default 'ZAR',
    subtotal numeric(12,2) not null default 0,
    discount numeric(12,2) not null default 0,
    vat_rate numeric(5,2) not null default 0,
    vat_amount numeric(12,2) not null default 0,
    total numeric(12,2) not null default 0,
    notes text,
    created_by uuid references public.admin_users(user_id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    amount_paid numeric(12,2) not null default 0,
    amount_outstanding numeric(12,2) not null default 0
);

create table public.invoice_items (
    id uuid primary key default gen_random_uuid(),
    invoice_id uuid not null references public.invoices(id) on delete cascade,
    service_id uuid references public.services(id) on delete set null,
    description text not null,
    quantity numeric(10,2) not null default 1 check (quantity > 0),
    unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
    line_total numeric(12,2) generated always as (round(quantity * unit_price,2)) stored,
    created_at timestamptz not null default now()
);

create table public.quotes (
    id uuid primary key default gen_random_uuid(),
    quote_number text,
    title text not null,
    lead_id uuid references public.leads(id) on delete set null,
    client_id uuid references public.clients(id) on delete set null,
    amount numeric(12,2) not null default 0,
    status text not null default 'draft'
        check (status in ('draft','sent','accepted','rejected','expired')),
    valid_until date,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.lead_proposals
    add constraint lead_proposals_lead_id_fkey
    foreign key (lead_id) references public.leads(id) on delete cascade;

alter table public.lead_proposals enable row level security;
create policy "Swayphics admins can manage lead proposals"
    on public.lead_proposals
    for all
    to authenticated
    using (public.is_swayphics_admin())
    with check (public.is_swayphics_admin());

alter table public.quotes enable row level security;
create policy "Swayphics admins can manage quotes"
    on public.quotes
    for all
    to authenticated
    using (public.is_swayphics_admin())
    with check (public.is_swayphics_admin());

grant select,insert,update,delete on public.leads,public.clients,public.services,
    public.lead_proposals,public.quotes,public.invoices,public.invoice_items to authenticated;
grant execute on function public.is_swayphics_admin() to authenticated;

insert into public.leads (id,business_name)
values ('99999999-9999-4999-8999-999999999901','Legacy Quote Lead');

insert into public.quotes (id,quote_number,title,lead_id,amount,status)
values (
    '99999999-9999-4999-8999-999999999902',
    'LEGACY-001',
    'Legacy flat quote',
    '99999999-9999-4999-8999-999999999901',
    375,
    'draft'
);

commit;
