-- Hard-stop provider requests when models, request sizes, or daily limits are not approved.
-- Counters are UTC-day request reservations. They do not store prompts or answers.

create table if not exists public.innerme_provider_quota_daily (
  provider text not null check (provider in ('cloudflare', 'gemini')),
  quota_date date not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (provider, quota_date)
);

alter table public.innerme_provider_quota_daily enable row level security;
revoke all on public.innerme_provider_quota_daily from public, anon, authenticated, service_role;
grant select, insert, update on public.innerme_provider_quota_daily to service_role;

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
      'used', pg_catalog.coalesce(v_used, v_daily_limit),
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

comment on table public.innerme_provider_quota_daily is
  'UTC-day provider reservation counters used by InnerMe zero-cost guard. Readable only by the server-side service role.';
comment on function public.innerme_reserve_provider_quota(text, text, integer) is
  'Atomically reserves one provider request only for explicitly approved models, byte limits, and daily request ceilings.';
