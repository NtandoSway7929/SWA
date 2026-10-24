-- Keep invoice status, project payment status and date-based overdue automation consistent.
-- This migration contains no data seeding or outbound email side effects.

begin;

create extension if not exists pg_cron;
create schema if not exists innerme_private;

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

-- A payment mutation is not the only event that changes project payment status:
-- invoice creation, status changes, re-association and deletion must also sync it.
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

-- The scheduled job runs as the migration/cron owner and does not expose a public RPC.
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

commit;
