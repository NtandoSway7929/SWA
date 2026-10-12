-- Store minimal provider-attempt telemetry for InnerMe routing.
-- Deliberately excludes prompts, generated answers, client records, and credentials.

create table if not exists public.innerme_provider_usage (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  task_category text not null check (task_category in ('copywriting', 'assistant_chat')),
  provider text not null check (provider in ('cloudflare', 'gemini')),
  model text not null,
  outcome text not null check (outcome in ('success', 'error')),
  http_status integer check (http_status between 100 and 599),
  latency_ms integer not null check (latency_ms >= 0),
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  total_tokens integer check (total_tokens >= 0),
  error_code text,
  fallback_reason text,
  created_at timestamptz not null default now(),
  constraint innerme_provider_usage_request_attempt_unique unique (request_id, attempt_number)
);

create index if not exists innerme_provider_usage_created_at_idx
  on public.innerme_provider_usage (created_at desc);

create index if not exists innerme_provider_usage_provider_outcome_created_idx
  on public.innerme_provider_usage (provider, outcome, created_at desc);

create index if not exists innerme_provider_usage_request_idx
  on public.innerme_provider_usage (request_id);

alter table public.innerme_provider_usage enable row level security;

revoke all on public.innerme_provider_usage from public, anon, authenticated, service_role;
grant select on public.innerme_provider_usage to authenticated;
grant insert on public.innerme_provider_usage to service_role;

drop policy if exists "InnerMe admins can view provider usage"
  on public.innerme_provider_usage;
create policy "InnerMe admins can view provider usage"
  on public.innerme_provider_usage
  for select to authenticated
  using ((select public.is_swayphics_admin()));

comment on table public.innerme_provider_usage is
  'Minimal InnerMe provider-attempt telemetry. Contains routing metadata and reported usage counts only; never stores prompts, answers, client records, or provider secrets.';
