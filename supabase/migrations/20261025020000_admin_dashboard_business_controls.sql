-- Swayphics Admin Settings: business controls, commercial defaults, and governance.
-- Business-wide settings remain owner-editable through the existing workflow_settings RLS policy.
-- No external client messages are sent by this migration.

begin;

alter table public.workflow_settings
    add column if not exists new_lead_response_hours integer not null default 24
        check (new_lead_response_hours between 1 and 720),
    add column if not exists followup_stage_days jsonb not null default '{}'::jsonb
        check (jsonb_typeof(followup_stage_days) = 'object'),
    add column if not exists max_followup_attempts integer not null default 5
        check (max_followup_attempts between 1 and 20),
    add column if not exists monthly_revenue_target numeric(12,2) not null default 0
        check (monthly_revenue_target >= 0),
    add column if not exists monthly_new_leads_target integer not null default 0
        check (monthly_new_leads_target >= 0),
    add column if not exists monthly_proposals_target integer not null default 0
        check (monthly_proposals_target >= 0),
    add column if not exists monthly_wins_target integer not null default 0
        check (monthly_wins_target >= 0),
    add column if not exists target_conversion_rate numeric(5,2) not null default 0
        check (target_conversion_rate between 0 and 100),
    add column if not exists quote_validity_days integer not null default 14
        check (quote_validity_days between 1 and 365),
    add column if not exists invoice_payment_terms_days integer not null default 7
        check (invoice_payment_terms_days between 0 and 365);

-- Use stage-specific intervals when configured; otherwise fall back to the legacy
-- lead_no_response_days value so existing installations retain their behaviour.
create or replace function public.ensure_swayphics_next_followup_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_days integer;
    v_raw_days text;
begin
    if new.last_contacted_at is not null
       and new.status in (
           'contacted',
           'interested',
           'proposal sent',
           'negotiating',
           'follow-up'
       )
       and (
           (
               new.next_follow_up is null
               and (
                   tg_op = 'INSERT'
                   or new.last_contacted_at is distinct from old.last_contacted_at
               )
           )
           or (
               tg_op = 'UPDATE'
               and new.next_follow_up is not distinct from old.next_follow_up
               and (
                   new.last_contacted_at is distinct from old.last_contacted_at
                   or new.status is distinct from old.status
               )
           )
       )
    then
        select ws.followup_stage_days ->> new.status,
               ws.lead_no_response_days
        into v_raw_days, v_days
        from public.workflow_settings ws
        where ws.id = 1;

        if coalesce(v_raw_days, '') ~ '^[0-9]{1,3}$' then
            v_days := greatest(1, least(365, v_raw_days::integer));
        end if;

        v_days := coalesce(v_days, 7);
        new.next_follow_up :=
            (new.last_contacted_at at time zone 'Africa/Johannesburg')::date
            + v_days;
    end if;

    return new;
end;
$$;

drop trigger if exists trg_z_ensure_swayphics_next_followup_date on public.leads;
create trigger trg_z_ensure_swayphics_next_followup_date
before insert or update on public.leads
for each row execute function public.ensure_swayphics_next_followup_date();

-- Stage-aware background follow-up worker. The configured cap sends a daily
-- review alert instead of generating unlimited follow-up tasks.
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
    v_max_attempts integer;
    v_attempt_count integer;
    v_today date := (now() at time zone 'Africa/Johannesburg')::date;
    v_dedupe_key text;
    v_lead public.leads%rowtype;
begin
    select coalesce(ws.max_followup_attempts, 5)
    into v_max_attempts
    from public.workflow_settings ws
    where ws.id = 1;
    v_max_attempts := coalesce(v_max_attempts, 5);

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
                  when coalesce(settings.stage_days, '') ~ '^[0-9]{1,3}
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
          and f.status in ('pending', 'completed');

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

            v_created := v_created + 1;
        end if;
    end loop;

    return v_created;
end;
$$;

revoke all privileges
    on function innerme_private.process_swayphics_stale_leads_internal()
    from public, anon, authenticated, service_role;

-- Respect the configured first-response SLA, in addition to due/overdue dates.
create or replace function innerme_private.generate_swayphics_due_lead_notifications_internal()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_today date := (now() at time zone 'Africa/Johannesburg')::date;
    v_response_hours integer;
    v_count integer := 0;
    r record;
    v_event_type text;
    v_title text;
    v_message text;
    v_dedupe_key text;
begin
    select coalesce(ws.new_lead_response_hours, 24)
    into v_response_hours
    from public.workflow_settings ws
    where ws.id = 1;
    v_response_hours := coalesce(v_response_hours, 24);

    for r in
        select l.id, l.business_name, l.contact_name, l.status,
               l.assigned_to, l.next_follow_up, l.created_at
        from public.leads l
        where l.status not in ('won', 'lost', 'not interested')
          and (
              l.next_follow_up <= v_today
              or (
                  l.status = 'new'
                  and l.created_at <= now() - make_interval(hours => v_response_hours)
              )
          )
        order by l.next_follow_up nulls first, l.business_name, l.id
    loop
        if r.status = 'new'
           and r.created_at <= now() - make_interval(hours => v_response_hours) then
            v_event_type := 'lead.response_overdue';
            v_title := 'New lead response target missed';
            v_message := coalesce(
                nullif(trim(r.business_name), ''),
                nullif(trim(r.contact_name), ''),
                'Lead'
            ) || ' has been awaiting a first response for longer than the configured ' ||
                v_response_hours || '-hour target.';
        elsif r.next_follow_up < v_today then
            v_event_type := 'lead.overdue';
            if r.status = 'new' then
                v_title := 'First contact overdue';
                v_message := coalesce(nullif(trim(r.business_name), ''), nullif(trim(r.contact_name), ''), 'Lead') ||
                    ' was due for first contact on ' || to_char(r.next_follow_up, 'DD Mon YYYY') || '.';
            else
                v_title := 'Lead follow-up overdue';
                v_message := coalesce(nullif(trim(r.business_name), ''), nullif(trim(r.contact_name), ''), 'Lead') ||
                    ' had a follow-up due on ' || to_char(r.next_follow_up, 'DD Mon YYYY') || '.';
            end if;
        else
            v_event_type := 'lead.due_today';
            if r.status = 'new' then
                v_title := 'First contact due today';
                v_message := coalesce(nullif(trim(r.business_name), ''), nullif(trim(r.contact_name), ''), 'Lead') ||
                    ' is scheduled for first contact today.';
            else
                v_title := 'Lead follow-up due today';
                v_message := coalesce(nullif(trim(r.business_name), ''), nullif(trim(r.contact_name), ''), 'Lead') ||
                    ' has a follow-up scheduled for today.';
            end if;
        end if;

        v_dedupe_key := 'swayphics-lead-schedule:' ||
            r.id::text || ':' || v_today::text;

        if r.assigned_to is not null then
            perform public.create_admin_notification(
                r.assigned_to, null, 'warning', v_event_type, v_title, v_message,
                'lead', r.id, 'leads', v_dedupe_key
            );
        else
            perform public.notify_admins(
                null, 'warning', v_event_type, v_title, v_message,
                'lead', r.id, 'leads', v_dedupe_key, true
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

-- Default commercial terms apply only to new records and never rewrite existing
-- issued documents or already-entered due dates. Separate functions keep record
-- fields table-specific so quote triggers never resolve invoice-only columns.
create or replace function public.apply_swayphics_invoice_payment_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_days integer;
begin
    if new.due_date is null then
        select coalesce(ws.invoice_payment_terms_days, 7)
        into v_days
        from public.workflow_settings ws
        where ws.id = 1;

        new.due_date := coalesce(new.issue_date, current_date) + coalesce(v_days, 7);
    end if;
    return new;
end;
$$;

create or replace function public.apply_swayphics_quote_validity_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_days integer;
begin
    if new.valid_until is null then
        select coalesce(ws.quote_validity_days, 14)
        into v_days
        from public.workflow_settings ws
        where ws.id = 1;

        new.valid_until :=
            (coalesce(new.created_at, now()) at time zone 'Africa/Johannesburg')::date
            + coalesce(v_days, 14);
    end if;
    return new;
end;
$$;

revoke all privileges on function public.apply_swayphics_invoice_payment_defaults() from public, anon, authenticated;
revoke all privileges on function public.apply_swayphics_quote_validity_defaults() from public, anon, authenticated;

drop trigger if exists trg_swayphics_invoice_commercial_defaults on public.invoices;
create trigger trg_swayphics_invoice_commercial_defaults
before insert on public.invoices
for each row execute function public.apply_swayphics_invoice_payment_defaults();

drop trigger if exists trg_swayphics_quote_commercial_defaults on public.quotes;
create trigger trg_swayphics_quote_commercial_defaults
before insert on public.quotes
for each row execute function public.apply_swayphics_quote_validity_defaults();

-- Audit setting changes by field name only: never store previous/new values,
-- payment details, template bodies, or other sensitive configuration content.
create table if not exists public.admin_settings_audit_log (
    id bigint generated always as identity primary key,
    actor_id uuid,
    setting_area text not null,
    changed_fields jsonb not null default '[]'::jsonb
        check (jsonb_typeof(changed_fields) = 'array'),
    created_at timestamptz not null default now()
);

alter table public.admin_settings_audit_log enable row level security;
revoke all on table public.admin_settings_audit_log from public, anon;
grant select on table public.admin_settings_audit_log to authenticated;

drop policy if exists "Swayphics admins can read settings audit history"
    on public.admin_settings_audit_log;
create policy "Swayphics admins can read settings audit history"
on public.admin_settings_audit_log
for select to authenticated
using (
    public.is_swayphics_admin()
    and (
        actor_id = (select auth.uid())
        or public.is_swayphics_owner()
    )
);

create or replace function public.audit_swayphics_settings_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_old jsonb;
    v_new jsonb;
    v_changed jsonb;
begin
    v_new := to_jsonb(new);
    if tg_op = 'UPDATE' then
        v_old := to_jsonb(old);
    else
        v_old := '{}'::jsonb;
    end if;

    select coalesce(jsonb_agg(e.key order by e.key), '[]'::jsonb)
    into v_changed
    from jsonb_each(v_new) e
    where e.key not in (
        'id', 'user_id', 'created_at', 'updated_at', 'updated_by'
    )
      and (
          tg_op = 'INSERT'
          or (v_old -> e.key) is distinct from e.value
      );

    if jsonb_array_length(v_changed) > 0 then
        insert into public.admin_settings_audit_log (
            actor_id, setting_area, changed_fields
        )
        values (auth.uid(), tg_table_name, v_changed);
    end if;

    return new;
end;
$$;

revoke all privileges on function public.audit_swayphics_settings_change() from public, anon, authenticated;

drop trigger if exists trg_audit_swayphics_workflow_settings on public.workflow_settings;
create trigger trg_audit_swayphics_workflow_settings
after insert or update on public.workflow_settings
for each row execute function public.audit_swayphics_settings_change();

drop trigger if exists trg_audit_swayphics_invoice_settings on public.invoice_settings;
create trigger trg_audit_swayphics_invoice_settings
after insert or update on public.invoice_settings
for each row execute function public.audit_swayphics_settings_change();

drop trigger if exists trg_audit_swayphics_admin_notification_preferences on public.admin_notification_preferences;
create trigger trg_audit_swayphics_admin_notification_preferences
after insert or update on public.admin_notification_preferences
for each row execute function public.audit_swayphics_settings_change();

drop trigger if exists trg_audit_swayphics_admin_dashboard_preferences on public.admin_dashboard_preferences;
create trigger trg_audit_swayphics_admin_dashboard_preferences
after insert or update on public.admin_dashboard_preferences
for each row execute function public.audit_swayphics_settings_change();

drop trigger if exists trg_audit_swayphics_communication_templates on public.communication_templates;
create trigger trg_audit_swayphics_communication_templates
after insert or update on public.communication_templates
for each row execute function public.audit_swayphics_settings_change();

-- Expose only a bounded, allowlisted view of scheduled-job health to active admins.
create or replace function public.get_swayphics_automation_status()
returns table (
    job_name text,
    schedule text,
    active boolean,
    last_run timestamptz,
    last_status text,
    last_message text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null or not public.is_swayphics_admin() then
        raise exception 'Active Swayphics admin access required.';
    end if;

    return query
    select
        j.jobname::text,
        j.schedule::text,
        j.active,
        run.start_time,
        run.status::text,
        run.return_message::text
    from cron.job j
    left join lateral (
        select d.start_time, d.status, d.return_message
        from cron.job_run_details d
        where d.jobid = j.jobid
        order by d.start_time desc
        limit 1
    ) run on true
    where j.jobname in (
        'swayphics-stale-lead-followups',
        'swayphics-invoice-status-refresh',
        'swayphics-leads-due-today',
        'swayphics-quote-expiry-reminders'
    )
    order by j.jobname;
end;
$$;

revoke all privileges on function public.get_swayphics_automation_status() from public, anon;
grant execute on function public.get_swayphics_automation_status() to authenticated;

notify pgrst, 'reload schema';

commit;
