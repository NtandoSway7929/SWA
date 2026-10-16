-- Correct the exhausted-quota branch of the zero-cost provider guard.
-- COALESCE is SQL syntax, not a pg_catalog function. Preserve the existing
-- limits and fail-closed decision; do not reset or increase any quota counter.

create or replace function public.innerme_reserve_provider_quota(
  p_provider text,
  p_model text,
  p_request_bytes integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_quota_date date := (pg_catalog.now() at time zone 'UTC')::date;
  v_daily_limit integer;
  v_used integer;
begin
  if p_provider = 'cloudflare' then
    if p_model <> '@cf/meta/llama-3.1-8b-instruct-fp8' then
      return pg_catalog.jsonb_build_object(
        'allowed', false, 'used', 0, 'daily_limit', 100, 'reason', 'model_not_approved'
      );
    end if;
    v_daily_limit := 100;
    if p_request_bytes is null or p_request_bytes < 0 or p_request_bytes > 8000 then
      return pg_catalog.jsonb_build_object(
        'allowed', false, 'used', 0, 'daily_limit', v_daily_limit, 'reason', 'request_too_large'
      );
    end if;
  elsif p_provider = 'gemini' then
    if p_model not in ('gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite') then
      return pg_catalog.jsonb_build_object(
        'allowed', false, 'used', 0, 'daily_limit', 40, 'reason', 'model_not_approved'
      );
    end if;
    v_daily_limit := 40;
    if p_request_bytes is null or p_request_bytes < 0 or p_request_bytes > 24000 then
      return pg_catalog.jsonb_build_object(
        'allowed', false, 'used', 0, 'daily_limit', v_daily_limit, 'reason', 'request_too_large'
      );
    end if;
  else
    return pg_catalog.jsonb_build_object(
      'allowed', false, 'used', 0, 'daily_limit', 0, 'reason', 'provider_not_approved'
    );
  end if;

  insert into public.innerme_provider_quota_daily as q (
    provider, quota_date, request_count, updated_at
  )
  values (p_provider, v_quota_date, 1, pg_catalog.now())
  on conflict (provider, quota_date)
  do update
    set request_count = q.request_count + 1,
        updated_at = pg_catalog.now()
    where q.request_count < v_daily_limit
  returning request_count into v_used;

  if v_used is null then
    select q.request_count
      into v_used
      from public.innerme_provider_quota_daily as q
      where q.provider = p_provider and q.quota_date = v_quota_date;

    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'used', COALESCE(v_used, v_daily_limit),
      'daily_limit', v_daily_limit,
      'reason', 'daily_quota_reached'
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'allowed', true,
    'used', v_used,
    'daily_limit', v_daily_limit,
    'reason', null
  );
end;
$$;

revoke all on function public.innerme_reserve_provider_quota(text, text, integer) from public, anon, authenticated;
grant execute on function public.innerme_reserve_provider_quota(text, text, integer) to service_role;

comment on function public.innerme_reserve_provider_quota(text, text, integer) is
  'Atomically reserves one provider request only for explicitly approved models, byte limits, and daily request ceilings; exhausted quota is returned without reserving another request.';
