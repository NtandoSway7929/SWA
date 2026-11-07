-- Create one first-contact follow-up when a new lead exceeds the configured
-- response SLA. The existing 15-minute stale-lead worker and authenticated
-- manual scan both use this function; no second cron job is introduced.
begin;

create or replace function innerme_private.process_swayphics_stale_leads_internal()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_created integer := 0;
    v_inserted integer := 0;
    v_assigned_to uuid;
    v_days integer;
    v_response_hours integer;
    v_max_attempts integer;
    v_attempt_count integer;
    v_today date := (now() at time zone 'Africa/Johannesburg')::date;
    v_dedupe_key text;
    v_lead public.leads%rowtype;
begin
    select
        coalesce(ws.max_followup_attempts, 5),
        coalesce(ws.new_lead_response_hours, 24)
    into v_max_attempts, v_response_hours
    from public.workflow_settings ws
    where ws.id = 1;

    v_max_attempts := coalesce(v_max_attempts, 5);
    v_response_hours := coalesce(v_response_hours, 24);

    -- New leads receive a pending first-contact task only after the configured
    -- response target has elapsed. Any existing follow-up record, regardless
    -- of status, prevents a second first-contact task from being generated.
    for v_lead in
        select l.*
        from public.leads l
        where l.status = 'new'
          and l.created_at <= now() - make_interval(hours => v_response_hours)
          and not exists (
              select 1
              from public.follow_ups f
              where f.lead_id = l.id
          )
        order by l.created_at asc, l.id
        for update of l skip locked
    loop
        select coalesce(
            (
                select au.user_id
                from public.admin_users au
                where au.user_id = v_lead.assigned_to
                  and au.active = true
                limit 1
            ),
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

        -- Never infer WhatsApp registration from a phone number. The task is
        -- an internal reminder only; it does not send an email or message.
        insert into public.follow_ups (
            lead_id, assigned_to, scheduled_for, channel, status, note
        )
        values (
            v_lead.id,
            v_assigned_to,
            v_today,
            case
                when nullif(trim(v_lead.email), '') is not null then 'Email'
                when nullif(trim(v_lead.phone), '') is not null then 'Phone'
                else 'Other'
            end,
            'pending',
            'Automatic first-contact task: response target missed after ' ||
                v_response_hours ||
                ' hours. Verify the contact channel before outreach.'
        )
        on conflict (lead_id)
        where lead_id is not null and status = 'pending'
        do nothing;

        get diagnostics v_inserted = row_count;
        v_created := v_created + v_inserted;
    end loop;

    -- Existing stage-based follow-ups retain their current interval and
    -- attempt-cap behavior. The first-contact task is not counted as a later
    -- follow-up attempt once the lead has been contacted.
    for v_lead in
        select l.*
        from public.leads l
        cross join lateral (
            select
                ws.lead_no_response_days,
                ws.followup_stage_days ->> l.status as stage_days
            from public.workflow_settings ws
            where ws.id = 1
        ) settings
        where l.status in (
            'contacted',
            'interested',
            'proposal sent',
            'negotiating',
            'follow-up'
        )
          and l.last_contacted_at is not null
          and l.last_contacted_at <= now() - make_interval(
              days => case
                  when coalesce(settings.stage_days, '') ~ '^[0-9]{1,3}$'
                    then greatest(1, least(365, settings.stage_days::integer))
                  else coalesce(settings.lead_no_response_days, 7)
              end
          )
          and not exists (
              select 1
              from public.follow_ups f
              where f.lead_id = l.id
                and f.status = 'pending'
          )
        order by l.last_contacted_at asc
        for update of l skip locked
    loop
        select
            case
                when coalesce(ws.followup_stage_days ->> v_lead.status, '') ~ '^[0-9]{1,3}$'
                    then greatest(1, least(365, (ws.followup_stage_days ->> v_lead.status)::integer))
                else coalesce(ws.lead_no_response_days, 7)
            end
        into v_days
        from public.workflow_settings ws
        where ws.id = 1;
        v_days := coalesce(v_days, 7);

        select count(*)
        into v_attempt_count
        from public.follow_ups f
        where f.lead_id = v_lead.id
          and f.status in ('pending', 'completed')
          and coalesce(f.note, '') not like 'Automatic first-contact task:%';

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

        if v_attempt_count >= v_max_attempts then
            v_dedupe_key := 'swayphics-followup-limit:' ||
                v_lead.id::text || ':' || v_today::text;

            if v_assigned_to is not null then
                perform public.create_admin_notification(
                    v_assigned_to, null, 'warning', 'lead.followup_limit',
                    'Follow-up limit reached',
                    coalesce(nullif(trim(v_lead.business_name), ''), 'This lead') ||
                        ' has reached the configured limit of ' || v_max_attempts ||
                        ' follow-up attempts. Review the opportunity before further outreach.',
                    'lead', v_lead.id, 'leads', v_dedupe_key
                );
            else
                perform public.notify_admins(
                    null, 'warning', 'lead.followup_limit',
                    'Follow-up limit reached',
                    coalesce(nullif(trim(v_lead.business_name), ''), 'This lead') ||
                        ' has reached the configured limit of ' || v_max_attempts ||
                        ' follow-up attempts. Review the opportunity before further outreach.',
                    'lead', v_lead.id, 'leads', v_dedupe_key, true
                );
            end if;

            update public.leads
            set status = 'follow-up',
                next_follow_up = v_today,
                updated_at = now()
            where id = v_lead.id
              and status in ('contacted', 'interested', 'proposal sent', 'negotiating', 'follow-up');

            continue;
        end if;

        insert into public.follow_ups (
            lead_id, assigned_to, scheduled_for, channel, status, note
        )
        values (
            v_lead.id,
            v_assigned_to,
            v_today,
            case
                when nullif(trim(v_lead.email), '') is not null then 'Email'
                when nullif(trim(v_lead.phone), '') is not null then 'Phone'
                else 'Other'
            end,
            'pending',
            'Automatic follow-up: no response within ' ||
                v_days ||
                ' days for the current lead stage. Verify the contact channel before outreach.'
        )
        on conflict (lead_id)
        where lead_id is not null and status = 'pending'
        do nothing;

        get diagnostics v_inserted = row_count;

        if v_inserted > 0 then
            update public.leads
            set status = 'follow-up',
                next_follow_up = v_today,
                updated_at = now()
            where id = v_lead.id
              and status in (
                  'contacted',
                  'interested',
                  'proposal sent',
                  'negotiating',
                  'follow-up'
              );

            v_created := v_created + v_inserted;
        end if;
    end loop;

    return v_created;
end;
$$;

revoke all privileges
    on function innerme_private.process_swayphics_stale_leads_internal()
    from public, anon, authenticated, service_role;

-- When a lead is moved out of New, close any still-pending automatic
-- first-contact task. Actual contact completes it; terminal dispositions
-- skip it. This keeps the Follow-ups page aligned with the lead's current
-- lifecycle even when the status is changed outside the manual-contact RPC.
create or replace function innerme_private.complete_swayphics_first_contact_followups_on_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if old.status = 'new' and new.status <> 'new' then
        update public.follow_ups f
        set status = case
                when new.status in ('won', 'lost', 'not interested') then 'skipped'
                else 'completed'
            end,
            completed_at = case
                when new.status in ('won', 'lost', 'not interested') then null
                else coalesce(f.completed_at, now())
            end
        where f.lead_id = new.id
          and f.status = 'pending'
          and coalesce(f.note, '') like 'Automatic first-contact task:%';
    end if;

    return new;
end;
$$;

revoke all privileges
    on function innerme_private.complete_swayphics_first_contact_followups_on_status_change()
    from public, anon, authenticated, service_role;

drop trigger if exists trg_complete_swayphics_first_contact_followups on public.leads;
create trigger trg_complete_swayphics_first_contact_followups
after update of status on public.leads
for each row
when (old.status = 'new' and new.status <> 'new')
execute function innerme_private.complete_swayphics_first_contact_followups_on_status_change();

commit;
