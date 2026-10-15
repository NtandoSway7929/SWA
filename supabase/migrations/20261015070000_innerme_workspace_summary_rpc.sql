-- Authoritative, request-scoped workspace aggregates for InnerMe.
-- SECURITY INVOKER preserves table grants and row-level security; detailed rows
-- remain separately bounded by the Edge Function's selective retrieval plan.
create or replace function public.get_innerme_workspace_summary(p_collections text[])
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_today date := (pg_catalog.now() at time zone 'Africa/Johannesburg')::date;
  v_summary jsonb := pg_catalog.jsonb_build_object(
    'generated_date_johannesburg', v_today,
    'timezone', 'Africa/Johannesburg',
    'summary_source', 'database_aggregate',
    'metric_scope', 'Aggregate counts and monetary totals are calculated in PostgreSQL across rows visible to the authenticated Swayphics administrator under the current RLS policies. Detailed record lists remain bounded samples.'
  );
  v_metrics jsonb;
  v_followup_counts jsonb := '{}'::jsonb;
  v_allowed text[] := array[
    'tasks', 'leads', 'followups', 'clients', 'projects', 'quotes',
    'payments', 'enquiries', 'invoices', 'portal_requests',
    'communications', 'activities', 'email_messages'
  ];
begin
  if auth.uid() is null or not public.is_swayphics_admin() then
    raise exception using
      errcode = '42501',
      message = 'Authenticated Swayphics administrator access is required.';
  end if;

  if p_collections is null
     or pg_catalog.cardinality(p_collections) < 1
     or pg_catalog.cardinality(p_collections) > pg_catalog.cardinality(v_allowed) then
    raise exception using
      errcode = '22023',
      message = 'A non-empty, bounded collection list is required.';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(p_collections) as requested(collection_name)
    where requested.collection_name is null
       or not (requested.collection_name = any(v_allowed))
  ) then
    raise exception using
      errcode = '22023',
      message = 'The collection list contains an unsupported workspace domain.';
  end if;

  if pg_catalog.cardinality(p_collections) <>
     (select pg_catalog.count(distinct requested.collection_name)
      from pg_catalog.unnest(p_collections) as requested(collection_name)) then
    raise exception using
      errcode = '22023',
      message = 'Duplicate workspace domains are not allowed.';
  end if;

  if 'leads' = any(p_collections) then
    select pg_catalog.jsonb_build_object(
      'lead_counts', pg_catalog.jsonb_build_object(
        'total', pg_catalog.count(*),
        'open_pipeline', pg_catalog.count(*) filter (where status not in ('won', 'lost')),
        'active_excluding_follow_up', pg_catalog.count(*) filter (where status not in ('won', 'lost') and status <> 'follow-up'),
        'follow_up_status', pg_catalog.count(*) filter (where status = 'follow-up'),
        'converted_to_client', pg_catalog.count(*) filter (where converted_client_id is not null),
        'won', pg_catalog.count(*) filter (where status = 'won'),
        'lost', pg_catalog.count(*) filter (where status = 'lost')
      ),
      'lead_value_zar', pg_catalog.jsonb_build_object(
        'open_pipeline', pg_catalog.round(pg_catalog.coalesce(pg_catalog.sum(pg_catalog.coalesce(estimated_value, 0)) filter (where status not in ('won', 'lost')), 0)::numeric, 2),
        'active_excluding_follow_up', pg_catalog.round(pg_catalog.coalesce(pg_catalog.sum(pg_catalog.coalesce(estimated_value, 0)) filter (where status not in ('won', 'lost') and status <> 'follow-up'), 0)::numeric, 2),
        'won_value', pg_catalog.round(pg_catalog.coalesce(pg_catalog.sum(pg_catalog.coalesce(estimated_value, 0)) filter (where status = 'won'), 0)::numeric, 2)
      )
    )
    into v_metrics
    from public.leads;
    v_summary := v_summary || v_metrics;

    select pg_catalog.jsonb_build_object(
      'lead_next_followups_due_or_overdue', pg_catalog.count(*) filter (where next_follow_up is not null and next_follow_up <= v_today and status not in ('won', 'lost')),
      'lead_next_followups_due_today', pg_catalog.count(*) filter (where next_follow_up = v_today and status not in ('won', 'lost')),
      'lead_next_followups_overdue', pg_catalog.count(*) filter (where next_follow_up < v_today and status not in ('won', 'lost'))
    )
    into v_metrics
    from public.leads;
    v_followup_counts := v_followup_counts || v_metrics;
  end if;

  if 'followups' = any(p_collections) then
    select pg_catalog.jsonb_build_object(
      'pending_due_or_overdue', pg_catalog.count(*) filter (where status = 'pending' and scheduled_for <= v_today),
      'pending_due_today', pg_catalog.count(*) filter (where status = 'pending' and scheduled_for = v_today),
      'pending_overdue', pg_catalog.count(*) filter (where status = 'pending' and scheduled_for < v_today),
      'pending_total', pg_catalog.count(*) filter (where status = 'pending')
    )
    into v_metrics
    from public.follow_ups;
    v_followup_counts := v_followup_counts || v_metrics;
  end if;

  if v_followup_counts <> '{}'::jsonb then
    v_summary := v_summary || pg_catalog.jsonb_build_object('followup_counts', v_followup_counts);
  end if;

  if 'quotes' = any(p_collections) then
    select pg_catalog.jsonb_build_object(
      'quote_summary', pg_catalog.jsonb_build_object(
        'open_count', pg_catalog.count(*) filter (where status in ('draft', 'sent', 'accepted')),
        'open_value_zar', pg_catalog.round(pg_catalog.coalesce(pg_catalog.sum(amount) filter (where status in ('draft', 'sent', 'accepted')), 0)::numeric, 2)
      )
    )
    into v_metrics
    from public.quotes;
    v_summary := v_summary || v_metrics;
  end if;

  if 'invoices' = any(p_collections) then
    select pg_catalog.jsonb_build_object(
      'invoice_summary', pg_catalog.jsonb_build_object(
        'total', pg_catalog.count(*),
        'outstanding_value_zar', pg_catalog.round(pg_catalog.coalesce(pg_catalog.sum(pg_catalog.greatest(pg_catalog.coalesce(amount_outstanding, 0), 0)) filter (where status <> 'cancelled' and archived is not true), 0)::numeric, 2)
      )
    )
    into v_metrics
    from public.invoices;
    v_summary := v_summary || v_metrics;
  end if;

  if 'payments' = any(p_collections) then
    select pg_catalog.jsonb_build_object(
      'payment_summary', pg_catalog.jsonb_build_object(
        'total_paid_value_zar', pg_catalog.round(pg_catalog.coalesce(pg_catalog.sum(amount) filter (where status = 'paid'), 0)::numeric, 2)
      )
    )
    into v_metrics
    from public.payments;
    v_summary := v_summary || v_metrics;
  end if;

  if 'enquiries' = any(p_collections) then
    select pg_catalog.jsonb_build_object(
      'enquiry_summary', pg_catalog.jsonb_build_object(
        'total', pg_catalog.count(*),
        'new', pg_catalog.count(*) filter (where status = 'new')
      )
    )
    into v_metrics
    from public.website_enquiries;
    v_summary := v_summary || v_metrics;
  end if;

  if 'tasks' = any(p_collections) then
    select pg_catalog.jsonb_build_object(
      'task_summary', pg_catalog.jsonb_build_object(
        'open', pg_catalog.count(*) filter (where status <> 'completed'),
        'total', pg_catalog.count(*)
      )
    )
    into v_metrics
    from public.tasks;
    v_summary := v_summary || v_metrics;
  end if;

  if 'projects' = any(p_collections) then
    select pg_catalog.jsonb_build_object(
      'project_summary', pg_catalog.jsonb_build_object(
        'active', pg_catalog.count(*) filter (where status in ('planning', 'in progress', 'review')),
        'total', pg_catalog.count(*)
      )
    )
    into v_metrics
    from public.client_projects;
    v_summary := v_summary || v_metrics;
  end if;

  if 'clients' = any(p_collections) then
    select pg_catalog.jsonb_build_object(
      'client_summary', pg_catalog.jsonb_build_object('total', pg_catalog.count(*))
    )
    into v_metrics
    from public.clients;
    v_summary := v_summary || v_metrics;
  end if;

  if 'portal_requests' = any(p_collections) then
    select pg_catalog.jsonb_build_object(
      'portal_request_summary', pg_catalog.jsonb_build_object(
        'total', pg_catalog.count(*),
        'new', pg_catalog.count(*) filter (where status = 'new')
      )
    )
    into v_metrics
    from public.client_portal_requests;
    v_summary := v_summary || v_metrics;
  end if;

  if 'communications' = any(p_collections) then
    select pg_catalog.jsonb_build_object(
      'communication_summary', pg_catalog.jsonb_build_object('total', pg_catalog.count(*))
    )
    into v_metrics
    from public.communication_logs;
    v_summary := v_summary || v_metrics;
  end if;

  if 'activities' = any(p_collections) then
    select pg_catalog.jsonb_build_object(
      'activity_summary', pg_catalog.jsonb_build_object('total', pg_catalog.count(*))
    )
    into v_metrics
    from public.activity_log;
    v_summary := v_summary || v_metrics;
  end if;

  if 'email_messages' = any(p_collections) then
    select pg_catalog.jsonb_build_object(
      'email_summary', pg_catalog.jsonb_build_object(
        'total', pg_catalog.count(*),
        'unread', pg_catalog.count(*) filter (where is_read is not true),
        'outbound', pg_catalog.count(*) filter (where direction = 'outbound'),
        'inbound', pg_catalog.count(*) filter (where direction = 'inbound')
      )
    )
    into v_metrics
    from public.email_messages
    where mailbox = 'info@swayphics.co.za';
    v_summary := v_summary || v_metrics;
  end if;

  return v_summary;
end;
$function$;

revoke all on function public.get_innerme_workspace_summary(text[]) from public, anon;
grant execute on function public.get_innerme_workspace_summary(text[]) to authenticated;
comment on function public.get_innerme_workspace_summary(text[]) is
  'Read-only request-scoped operational aggregates for authenticated Swayphics admins. SECURITY INVOKER preserves grants and RLS; detailed lists remain bounded.';
