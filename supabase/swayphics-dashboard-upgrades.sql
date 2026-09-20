-- SWAYPHICS DASHBOARD UPGRADES
-- Run once in Supabase SQL Editor after the existing workspace/billing SQL.

-- =========================================================
-- COMMUNICATION LOG
-- =========================================================

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

-- =========================================================
-- PROJECT COST TRACKING
-- =========================================================

alter table public.client_projects
    add column if not exists estimated_cost numeric(12,2) not null default 0
    check (estimated_cost >= 0);

-- =========================================================
-- LEAD STAGE HISTORY
-- =========================================================

create table if not exists public.lead_stage_history (
    id uuid primary key default gen_random_uuid(),
    lead_id uuid not null references public.leads(id) on delete cascade,
    from_status text,
    to_status text not null,
    changed_at timestamptz not null default now(),
    changed_by uuid references public.admin_users(user_id) on delete set null
);

create index if not exists lead_stage_history_lead_idx
    on public.lead_stage_history(lead_id, changed_at desc);

create index if not exists lead_stage_history_changed_idx
    on public.lead_stage_history(changed_at desc);

create or replace function public.record_lead_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_op = 'INSERT' then
        insert into public.lead_stage_history (
            lead_id,
            from_status,
            to_status,
            changed_by
        )
        values (
            new.id,
            null,
            new.status,
            auth.uid()
        );
        return new;
    end if;

    if tg_op = 'UPDATE' and new.status is distinct from old.status then
        insert into public.lead_stage_history (
            lead_id,
            from_status,
            to_status,
            changed_by
        )
        values (
            new.id,
            old.status,
            new.status,
            auth.uid()
        );
    end if;

    return new;
end;
$$;

drop trigger if exists leads_stage_history_trigger
    on public.leads;

create trigger leads_stage_history_trigger
after insert or update of status
on public.leads
for each row
execute function public.record_lead_stage_change();

insert into public.lead_stage_history (
    lead_id,
    from_status,
    to_status,
    changed_at
)
select
    l.id,
    null,
    l.status,
    coalesce(l.created_at, now())
from public.leads l
where not exists (
    select 1
    from public.lead_stage_history h
    where h.lead_id = l.id
);

-- =========================================================
-- SECURE CLIENT PORTAL
-- =========================================================

create table if not exists public.client_portal_tokens (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete cascade,
    token_hash text not null unique,
    active boolean not null default true,
    expires_at timestamptz,
    created_by uuid references public.admin_users(user_id) on delete set null,
    last_used_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists client_portal_tokens_client_idx
    on public.client_portal_tokens(client_id, created_at desc);

create index if not exists client_portal_tokens_active_idx
    on public.client_portal_tokens(active, expires_at);

alter table public.client_portal_tokens enable row level security;

grant select, insert, update, delete
on table public.client_portal_tokens
to authenticated;

drop policy if exists "Swayphics admins can manage portal tokens"
    on public.client_portal_tokens;

create policy "Swayphics admins can manage portal tokens"
on public.client_portal_tokens
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

-- The public portal does not read tables directly. It calls this
-- tightly scoped RPC, which validates a hashed token first.
create or replace function public.get_client_portal(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_token public.client_portal_tokens%rowtype;
    v_result jsonb;
begin
    if p_token is null or length(trim(p_token)) < 32 then
        return jsonb_build_object(
            'ok', false,
            'error', 'Invalid portal link.'
        );
    end if;

    select *
    into v_token
    from public.client_portal_tokens
    where token_hash = encode(
        digest(trim(p_token), 'sha256'),
        'hex'
    )
      and active = true
      and (
          expires_at is null
          or expires_at > now()
      )
    order by created_at desc
    limit 1;

    if not found then
        return jsonb_build_object(
            'ok', false,
            'error', 'This portal link is invalid or has expired.'
        );
    end if;

    update public.client_portal_tokens
    set last_used_at = now()
    where id = v_token.id;

    select jsonb_build_object(
        'ok', true,
        'client', jsonb_build_object(
            'id', c.id,
            'business_name', c.business_name,
            'contact_name', c.contact_name,
            'email', c.email,
            'phone', c.phone,
            'status', c.status
        ),
        'projects', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id', p.id,
                    'name', p.name,
                    'service', p.service,
                    'description', p.description,
                    'status', p.status,
                    'value', p.value,
                    'due_date', p.due_date,
                    'payment_status', p.payment_status
                )
                order by p.created_at desc
            )
            from public.client_projects p
            where p.client_id = c.id
        ), '[]'::jsonb),
        'quotes', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id', q.id,
                    'quote_number', q.quote_number,
                    'title', q.title,
                    'amount', q.amount,
                    'status', q.status,
                    'valid_until', q.valid_until,
                    'notes', q.notes
                )
                order by q.created_at desc
            )
            from public.quotes q
            where q.client_id = c.id
              and q.status <> 'rejected'
        ), '[]'::jsonb),
        'invoices', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id', i.id,
                    'invoice_number', i.invoice_number,
                    'issue_date', i.issue_date,
                    'due_date', i.due_date,
                    'status', i.status,
                    'currency', i.currency,
                    'total', i.total,
                    'amount_outstanding', i.total - coalesce((
                        select sum(pp.amount)
                        from public.payments pp
                        where pp.invoice_id = i.id
                          and pp.status = 'paid'
                    ), 0),
                    'notes', i.notes
                )
                order by i.created_at desc
            )
            from public.invoices i
            where i.client_id = c.id
              and i.status <> 'cancelled'
        ), '[]'::jsonb),
        'payments', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id', pp.id,
                    'amount', pp.amount,
                    'method', pp.method,
                    'reference', pp.reference,
                    'paid_at', pp.paid_at
                )
                order by pp.paid_at desc nulls last, pp.created_at desc
            )
            from public.payments pp
            where pp.client_id = c.id
              and pp.status = 'paid'
        ), '[]'::jsonb)
    )
    into v_result
    from public.clients c
    where c.id = v_token.client_id;

    if v_result is null then
        return jsonb_build_object(
            'ok', false,
            'error', 'This client record is no longer available.'
        );
    end if;

    return v_result;
end;
$$;

revoke all on function public.get_client_portal(text)
    from public;

grant execute on function public.get_client_portal(text)
    to anon, authenticated;

-- =========================================================
-- CLIENT PORTAL REQUESTS
-- =========================================================

create table if not exists public.client_portal_requests (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete cascade,
    subject text not null,
    message text not null,
    status text not null default 'new'
        check (status in ('new','in progress','completed')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists client_portal_requests_client_idx
    on public.client_portal_requests(client_id, created_at desc);

alter table public.client_portal_requests enable row level security;

grant select, insert, update, delete
on table public.client_portal_requests
to authenticated;

drop policy if exists "Swayphics admins can manage portal requests"
    on public.client_portal_requests;

create policy "Swayphics admins can manage portal requests"
on public.client_portal_requests
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

create or replace function public.submit_client_portal_request(
    p_token text,
    p_subject text,
    p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_token public.client_portal_tokens%rowtype;
    v_request public.client_portal_requests%rowtype;
begin
    select *
    into v_token
    from public.client_portal_tokens
    where token_hash = encode(
        digest(trim(p_token), 'sha256'),
        'hex'
    )
      and active = true
      and (
          expires_at is null
          or expires_at > now()
      )
    order by created_at desc
    limit 1;

    if not found then
        return jsonb_build_object(
            'ok', false,
            'error', 'This portal link is invalid or has expired.'
        );
    end if;

    if length(trim(coalesce(p_subject, ''))) < 2 then
        return jsonb_build_object(
            'ok', false,
            'error', 'Please enter a subject.'
        );
    end if;

    if length(trim(coalesce(p_message, ''))) < 2 then
        return jsonb_build_object(
            'ok', false,
            'error', 'Please enter a message.'
        );
    end if;

    insert into public.client_portal_requests (
        client_id,
        subject,
        message
    )
    values (
        v_token.client_id,
        left(trim(p_subject), 180),
        left(trim(p_message), 5000)
    )
    returning * into v_request;

    update public.client_portal_tokens
    set last_used_at = now()
    where id = v_token.id;

    return jsonb_build_object(
        'ok', true,
        'request_id', v_request.id
    );
end;
$$;

revoke all on function public.submit_client_portal_request(text,text,text)
    from public;

grant execute on function public.submit_client_portal_request(text,text,text)
    to anon, authenticated;

notify pgrst, 'reload schema';


-- =========================================================
-- PRIVATE CLIENT / PROJECT DOCUMENT STORAGE
-- =========================================================

create table if not exists public.client_documents (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete cascade,
    project_id uuid references public.client_projects(id) on delete cascade,
    file_name text not null,
    storage_path text not null unique,
    mime_type text,
    size_bytes bigint not null default 0,
    uploaded_by uuid references public.admin_users(user_id) on delete set null,
    created_at timestamptz not null default now()
);

create index if not exists client_documents_client_idx
    on public.client_documents(client_id, created_at desc);

create index if not exists client_documents_project_idx
    on public.client_documents(project_id, created_at desc);

alter table public.client_documents enable row level security;

grant select, insert, update, delete
on table public.client_documents
to authenticated;

drop policy if exists "Swayphics admins can manage client documents"
    on public.client_documents;

create policy "Swayphics admins can manage client documents"
on public.client_documents
for all
to authenticated
using (public.is_swayphics_admin())
with check (public.is_swayphics_admin());

-- Private Supabase Storage bucket for internal client/project files.
insert into storage.buckets (id, name, public)
values ('swayphics-client-files', 'swayphics-client-files', false)
on conflict (id) do nothing;

drop policy if exists "Swayphics admins can read client files"
    on storage.objects;

create policy "Swayphics admins can read client files"
on storage.objects
for select
to authenticated
using (
    bucket_id = 'swayphics-client-files'
    and public.is_swayphics_admin()
);

drop policy if exists "Swayphics admins can upload client files"
    on storage.objects;

create policy "Swayphics admins can upload client files"
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'swayphics-client-files'
    and public.is_swayphics_admin()
);

drop policy if exists "Swayphics admins can update client files"
    on storage.objects;

create policy "Swayphics admins can update client files"
on storage.objects
for update
to authenticated
using (
    bucket_id = 'swayphics-client-files'
    and public.is_swayphics_admin()
)
with check (
    bucket_id = 'swayphics-client-files'
    and public.is_swayphics_admin()
);

drop policy if exists "Swayphics admins can delete client files"
    on storage.objects;

create policy "Swayphics admins can delete client files"
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'swayphics-client-files'
    and public.is_swayphics_admin()
);

notify pgrst, 'reload schema';
