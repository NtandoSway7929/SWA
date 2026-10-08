-- InnerMe Phase 9: Execution Intelligence
-- Approved InnerMe decisions can be converted into governed execution plans.
-- Phase 9 is planning only. It does not execute workspace or external actions.

alter table public.innerme_decisions
  add column if not exists evidence jsonb not null default '[]'::jsonb,
  add column if not exists expected_impact text,
  add column if not exists effort text not null default 'medium',
  add column if not exists urgency text not null default 'normal',
  add column if not exists confidence text not null default 'medium',
  add column if not exists recommended_next_action text,
  add column if not exists priority integer not null default 50;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.innerme_decisions'::regclass and conname='innerme_decisions_evidence_check') then
    alter table public.innerme_decisions add constraint innerme_decisions_evidence_check check (jsonb_typeof(evidence)='array');
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.innerme_decisions'::regclass and conname='innerme_decisions_effort_check') then
    alter table public.innerme_decisions add constraint innerme_decisions_effort_check check (effort in ('low','medium','high'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.innerme_decisions'::regclass and conname='innerme_decisions_urgency_check') then
    alter table public.innerme_decisions add constraint innerme_decisions_urgency_check check (urgency in ('critical','high','normal','low'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.innerme_decisions'::regclass and conname='innerme_decisions_confidence_check') then
    alter table public.innerme_decisions add constraint innerme_decisions_confidence_check check (confidence in ('high','medium','low'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.innerme_decisions'::regclass and conname='innerme_decisions_priority_check') then
    alter table public.innerme_decisions add constraint innerme_decisions_priority_check check (priority between 1 and 100);
  end if;
end $$;

create table if not exists public.innerme_execution_plans (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null,
  decision_id uuid not null references public.innerme_decisions(id) on delete restrict,
  title text not null,
  objective text not null,
  rationale text,
  evidence jsonb not null default '[]'::jsonb,
  success_metric text,
  completion_criteria jsonb not null default '[]'::jsonb,
  expected_outcome text,
  duration_days integer,
  target_date date,
  effort text not null default 'medium',
  urgency text not null default 'normal',
  confidence text not null default 'medium',
  risk text,
  status text not null default 'draft',
  source_conversation_id text,
  created_by uuid references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  activated_by uuid references auth.users(id) on delete restrict,
  activated_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint innerme_execution_plans_evidence_check check (jsonb_typeof(evidence)='array'),
  constraint innerme_execution_plans_completion_check check (jsonb_typeof(completion_criteria)='array'),
  constraint innerme_execution_plans_effort_check check (effort in ('low','medium','high')),
  constraint innerme_execution_plans_urgency_check check (urgency in ('critical','high','normal','low')),
  constraint innerme_execution_plans_confidence_check check (confidence in ('high','medium','low')),
  constraint innerme_execution_plans_status_check check (status in ('draft','approved','active','completed','blocked','cancelled')),
  constraint innerme_execution_plans_duration_check check (duration_days is null or duration_days between 0 and 365),
  constraint innerme_execution_plans_target_check check (target_date is null or duration_days is null or target_date >= created_at::date)
);

alter table public.innerme_execution_plans enable row level security;
drop policy if exists "innerme execution plans admins can manage" on public.innerme_execution_plans;
create policy "innerme execution plans admins can manage"
on public.innerme_execution_plans
for all to authenticated
using ((select public.is_swayphics_admin()))
with check ((select public.is_swayphics_admin()));

revoke all on table public.innerme_execution_plans from anon;
grant select,insert,update,delete on public.innerme_execution_plans to authenticated;
grant all on public.innerme_execution_plans to service_role;

create index if not exists innerme_execution_plans_decision_status_idx
on public.innerme_execution_plans(decision_id, status, created_at desc);
create index if not exists innerme_execution_plans_status_priority_idx
on public.innerme_execution_plans(status, urgency, created_at desc);

alter table public.innerme_execution_plans
  drop constraint if exists innerme_execution_plans_plan_key_key;

create unique index if not exists innerme_execution_plans_current_decision_unique
on public.innerme_execution_plans(decision_id)
where status in ('draft','approved','active');

create table if not exists public.innerme_execution_steps (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.innerme_execution_plans(id) on delete cascade,
  step_order integer not null,
  title text not null,
  action text not null,
  purpose text,
  owner_role text not null default 'Swayphics admin',
  due_offset_days integer,
  depends_on_step_order integer,
  success_signal text,
  verification_method text,
  risk_level text not null default 'low',
  status text not null default 'planned',
  linked_task_id uuid references public.tasks(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint innerme_execution_steps_order_check check (step_order between 1 and 50),
  constraint innerme_execution_steps_due_check check (due_offset_days is null or due_offset_days between 0 and 365),
  constraint innerme_execution_steps_dependency_check check (depends_on_step_order is null or (depends_on_step_order >= 1 and depends_on_step_order < step_order)),
  constraint innerme_execution_steps_risk_check check (risk_level in ('low','medium','high')),
  constraint innerme_execution_steps_status_check check (status in ('planned','approved','in_progress','completed','blocked','cancelled')),
  constraint innerme_execution_steps_unique_order unique (plan_id, step_order)
);

alter table public.innerme_execution_steps enable row level security;
drop policy if exists "innerme execution steps admins can manage" on public.innerme_execution_steps;
create policy "innerme execution steps admins can manage"
on public.innerme_execution_steps
for all to authenticated
using ((select public.is_swayphics_admin()))
with check ((select public.is_swayphics_admin()));

revoke all on table public.innerme_execution_steps from anon;
grant select,insert,update,delete on public.innerme_execution_steps to authenticated;
grant all on public.innerme_execution_steps to service_role;

create index if not exists innerme_execution_steps_plan_order_idx
on public.innerme_execution_steps(plan_id, step_order);
create index if not exists innerme_execution_steps_linked_task_idx
on public.innerme_execution_steps(linked_task_id);

create or replace function public.review_innerme_decision_candidate(
  p_candidate_id uuid,
  p_decision text
)
returns public.innerme_decision_candidates
language plpgsql
security invoker
set search_path=public
as $function$
declare
  v_candidate public.innerme_decision_candidates;
  v_decision text:=lower(trim(coalesce(p_decision,'')));
begin
  if not public.is_swayphics_admin() then
    raise exception 'Only active Swayphics admins can review InnerMe decision candidates.';
  end if;
  if v_decision not in ('approved','dismissed') then
    raise exception 'Decision candidate review must be approved or dismissed.';
  end if;

  select * into v_candidate
  from public.innerme_decision_candidates
  where id=p_candidate_id
  for update;

  if not found then
    raise exception 'The InnerMe decision candidate could not be found.';
  end if;
  if v_candidate.status <> 'candidate' then
    raise exception 'Only candidate decisions can be reviewed.';
  end if;

  if v_decision='approved' then
    insert into public.innerme_decisions (
      title, decision, context, rationale, evidence, expected_impact,
      effort, urgency, confidence, recommended_next_action, priority,
      status, source_conversation_id, created_by
    )
    values (
      v_candidate.title, v_candidate.decision, v_candidate.context, v_candidate.rationale,
      coalesce(v_candidate.evidence,'[]'::jsonb), v_candidate.expected_impact,
      v_candidate.effort, v_candidate.urgency, v_candidate.confidence,
      v_candidate.recommended_next_action, v_candidate.priority,
      'active', coalesce(v_candidate.source_conversation_id,'phase8_decision_intelligence'), auth.uid()
    );
  end if;

  update public.innerme_decision_candidates
  set status=v_decision, reviewed_by=auth.uid(), reviewed_at=now(), updated_at=now()
  where id=p_candidate_id
  returning * into v_candidate;

  return v_candidate;
end;
$function$;

revoke all on function public.review_innerme_decision_candidate(uuid,text) from public;
revoke all on function public.review_innerme_decision_candidate(uuid,text) from anon;
grant execute on function public.review_innerme_decision_candidate(uuid,text) to authenticated;

create or replace function public.create_innerme_execution_plan(
  p_plan jsonb,
  p_steps jsonb
)
returns public.innerme_execution_plans
language plpgsql
security invoker
set search_path=public
as $function$
declare
  v_plan public.innerme_execution_plans;
  v_decision_id uuid;
  v_plan_key text;
  v_step jsonb;
  v_step_count integer:=0;
  v_status text:=lower(trim(coalesce(p_plan->>'status','draft')));
begin
  if not public.is_swayphics_admin() then
    raise exception 'Only active Swayphics admins can create InnerMe execution plans.';
  end if;
  if p_plan is null or jsonb_typeof(p_plan) <> 'object' then
    raise exception 'Execution plan payload must be a JSON object.';
  end if;
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' then
    raise exception 'Execution plan steps must be a JSON array.';
  end if;

  v_decision_id := nullif(trim(p_plan->>'decision_id'),'')::uuid;
  v_plan_key := nullif(trim(p_plan->>'plan_key'),'');
  if v_decision_id is null or v_plan_key is null then
    raise exception 'Execution plan requires a decision_id and plan_key.';
  end if;

  perform 1 from public.innerme_decisions
  where id=v_decision_id and status='active';
  if not found then
    raise exception 'Execution plans may only be created for active InnerMe decisions.';
  end if;

  select * into v_plan
  from public.innerme_execution_plans
  where decision_id=v_decision_id and status in ('draft','approved','active')
  order by created_at desc limit 1;
  if found then
    return v_plan;
  end if;

  if v_status <> 'draft' then
    raise exception 'New execution plans must start in draft status.';
  end if;
  if nullif(trim(coalesce(p_plan->>'title','')),'') is null
     or nullif(trim(coalesce(p_plan->>'objective','')),'') is null then
    raise exception 'Execution plan title and objective are required.';
  end if;

  select count(*) into v_step_count
  from jsonb_array_elements(p_steps);
  if v_step_count < 1 then
    raise exception 'Execution plans require at least one execution step.';
  end if;
  if v_step_count > 12 then
    raise exception 'Execution plans are limited to 12 steps.';
  end if;

  insert into public.innerme_execution_plans (
    plan_key, decision_id, title, objective, rationale, evidence,
    success_metric, completion_criteria, expected_outcome, duration_days,
    target_date, effort, urgency, confidence, risk, status,
    source_conversation_id, created_by
  )
  values (
    v_plan_key, v_decision_id, trim(p_plan->>'title'), trim(p_plan->>'objective'),
    nullif(trim(coalesce(p_plan->>'rationale','')),''),
    case when jsonb_typeof(coalesce(p_plan->'evidence','[]'::jsonb))='array' then p_plan->'evidence' else '[]'::jsonb end,
    nullif(trim(coalesce(p_plan->>'success_metric','')),''),
    case when jsonb_typeof(coalesce(p_plan->'completion_criteria','[]'::jsonb))='array' then p_plan->'completion_criteria' else '[]'::jsonb end,
    nullif(trim(coalesce(p_plan->>'expected_outcome','')),''),
    case when nullif(trim(coalesce(p_plan->>'duration_days','')),'') is null then null else greatest(0,least((p_plan->>'duration_days')::integer,365)) end,
    case when nullif(trim(coalesce(p_plan->>'target_date','')),'') is null then null else (p_plan->>'target_date')::date end,
    case when (p_plan->>'effort') in ('low','medium','high') then p_plan->>'effort' else 'medium' end,
    case when (p_plan->>'urgency') in ('critical','high','normal','low') then p_plan->>'urgency' else 'normal' end,
    case when (p_plan->>'confidence') in ('high','medium','low') then p_plan->>'confidence' else 'medium' end,
    nullif(trim(coalesce(p_plan->>'risk','')),''),
    'draft',
    nullif(trim(coalesce(p_plan->>'source_conversation_id','')),''),
    auth.uid()
  )
  returning * into v_plan;

  for v_step in select value from jsonb_array_elements(p_steps)
  loop
    insert into public.innerme_execution_steps (
      plan_id, step_order, title, action, purpose, owner_role,
      due_offset_days, depends_on_step_order, success_signal,
      verification_method, risk_level, status, notes
    )
    values (
      v_plan.id,
      (v_step->>'step_order')::integer,
      trim(v_step->>'title'),
      trim(v_step->>'action'),
      nullif(trim(coalesce(v_step->>'purpose','')),''),
      coalesce(nullif(trim(v_step->>'owner_role'),''),'Swayphics admin'),
      case when nullif(trim(coalesce(v_step->>'due_offset_days','')),'') is null then null else greatest(0,least((v_step->>'due_offset_days')::integer,365)) end,
      case when nullif(trim(coalesce(v_step->>'depends_on_step_order','')),'') is null then null else (v_step->>'depends_on_step_order')::integer end,
      nullif(trim(coalesce(v_step->>'success_signal','')),''),
      nullif(trim(coalesce(v_step->>'verification_method','')),''),
      case when (v_step->>'risk_level') in ('low','medium','high') then v_step->>'risk_level' else 'low' end,
      'planned',
      nullif(trim(coalesce(v_step->>'notes','')),'')
    );
  end loop;

  return v_plan;
exception
  when unique_violation then
    select * into v_plan
    from public.innerme_execution_plans
    where decision_id=v_decision_id and status in ('draft','approved','active')
    order by created_at desc limit 1;
    if found then return v_plan; end if;
    raise;
end;
$function$;

revoke all on function public.create_innerme_execution_plan(jsonb,jsonb) from public;
revoke all on function public.create_innerme_execution_plan(jsonb,jsonb) from anon;
grant execute on function public.create_innerme_execution_plan(jsonb,jsonb) to authenticated;

create or replace function public.review_innerme_execution_plan(
  p_plan_id uuid,
  p_decision text
)
returns public.innerme_execution_plans
language plpgsql
security invoker
set search_path=public
as $function$
declare
  v_plan public.innerme_execution_plans;
  v_decision text:=lower(trim(coalesce(p_decision,'')));
  v_step_count integer;
begin
  if not public.is_swayphics_admin() then
    raise exception 'Only active Swayphics admins can review InnerMe execution plans.';
  end if;
  if v_decision not in ('approved','cancelled') then
    raise exception 'Execution plan review must be approved or cancelled.';
  end if;

  select * into v_plan
  from public.innerme_execution_plans
  where id=p_plan_id
  for update;
  if not found then
    raise exception 'The InnerMe execution plan could not be found.';
  end if;
  if v_plan.status <> 'draft' then
    raise exception 'Only draft execution plans can be reviewed.';
  end if;

  select count(*) into v_step_count
  from public.innerme_execution_steps
  where plan_id=v_plan.id;

  if v_decision='approved' and v_step_count < 1 then
    raise exception 'An execution plan cannot be approved without execution steps.';
  end if;

  if v_decision='approved' then
    update public.innerme_execution_plans
    set status='approved', approved_by=auth.uid(), approved_at=now(), updated_at=now()
    where id=v_plan.id
    returning * into v_plan;

    update public.innerme_execution_steps
    set status='approved', updated_at=now()
    where plan_id=v_plan.id and status='planned';
  else
    update public.innerme_execution_plans
    set status='cancelled', updated_at=now()
    where id=v_plan.id
    returning * into v_plan;

    update public.innerme_execution_steps
    set status='cancelled', updated_at=now()
    where plan_id=v_plan.id and status in ('planned','approved');
  end if;

  return v_plan;
end;
$function$;

revoke all on function public.review_innerme_execution_plan(uuid,text) from public;
revoke all on function public.review_innerme_execution_plan(uuid,text) from anon;
grant execute on function public.review_innerme_execution_plan(uuid,text) to authenticated;
