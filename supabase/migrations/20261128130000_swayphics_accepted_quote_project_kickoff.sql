-- Explicit accepted-quote to project kickoff handoff.
-- A project is created only by an authenticated administrator after client and
-- agreement conversion. Existing project, task, invoice and portal workflows remain authoritative.

begin;

alter table public.client_projects
    add column if not exists source_quote_id uuid
        references public.quotes(id) on delete restrict,
    add column if not exists source_agreement_id uuid
        references public.swayphics_project_agreements(id) on delete restrict;

do $block$
begin
    if not exists (
        select 1
        from pg_catalog.pg_constraint
        where conrelid = 'public.client_projects'::regclass
          and conname = 'client_projects_source_agreement_pair_check'
    ) then
        alter table public.client_projects
            add constraint client_projects_source_agreement_pair_check
            check (
                (source_quote_id is null and source_agreement_id is null)
                or
                (source_quote_id is not null and source_agreement_id is not null)
            );
    end if;
end;
$block$;

create unique index if not exists client_projects_source_quote_uidx
    on public.client_projects(source_quote_id)
    where source_quote_id is not null;

create unique index if not exists client_projects_source_agreement_uidx
    on public.client_projects(source_agreement_id)
    where source_agreement_id is not null;

create or replace function public.validate_swayphics_project_source_agreement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_quote public.quotes%rowtype;
    v_agreement public.swayphics_project_agreements%rowtype;
begin
    if tg_op = 'UPDATE'
       and old.source_quote_id is not null
       and (
           new.source_quote_id is distinct from old.source_quote_id
           or new.source_agreement_id is distinct from old.source_agreement_id
       ) then
        raise exception 'A project source quote and accepted agreement cannot be changed after kickoff.'
            using errcode = '55000';
    end if;

    if new.source_quote_id is null and new.source_agreement_id is null then
        return new;
    end if;

    if new.source_quote_id is null or new.source_agreement_id is null then
        raise exception 'A project must reference both its accepted quote and its accepted agreement.'
            using errcode = '23514';
    end if;

    select *
      into v_quote
      from public.quotes q
     where q.id = new.source_quote_id;

    if not found then
        raise exception 'The source quotation could not be found.'
            using errcode = '23503';
    end if;

    select *
      into v_agreement
      from public.swayphics_project_agreements a
     where a.id = new.source_agreement_id
       and a.quote_id = v_quote.id;

    if not found then
        raise exception 'The source agreement does not belong to the selected quotation.'
            using errcode = '23514';
    end if;

    if v_quote.status <> 'accepted'
       or v_quote.client_id is null
       or new.client_id is distinct from v_quote.client_id
       or v_agreement.client_id is distinct from v_quote.client_id
       or v_agreement.proposal_version_id is distinct from v_quote.proposal_version_id
       or not exists (
            select 1
              from public.quote_review_responses r
             where r.id = v_agreement.review_response_id
               and r.quote_id = v_quote.id
               and r.proposal_version_id = v_quote.proposal_version_id
               and r.decision = 'accepted'
               and r.terms_accepted is true
       ) then
        raise exception 'A project can only be linked to the current accepted quote, converted client and matching Terms-acknowledged agreement.'
            using errcode = '55000';
    end if;

    return new;
end;
$function$;

revoke all on function public.validate_swayphics_project_source_agreement()
    from public, anon, authenticated, service_role;

drop trigger if exists trg_validate_swayphics_project_source_agreement
    on public.client_projects;
create trigger trg_validate_swayphics_project_source_agreement
before insert or update of client_id, source_quote_id, source_agreement_id
on public.client_projects
for each row
execute function public.validate_swayphics_project_source_agreement();

create or replace function public.link_swayphics_project_invoice_after_quote_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_project public.client_projects%rowtype;
    v_invoice public.invoices%rowtype;
begin
    if new.invoice_id is null
       or new.invoice_id is not distinct from old.invoice_id then
        return new;
    end if;

    select *
      into v_project
      from public.client_projects p
     where p.source_quote_id = new.id
     for update;

    if not found then
        return new;
    end if;

    select *
      into v_invoice
      from public.invoices i
     where i.id = new.invoice_id
     for update;

    if not found then
        raise exception 'The invoice linked to the accepted quotation could not be found.'
            using errcode = '23503';
    end if;

    if v_invoice.client_id is distinct from v_project.client_id then
        raise exception 'The accepted quote invoice belongs to a different client than its project.'
            using errcode = '23514';
    end if;

    if v_invoice.project_id is not null
       and v_invoice.project_id is distinct from v_project.id then
        raise exception 'The accepted quote invoice is already linked to another project.'
            using errcode = '23514';
    end if;

    update public.invoices
       set project_id = v_project.id,
           updated_at = now()
     where id = v_invoice.id
       and project_id is null;

    return new;
end;
$function$;

revoke all on function public.link_swayphics_project_invoice_after_quote_change()
    from public, anon, authenticated, service_role;

drop trigger if exists trg_link_swayphics_project_invoice_after_quote_change
    on public.quotes;
create trigger trg_link_swayphics_project_invoice_after_quote_change
after update of invoice_id on public.quotes
for each row
execute function public.link_swayphics_project_invoice_after_quote_change();

create or replace function public.admin_create_project_from_accepted_quote(
    p_quote_id uuid,
    p_project_name text,
    p_service text default null,
    p_description text default null,
    p_due_date date default null,
    p_assigned_to uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_quote public.quotes%rowtype;
    v_agreement public.swayphics_project_agreements%rowtype;
    v_project public.client_projects%rowtype;
    v_invoice public.invoices%rowtype;
    v_project_name text;
    v_service text;
    v_description text;
    v_task_count integer := 0;
    v_invoice_linked boolean := false;
    v_already_created boolean := false;
begin
    if auth.uid() is null or not public.is_swayphics_admin() then
        raise exception 'Only an authenticated Swayphics administrator can start an accepted project.'
            using errcode = '42501';
    end if;

    v_project_name := nullif(btrim(coalesce(p_project_name, '')), '');
    v_service := nullif(btrim(coalesce(p_service, '')), '');
    v_description := nullif(btrim(coalesce(p_description, '')), '');

    if v_project_name is null or length(v_project_name) < 2 or length(v_project_name) > 160 then
        raise exception 'Enter a project name between 2 and 160 characters.'
            using errcode = '22023';
    end if;

    if v_service is not null and length(v_service) > 300 then
        raise exception 'The project service summary cannot exceed 300 characters.'
            using errcode = '22023';
    end if;

    if v_description is not null and length(v_description) > 12000 then
        raise exception 'The project description cannot exceed 12000 characters.'
            using errcode = '22023';
    end if;

    select *
      into v_quote
      from public.quotes q
     where q.id = p_quote_id
     for update;

    if not found then
        raise exception 'The quotation could not be found.'
            using errcode = 'P0002';
    end if;

    if v_quote.status <> 'accepted' or v_quote.client_id is null then
        raise exception 'Convert the accepted quotation to a client before creating its project.'
            using errcode = '55000';
    end if;

    select *
      into v_agreement
      from public.swayphics_project_agreements a
     where a.quote_id = v_quote.id
       and a.proposal_version_id = v_quote.proposal_version_id
       and a.client_id = v_quote.client_id
       and exists (
            select 1
              from public.quote_review_responses r
             where r.id = a.review_response_id
               and r.quote_id = v_quote.id
               and r.proposal_version_id = v_quote.proposal_version_id
               and r.decision = 'accepted'
               and r.terms_accepted is true
       )
     for update;

    if not found then
        raise exception 'A matching accepted agreement and Terms & Conditions acknowledgement are required before project kickoff.'
            using errcode = '55000';
    end if;

    if not exists (
        select 1
          from public.quote_items qi
         where qi.quote_id = v_quote.id
    ) then
        raise exception 'The accepted quotation has no saved service line items.'
            using errcode = '23514';
    end if;

    if p_assigned_to is not null
       and not exists (
            select 1
              from public.admin_users au
             where au.user_id = p_assigned_to
               and au.active is true
       ) then
        raise exception 'The selected project owner is not an active Swayphics administrator.'
            using errcode = '22023';
    end if;

    select *
      into v_project
      from public.client_projects p
     where p.source_quote_id = v_quote.id
     for update;

    if found then
        v_already_created := true;
        if v_project.client_id is distinct from v_quote.client_id
           or v_project.source_agreement_id is distinct from v_agreement.id then
            raise exception 'An existing project is linked to inconsistent accepted-sale records.'
                using errcode = '55000';
        end if;
    else
        insert into public.client_projects (
            client_id,
            name,
            service,
            description,
            status,
            value,
            due_date,
            assigned_to,
            payment_status,
            source_quote_id,
            source_agreement_id
        ) values (
            v_quote.client_id,
            v_project_name,
            v_service,
            v_description,
            'planning',
            v_quote.amount,
            p_due_date,
            p_assigned_to,
            'not invoiced',
            v_quote.id,
            v_agreement.id
        )
        returning * into v_project;
    end if;

    if v_quote.invoice_id is not null then
        select *
          into v_invoice
          from public.invoices i
         where i.id = v_quote.invoice_id
         for update;

        if not found then
            raise exception 'The invoice linked to this quotation could not be found.'
                using errcode = '23503';
        end if;

        if v_invoice.client_id is distinct from v_project.client_id then
            raise exception 'The accepted quote invoice belongs to a different client than its project.'
                using errcode = '23514';
        end if;

        if v_invoice.project_id is not null
           and v_invoice.project_id is distinct from v_project.id then
            raise exception 'The accepted quote invoice is already linked to another project.'
                using errcode = '23514';
        end if;

        update public.invoices
           set project_id = v_project.id,
               updated_at = now()
         where id = v_invoice.id
           and project_id is null;

        v_invoice_linked := true;
    end if;

    select count(*)::integer
      into v_task_count
      from public.tasks t
     where t.project_id = v_project.id;

    return jsonb_build_object(
        'success', true,
        'project_id', v_project.id,
        'project_name', v_project.name,
        'client_id', v_project.client_id,
        'source_quote_id', v_project.source_quote_id,
        'source_agreement_id', v_project.source_agreement_id,
        'status', v_project.status,
        'due_date', v_project.due_date,
        'invoice_id', case when v_invoice_linked then v_quote.invoice_id else null end,
        'invoice_linked', v_invoice_linked,
        'task_count', v_task_count,
        'already_created', v_already_created
    );
end;
$function$;

revoke all on function public.admin_create_project_from_accepted_quote(
    uuid, text, text, text, date, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.admin_create_project_from_accepted_quote(
    uuid, text, text, text, date, uuid
) to authenticated;

comment on column public.client_projects.source_quote_id is
    'The accepted quotation that authorised this project kickoff. Immutable after assignment.';
comment on column public.client_projects.source_agreement_id is
    'The immutable accepted agreement snapshot authorising this project kickoff. Immutable after assignment.';
comment on function public.admin_create_project_from_accepted_quote(
    uuid, text, text, text, date, uuid
) is
    'Creates or returns one project for a converted accepted quote. Uses existing project due-date and task-template triggers and links existing or later-created quote invoices.';

notify pgrst, 'reload schema';
commit;
