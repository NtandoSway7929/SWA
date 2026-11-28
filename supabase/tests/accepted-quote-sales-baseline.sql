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

create table public.lead_proposals (
    id uuid primary key default gen_random_uuid(),
    lead_id uuid not null references public.leads(id) on delete cascade,
    title text not null default 'Swayphics Proposal',
    subject text,
    content text not null,
    status text not null default 'draft'
        check (status in ('draft','approved','rejected')),
    assessment_snapshot jsonb not null default '{}'::jsonb,
    created_by uuid references public.admin_users(user_id) on delete set null,
    approved_by uuid references public.admin_users(user_id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    approved_at timestamptz
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


-- Additional contact details used by the existing branded email sender.
begin;
alter table public.leads
    add column contact_name text,
    add column email text,
    add column email_consent_required boolean not null default false,
    add column email_consent_status text;
alter table public.clients
    add column contact_name text,
    add column email text;
commit;


-- Existing Swayphics CRM fields needed by the accepted-quote conversion RPC.
begin;

alter table public.leads
    add column contact_name text,
    add column email text,
    add column phone text,
    add column status text not null default 'new',
    add column converted_client_id uuid references public.clients(id) on delete set null,
    add column assigned_to uuid references public.admin_users(user_id) on delete set null,
    add column next_follow_up date,
    add column notes text,
    add column updated_at timestamptz not null default now();

alter table public.clients
    add column contact_name text,
    add column email text,
    add column phone text,
    add column status text not null default 'active',
    add column assigned_to uuid references public.admin_users(user_id) on delete set null,
    add column notes text,
    add column created_at timestamptz not null default now(),
    add column updated_at timestamptz not null default now();

create or replace function public.convert_swayphics_lead_to_client(
    p_lead_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_lead public.leads%rowtype;
    v_client_id uuid;
    v_existing_client uuid;
begin
    if auth.uid() is null or not public.is_swayphics_admin() then
        raise exception 'Active Swayphics admin access required.'
            using errcode = '42501';
    end if;

    select *
      into v_lead
      from public.leads
     where id = p_lead_id
     for update;

    if not found then
        raise exception 'Lead could not be found.';
    end if;

    if v_lead.converted_client_id is not null then
        return v_lead.converted_client_id;
    end if;

    select c.id
      into v_existing_client
      from public.clients c
     where (
        v_lead.email is not null
        and nullif(btrim(v_lead.business_name), '') is not null
        and lower(btrim(c.email)) = lower(btrim(v_lead.email))
        and lower(btrim(c.business_name)) = lower(btrim(v_lead.business_name))
     )
     or (
        v_lead.email is null
        and nullif(btrim(v_lead.business_name), '') is not null
        and lower(btrim(c.business_name)) = lower(btrim(v_lead.business_name))
     )
     or (
        nullif(btrim(v_lead.business_name), '') is null
        and v_lead.email is not null
        and lower(btrim(c.email)) = lower(btrim(v_lead.email))
     )
     order by c.created_at desc
     limit 1;

    if v_existing_client is not null then
        v_client_id := v_existing_client;
        update public.clients
           set business_name = coalesce(nullif(btrim(v_lead.business_name), ''), business_name),
               contact_name = coalesce(nullif(btrim(v_lead.contact_name), ''), contact_name),
               email = coalesce(nullif(btrim(v_lead.email), ''), email),
               phone = coalesce(nullif(btrim(v_lead.phone), ''), phone),
               status = 'active',
               source_lead_id = p_lead_id,
               updated_at = now()
         where id = v_client_id;
    else
        insert into public.clients (
            business_name, contact_name, email, phone, status,
            assigned_to, notes, source_lead_id
        ) values (
            v_lead.business_name, v_lead.contact_name, v_lead.email, v_lead.phone,
            'active', coalesce(v_lead.assigned_to, auth.uid()), v_lead.notes, p_lead_id
        )
        returning id into v_client_id;
    end if;

    update public.leads
       set status = 'won',
           converted_client_id = v_client_id,
           next_follow_up = null,
           updated_at = now()
     where id = p_lead_id;

    return v_client_id;
end;
$function$;

revoke all on function public.convert_swayphics_lead_to_client(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.convert_swayphics_lead_to_client(uuid)
    to authenticated;

commit;
