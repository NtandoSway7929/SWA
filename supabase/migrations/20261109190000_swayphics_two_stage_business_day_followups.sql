-- Fixed two-stage lead follow-ups: two South African business days from
-- contact, then two business days from completion of attempt one.
-- Weekdays only (Monday-Friday) in the South African local calendar.
create or replace function public.swayphics_add_business_days(p_start_date date,p_days integer)
returns date language plpgsql immutable strict set search_path = '' as $$
declare v_date date := p_start_date; v_remaining integer := p_days;
begin
    if p_days < 0 then raise exception 'Business-day offsets cannot be negative.'; end if;
    while v_remaining > 0 loop
        v_date := v_date + 1;
        if extract(isodow from v_date) between 1 and 5 then v_remaining := v_remaining - 1; end if;
    end loop;
    return v_date;
end;
$$;
revoke all privileges on function public.swayphics_add_business_days(date,integer)
from public,anon,authenticated,service_role;


-- Persist a two-attempt sequence against each lead's actual follow-up records.
alter table public.follow_ups add column if not exists automation_sequence smallint;

-- Legacy first-contact tasks were internal reminders, not completed outreach.
update public.follow_ups set status='skipped',completed_at=null,automation_sequence=null
where coalesce(note,'') like 'Automatic first-contact task:%';

-- Sequence existing, genuine pending/completed lead follow-ups in historical order.
with ranked as (
    select f.id,row_number() over(partition by f.lead_id order by f.created_at,f.id) as attempt_number
    from public.follow_ups f
    where f.lead_id is not null and f.status in ('pending','completed')
      and f.automation_sequence is null
)
update public.follow_ups f set automation_sequence=ranked.attempt_number::smallint
from ranked where f.id=ranked.id and ranked.attempt_number between 1 and 2;

-- Retire historical pending reminders beyond the two-attempt cap.
with ranked as (
    select f.id,row_number() over(partition by f.lead_id order by f.created_at,f.id) as attempt_number
    from public.follow_ups f
    where f.lead_id is not null and f.status in ('pending','completed')
)
update public.follow_ups f set status='skipped',completed_at=null
from ranked where f.id=ranked.id and ranked.attempt_number>2 and f.status='pending';

alter table public.follow_ups drop constraint if exists follow_ups_automation_sequence_check;
alter table public.follow_ups add constraint follow_ups_automation_sequence_check
check (automation_sequence is null or automation_sequence in (1,2));
create unique index if not exists follow_ups_lead_automation_sequence_uidx
on public.follow_ups(lead_id,automation_sequence)
where lead_id is not null and automation_sequence is not null;
create unique index if not exists follow_ups_one_pending_per_lead_idx
on public.follow_ups(lead_id) where lead_id is not null and status='pending';

-- If two real attempts have already been completed, close the historical lead.
update public.leads l set status='lost',next_follow_up=null,updated_at=now()
where l.status not in ('won','lost','not interested')
  and (select count(*) from public.follow_ups f where f.lead_id=l.id and f.status='completed')>=2;

-- A completed first follow-up represents a real contact attempt. Ensure
-- older records in that state are active contacted leads, not untouched New leads.
update public.leads l
set status='contacted',updated_at=now()
where l.status='new'
  and exists (
      select 1 from public.follow_ups f
      where f.lead_id=l.id
        and f.automation_sequence=1
        and f.status='completed'
  );

-- Backfill the next due date from initial contact or completion of follow-up one.
update public.leads l
set next_follow_up=coalesce(
    (select public.swayphics_add_business_days((f.completed_at at time zone 'Africa/Johannesburg')::date,2)
     from public.follow_ups f
     where f.lead_id=l.id and f.automation_sequence=1 and f.status='completed'
     order by f.created_at desc limit 1),
    public.swayphics_add_business_days((l.last_contacted_at at time zone 'Africa/Johannesburg')::date,2)
),updated_at=now()
where l.status in ('contacted','interested','proposal sent','negotiating','follow-up')
  and (l.last_contacted_at is not null or exists (
      select 1 from public.follow_ups f where f.lead_id=l.id
      and f.automation_sequence=1 and f.status='completed'));

-- Keep old settings columns for compatibility, but pin them to the new policy.
update public.workflow_settings set lead_no_response_days=2,followup_stage_days='{}'::jsonb,
max_followup_attempts=2 where id=1;

create or replace function innerme_private.assign_swayphics_followup_sequence()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_lead_status text; v_next_sequence integer;
begin
    if new.status='skipped' then new.automation_sequence:=null; return new; end if;
    if new.lead_id is null or new.status not in ('pending','completed') then return new; end if;
    if new.status='completed' then new.completed_at:=coalesce(new.completed_at,now()); end if;
    if new.automation_sequence is not null then return new; end if;

    select l.status into v_lead_status from public.leads l where l.id=new.lead_id for update;
    if not found then raise exception 'The lead for this follow-up could not be found.'; end if;
    if v_lead_status in ('won','lost','not interested') then
        raise exception 'A closed or disqualified lead cannot receive another follow-up.';
    end if;
    select coalesce(max(f.automation_sequence),0)+1 into v_next_sequence
    from public.follow_ups f where f.lead_id=new.lead_id and f.automation_sequence is not null;
    if v_next_sequence>2 then raise exception 'This lead has reached the maximum of two follow-ups.'; end if;
    new.automation_sequence:=v_next_sequence::smallint;
    return new;
end;
$$;
revoke all privileges on function innerme_private.assign_swayphics_followup_sequence()
from public,anon,authenticated,service_role;
drop trigger if exists trg_assign_swayphics_followup_sequence on public.follow_ups;
create trigger trg_assign_swayphics_followup_sequence
before insert or update on public.follow_ups
for each row execute function innerme_private.assign_swayphics_followup_sequence();

create or replace function innerme_private.apply_swayphics_followup_completion()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_completed_at timestamptz;
begin
    if new.lead_id is null or new.status<>'completed' then return new; end if;
    if tg_op='UPDATE' and old.status='completed'
       and old.completed_at is not distinct from new.completed_at then return new; end if;
    v_completed_at:=coalesce(new.completed_at,now());

    if new.automation_sequence=1 then
        update public.leads l
        set last_contacted_at=v_completed_at,
            status=case when status='new' then 'contacted' else status end,
            next_follow_up=public.swayphics_add_business_days(
                (v_completed_at at time zone 'Africa/Johannesburg')::date,2),
            updated_at=now()
        where l.id=new.lead_id and l.status not in ('won','lost','not interested');
    elsif new.automation_sequence=2 then
        update public.leads l
        set status='lost',last_contacted_at=v_completed_at,next_follow_up=null,updated_at=now()
        where l.id=new.lead_id and l.status not in ('won','lost','not interested');
    end if;
    return new;
end;
$$;
revoke all privileges on function innerme_private.apply_swayphics_followup_completion()
from public,anon,authenticated,service_role;
drop trigger if exists trg_apply_swayphics_followup_completion on public.follow_ups;
create trigger trg_apply_swayphics_followup_completion
after insert or update of status,completed_at on public.follow_ups
for each row execute function innerme_private.apply_swayphics_followup_completion();

create or replace function innerme_private.skip_swayphics_terminal_lead_followups()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if new.status in ('won','lost','not interested') and old.status is distinct from new.status then
        update public.follow_ups f set status='skipped',completed_at=null,automation_sequence=null
        where f.lead_id=new.id and f.status='pending';
    end if;
    return new;
end;
$$;
revoke all privileges on function innerme_private.skip_swayphics_terminal_lead_followups()
from public,anon,authenticated,service_role;
drop trigger if exists trg_skip_swayphics_terminal_lead_followups on public.leads;
create trigger trg_skip_swayphics_terminal_lead_followups
after update of status on public.leads
for each row execute function innerme_private.skip_swayphics_terminal_lead_followups();


-- Start the follow-up clock on first recorded contact only.
create or replace function public.touch_swayphics_lead_contacted()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if new.status in ('contacted','interested','proposal sent','negotiating','follow-up')
       and new.last_contacted_at is null then
        new.last_contacted_at := now();
        new.next_follow_up := public.swayphics_add_business_days(
            (new.last_contacted_at at time zone 'Africa/Johannesburg')::date,2);
    end if;
    return new;
end;
$$;
drop trigger if exists trg_touch_swayphics_lead_contacted on public.leads;
create trigger trg_touch_swayphics_lead_contacted
before insert or update of status on public.leads
for each row execute function public.touch_swayphics_lead_contacted();


create or replace function public.ensure_swayphics_next_followup_date()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if new.last_contacted_at is not null
       and new.status in ('contacted','interested','proposal sent','negotiating','follow-up')
       and (
           tg_op = 'INSERT'
           or new.last_contacted_at is distinct from old.last_contacted_at
           or (tg_op = 'UPDATE'
               and new.next_follow_up is not distinct from old.next_follow_up
               and new.status is distinct from old.status)
       ) then
        new.next_follow_up := public.swayphics_add_business_days(
            (new.last_contacted_at at time zone 'Africa/Johannesburg')::date,2);
    end if;
    return new;
end;
$$;
revoke all privileges on function public.ensure_swayphics_next_followup_date()
from public,anon,authenticated,service_role;
drop trigger if exists trg_z_ensure_swayphics_next_followup_date on public.leads;
create trigger trg_z_ensure_swayphics_next_followup_date
before insert or update on public.leads
for each row execute function public.ensure_swayphics_next_followup_date();


-- Recalculate the clock from real outbound contact or the manual contact mark.
create or replace function public.recalculate_swayphics_lead_contact_clock(p_lead_id uuid)
returns public.leads language plpgsql security definer set search_path = public as $$
declare v_lead public.leads%rowtype; v_latest_contact timestamptz;
begin
    select * into v_lead from public.leads where id=p_lead_id for update;
    if not found then raise exception 'Lead could not be found.'; end if;

    select max(contacted_at) into v_latest_contact
    from public.communication_logs
    where lead_id=p_lead_id and lower(coalesce(direction,''))='outbound';
    v_latest_contact := greatest(
        coalesce(v_latest_contact,'epoch'::timestamptz),
        coalesce(v_lead.contacted_manually_at,'epoch'::timestamptz));

    if v_latest_contact='epoch'::timestamptz then
        update public.follow_ups set status='skipped',completed_at=null,automation_sequence=null
        where lead_id=p_lead_id and status='pending' and automation_sequence is not null;
        update public.leads set last_contacted_at=null,next_follow_up=null,updated_at=now()
        where id=p_lead_id returning * into v_lead;
        return v_lead;
    end if;

    update public.leads
    set last_contacted_at=v_latest_contact,
        next_follow_up=public.swayphics_add_business_days(
            (v_latest_contact at time zone 'Africa/Johannesburg')::date,2),
        status=case when status='new' then 'contacted' else status end,
        updated_at=now()
    where id=p_lead_id returning * into v_lead;
    return v_lead;
end;
$$;
revoke all on function public.recalculate_swayphics_lead_contact_clock(uuid) from public;
grant execute on function public.recalculate_swayphics_lead_contact_clock(uuid) to authenticated;


-- Central dashboard control for explicitly marking a lead as contacted.
create or replace function public.set_swayphics_lead_manual_contact(p_lead_id uuid,p_contacted boolean)
returns public.leads language plpgsql security definer set search_path = public as $$
declare v_lead public.leads%rowtype; v_now timestamptz := now();
begin
    if not public.is_swayphics_admin() then raise exception 'Active Swayphics admin access required.'; end if;
    select * into v_lead from public.leads where id=p_lead_id for update;
    if not found then raise exception 'Lead could not be found.'; end if;

    if p_contacted then
        if v_lead.status in ('won','lost','not interested') then
            raise exception 'A closed lead must be reactivated before it can be marked contacted.';
        end if;
        update public.leads
        set contacted_manually=true,contacted_manually_at=v_now,contacted_manually_by=auth.uid(),
            last_contacted_at=v_now,
            next_follow_up=public.swayphics_add_business_days((v_now at time zone 'Africa/Johannesburg')::date,2),
            status=case when status='new' then 'contacted' else status end,updated_at=v_now
        where id=p_lead_id returning * into v_lead;
    else
        update public.leads
        set contacted_manually=false,contacted_manually_at=null,contacted_manually_by=null,updated_at=v_now
        where id=p_lead_id returning * into v_lead;
        select public.recalculate_swayphics_lead_contact_clock(p_lead_id) into v_lead;
    end if;
    return v_lead;
end;
$$;
revoke all on function public.set_swayphics_lead_manual_contact(uuid,boolean) from public;
grant execute on function public.set_swayphics_lead_manual_contact(uuid,boolean) to authenticated;


-- Run an idempotent sequence: first attempt after contact, second after
-- the first attempt is completed. Untouched leads are deliberately excluded.
create or replace function innerme_private.process_swayphics_stale_leads_internal()
returns integer language plpgsql security definer set search_path = '' as $$
declare
    v_created integer:=0; v_inserted integer:=0; v_assigned_to uuid;
    v_sequence smallint; v_due_date date; v_first_completed_at timestamptz;
    v_today date:=(now() at time zone 'Africa/Johannesburg')::date;
    v_lead public.leads%rowtype;
begin
    for v_lead in
        select l.* from public.leads l
        where l.status in ('contacted','interested','proposal sent','negotiating','follow-up')
          and l.last_contacted_at is not null
          and not exists (select 1 from public.follow_ups f
                          where f.lead_id=l.id and f.status='pending')
          and (
              (not exists (select 1 from public.follow_ups f
                           where f.lead_id=l.id and f.automation_sequence=1
                             and f.status in ('pending','completed'))
               and not exists (select 1 from public.follow_ups f
                               where f.lead_id=l.id and f.automation_sequence=2
                                 and f.status in ('pending','completed')))
              or
              (exists (select 1 from public.follow_ups f
                       where f.lead_id=l.id and f.automation_sequence=1 and f.status='completed')
               and not exists (select 1 from public.follow_ups f
                               where f.lead_id=l.id and f.automation_sequence=2
                                 and f.status in ('pending','completed')))
          )
        order by l.last_contacted_at,l.id
        for update of l skip locked
    loop
        select f.completed_at into v_first_completed_at
        from public.follow_ups f
        where f.lead_id=v_lead.id and f.automation_sequence=1 and f.status='completed'
        order by f.created_at desc limit 1;

        if v_first_completed_at is null then
            v_sequence:=1;
            v_due_date:=public.swayphics_add_business_days(
                (v_lead.last_contacted_at at time zone 'Africa/Johannesburg')::date,2);
        else
            v_sequence:=2;
            v_due_date:=public.swayphics_add_business_days(
                (v_first_completed_at at time zone 'Africa/Johannesburg')::date,2);
        end if;
        if v_due_date>v_today then continue; end if;

        select coalesce(
            (select au.user_id from public.admin_users au
             where au.user_id=v_lead.assigned_to and au.active=true limit 1),
            (select au.user_id from public.admin_users au where au.active=true
             order by case when au.role='owner' then 0 else 1 end,au.user_id limit 1)
        ) into v_assigned_to;

        insert into public.follow_ups(
            lead_id,assigned_to,scheduled_for,channel,status,note,automation_sequence
        ) values (
            v_lead.id,v_assigned_to,v_due_date,
            case when nullif(trim(v_lead.email),'') is not null then 'Email'
                 when nullif(trim(v_lead.phone),'') is not null then 'Phone'
                 else 'Other' end,
            'pending',
            case when v_sequence=1
                 then 'Automatic follow-up 1 of 2: due two business days after contact. Complete only after the outreach attempt has been made.'
                 else 'Automatic follow-up 2 of 2: due two business days after follow-up 1 was completed. Complete only after the outreach attempt has been made.'
            end,
            v_sequence
        ) on conflict do nothing;

        get diagnostics v_inserted=row_count;
        v_created:=v_created+v_inserted;
        if v_inserted>0 then
            update public.leads set next_follow_up=v_due_date,updated_at=now()
            where id=v_lead.id;
        end if;
    end loop;
    return v_created;
end;
$$;
revoke all privileges on function innerme_private.process_swayphics_stale_leads_internal()
from public,anon,authenticated,service_role;


drop trigger if exists trg_complete_swayphics_first_contact_followups on public.leads;
drop function if exists innerme_private.complete_swayphics_first_contact_followups_on_status_change();

create or replace function public.process_swayphics_stale_leads()
returns integer language plpgsql security definer set search_path = '' as $$
begin
    if auth.uid() is null or not public.is_swayphics_admin() then
        raise exception 'Active Swayphics admin access required.';
    end if;
    return innerme_private.process_swayphics_stale_leads_internal();
end;
$$;
revoke all privileges on function public.process_swayphics_stale_leads()
from public,anon,service_role;
grant execute on function public.process_swayphics_stale_leads() to authenticated;
notify pgrst,'reload schema';
