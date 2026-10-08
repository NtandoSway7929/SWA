-- InnerMe Phase 6: Evaluation & Benchmarking
-- Fixed benchmark cases and stored evaluation runs/results.
-- Benchmarking never mutates live knowledge or business workspace records.

create table if not exists public.innerme_evaluation_cases (
  id uuid primary key default gen_random_uuid(),
  case_key text not null unique,
  title text not null,
  category text not null,
  prompt text not null,
  expected_behavior text not null,
  expected_knowledge_ids jsonb not null default '[]'::jsonb,
  required_signals jsonb not null default '[]'::jsonb,
  forbidden_signals jsonb not null default '[]'::jsonb,
  rubric text not null,
  severity text not null default 'standard',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.innerme_evaluation_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null default 'manual',
  provider_model text,
  total_cases integer not null default 0,
  passed_cases integer not null default 0,
  failed_cases integer not null default 0,
  pass_rate numeric(5,2) not null default 0,
  average_score numeric(5,2) not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running',
  created_by uuid references auth.users(id) on delete restrict,
  summary jsonb not null default '{}'::jsonb
);

create table if not exists public.innerme_evaluation_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.innerme_evaluation_runs(id) on delete cascade,
  case_id uuid not null references public.innerme_evaluation_cases(id) on delete restrict,
  prompt text not null,
  answer text,
  retrieval_matches jsonb not null default '[]'::jsonb,
  attributed_knowledge jsonb not null default '{}'::jsonb,
  dimension_scores jsonb not null default '{}'::jsonb,
  score numeric(5,2) not null default 0,
  passed boolean not null default false,
  judge_rationale text,
  provider_model text,
  created_at timestamptz not null default now(),
  unique (run_id, case_id)
);

alter table public.innerme_evaluation_cases enable row level security;
alter table public.innerme_evaluation_runs enable row level security;
alter table public.innerme_evaluation_results enable row level security;

-- Existing project already contains the seeded benchmark cases.
-- Keep case seeding in the live migration history that created this system.

revoke all on table public.innerme_evaluation_cases, public.innerme_evaluation_runs, public.innerme_evaluation_results from anon;
grant select, insert, update, delete on public.innerme_evaluation_cases to authenticated;
grant select, insert, update on public.innerme_evaluation_runs to authenticated;
grant select, insert on public.innerme_evaluation_results to authenticated;
grant all on public.innerme_evaluation_cases, public.innerme_evaluation_runs, public.innerme_evaluation_results to service_role;

drop policy if exists "innerme evaluation cases admins can select" on public.innerme_evaluation_cases;
create policy "innerme evaluation cases admins can select" on public.innerme_evaluation_cases
for select to authenticated using ((select public.is_swayphics_admin()));

drop policy if exists "innerme evaluation cases admins can manage" on public.innerme_evaluation_cases;
create policy "innerme evaluation cases admins can manage" on public.innerme_evaluation_cases
for all to authenticated using ((select public.is_swayphics_admin()))
with check ((select public.is_swayphics_admin()));

drop policy if exists "innerme evaluation runs admins can select" on public.innerme_evaluation_runs;
create policy "innerme evaluation runs admins can select" on public.innerme_evaluation_runs
for select to authenticated using ((select public.is_swayphics_admin()));

drop policy if exists "innerme evaluation runs admins can insert" on public.innerme_evaluation_runs;
create policy "innerme evaluation runs admins can insert" on public.innerme_evaluation_runs
for insert to authenticated with check ((select public.is_swayphics_admin()));

drop policy if exists "innerme evaluation runs admins can update" on public.innerme_evaluation_runs;
create policy "innerme evaluation runs admins can update" on public.innerme_evaluation_runs
for update to authenticated using ((select public.is_swayphics_admin()))
with check ((select public.is_swayphics_admin()));

drop policy if exists "innerme evaluation results admins can select" on public.innerme_evaluation_results;
create policy "innerme evaluation results admins can select" on public.innerme_evaluation_results
for select to authenticated using ((select public.is_swayphics_admin()));

drop policy if exists "innerme evaluation results admins can insert" on public.innerme_evaluation_results;
create policy "innerme evaluation results admins can insert" on public.innerme_evaluation_results
for insert to authenticated with check ((select public.is_swayphics_admin()));

create index if not exists innerme_eval_cases_status_idx on public.innerme_evaluation_cases(status, severity);
create index if not exists innerme_eval_runs_started_idx on public.innerme_evaluation_runs(started_at desc);
create index if not exists innerme_eval_results_run_idx on public.innerme_evaluation_results(run_id, passed, score desc);


-- Phase 7 regression-control additions
alter table public.innerme_evaluation_runs
  add column if not exists benchmark_version integer not null default 1,
  add column if not exists knowledge_snapshot_hash text,
  add column if not exists baseline_run_id uuid references public.innerme_evaluation_runs(id) on delete set null,
  add column if not exists delta_average_score numeric(6,2),
  add column if not exists delta_pass_rate numeric(6,2),
  add column if not exists regression_status text not null default 'baseline',
  add column if not exists critical_failures integer not null default 0,
  add column if not exists regression_summary jsonb not null default '{}'::jsonb;

alter table public.innerme_evaluation_runs
  drop constraint if exists innerme_evaluation_runs_regression_status_check;
alter table public.innerme_evaluation_runs
  add constraint innerme_evaluation_runs_regression_status_check
  check (regression_status in ('baseline','stable','improved','regressed','inconclusive'));

alter table public.innerme_evaluation_results
  add column if not exists case_key text,
  add column if not exists severity text,
  add column if not exists failure_flags jsonb not null default '[]'::jsonb,
  add column if not exists regressed_from_previous boolean not null default false;

alter table public.innerme_evaluation_results
  drop constraint if exists innerme_evaluation_results_severity_check;
alter table public.innerme_evaluation_results
  add constraint innerme_evaluation_results_severity_check
  check (severity is null or severity in ('critical','high','standard'));

create index if not exists innerme_eval_runs_version_started_idx
  on public.innerme_evaluation_runs (benchmark_version, started_at desc);
create index if not exists innerme_eval_runs_regression_idx
  on public.innerme_evaluation_runs (regression_status, started_at desc);
create index if not exists innerme_eval_results_case_run_idx
  on public.innerme_evaluation_results (case_id, run_id, passed);

-- Partial benchmark runs are explicitly marked inconclusive.
alter table public.innerme_evaluation_runs
  drop constraint if exists innerme_evaluation_runs_status_check;
alter table public.innerme_evaluation_runs
  add constraint innerme_evaluation_runs_status_check
  check (status in ('running','completed','failed','inconclusive'));
