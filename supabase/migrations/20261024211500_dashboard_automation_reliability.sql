-- Make the business follow-up cycle reliable when the dashboard is closed.
-- Safe to reapply: functions, index, trigger and named cron job are idempotent.

begin;

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
            v_lead.assigned_to,
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

-- Completing a follow-up updates last_contacted_at and clears next_follow_up in
-- the dashboard. Recalculate the next due date from the configured interval so
-- repeat follow-ups remain visible and eligible for the next automation cycle.
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

-- Every 15 minutes, even when the dashboard is closed. The routine is idempotent and has no
-- dependence on auth.uid(), unlike the dashboard-facing wrapper.
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

commit;
