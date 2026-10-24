-- Expanded Settings workspace for Swayphics Admin.
-- Apply once in the production Supabase SQL Editor after the existing admin,
-- invoicing, and business-flow schemas have been installed.

begin;

-- Existing workflow values are selected by admins. Only owners may change
-- business-wide lead timing and the review destination.
grant select, update on table public.workflow_settings to authenticated;

drop policy if exists "Swayphics owners can update workflow settings"
    on public.workflow_settings;
create policy "Swayphics owners can update workflow settings"
on public.workflow_settings
for update to authenticated
using (public.is_swayphics_owner())
with check (public.is_swayphics_owner());

-- Per-administrator notification choices. Missing rows intentionally mean
-- notifications remain enabled to preserve current behaviour.
create table if not exists public.admin_notification_preferences (
    user_id uuid primary key
        references public.admin_users(user_id) on delete cascade,
    in_app_notifications_enabled boolean not null default true,
    notify_sales boolean not null default true,
    notify_finance boolean not null default true,
    notify_delivery boolean not null default true,
    notify_innerme boolean not null default true,
    browser_push_enabled boolean not null default true,
    updated_at timestamptz not null default now()
);

alter table public.admin_notification_preferences enable row level security;
grant select, insert, update, delete
    on table public.admin_notification_preferences to authenticated;

drop policy if exists "Admins manage own notification preferences"
    on public.admin_notification_preferences;
create policy "Admins manage own notification preferences"
on public.admin_notification_preferences
for all to authenticated
using (
    user_id = (select auth.uid())
    and public.is_swayphics_admin()
)
with check (
    user_id = (select auth.uid())
    and public.is_swayphics_admin()
);

-- Per-administrator presentation and navigation preferences.
create table if not exists public.admin_dashboard_preferences (
    user_id uuid primary key
        references public.admin_users(user_id) on delete cascade,
    default_landing_view text not null default 'current'
        check (default_landing_view in (
            'current', 'leads', 'followups', 'tasks', 'clients',
            'projects', 'invoices', 'settings', 'innerme'
        )),
    table_density text not null default 'comfortable'
        check (table_density in ('comfortable', 'compact')),
    date_format text not null default 'en-ZA'
        check (date_format in ('en-ZA', 'iso')),
    currency_display text not null default 'symbol'
        check (currency_display in ('symbol', 'code')),
    reduced_motion boolean not null default false,
    updated_at timestamptz not null default now()
);

alter table public.admin_dashboard_preferences enable row level security;
grant select, insert, update, delete
    on table public.admin_dashboard_preferences to authenticated;

drop policy if exists "Admins manage own dashboard preferences"
    on public.admin_dashboard_preferences;
create policy "Admins manage own dashboard preferences"
on public.admin_dashboard_preferences
for all to authenticated
using (
    user_id = (select auth.uid())
    and public.is_swayphics_admin()
)
with check (
    user_id = (select auth.uid())
    and public.is_swayphics_admin()
);

-- Shared communication templates. All admins can read them; only the owner
-- can change defaults used by the business.
create table if not exists public.communication_templates (
    id uuid primary key default gen_random_uuid(),
    template_key text not null unique
        check (template_key ~ '^[a-z][a-z0-9_]{1,49}$'),
    name text not null,
    subject text not null default '',
    body text not null,
    enabled boolean not null default true,
    updated_by uuid references public.admin_users(user_id) on delete set null,
    updated_at timestamptz not null default now()
);

alter table public.communication_templates enable row level security;
grant select, insert, update, delete
    on table public.communication_templates to authenticated;

drop policy if exists "Swayphics admins can read communication templates"
    on public.communication_templates;
create policy "Swayphics admins can read communication templates"
on public.communication_templates
for select to authenticated
using (public.is_swayphics_admin());

drop policy if exists "Swayphics owners manage communication templates"
    on public.communication_templates;
create policy "Swayphics owners manage communication templates"
on public.communication_templates
for all to authenticated
using (public.is_swayphics_owner())
with check (public.is_swayphics_owner());

insert into public.communication_templates (template_key, name, subject, body)
values
(
    'initial_outreach',
    'Initial prospect outreach',
    'A tailored online presence for {{business_name}}',
    'Hello {{contact_name}},' || E'\n\n' ||
    'I came across {{business_name}} and noticed an opportunity to strengthen how prospective customers discover your services online.' || E'\n\n' ||
    'Swayphics designs tailored websites that help businesses present their services clearly and turn interest into enquiries. I would be glad to show you a focused concept for your business.' || E'\n\n' ||
    'Would you be open to a brief conversation?' || E'\n\n' ||
    'Kind Regards,' || E'\n\n' ||
    'Lesego Gumede' || E'\n' ||
    'Swayphics'
),
(
    'follow_up_1',
    'First follow-up',
    'Following up on my message to {{business_name}}',
    'Hello {{contact_name}},' || E'\n\n' ||
    'I am following up on my earlier message about improving {{business_name}}' || E'''s online presence.' || E'\n\n' ||
    'The idea is to give potential customers a clear place to understand your services and contact you. Would a short conversation this week suit you?' || E'\n\n' ||
    'Kind Regards,' || E'\n\n' ||
    'Lesego Gumede' || E'\n' ||
    'Swayphics'
),
(
    'follow_up_2',
    'Second follow-up',
    'Should I keep this open for {{business_name}}?',
    'Hello {{contact_name}},' || E'\n\n' ||
    'I wanted to check once more whether a website conversation would be useful for {{business_name}}.' || E'\n\n' ||
    'No pressure if the timing is not right. A quick yes, no, or later would help me close the loop appropriately.' || E'\n\n' ||
    'Kind Regards,' || E'\n\n' ||
    'Lesego Gumede' || E'\n' ||
    'Swayphics'
),
(
    'meeting_confirmation',
    'Meeting confirmation',
    'Confirming our conversation on {{meeting_date}}',
    'Hello {{contact_name}},' || E'\n\n' ||
    'Thank you for agreeing to speak with Swayphics. This message confirms our planned conversation about {{business_name}} on {{meeting_date}} at {{meeting_time}}.' || E'\n\n' ||
    'We will focus on your goals, the needs of your customers, and the most practical next step.' || E'\n\n' ||
    'Kind Regards,' || E'\n\n' ||
    'Lesego Gumede' || E'\n' ||
    'Swayphics'
),
(
    'proposal_follow_up',
    'Proposal follow-up',
    'Checking in on the {{service_name}} proposal',
    'Hello {{contact_name}},' || E'\n\n' ||
    'I am checking whether you have had a chance to review the proposal for {{business_name}}.' || E'\n\n' ||
    'Please let me know if you would like any part clarified. We can adjust the scope to match the priorities we discussed before you decide how to proceed.' || E'\n\n' ||
    'Kind Regards,' || E'\n\n' ||
    'Lesego Gumede' || E'\n' ||
    'Swayphics'
),
(
    'payment_reminder',
    'Payment reminder',
    'Payment reminder for {{invoice_number}}',
    'Hello {{contact_name}},' || E'\n\n' ||
    'This is a courteous reminder that invoice {{invoice_number}} for {{business_name}} has an outstanding balance of {{amount_due}}, due on {{due_date}}.' || E'\n\n' ||
    'Please let us know if payment has already been made or if you need the invoice resent.' || E'\n\n' ||
    'Kind Regards,' || E'\n\n' ||
    'Swayphics'
),
(
    'review_request',
    'Project review request',
    'Thank you for choosing Swayphics',
    'Hello {{contact_name}},' || E'\n\n' ||
    'Thank you for choosing Swayphics for {{project_name}}. We would genuinely value your feedback on the process, communication and final result.' || E'\n\n' ||
    'You can share your experience here: {{review_link}}' || E'\n\n' ||
    'Kind Regards,' || E'\n\n' ||
    'Swayphics'
)
on conflict (template_key) do nothing;

-- Honour notification preferences at creation time. This keeps disabled
-- categories out of both the in-dashboard inbox and the push-delivery trigger.
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
set search_path = public
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
        recipient_id,
        actor_id,
        type,
        event_type,
        title,
        message,
        entity_type,
        entity_id,
        view,
        dedupe_key
    )
    values (
        p_recipient_id,
        p_actor_id,
        coalesce(p_type, 'info'),
        p_event_type,
        p_title,
        coalesce(p_message, ''),
        p_entity_type,
        p_entity_id,
        p_view,
        p_dedupe_key
    )
    on conflict (recipient_id, dedupe_key)
    where dedupe_key is not null
    do nothing;
end;
$$;

commit;
