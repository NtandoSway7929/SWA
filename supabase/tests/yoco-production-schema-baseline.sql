-- Yoco disposable QA baseline.
-- Read-only catalog snapshot from the Swayphics Web production schema, captured 2026-11-12.
-- This file contains schema metadata only: no business rows, Auth users, API keys, secrets,
-- or provider credentials. It is a focused dependency fixture for the Yoco migrations,
-- not a full production backup and must never be applied to production.
--
-- The repository's historical migration chain does not create the original Swayphics
-- workspace tables. This fixture creates the exact current table/constraint contracts
-- required by the Yoco migrations in an isolated Supabase test database.

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create sequence if not exists public.swayphics_invoice_number_seq start 1 increment 1;

set local search_path = public, extensions;

create table public."admin_users" (
  "user_id" uuid not null,
  "full_name" text not null,
  "email" text,
  "role" text default 'team_member'::text not null,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null
);

create table public."leads" (
  "id" uuid default gen_random_uuid() not null,
  "business_name" text not null,
  "contact_name" text,
  "email" text,
  "phone" text,
  "service_interest" text,
  "source" text,
  "status" text default 'new'::text not null,
  "estimated_value" numeric(12,2) default 0,
  "assigned_to" uuid,
  "next_follow_up" date,
  "notes" text,
  "converted_client_id" uuid,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "last_contacted_at" timestamp with time zone,
  "business_assessment" text,
  "research_findings" text,
  "swayphics_solution" text,
  "recommended_services" text,
  "research_sources" text,
  "assessment_updated_at" timestamp with time zone,
  "assessment_updated_by" uuid,
  "contacted_manually" boolean default false not null,
  "contacted_manually_at" timestamp with time zone,
  "contacted_manually_by" uuid
);

create table public."clients" (
  "id" uuid default gen_random_uuid() not null,
  "business_name" text not null,
  "contact_name" text,
  "email" text,
  "phone" text,
  "status" text default 'active'::text not null,
  "assigned_to" uuid,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "source_lead_id" uuid
);

create table public."client_projects" (
  "id" uuid default gen_random_uuid() not null,
  "client_id" uuid,
  "name" text not null,
  "service" text,
  "description" text,
  "status" text default 'planning'::text not null,
  "value" numeric(12,2) default 0,
  "due_date" date,
  "assigned_to" uuid,
  "payment_status" text default 'not invoiced'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "completed_at" timestamp with time zone,
  "review_requested_at" timestamp with time zone,
  "review_email_status" text default 'not requested'::text not null,
  "estimated_cost" numeric(12,2) default 0 not null
);

create table public."payments" (
  "id" uuid default gen_random_uuid() not null,
  "client_id" uuid,
  "project_id" uuid,
  "amount" numeric(12,2) default 0 not null,
  "status" text default 'due'::text not null,
  "method" text,
  "reference" text,
  "due_date" date,
  "paid_at" date,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "invoice_id" uuid
);

create table public."invoices" (
  "id" uuid default gen_random_uuid() not null,
  "invoice_number" text default ((('SWY-'::text || to_char((CURRENT_DATE)::timestamp with time zone, 'YYYY'::text)) || '-'::text) || lpad((nextval('swayphics_invoice_number_seq'::regclass))::text, 4, '0'::text)) not null,
  "client_id" uuid not null,
  "project_id" uuid,
  "issue_date" date default CURRENT_DATE not null,
  "due_date" date,
  "status" text default 'draft'::text not null,
  "currency" text default 'ZAR'::text not null,
  "subtotal" numeric(12,2) default 0 not null,
  "discount" numeric(12,2) default 0 not null,
  "vat_rate" numeric(5,2) default 0 not null,
  "vat_amount" numeric(12,2) default 0 not null,
  "total" numeric(12,2) default 0 not null,
  "notes" text,
  "email_status" text default 'not sent'::text not null,
  "sent_at" timestamp with time zone,
  "email_id" text,
  "email_error" text,
  "created_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "amount_paid" numeric(12,2) default 0 not null,
  "amount_outstanding" numeric(12,2) default 0 not null,
  "archived" boolean default false not null,
  "archived_at" timestamp with time zone
);

create table public."client_portal_tokens" (
  "id" uuid default gen_random_uuid() not null,
  "client_id" uuid not null,
  "token_hash" text not null,
  "active" boolean default true not null,
  "expires_at" timestamp with time zone,
  "created_by" uuid,
  "last_used_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "request_count" integer default 0 not null,
  "request_window_started_at" timestamp with time zone
);

create table public."quotes" (
  "id" uuid default gen_random_uuid() not null,
  "quote_number" text,
  "title" text not null,
  "lead_id" uuid,
  "client_id" uuid,
  "amount" numeric(12,2) default 0 not null,
  "status" text default 'draft'::text not null,
  "valid_until" date,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

-- Preserve primary keys, checks, unique constraints, and foreign-key relationships.
alter table public."admin_users" add constraint "admin_users_pkey" PRIMARY KEY (user_id);
alter table public."client_portal_tokens" add constraint "client_portal_tokens_pkey" PRIMARY KEY (id);
alter table public."client_portal_tokens" add constraint "client_portal_tokens_token_hash_key" UNIQUE (token_hash);
alter table public."client_projects" add constraint "client_projects_pkey" PRIMARY KEY (id);
alter table public."clients" add constraint "clients_pkey" PRIMARY KEY (id);
alter table public."invoices" add constraint "invoices_pkey" PRIMARY KEY (id);
alter table public."invoices" add constraint "invoices_invoice_number_key" UNIQUE (invoice_number);
alter table public."leads" add constraint "leads_pkey" PRIMARY KEY (id);
alter table public."payments" add constraint "payments_pkey" PRIMARY KEY (id);
alter table public."quotes" add constraint "quotes_pkey" PRIMARY KEY (id);
alter table public."admin_users" add constraint "admin_users_role_check" CHECK (role = ANY (ARRAY['owner'::text, 'team_member'::text]));
alter table public."client_projects" add constraint "client_projects_estimated_cost_check" CHECK (estimated_cost >= 0::numeric);
alter table public."client_projects" add constraint "client_projects_payment_status_check" CHECK (payment_status = ANY (ARRAY['not invoiced'::text, 'invoice drafted'::text, 'invoice sent'::text, 'partially paid'::text, 'paid'::text, 'overdue'::text]));
alter table public."client_projects" add constraint "client_projects_review_email_status_check" CHECK (review_email_status = ANY (ARRAY['not requested'::text, 'queued'::text, 'sent'::text, 'failed'::text]));
alter table public."client_projects" add constraint "client_projects_status_check" CHECK (status = ANY (ARRAY['planning'::text, 'in progress'::text, 'review'::text, 'completed'::text, 'paused'::text, 'cancelled'::text]));
alter table public."clients" add constraint "clients_status_check" CHECK (status = ANY (ARRAY['active'::text, 'archived'::text]));
alter table public."invoices" add constraint "invoices_email_status_check" CHECK (email_status = ANY (ARRAY['not sent'::text, 'sending'::text, 'sent'::text, 'failed'::text]));
alter table public."invoices" add constraint "invoices_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'sent'::text, 'partially paid'::text, 'paid'::text, 'overdue'::text, 'cancelled'::text]));
alter table public."leads" add constraint "leads_status_check" CHECK (status = ANY (ARRAY['new'::text, 'contacted'::text, 'interested'::text, 'proposal sent'::text, 'negotiating'::text, 'follow-up'::text, 'not interested'::text, 'won'::text, 'lost'::text]));
alter table public."payments" add constraint "payments_method_check" CHECK (method = ANY (ARRAY['EFT'::text, 'Cash'::text, 'Card'::text, 'PayFast'::text, 'Other'::text]));
alter table public."payments" add constraint "payments_status_check" CHECK (status = ANY (ARRAY['due'::text, 'partially paid'::text, 'paid'::text, 'overdue'::text]));
alter table public."quotes" add constraint "quotes_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'sent'::text, 'accepted'::text, 'rejected'::text, 'expired'::text]));
alter table public."admin_users" add constraint "admin_users_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public."client_portal_tokens" add constraint "client_portal_tokens_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
alter table public."client_portal_tokens" add constraint "client_portal_tokens_created_by_fkey" FOREIGN KEY (created_by) REFERENCES admin_users(user_id) ON DELETE SET NULL;
alter table public."client_projects" add constraint "client_projects_assigned_to_fkey" FOREIGN KEY (assigned_to) REFERENCES admin_users(user_id) ON DELETE SET NULL;
alter table public."client_projects" add constraint "client_projects_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
alter table public."clients" add constraint "clients_assigned_to_fkey" FOREIGN KEY (assigned_to) REFERENCES admin_users(user_id) ON DELETE SET NULL;
alter table public."clients" add constraint "clients_source_lead_id_fkey" FOREIGN KEY (source_lead_id) REFERENCES leads(id) ON DELETE SET NULL;
alter table public."invoices" add constraint "invoices_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT;
alter table public."invoices" add constraint "invoices_created_by_fkey" FOREIGN KEY (created_by) REFERENCES admin_users(user_id) ON DELETE SET NULL;
alter table public."invoices" add constraint "invoices_project_id_fkey" FOREIGN KEY (project_id) REFERENCES client_projects(id) ON DELETE SET NULL;
alter table public."leads" add constraint "leads_assessment_updated_by_fkey" FOREIGN KEY (assessment_updated_by) REFERENCES admin_users(user_id) ON DELETE SET NULL;
alter table public."leads" add constraint "leads_assigned_to_fkey" FOREIGN KEY (assigned_to) REFERENCES admin_users(user_id) ON DELETE SET NULL;
alter table public."leads" add constraint "leads_contacted_manually_by_fkey" FOREIGN KEY (contacted_manually_by) REFERENCES admin_users(user_id) ON DELETE SET NULL;
alter table public."leads" add constraint "leads_converted_client_id_fkey" FOREIGN KEY (converted_client_id) REFERENCES clients(id) ON DELETE SET NULL;
alter table public."payments" add constraint "payments_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
alter table public."payments" add constraint "payments_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;
alter table public."payments" add constraint "payments_project_id_fkey" FOREIGN KEY (project_id) REFERENCES client_projects(id) ON DELETE SET NULL;
alter table public."quotes" add constraint "quotes_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;
alter table public."quotes" add constraint "quotes_lead_id_fkey" FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;

-- Preserve row-level security posture for the existing exposed workspace tables.
alter table public."admin_users" enable row level security;
alter table public."leads" enable row level security;
alter table public."clients" enable row level security;
alter table public."client_projects" enable row level security;
alter table public."payments" enable row level security;
alter table public."invoices" enable row level security;
alter table public."client_portal_tokens" enable row level security;
alter table public."quotes" enable row level security;

CREATE OR REPLACE FUNCTION public.is_swayphics_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select exists (
        select 1
        from public.admin_users
        where user_id = auth.uid()
          and active = true
    );
$function$;


CREATE OR REPLACE FUNCTION public.next_swayphics_invoice_number()
 RETURNS text
 LANGUAGE sql
AS $function$
    select
        'SWY-' ||
        to_char(current_date, 'YYYY') ||
        '-' ||
        lpad(nextval('public.swayphics_invoice_number_seq')::text, 4, '0');
$function$;


CREATE OR REPLACE FUNCTION public.sync_swayphics_payment_after_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;


CREATE OR REPLACE FUNCTION public.sync_swayphics_project_payment_status(p_project_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;


CREATE OR REPLACE FUNCTION public.sync_swayphics_project_after_invoice_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

-- These three functions are replaced by migration 202611110002; keep their
-- signatures present so the existing production trigger attachments are represented.
create or replace function public.recalculate_swayphics_invoice_balance(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$ begin return; end; $$;

create or replace function public.sync_swayphics_invoice_after_change()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin return new; end; $$;

create or replace function public.enforce_swayphics_payment_invoice_integrity()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin return new; end; $$;

-- Migration 202611110002 replaces this existing RPC while preserving its signature.
create or replace function public.get_client_portal(p_token text)
returns jsonb language plpgsql security definer set search_path = 'public'
as $$ begin return jsonb_build_object('ok', false); end; $$;

-- Retain the production invoice/payment trigger paths touched by the Yoco logic.
create trigger trg_sync_swayphics_invoice_before_change
before insert or update on public.invoices
for each row execute function public.sync_swayphics_invoice_after_change();

create trigger trg_enforce_swayphics_payment_invoice_integrity
before insert or update on public.payments
for each row execute function public.enforce_swayphics_payment_invoice_integrity();

create trigger trg_sync_swayphics_project_after_invoice_change
after insert or delete or update on public.invoices
for each row execute function public.sync_swayphics_project_after_invoice_change();

create trigger trg_sync_swayphics_payment_after_change
after insert or delete or update on public.payments
for each row execute function public.sync_swayphics_payment_after_change();

commit;
