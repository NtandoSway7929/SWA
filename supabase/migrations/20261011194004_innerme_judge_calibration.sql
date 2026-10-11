-- Persist judge-calibration runs separately from production-quality benchmark runs.
-- This prevents calibration fixtures from being counted as ordinary scored cases.
create table if not exists public.innerme_judge_calibration_runs (
  id uuid primary key default gen_random_uuid(),
  calibration_version integer not null,
  provider_model text not null,
  status text not null check (status in ('running', 'completed', 'inconclusive')),
  total_case_pairs integer not null default 0,
  passed_pairs integer not null default 0,
  failed_pairs integer not null default 0,
  calibration_passed boolean,
  summary jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.innerme_judge_calibration_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.innerme_judge_calibration_runs(id) on delete cascade,
  calibration_case_key text not null,
  candidate_key text not null,
  expected_quality text not null check (expected_quality in ('correct', 'incorrect')),
  judge_model text not null,
  score numeric not null check (score >= 0 and score <= 100),
  passed boolean not null,
  dimension_scores jsonb not null default '{}'::jsonb,
  rationale text not null,
  created_at timestamptz not null default now(),
  unique (run_id, calibration_case_key, candidate_key, judge_model)
);

create index if not exists innerme_judge_calibration_runs_created_idx
  on public.innerme_judge_calibration_runs (created_at desc);

create index if not exists innerme_judge_calibration_results_run_idx
  on public.innerme_judge_calibration_results (run_id, calibration_case_key);

alter table public.innerme_judge_calibration_runs enable row level security;
alter table public.innerme_judge_calibration_results enable row level security;

grant select, insert, update on public.innerme_judge_calibration_runs to authenticated;
grant select, insert on public.innerme_judge_calibration_results to authenticated;

drop policy if exists "innerme judge calibration runs admins can select"
  on public.innerme_judge_calibration_runs;
create policy "innerme judge calibration runs admins can select"
  on public.innerme_judge_calibration_runs
  for select to authenticated
  using ((select public.is_swayphics_admin()));

drop policy if exists "innerme judge calibration runs admins can insert"
  on public.innerme_judge_calibration_runs;
create policy "innerme judge calibration runs admins can insert"
  on public.innerme_judge_calibration_runs
  for insert to authenticated
  with check ((select public.is_swayphics_admin()));

drop policy if exists "innerme judge calibration runs admins can update"
  on public.innerme_judge_calibration_runs;
create policy "innerme judge calibration runs admins can update"
  on public.innerme_judge_calibration_runs
  for update to authenticated
  using ((select public.is_swayphics_admin()))
  with check ((select public.is_swayphics_admin()));

drop policy if exists "innerme judge calibration results admins can select"
  on public.innerme_judge_calibration_results;
create policy "innerme judge calibration results admins can select"
  on public.innerme_judge_calibration_results
  for select to authenticated
  using ((select public.is_swayphics_admin()));

drop policy if exists "innerme judge calibration results admins can insert"
  on public.innerme_judge_calibration_results;
create policy "innerme judge calibration results admins can insert"
  on public.innerme_judge_calibration_results
  for insert to authenticated
  with check ((select public.is_swayphics_admin()));

comment on table public.innerme_judge_calibration_runs is
  'Isolated judge-sensitivity calibration runs. These are not ordinary InnerMe answer-quality benchmark runs.';
comment on table public.innerme_judge_calibration_results is
  'Scores from fixed known-good and deliberately flawed answer pairs, recorded per judge model.';
