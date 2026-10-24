-- SWAYPHICS BUSINESS FLOW AUTOMATION
-- Run after:
--   1) swayphics-admin-workspace.sql
--   2) swayphics-admin-workspace-security-fix.sql
--   3) swayphics-invoicing.sql
--
-- Creates the operational flow:
-- Enquiry -> Lead -> Follow-up -> Client -> Project -> Portfolio
-- Project -> Review request
-- Invoice -> Payment -> live invoice balance
--
-- Existing records are preserved.

create table if not exists public.workflow_settings (
    id smallint primary key default 1 check (id = 1),
    lead_no_response_days integer not null default 7
        check (lead_no_response_days between 1 and 365),
    review_link text not null
        default 'https://swayphics.co.za/testimonial/',
    updated_at timestamptz not null default now()
);

insert into public.workflow_settings (
    id,
    lead_no_response_days,
    review_link
)
values (
    1,
    7,
    'https://swayphics.co.za/testimonial/'
)
on conflict (id) do nothing;

alter table public.website_enquiries
    add column if not exists contacted_at timestamptz;

alter table public.website_enquiries
    add column if not exists converted_lead_id uuid
    references public.leads(id)
    on delete set null;

create index if not exists enquiries_converted_lead_idx
    on public.website_enquiries(converted_lead_id);

alter table public.leads
    add column if not exists last_contacted_at timestamptz;

alter table public.leads
    drop constraint if exists leads_status_check;

alter table public.leads
    add constraint leads_status_check
    check (
        status in (
            'new',
            'contacted',
            'interested',
            'proposal sent',
            'negotiating',
            'follow-up',
            'won',
            'lost'
        )
    );

create index if not exists leads_last_contacted_idx
    on public.leads(last_contacted_at);

alter table public.clients
    add column if not exists source_lead_id uuid
    references public.leads(id)
    on delete set null;

create unique index if not exists clients_source_lead_unique_idx
    on public.clients(source_lead_id)
    where source_lead_id is not null;

alter table public.client_projects
    add column if not exists completed_at timestamptz;

alter table public.client_projects
    add column if not exists review_requested_at timestamptz;

alter table public.client_projects
    add column if not exists review_email_status text
        not null default 'not requested';

alter table public.client_projects
    drop constraint if exists client_projects_review_email_status_check;

alter table public.client_projects
    add constraint client_projects_review_email_status_check
    check (
        review_email_status in (
            'not requested',
            'queued',
            'sent',
            'failed'
        )
    );

create table if not exists public.client_review_requests (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null unique
        references public.client_projects(id)
        on delete cascade,
    client_id uuid not null
        references public.clients(id)
        on delete cascade,
    email text,
    review_url text not null,
    status text not null default 'queued'
        check (status in ('queued','sent','failed','skipped')),
    email_id text,
    error_message text,
    requested_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists review_requests_status_idx
    on public.client_review_requests(status);

create index if not exists review_requests_client_idx
    on public.client_review_requests(client_id);

alter table public.portfolio_projects
    add column if not exists source_project_id uuid
    references public.client_projects(id)
    on delete set null;

create unique index if not exists portfolio_source_project_unique_idx
    on public.portfolio_projects(source_project_id)
    where source_project_id is not null;

-- Client records may be deleted from the admin workspace. Related records
-- use their existing foreign-key delete behavior.

-- When a lead enters a contacted/progressed stage, update the last-contacted clock.
create or replace function public.touch_swayphics_lead_contacted()
returns trigger
language plpgsql
as $$
begin
    if (
        new.status in (
            'contacted',
            'interested',
            'proposal sent',
            'negotiating'
        )
        and (
            tg_op = 'INSERT'
            or old.status is distinct from new.status
        )
    ) then
        new.last_contacted_at = now();
    end if;

    return new;
end;
$$;

drop trigger if exists trg_touch_swayphics_lead_contacted
on public.leads;

create trigger trg_touch_swayphics_lead_contacted
before insert or update of status on public.leads
for each row
execute function public.touch_swayphics_lead_contacted();

-- Atomic Enquiry -> Lead conversion used by the Contacted button.
create or replace function public.convert_swayphics_enquiry_to_lead(
    p_enquiry_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_enquiry public.website_enquiries%rowtype;
    v_lead_id uuid;
    v_existing_lead uuid;
    v_days integer;
begin
    if not public.is_swayphics_admin() then
        raise exception 'Active Swayphics admin access required.';
    end if;

    select *
    into v_enquiry
    from public.website_enquiries
    where id = p_enquiry_id
    for update;

    if not found then
        raise exception 'Website enquiry could not be found.';
    end if;

    if v_enquiry.converted_lead_id is not null then
        return v_enquiry.converted_lead_id;
    end if;

    select id
    into v_existing_lead
    from public.leads
    where (
        v_enquiry.email is not null
        and nullif(trim(v_enquiry.business_name), '') is not null
        and lower(trim(email)) = lower(trim(v_enquiry.email))
        and lower(trim(business_name)) =
            lower(trim(v_enquiry.business_name))
    )
    or (
        v_enquiry.email is null
        and nullif(trim(v_enquiry.business_name), '') is not null
        and lower(trim(business_name)) =
            lower(trim(v_enquiry.business_name))
    )
    or (
        nullif(trim(v_enquiry.business_name), '') is null
        and v_enquiry.email is not null
        and lower(trim(email)) = lower(trim(v_enquiry.email))
    )
    order by created_at desc
    limit 1;

    select lead_no_response_days
    into v_days
    from public.workflow_settings
    where id = 1;

    if v_existing_lead is not null then
        v_lead_id := v_existing_lead;

        update public.leads
        set
            business_name =
                coalesce(
                    nullif(trim(v_enquiry.business_name), ''),
                    business_name
                ),
            contact_name =
                coalesce(
                    nullif(trim(v_enquiry.name), ''),
                    contact_name
                ),
            email =
                coalesce(
                    nullif(trim(v_enquiry.email), ''),
                    email
                ),
            phone =
                coalesce(
                    nullif(trim(v_enquiry.phone), ''),
                    phone
                ),
            service_interest =
                coalesce(
                    nullif(trim(v_enquiry.service), ''),
                    service_interest
                ),
            status = case
                when status in ('won', 'lost') then 'contacted'
                else 'contacted'
            end,
            last_contacted_at = now(),
            next_follow_up = current_date + coalesce(v_days, 7),
            updated_at = now()
        where id = v_lead_id;
    else
        insert into public.leads (
            business_name,
            contact_name,
            email,
            phone,
            service_interest,
            source,
            status,
            estimated_value,
            assigned_to,
            next_follow_up,
            last_contacted_at,
            notes
        )
        values (
            coalesce(v_enquiry.business_name, v_enquiry.name, 'Website enquiry'),
            v_enquiry.name,
            v_enquiry.email,
            v_enquiry.phone,
            v_enquiry.service,
            'Website',
            'contacted',
            0,
            auth.uid(),
            current_date + coalesce(v_days, 7),
            now(),
            coalesce(v_enquiry.message, '')
        )
        returning id into v_lead_id;
    end if;

    update public.website_enquiries
    set
        status = 'contacted',
        contacted_at = coalesce(contacted_at, now()),
        converted_lead_id = v_lead_id
    where id = p_enquiry_id;

    return v_lead_id;
end;
$$;

revoke all on function public.convert_swayphics_enquiry_to_lead(uuid) from public;
grant execute on function public.convert_swayphics_enquiry_to_lead(uuid)
to authenticated;

-- Atomic Lead -> Client conversion.
create or replace function public.convert_swayphics_lead_to_client(
    p_lead_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_lead public.leads%rowtype;
    v_client_id uuid;
    v_existing_client uuid;
begin
    if not public.is_swayphics_admin() then
        raise exception 'Active Swayphics admin access required.';
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

    select id
    into v_existing_client
    from public.clients
    where (
        v_lead.email is not null
        and nullif(trim(v_lead.business_name), '') is not null
        and lower(trim(email)) = lower(trim(v_lead.email))
        and lower(trim(business_name)) =
            lower(trim(v_lead.business_name))
    )
    or (
        v_lead.email is null
        and nullif(trim(v_lead.business_name), '') is not null
        and lower(trim(business_name)) =
            lower(trim(v_lead.business_name))
    )
    or (
        nullif(trim(v_lead.business_name), '') is null
        and v_lead.email is not null
        and lower(trim(email)) = lower(trim(v_lead.email))
    )
    order by created_at desc
    limit 1;

    if v_existing_client is not null then
        v_client_id := v_existing_client;

        update public.clients
        set
            business_name =
                coalesce(
                    nullif(trim(v_lead.business_name), ''),
                    business_name
                ),
            contact_name =
                coalesce(
                    nullif(trim(v_lead.contact_name), ''),
                    contact_name
                ),
            email =
                coalesce(
                    nullif(trim(v_lead.email), ''),
                    email
                ),
            phone =
                coalesce(
                    nullif(trim(v_lead.phone), ''),
                    phone
                ),
            status = 'active',
            source_lead_id = p_lead_id,
            updated_at = now()
        where id = v_client_id;
    else
        insert into public.clients (
            business_name,
            contact_name,
            email,
            phone,
            status,
            assigned_to,
            notes,
            source_lead_id
        )
        values (
            v_lead.business_name,
            v_lead.contact_name,
            v_lead.email,
            v_lead.phone,
            'active',
            coalesce(v_lead.assigned_to, auth.uid()),
            v_lead.notes,
            p_lead_id
        )
        returning id into v_client_id;
    end if;

    update public.leads
    set
        status = 'won',
        converted_client_id = v_client_id,
        next_follow_up = null,
        updated_at = now()
    where id = p_lead_id;

    return v_client_id;
end;
$$;

revoke all on function public.convert_swayphics_lead_to_client(uuid) from public;
grant execute on function public.convert_swayphics_lead_to_client(uuid)
to authenticated;

-- Updated by dashboard_automation_reliability migration: private worker plus authenticated dashboard wrapper.
create schema if not exists innerme_private;

-- The automation has always intended to maintain at most one pending follow-up per lead.
-- Enforce that invariant even if a browser refresh and the scheduler run concurrently.
create unique index if not exists follow_ups_one_pending_per_lead_idx
    on public.follow_ups (lead_id)
    where lead_id is not null and status = 'pending';

create or replace function innerme_private.process_swayphics_stale_leads_internal()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_days integer;
    v_created integer := 0;
    v_inserted integer := 0;
    v_assigned_to uuid;
    v_lead public.leads%rowtype;
begin
    select coalesce(
        (select ws.lead_no_response_days
         from public.workflow_settings ws
         where ws.id = 1),
        7
    )
    into v_days;

    for v_lead in
        select l.*
        from public.leads l
        where l.status in (
            'contacted',
            'interested',
            'proposal sent',
            'negotiating',
            'follow-up'
        )
          and l.last_contacted_at is not null
          and l.last_contacted_at <= now() - make_interval(days => v_days)
          and not exists (
              select 1
              from public.follow_ups f
              where f.lead_id = l.id
                and f.status = 'pending'
          )
        order by l.last_contacted_at asc
        for update of l skip locked
    loop
        select coalesce(
            v_lead.assigned_to,
            (
                select au.user_id
                from public.admin_users au
                where au.active = true
                order by case when au.role = 'owner' then 0 else 1 end,
                         au.user_id
                limit 1
            )
        )
        into v_assigned_to;

        -- Never assume a stored phone number is registered on WhatsApp.
        -- Prefer a usable email address; otherwise create a phone task or an
        -- unassigned "Other" task so an administrator can verify contact details.
        insert into public.follow_ups (
            lead_id,
            assigned_to,
            scheduled_for,
            channel,
            status,
            note
        )
        values (
            v_lead.id,
            v_assigned_to,
            current_date,
            case
                when nullif(trim(v_lead.email), '') is not null then 'Email'
                when nullif(trim(v_lead.phone), '') is not null then 'Phone'
                else 'Other'
            end,
            'pending',
            'Automatic follow-up: no response within ' ||
                v_days ||
                ' days. Verify the contact channel before outreach.'
        )
        on conflict (lead_id)
        where lead_id is not null and status = 'pending'
        do nothing;

        get diagnostics v_inserted = row_count;

        if v_inserted > 0 then
            update public.leads
            set status = 'follow-up',
                next_follow_up = current_date,
                updated_at = now()
            where id = v_lead.id
              and status in (
                  'contacted',
                  'interested',
                  'proposal sent',
                  'negotiating',
                  'follow-up'
              );

            v_created := v_created + 1;
        end if;
    end loop;

    return v_created;
end;
$$;

revoke all privileges
    on function innerme_private.process_swayphics_stale_leads_internal()
    from public, anon, authenticated, service_role;

-- Preserve the authenticated dashboard RPC but keep the privileged worker private.
create or replace function public.process_swayphics_stale_leads()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null or not public.is_swayphics_admin() then
        raise exception 'Active Swayphics admin access required.';
    end if;

    return innerme_private.process_swayphics_stale_leads_internal();
end;
$$;

revoke all privileges
    on function public.process_swayphics_stale_leads()
    from public, anon, service_role;
grant execute
    on function public.process_swayphics_stale_leads()
    to authenticated;


-- Complete invoice/payment linkage.
alter table public.invoices
    add column if not exists amount_paid numeric(12,2) not null default 0;

alter table public.invoices
    add column if not exists amount_outstanding numeric(12,2) not null default 0;

create or replace function public.recalculate_swayphics_invoice_balance(
    p_invoice_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_total numeric(12,2);
    v_paid numeric(12,2);
    v_outstanding numeric(12,2);
    v_due_date date;
    v_status text;
    v_today date := (now() at time zone 'Africa/Johannesburg')::date;
begin
    select i.total, i.due_date, i.status
    into v_total, v_due_date, v_status
    from public.invoices i
    where i.id = p_invoice_id;

    if not found then
        return;
    end if;

    select coalesce(sum(
        case
            when p.status in ('paid', 'partially paid') then p.amount
            else 0
        end
    ), 0)
    into v_paid
    from public.payments p
    where p.invoice_id = p_invoice_id;

    v_paid := greatest(
        0,
        least(coalesce(v_paid, 0), greatest(coalesce(v_total, 0), 0))
    );
    v_outstanding := greatest(coalesce(v_total, 0) - v_paid, 0);

    update public.invoices i
    set amount_paid = v_paid,
        amount_outstanding = v_outstanding,
        status = case
            when v_status = 'cancelled' then 'cancelled'
            when coalesce(v_total, 0) > 0
                 and v_paid >= coalesce(v_total, 0) then 'paid'
            when v_status = 'draft' and v_paid <= 0 then 'draft'
            when v_due_date is not null
                 and v_due_date < v_today
                 and v_outstanding > 0 then 'overdue'
            when v_paid > 0 then 'partially paid'
            else 'sent'
        end,
        updated_at = now()
    where i.id = p_invoice_id;
end;
$$;

-- Keep draft invoices distinct from invoices that have actually been sent.
alter table public.client_projects
    drop constraint if exists client_projects_payment_status_check;
alter table public.client_projects
    add constraint client_projects_payment_status_check
    check (payment_status in (
        'not invoiced',
        'invoice drafted',
        'invoice sent',
        'partially paid',
        'paid',
        'overdue'
    ));

create or replace function public.sync_swayphics_project_payment_status(
    p_project_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_project_id is null then
        return;
    end if;

    update public.client_projects cp
    set payment_status = case
        when exists (
            select 1
            from public.invoices i
            where i.project_id = p_project_id
              and i.status = 'overdue'
              and coalesce(i.amount_outstanding, 0) > 0
        ) then 'overdue'
        when exists (
            select 1
            from public.invoices i
            where i.project_id = p_project_id
              and i.status = 'partially paid'
        ) then 'partially paid'
        when exists (
            select 1
            from public.invoices i
            where i.project_id = p_project_id
              and i.status = 'paid'
        )
        and not exists (
            select 1
            from public.invoices i
            where i.project_id = p_project_id
              and i.status not in ('paid', 'cancelled')
        ) then 'paid'
        when exists (
            select 1
            from public.invoices i
            where i.project_id = p_project_id
              and i.status = 'sent'
        ) then 'invoice sent'
        when exists (
            select 1
            from public.invoices i
            where i.project_id = p_project_id
              and i.status = 'draft'
        ) then 'invoice drafted'
        else 'not invoiced'
    end,
    updated_at = now()
    where cp.id = p_project_id;
end;
$$;

create or replace function public.sync_swayphics_payment_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_op = 'DELETE' then
        perform public.recalculate_swayphics_invoice_balance(old.invoice_id);
        if old.project_id is not null then
            perform public.sync_swayphics_project_payment_status(old.project_id);
        end if;
    else
        if new.invoice_id is not null then
            perform public.recalculate_swayphics_invoice_balance(new.invoice_id);
        end if;

        if old.invoice_id is not null
           and old.invoice_id is distinct from new.invoice_id then
            perform public.recalculate_swayphics_invoice_balance(old.invoice_id);
        end if;

        if new.project_id is not null then
            perform public.sync_swayphics_project_payment_status(new.project_id);
        end if;

        if old.project_id is not null
           and old.project_id is distinct from new.project_id then
            perform public.sync_swayphics_project_payment_status(old.project_id);
        end if;
    end if;

    return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sync_swayphics_payment_after_change
on public.payments;

create trigger trg_sync_swayphics_payment_after_change
after insert or update or delete on public.payments
for each row
execute function public.sync_swayphics_payment_after_change();

-- Keep invoice balances correct when invoice totals/due dates change.
create or replace function public.sync_swayphics_invoice_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_paid numeric(12,2);
    v_total numeric(12,2);
    v_outstanding numeric(12,2);
    v_today date := (now() at time zone 'Africa/Johannesburg')::date;
begin
    if tg_op = 'INSERT' then
        new.amount_paid := 0;
        new.amount_outstanding := greatest(coalesce(new.total, 0), 0);
        new.status := case
            when new.status = 'cancelled' then 'cancelled'
            when new.status = 'draft' then 'draft'
            when new.due_date is not null
                 and new.due_date < v_today
                 and coalesce(new.total, 0) > 0 then 'overdue'
            else 'sent'
        end;
        return new;
    end if;

    if new.total is distinct from old.total
       or new.due_date is distinct from old.due_date
       or new.project_id is distinct from old.project_id
       or new.status is distinct from old.status
       or new.amount_paid is distinct from old.amount_paid
       or new.amount_outstanding is distinct from old.amount_outstanding
    then
        select coalesce(sum(
            case
                when p.status in ('paid', 'partially paid') then p.amount
                else 0
            end
        ), 0)
        into v_paid
        from public.payments p
        where p.invoice_id = new.id;

        v_total := greatest(coalesce(new.total, 0), 0);
        v_paid := greatest(0, least(coalesce(v_paid, 0), v_total));
        v_outstanding := greatest(v_total - v_paid, 0);

        new.amount_paid := v_paid;
        new.amount_outstanding := v_outstanding;
        new.status := case
            when new.status = 'cancelled' then 'cancelled'
            when v_total > 0 and v_paid >= v_total then 'paid'
            when new.status = 'draft' and v_paid <= 0 then 'draft'
            when new.due_date is not null
                 and new.due_date < v_today
                 and v_outstanding > 0 then 'overdue'
            when v_paid > 0 then 'partially paid'
            else 'sent'
        end;
    end if;

    return new;
end;
$$;

drop trigger if exists trg_sync_swayphics_invoice_before_change
on public.invoices;

create trigger trg_sync_swayphics_invoice_before_change
before insert or update on public.invoices
for each row
execute function public.sync_swayphics_invoice_after_change();

-- Project completion automation:
--   * create a portfolio record if one does not exist
--   * queue a client review request exactly once
create or replace function public.auto_swayphics_project_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_review_link text;
    v_client_email text;
    v_year integer;
begin
    if new.status = 'completed'
       and (
           tg_op = 'INSERT'
           or old.status is distinct from new.status
       ) then

        v_year :=
            extract(
                year from (
                    now() at time zone 'Africa/Johannesburg'
                )
            )::integer;

        insert into public.portfolio_projects (
            title,
            category,
            description,
            year,
            published,
            source_project_id
        )
        values (
            new.name,
            coalesce(new.service, 'Client work'),
            coalesce(
                new.description,
                'Completed project delivered by Swayphics.'
            ),
            v_year,
            false,
            new.id
        )
        on conflict do nothing;

        if new.client_id is not null then
            select email
            into v_client_email
            from public.clients
            where id = new.client_id;

            select review_link
            into v_review_link
            from public.workflow_settings
            where id = 1;

            insert into public.client_review_requests (
                project_id,
                client_id,
                email,
                review_url,
                status
            )
            values (
                new.id,
                new.client_id,
                v_client_email,
                coalesce(
                    v_review_link,
                    'https://swayphics.co.za/testimonial/'
                ),
                case
                    when coalesce(
                        trim(v_client_email),
                        ''
                    ) = ''
                        then 'skipped'
                    else 'queued'
                end
            )
            on conflict (project_id) do nothing;
        end if;
    end if;

    return new;
end;
$$;

drop trigger if exists trg_auto_swayphics_project_completion
on public.client_projects;

create trigger trg_auto_swayphics_project_completion
after insert or update of status on public.client_projects
for each row
execute function public.auto_swayphics_project_completion();

-- Set completed_at automatically in the South African timezone context.
create or replace function public.set_swayphics_project_completed_at()
returns trigger
language plpgsql
as $$
begin
    if new.status = 'completed'
       and (
           tg_op = 'INSERT'
           or old.status is distinct from new.status
       ) then
        new.completed_at = coalesce(
            new.completed_at,
            now()
        );
    end if;

    return new;
end;
$$;

drop trigger if exists trg_set_swayphics_project_completed_at
on public.client_projects;

create trigger trg_set_swayphics_project_completed_at
before insert or update of status on public.client_projects
for each row
execute function public.set_swayphics_project_completed_at();

-- Permissions and RLS for the new workflow tables.
alter table public.workflow_settings enable row level security;
alter table public.client_review_requests enable row level security;

grant select on table public.workflow_settings to authenticated;
grant select, insert, update, delete
on table public.client_review_requests
to authenticated;

grant all privileges on table public.workflow_settings
to service_role;

grant all privileges on table public.client_review_requests
to service_role;

drop policy if exists "Swayphics admins can view workflow settings"
on public.workflow_settings;

create policy "Swayphics admins can view workflow settings"
on public.workflow_settings
for select
to authenticated
using (public.is_swayphics_admin());

drop policy if exists "Swayphics admins can view review requests"
on public.client_review_requests;

create policy "Swayphics admins can view review requests"
on public.client_review_requests
for select
to authenticated
using (public.is_swayphics_admin());

drop policy if exists "Swayphics admins can manage review requests"
on public.client_review_requests;

create policy "Swayphics admins can manage review requests"
on public.client_review_requests
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

grant all privileges on table public.clients to service_role;
grant all privileges on table public.client_projects to service_role;
grant all privileges on table public.payments to service_role;
grant all privileges on table public.invoices to service_role;
grant all privileges on table public.invoice_items to service_role;
grant all privileges on table public.portfolio_projects to service_role;

-- Keep the next contact date populated when a completed follow-up updates the contact clock.
create or replace function public.ensure_swayphics_next_followup_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_days integer;
begin
    if new.last_contacted_at is not null
       and new.next_follow_up is null
       and new.status in (
           'contacted',
           'interested',
           'proposal sent',
           'negotiating',
           'follow-up'
       )
       and (
           tg_op = 'INSERT'
           or new.last_contacted_at is distinct from old.last_contacted_at
       )
    then
        select coalesce(
            (select ws.lead_no_response_days
             from public.workflow_settings ws
             where ws.id = 1),
            7
        )
        into v_days;

        new.next_follow_up :=
            (new.last_contacted_at at time zone 'Africa/Johannesburg')::date
            + v_days;
    end if;

    return new;
end;
$$;

revoke all privileges
    on function public.ensure_swayphics_next_followup_date()
    from public, anon, authenticated, service_role;

drop trigger if exists trg_z_ensure_swayphics_next_followup_date
    on public.leads;
create trigger trg_z_ensure_swayphics_next_followup_date
    before insert or update on public.leads
    for each row
    execute function public.ensure_swayphics_next_followup_date();

-- Ensure the stale-lead processor runs every 15 minutes, even when the dashboard is closed.
create extension if not exists pg_cron;
do $$
declare
    v_job_id bigint;
begin
    for v_job_id in
        select jobid
        from cron.job
        where jobname = 'swayphics-stale-lead-followups'
    loop
        perform cron.unschedule(v_job_id);
    end loop;

    perform cron.schedule(
        'swayphics-stale-lead-followups',
        '*/15 * * * *',
        'select innerme_private.process_swayphics_stale_leads_internal();'
    );
end;
$$;

notify pgrst, 'reload schema';

-- Synchronize project payment status after invoice insert/update/delete.
create or replace function public.sync_swayphics_project_after_invoice_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'DELETE' then
        perform public.sync_swayphics_project_payment_status(old.project_id);
        return old;
    end if;

    perform public.sync_swayphics_project_payment_status(new.project_id);

    if tg_op = 'UPDATE'
       and old.project_id is distinct from new.project_id then
        perform public.sync_swayphics_project_payment_status(old.project_id);
    end if;

    return new;
end;
$$;

revoke all privileges
    on function public.recalculate_swayphics_invoice_balance(uuid)
    from public, anon, authenticated, service_role;
revoke all privileges
    on function public.sync_swayphics_project_payment_status(uuid)
    from public, anon, authenticated, service_role;
revoke all privileges
    on function public.sync_swayphics_invoice_after_change()
    from public, anon, authenticated, service_role;
revoke all privileges
    on function public.sync_swayphics_project_after_invoice_change()
    from public, anon, authenticated, service_role;

drop trigger if exists trg_sync_swayphics_project_after_invoice_change
    on public.invoices;
create trigger trg_sync_swayphics_project_after_invoice_change
    after insert or update or delete on public.invoices
    for each row
    execute function public.sync_swayphics_project_after_invoice_change();

-- Date-boundary sweep: statuses and project payment indicators remain current after due dates pass.
create or replace function innerme_private.refresh_swayphics_invoice_statuses_internal()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_today date := (now() at time zone 'Africa/Johannesburg')::date;
    v_updated integer := 0;
begin
    update public.invoices i
    set status = 'overdue',
        updated_at = now()
    where i.archived = false
      and i.status in ('sent', 'partially paid')
      and i.due_date is not null
      and i.due_date < v_today
      and coalesce(i.amount_outstanding, 0) > 0;

    get diagnostics v_updated = row_count;
    return v_updated;
end;
$$;

revoke all privileges
    on function innerme_private.refresh_swayphics_invoice_statuses_internal()
    from public, anon, authenticated, service_role;

create extension if not exists pg_cron;
do $$
declare
    v_job_id bigint;
begin
    for v_job_id in
        select jobid
        from cron.job
        where jobname = 'swayphics-invoice-status-refresh'
    loop
        perform cron.unschedule(v_job_id);
    end loop;

    perform cron.schedule(
        'swayphics-invoice-status-refresh',
        '5 0 * * *',
        'select innerme_private.refresh_swayphics_invoice_statuses_internal();'
    );
end;
$$;

notify pgrst, 'reload schema';

-- Repair active contact records created before next-follow-up dates were auto-populated.
do $$
declare
    v_days integer;
begin
    select coalesce(
        (select ws.lead_no_response_days
         from public.workflow_settings ws
         where ws.id = 1),
        7
    )
    into v_days;

    update public.leads l
    set next_follow_up =
        (l.last_contacted_at at time zone 'Africa/Johannesburg')::date + v_days
    where l.next_follow_up is null
      and l.last_contacted_at is not null
      and l.status in (
          'contacted',
          'interested',
          'proposal sent',
          'negotiating',
          'follow-up'
      );
end;
$$;

-- Notify admins about first contact/follow-ups due today or already overdue.
create or replace function innerme_private.generate_swayphics_due_lead_notifications_internal()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_today date := (now() at time zone 'Africa/Johannesburg')::date;
    v_count integer := 0;
    r record;
    v_event_type text;
    v_title text;
    v_message text;
    v_dedupe_key text;
begin
    for r in
        select l.id, l.business_name, l.contact_name, l.status,
               l.assigned_to, l.next_follow_up
        from public.leads l
        where l.status not in ('won', 'lost', 'not interested')
          and l.next_follow_up <= v_today
        order by l.next_follow_up, l.business_name, l.id
    loop
        if r.next_follow_up < v_today then
            v_event_type := 'lead.overdue';
            if r.status = 'new' then
                v_title := 'First contact overdue';
                v_message := coalesce(
                    nullif(trim(r.business_name), ''),
                    nullif(trim(r.contact_name), ''),
                    'Lead'
                ) || ' was due for first contact on ' ||
                    to_char(r.next_follow_up, 'DD Mon YYYY') || '.';
            else
                v_title := 'Lead follow-up overdue';
                v_message := coalesce(
                    nullif(trim(r.business_name), ''),
                    nullif(trim(r.contact_name), ''),
                    'Lead'
                ) || ' had a follow-up due on ' ||
                    to_char(r.next_follow_up, 'DD Mon YYYY') || '.';
            end if;
        else
            v_event_type := 'lead.due_today';
            if r.status = 'new' then
                v_title := 'First contact due today';
                v_message := coalesce(
                    nullif(trim(r.business_name), ''),
                    nullif(trim(r.contact_name), ''),
                    'Lead'
                ) || ' is scheduled for first contact today.';
            else
                v_title := 'Lead follow-up due today';
                v_message := coalesce(
                    nullif(trim(r.business_name), ''),
                    nullif(trim(r.contact_name), ''),
                    'Lead'
                ) || ' has a follow-up scheduled for today.';
            end if;
        end if;

        v_dedupe_key := 'swayphics-lead-schedule:' ||
            r.id::text || ':' || v_today::text;

        if r.assigned_to is not null then
            perform public.create_admin_notification(
                r.assigned_to, null,
                'warning',
                v_event_type,
                v_title,
                v_message,
                'lead',
                r.id,
                'leads',
                v_dedupe_key
            );
        else
            perform public.notify_admins(
                null,
                'warning',
                v_event_type,
                v_title,
                v_message,
                'lead',
                r.id,
                'leads',
                v_dedupe_key,
                true
            );
        end if;

        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$$;


revoke all privileges
    on function innerme_private.generate_swayphics_due_lead_notifications_internal()
    from public, anon, authenticated, service_role;

do $$
declare
    v_job_id bigint;
begin
    for v_job_id in
        select jobid
        from cron.job
        where jobname = 'swayphics-leads-due-today'
    loop
        perform cron.unschedule(v_job_id);
    end loop;

    perform cron.schedule(
        'swayphics-leads-due-today',
        '*/15 * * * *',
        'select innerme_private.generate_swayphics_due_lead_notifications_internal();'
    );
end;
$$;

notify pgrst, 'reload schema';

-- Notify administrators when sent quotes reach their validity date.
create or replace function innerme_private.generate_swayphics_quote_expiry_notifications_internal()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_today date := (now() at time zone 'Africa/Johannesburg')::date;
    v_count integer := 0;
    r record;
    v_title text;
    v_message text;
    v_severity text;
    v_event_type text;
    v_dedupe_key text;
begin
    for r in
        select
            q.id,
            q.quote_number,
            q.title,
            q.valid_until,
            coalesce(l.assigned_to, c.assigned_to) as assigned_to
        from public.quotes q
        left join public.leads l on l.id = q.lead_id
        left join public.clients c on c.id = q.client_id
        where q.status = 'sent'
          and q.valid_until is not null
          and q.valid_until <= v_today
        order by q.valid_until asc, q.id
    loop
        if r.valid_until = v_today then
            v_title := 'Quote expires today';
            v_severity := 'warning';
            v_event_type := 'quote.expiry_due';
            v_message := coalesce(
                nullif(trim(r.quote_number), ''),
                nullif(trim(r.title), ''),
                'Quote'
            ) || ' is due to expire today. Review the prospect and decide whether to follow up.';
        else
            v_title := 'Quote has expired';
            v_severity := 'danger';
            v_event_type := 'quote.expired';
            v_message := coalesce(
                nullif(trim(r.quote_number), ''),
                nullif(trim(r.title), ''),
                'Quote'
            ) || ' expired on ' || to_char(r.valid_until, 'DD Mon YYYY') ||
            '. Verify its current status before re-engaging the prospect.';
        end if;

        v_dedupe_key := 'swayphics-quote-validity:' ||
            r.id::text || ':' || r.valid_until::text || ':' ||
            case when r.valid_until = v_today then 'due' else 'expired' end;

        if r.assigned_to is not null then
            perform public.create_admin_notification(
                r.assigned_to, null,
                v_severity,
                v_event_type,
                v_title,
                v_message,
                'quote',
                r.id,
                'quotes',
                v_dedupe_key
            );
        else
            perform public.notify_admins(
                null,
                v_severity,
                v_event_type,
                v_title,
                v_message,
                'quote',
                r.id,
                'quotes',
                v_dedupe_key,
                true
            );
        end if;

        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$$;

revoke all privileges
    on function innerme_private.generate_swayphics_quote_expiry_notifications_internal()
    from public, anon, authenticated, service_role;

do $$
declare
    v_job_id bigint;
begin
    for v_job_id in
        select jobid
        from cron.job
        where jobname = 'swayphics-quote-expiry-reminders'
    loop
        perform cron.unschedule(v_job_id);
    end loop;

    perform cron.schedule(
        'swayphics-quote-expiry-reminders',
        '*/15 * * * *',
        'select innerme_private.generate_swayphics_quote_expiry_notifications_internal();'
    );
end;
$$;

notify pgrst, 'reload schema';
