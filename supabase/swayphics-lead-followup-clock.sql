-- SWAYPHICS LEAD FOLLOW-UP CLOCK
-- Run after the existing lead/workflow migrations.
--
-- The lead no-response window is counted from the latest outbound contact.
-- Contact can come from:
--   1) an outbound communication_logs entry, or
--   2) the admin manual "Mark contacted" action.
--
-- The interval is read from workflow_settings.lead_no_response_days.

alter table public.leads
    add column if not exists last_contacted_at timestamptz;

alter table public.leads
    add column if not exists contacted_manually boolean not null default false;

alter table public.leads
    add column if not exists contacted_manually_at timestamptz;

alter table public.leads
    add column if not exists contacted_manually_by uuid
        references public.admin_users(user_id)
        on delete set null;

create index if not exists leads_last_contacted_idx
    on public.leads(last_contacted_at);

create index if not exists leads_contacted_manually_idx
    on public.leads(contacted_manually);

create index if not exists leads_contacted_manually_at_idx
    on public.leads(contacted_manually_at desc);

-- Recalculate the lead's contact clock from the latest available contact.
create or replace function public.recalculate_swayphics_lead_contact_clock(
    p_lead_id uuid
)
returns public.leads
language plpgsql
security definer
set search_path = public
as $$
declare
    v_lead public.leads%rowtype;
    v_latest_contact timestamptz;
    v_days integer;
begin
    -- This function is also called by a database trigger from communication_logs.
    -- Authorization is enforced by the public RPC wrapper, not by the trigger path.

    select *
    into v_lead
    from public.leads
    where id = p_lead_id
    for update;

    if not found then
        raise exception 'Lead could not be found.';
    end if;

    select coalesce(lead_no_response_days, 7)
    into v_days
    from public.workflow_settings
    where id = 1;

    select max(contacted_at)
    into v_latest_contact
    from public.communication_logs
    where lead_id = p_lead_id
      and lower(coalesce(direction, '')) = 'outbound';

    v_latest_contact := greatest(
        coalesce(v_latest_contact, 'epoch'::timestamptz),
        coalesce(v_lead.contacted_manually_at, 'epoch'::timestamptz)
    );

    if v_latest_contact = 'epoch'::timestamptz then
        update public.leads
        set
            last_contacted_at = null,
            next_follow_up = null,
            updated_at = now()
        where id = p_lead_id
        returning * into v_lead;

        return v_lead;
    end if;

    update public.leads
    set
        last_contacted_at = v_latest_contact,
        next_follow_up =
            (
                v_latest_contact
                at time zone 'Africa/Johannesburg'
            )::date + coalesce(v_days, 7),
        status =
            case
                when status = 'new' then 'contacted'
                else status
            end,
        updated_at = now()
    where id = p_lead_id
    returning * into v_lead;

    return v_lead;
end;
$$;

revoke all on function public.recalculate_swayphics_lead_contact_clock(uuid)
from public;

grant execute on function public.recalculate_swayphics_lead_contact_clock(uuid)
to authenticated;

-- Automatically move the follow-up clock whenever an outbound communication
-- is added or edited for a lead.
create or replace function public.sync_swayphics_lead_contact_from_communication()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_lead_id uuid;
begin
    if tg_op = 'DELETE' then
        if old.lead_id is not null then
            perform public.recalculate_swayphics_lead_contact_clock(
                old.lead_id
            );
        end if;

        return old;
    end if;

    if tg_op = 'UPDATE'
       and old.lead_id is not null
       and old.lead_id is distinct from new.lead_id then
        perform public.recalculate_swayphics_lead_contact_clock(
            old.lead_id
        );
    end if;

    if new.lead_id is not null then
        perform public.recalculate_swayphics_lead_contact_clock(
            new.lead_id
        );
    end if;

    return new;
end;
$$;

drop trigger if exists trg_sync_swayphics_lead_contact_from_communication
on public.communication_logs;

create trigger trg_sync_swayphics_lead_contact_from_communication
after insert or update of lead_id, direction, contacted_at or delete
on public.communication_logs
for each row
execute function public.sync_swayphics_lead_contact_from_communication();

-- Keep the existing status-based contact clock aligned with the same
-- follow-up calculation when a lead is moved into a contacted/progressed stage.
create or replace function public.touch_swayphics_lead_contacted()
returns trigger
language plpgsql
as $$
declare
    v_days integer;
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
        select coalesce(lead_no_response_days, 7)
        into v_days
        from public.workflow_settings
        where id = 1;

        new.last_contacted_at = now();
        new.next_follow_up =
            current_date + coalesce(v_days, 7);
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

-- Central function used by the admin dashboard's manual Contacted control.
-- It also starts/resets the follow-up clock.
create or replace function public.set_swayphics_lead_manual_contact(
    p_lead_id uuid,
    p_contacted boolean
)
returns public.leads
language plpgsql
security definer
set search_path = public
as $$
declare
    v_lead public.leads%rowtype;
    v_days integer;
    v_now timestamptz := now();
begin
    if not public.is_swayphics_admin() then
        raise exception 'Active Swayphics admin access required.';
    end if;

    select coalesce(lead_no_response_days, 7)
    into v_days
    from public.workflow_settings
    where id = 1;

    select *
    into v_lead
    from public.leads
    where id = p_lead_id
    for update;

    if not found then
        raise exception 'Lead could not be found.';
    end if;

    if p_contacted then
        update public.leads
        set
            contacted_manually = true,
            contacted_manually_at = v_now,
            contacted_manually_by = auth.uid(),
            last_contacted_at = v_now,
            next_follow_up =
                (
                    v_now
                    at time zone 'Africa/Johannesburg'
                )::date + coalesce(v_days, 7),
            status =
                case
                    when status = 'new' then 'contacted'
                    else status
                end,
            updated_at = v_now
        where id = p_lead_id
        returning * into v_lead;
    else
        update public.leads
        set
            contacted_manually = false,
            contacted_manually_at = null,
            contacted_manually_by = null,
            updated_at = v_now
        where id = p_lead_id
        returning * into v_lead;

        select public.recalculate_swayphics_lead_contact_clock(
            p_lead_id
        )
        into v_lead;
    end if;

    return v_lead;
end;
$$;

revoke all on function public.set_swayphics_lead_manual_contact(uuid, boolean)
from public;

grant execute on function public.set_swayphics_lead_manual_contact(uuid, boolean)
to authenticated;



-- Backfill existing leads from their most recent outbound communication or
-- existing manual contact timestamp so the new clock applies immediately.
do $
declare
    v_lead record;
begin
    for v_lead in
        select id
        from public.leads
        where exists (
            select 1
            from public.communication_logs c
            where c.lead_id = public.leads.id
              and lower(coalesce(c.direction, '')) = 'outbound'
        )
        or contacted_manually_at is not null
    loop
        perform public.recalculate_swayphics_lead_contact_clock(
            v_lead.id
        );
    end loop;
end;
$;

notify pgrst, 'reload schema';

