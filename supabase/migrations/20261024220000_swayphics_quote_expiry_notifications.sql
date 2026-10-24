-- Notify administrators when a sent quote reaches its validity date.
-- This only creates internal alerts; it does not change quote status or email clients.

begin;

create extension if not exists pg_cron;
create schema if not exists innerme_private;

create or replace function public.create_admin_notification(
    p_recipient_id uuid,
    p_actor_id uuid,
    p_type text,
    p_event_type text,
    p_title text,
    p_message text,
    p_entity_type text default null,
    p_entity_id uuid default null,
    p_view text default null,
    p_dedupe_key text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_in_app_enabled boolean;
    v_sales_enabled boolean;
    v_finance_enabled boolean;
    v_delivery_enabled boolean;
    v_innerme_enabled boolean;
    v_event text := lower(coalesce(p_event_type, ''));
begin
    if p_recipient_id is null then
        return;
    end if;

    if not exists (
        select 1
        from public.admin_users
        where user_id = p_recipient_id
          and active = true
    ) then
        return;
    end if;

    if p_actor_id is not null and p_recipient_id = p_actor_id then
        return;
    end if;

    select
        in_app_notifications_enabled,
        notify_sales,
        notify_finance,
        notify_delivery,
        notify_innerme
    into
        v_in_app_enabled,
        v_sales_enabled,
        v_finance_enabled,
        v_delivery_enabled,
        v_innerme_enabled
    from public.admin_notification_preferences
    where user_id = p_recipient_id;

    if coalesce(v_in_app_enabled, true) is false then
        return;
    end if;

    if (
        v_event like 'lead.%'
        or v_event like 'enquiry.%'
        or v_event like 'website_enquiry.%'
        or v_event like 'followup.%'
        or v_event like 'task.%'
        or v_event like 'quote.%'
    ) and coalesce(v_sales_enabled, true) is false then
        return;
    end if;

    if (
        v_event like 'invoice.%'
        or v_event like 'payment.%'
        or v_event like 'finance.%'
    ) and coalesce(v_finance_enabled, true) is false then
        return;
    end if;

    if (
        v_event like 'email.%'
        or v_event like 'review.%'
        or v_event like 'delivery.%'
        or v_event like 'project.%'
        or v_event like 'document.%'
        or v_event like 'portal.%'
    ) and coalesce(v_delivery_enabled, true) is false then
        return;
    end if;

    if (
        v_event like 'innerme.%'
        or v_event like 'provider.%'
        or v_event like 'ai.%'
    ) and coalesce(v_innerme_enabled, true) is false then
        return;
    end if;

    insert into public.admin_notifications (
        recipient_id, actor_id, type, event_type, title, message,
        entity_type, entity_id, view, dedupe_key
    )
    values (
        p_recipient_id, p_actor_id, coalesce(p_type, 'info'), p_event_type,
        p_title, coalesce(p_message, ''), p_entity_type, p_entity_id,
        p_view, p_dedupe_key
    )
    on conflict (recipient_id, dedupe_key)
    where dedupe_key is not null
    do nothing;
end;
$$;

create or replace function innerme_private.generate_swayphics_quote_expiry_notifications_internal()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_today date := (now() at time zone 'Africa/Johannesburg')::date;
    v_count integer := 0;
    r record;
    v_title text;
    v_message text;
    v_severity text;
    v_event_type text;
    v_dedupe_key text;
begin
    for r in
        select
            q.id,
            q.quote_number,
            q.title,
            q.valid_until,
            coalesce(l.assigned_to, c.assigned_to) as assigned_to
        from public.quotes q
        left join public.leads l on l.id = q.lead_id
        left join public.clients c on c.id = q.client_id
        where q.status = 'sent'
          and q.valid_until is not null
          and q.valid_until <= v_today
        order by q.valid_until asc, q.id
    loop
        if r.valid_until = v_today then
            v_title := 'Quote expires today';
            v_severity := 'warning';
            v_event_type := 'quote.expiry_due';
            v_message := coalesce(
                nullif(trim(r.quote_number), ''),
                nullif(trim(r.title), ''),
                'Quote'
            ) || ' is due to expire today. Review the prospect and decide whether to follow up.';
        else
            v_title := 'Quote has expired';
            v_severity := 'danger';
            v_event_type := 'quote.expired';
            v_message := coalesce(
                nullif(trim(r.quote_number), ''),
                nullif(trim(r.title), ''),
                'Quote'
            ) || ' expired on ' || to_char(r.valid_until, 'DD Mon YYYY') ||
            '. Verify its current status before re-engaging the prospect.';
        end if;

        v_dedupe_key := 'swayphics-quote-validity:' ||
            r.id::text || ':' || r.valid_until::text || ':' ||
            case when r.valid_until = v_today then 'due' else 'expired' end;

        if r.assigned_to is not null then
            perform public.create_admin_notification(
                r.assigned_to, null,
                v_severity,
                v_event_type,
                v_title,
                v_message,
                'quote',
                r.id,
                'quotes',
                v_dedupe_key
            );
        else
            perform public.notify_admins(
                null,
                v_severity,
                v_event_type,
                v_title,
                v_message,
                'quote',
                r.id,
                'quotes',
                v_dedupe_key,
                true
            );
        end if;

        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$$;

revoke all privileges
    on function innerme_private.generate_swayphics_quote_expiry_notifications_internal()
    from public, anon, authenticated, service_role;

do $$
declare
    v_job_id bigint;
begin
    for v_job_id in
        select jobid
        from cron.job
        where jobname = 'swayphics-quote-expiry-reminders'
    loop
        perform cron.unschedule(v_job_id);
    end loop;

    perform cron.schedule(
        'swayphics-quote-expiry-reminders',
        '*/15 * * * *',
        'select innerme_private.generate_swayphics_quote_expiry_notifications_internal();'
    );
end;
$$;

notify pgrst, 'reload schema';

commit;
