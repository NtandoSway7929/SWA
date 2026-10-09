-- Support a deliberate Not Interested lead status and an atomic six-month re-engagement reminder.
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
            'not interested',
            'won',
            'lost'
        )
    );

create or replace function public.mark_swayphics_lead_not_interested(
    p_lead_id uuid
)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_lead public.leads%rowtype;
    v_pending_follow_up_id uuid;
    v_follow_up_date date;
    v_follow_up_note text :=
        'Long-term re-engagement: the lead is not interested at present. Revisit their service needs in approximately six months.';
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

    if v_lead.status in ('won', 'lost') then
        raise exception 'Won or lost leads cannot be marked Not Interested.';
    end if;

    v_follow_up_date :=
        (
            (now() at time zone 'Africa/Johannesburg')::date
            + interval '6 months'
        )::date;

    select id
    into v_pending_follow_up_id
    from public.follow_ups
    where lead_id = p_lead_id
      and status = 'pending'
    order by scheduled_for desc, created_at desc
    limit 1;

    -- Supersede other pending reminders so an old, nearer follow-up
    -- does not fire after the lead has asked to defer contact.
    update public.follow_ups
    set
        status = 'skipped',
        note = concat_ws(
            E'\\n',
            nullif(trim(note), ''),
            'Superseded by the six-month Not Interested re-engagement reminder.'
        )
    where lead_id = p_lead_id
      and status = 'pending'
      and id is distinct from v_pending_follow_up_id;

    update public.leads
    set
        status = 'not interested',
        next_follow_up = v_follow_up_date,
        updated_at = now()
    where id = p_lead_id;

    if v_pending_follow_up_id is not null then
        update public.follow_ups
        set
            scheduled_for = v_follow_up_date,
            assigned_to = coalesce(v_lead.assigned_to, assigned_to, auth.uid()),
            channel = coalesce(channel, 'WhatsApp'),
            status = 'pending',
            completed_at = null,
            note = concat_ws(
                E'\\n',
                nullif(trim(note), ''),
                v_follow_up_note
            )
        where id = v_pending_follow_up_id;
    else
        insert into public.follow_ups (
            lead_id,
            assigned_to,
            scheduled_for,
            channel,
            status,
            note
        )
        values (
            p_lead_id,
            coalesce(v_lead.assigned_to, auth.uid()),
            v_follow_up_date,
            'WhatsApp',
            'pending',
            v_follow_up_note
        );
    end if;

    return v_follow_up_date;
end;
$$;

revoke all on function public.mark_swayphics_lead_not_interested(uuid)
    from public, anon;
grant execute on function public.mark_swayphics_lead_not_interested(uuid)
    to authenticated;
