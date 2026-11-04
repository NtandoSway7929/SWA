-- Shared invocation quotas for the isolated InnerMe Municipal Money pilot.
-- This migration is committed to a feature branch only. It has not been applied to Supabase.
-- Limits are internal pilot ceilings, not National Treasury rate limits.

create schema if not exists innerme_private;

revoke all on schema innerme_private from public, anon, authenticated, service_role;
grant usage on schema innerme_private to authenticated;

create table if not exists innerme_private.innerme_integration_quota_windows (
  scope_type text not null check (scope_type in ('admin', 'project')),
  scope_id text not null check (pg_catalog.length(scope_id) between 1 and 128),
  capability text not null check (
    capability = 'za.municipal_money.income_expenditure.read'
  ),
  window_type text not null check (window_type in ('minute', 'utc_day')),
  window_start timestamptz not null,
  reserved_count integer not null default 0 check (reserved_count >= 0),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (scope_type, scope_id, capability, window_type, window_start)
);

alter table innerme_private.innerme_integration_quota_windows enable row level security;
revoke all on table innerme_private.innerme_integration_quota_windows
  from public, anon, authenticated, service_role;

create index if not exists innerme_integration_quota_windows_retention_idx
  on innerme_private.innerme_integration_quota_windows (window_start);

create table if not exists innerme_private.innerme_integration_quota_leases (
  reservation_id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  capability text not null check (
    capability = 'za.municipal_money.income_expenditure.read'
  ),
  reserved_at timestamptz not null default pg_catalog.now(),
  lease_expires_at timestamptz not null,
  released_at timestamptz
);

alter table innerme_private.innerme_integration_quota_leases enable row level security;
revoke all on table innerme_private.innerme_integration_quota_leases
  from public, anon, authenticated, service_role;

create index if not exists innerme_integration_quota_leases_active_idx
  on innerme_private.innerme_integration_quota_leases (capability, lease_expires_at)
  where released_at is null;

create or replace function innerme_private.reserve_integration_quota(
  p_capability text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin_user_id uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_minute_start timestamptz;
  v_day_start timestamptz;
  v_project_scope_id text := pg_catalog.current_database();
  v_admin_minute_used integer := 0;
  v_project_minute_used integer := 0;
  v_admin_day_used integer := 0;
  v_project_day_used integer := 0;
  v_inflight_count integer := 0;
  v_next_lease_expiry timestamptz;
  v_retry_after integer := 0;
  v_reason text := null;
  v_reservation_id uuid;
begin
  if v_admin_user_id is null or not public.is_swayphics_admin() then
    raise insufficient_privilege using message = 'Active Swayphics admin access is required.';
  end if;

  if p_capability is distinct from 'za.municipal_money.income_expenditure.read' then
    raise invalid_parameter_value using message = 'Integration capability is not approved.';
  end if;

  v_minute_start :=
    (pg_catalog.date_trunc('minute', v_now at time zone 'UTC') at time zone 'UTC');
  v_day_start :=
    (pg_catalog.date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC');

  -- One transaction lock per capability keeps the four counters and concurrency
  -- check serialised, so concurrent callers cannot reserve the same remaining slot.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('innerme.integration.quota:' || p_capability, 0)
  );

  -- Remove expired leases and old released leases. An abandoned request therefore
  -- cannot permanently occupy a concurrency slot.
  delete from innerme_private.innerme_integration_quota_leases
  where capability = p_capability
    and (
      lease_expires_at <= v_now
      or (released_at is not null and released_at < v_now - interval '2 days')
    );

  delete from innerme_private.innerme_integration_quota_windows
  where window_start < v_day_start - interval '2 days';

  select pg_catalog.count(*)::integer, pg_catalog.min(lease_expires_at)
    into v_inflight_count, v_next_lease_expiry
  from innerme_private.innerme_integration_quota_leases
  where capability = p_capability
    and released_at is null
    and lease_expires_at > v_now;

  if v_inflight_count >= 3 then
    v_reason := 'concurrent_limit';
    v_retry_after := greatest(
      1,
      pg_catalog.ceil(
        pg_catalog.date_part('epoch', v_next_lease_expiry - v_now)
      )::integer
    );
  end if;

  select coalesce((
    select reserved_count
    from innerme_private.innerme_integration_quota_windows
    where scope_type = 'admin'
      and scope_id = v_admin_user_id::text
      and capability = p_capability
      and window_type = 'minute'
      and window_start = v_minute_start
  ), 0) into v_admin_minute_used;

  select coalesce((
    select reserved_count
    from innerme_private.innerme_integration_quota_windows
    where scope_type = 'project'
      and scope_id = v_project_scope_id
      and capability = p_capability
      and window_type = 'minute'
      and window_start = v_minute_start
  ), 0) into v_project_minute_used;

  select coalesce((
    select reserved_count
    from innerme_private.innerme_integration_quota_windows
    where scope_type = 'admin'
      and scope_id = v_admin_user_id::text
      and capability = p_capability
      and window_type = 'utc_day'
      and window_start = v_day_start
  ), 0) into v_admin_day_used;

  select coalesce((
    select reserved_count
    from innerme_private.innerme_integration_quota_windows
    where scope_type = 'project'
      and scope_id = v_project_scope_id
      and capability = p_capability
      and window_type = 'utc_day'
      and window_start = v_day_start
  ), 0) into v_project_day_used;

  if v_admin_minute_used >= 3 then
    v_reason := coalesce(v_reason, 'admin_minute_limit');
    v_retry_after := greatest(
      v_retry_after,
      greatest(1, pg_catalog.ceil(
        pg_catalog.date_part('epoch', v_minute_start + interval '1 minute' - v_now)
      )::integer)
    );
  end if;

  if v_project_minute_used >= 15 then
    v_reason := coalesce(v_reason, 'project_minute_limit');
    v_retry_after := greatest(
      v_retry_after,
      greatest(1, pg_catalog.ceil(
        pg_catalog.date_part('epoch', v_minute_start + interval '1 minute' - v_now)
      )::integer)
    );
  end if;

  if v_admin_day_used >= 30 then
    v_reason := coalesce(v_reason, 'admin_daily_limit');
    v_retry_after := greatest(
      v_retry_after,
      greatest(1, pg_catalog.ceil(
        pg_catalog.date_part('epoch', v_day_start + interval '1 day' - v_now)
      )::integer)
    );
  end if;

  if v_project_day_used >= 100 then
    v_reason := coalesce(v_reason, 'project_daily_limit');
    v_retry_after := greatest(
      v_retry_after,
      greatest(1, pg_catalog.ceil(
        pg_catalog.date_part('epoch', v_day_start + interval '1 day' - v_now)
      )::integer)
    );
  end if;

  if v_reason is not null then
    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'reason', v_reason,
      'retry_after_seconds', v_retry_after
    );
  end if;

  insert into innerme_private.innerme_integration_quota_windows as q (
    scope_type, scope_id, capability, window_type, window_start, reserved_count, updated_at
  ) values
    ('admin', v_admin_user_id::text, p_capability, 'minute', v_minute_start, 1, v_now),
    ('project', v_project_scope_id, p_capability, 'minute', v_minute_start, 1, v_now),
    ('admin', v_admin_user_id::text, p_capability, 'utc_day', v_day_start, 1, v_now),
    ('project', v_project_scope_id, p_capability, 'utc_day', v_day_start, 1, v_now)
  on conflict (scope_type, scope_id, capability, window_type, window_start)
  do update
    set reserved_count = q.reserved_count + 1,
        updated_at = excluded.updated_at;

  insert into innerme_private.innerme_integration_quota_leases (
    admin_user_id, capability, reserved_at, lease_expires_at
  ) values (
    v_admin_user_id, p_capability, v_now, v_now + interval '60 seconds'
  )
  returning reservation_id into v_reservation_id;

  return pg_catalog.jsonb_build_object(
    'allowed', true,
    'reservation_id', v_reservation_id,
    'reserved_at', v_now,
    'lease_expires_at', v_now + interval '60 seconds',
    'limits', pg_catalog.jsonb_build_object(
      'admin_per_minute', 3,
      'project_per_minute', 15,
      'admin_per_utc_day', 30,
      'project_per_utc_day', 100,
      'project_concurrent', 3
    )
  );
end;
$function$;

create or replace function innerme_private.release_integration_quota(
  p_reservation_id uuid,
  p_capability text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin_user_id uuid := auth.uid();
  v_released boolean := false;
  v_rows integer := 0;
begin
  if v_admin_user_id is null or not public.is_swayphics_admin() then
    raise insufficient_privilege using message = 'Active Swayphics admin access is required.';
  end if;

  if p_capability is distinct from 'za.municipal_money.income_expenditure.read' then
    raise invalid_parameter_value using message = 'Integration capability is not approved.';
  end if;

  update innerme_private.innerme_integration_quota_leases
  set released_at = pg_catalog.clock_timestamp()
  where reservation_id = p_reservation_id
    and admin_user_id = v_admin_user_id
    and capability = p_capability
    and released_at is null;

  get diagnostics v_rows = row_count;
  v_released := v_rows > 0;

  return pg_catalog.jsonb_build_object(
    'released', v_released,
    'idempotent', not v_released
  );
end;
$function$;

create or replace function public.innerme_reserve_integration_quota(
  p_capability text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if auth.uid() is null or not public.is_swayphics_admin() then
    raise insufficient_privilege using message = 'Active Swayphics admin access is required.';
  end if;

  if p_capability is distinct from 'za.municipal_money.income_expenditure.read' then
    raise invalid_parameter_value using message = 'Integration capability is not approved.';
  end if;

  return innerme_private.reserve_integration_quota(p_capability);
end;
$function$;

create or replace function public.innerme_release_integration_quota(
  p_reservation_id uuid,
  p_capability text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if auth.uid() is null or not public.is_swayphics_admin() then
    raise insufficient_privilege using message = 'Active Swayphics admin access is required.';
  end if;

  if p_reservation_id is null
    or p_capability is distinct from 'za.municipal_money.income_expenditure.read' then
    raise invalid_parameter_value using message = 'Integration reservation is not valid.';
  end if;

  return innerme_private.release_integration_quota(p_reservation_id, p_capability);
end;
$function$;

revoke all on function innerme_private.reserve_integration_quota(text)
  from public, anon, authenticated, service_role;
revoke all on function innerme_private.release_integration_quota(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function innerme_private.reserve_integration_quota(text) to authenticated;
grant execute on function innerme_private.release_integration_quota(uuid, text) to authenticated;

revoke all on function public.innerme_reserve_integration_quota(text)
  from public, anon, authenticated, service_role;
revoke all on function public.innerme_release_integration_quota(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.innerme_reserve_integration_quota(text) to authenticated;
grant execute on function public.innerme_release_integration_quota(uuid, text) to authenticated;

comment on schema innerme_private is
  'Non-exposed internal storage and helpers for governed InnerMe external integrations.';
comment on table innerme_private.innerme_integration_quota_windows is
  'Atomic per-admin and per-project invocation counters for approved external integration capabilities; inaccessible directly to API roles.';
comment on table innerme_private.innerme_integration_quota_leases is
  'Short-lived concurrency leases for approved external integration invocations; consumed request counters are not decremented on release.';
comment on function public.innerme_reserve_integration_quota(text) is
  'Authenticated active-admin RPC that atomically reserves per-admin/project invocation limits and a project concurrency lease for an approved integration capability.';
comment on function public.innerme_release_integration_quota(uuid, text) is
  'Authenticated active-admin RPC that idempotently releases an in-flight integration lease without decrementing request counters.';
