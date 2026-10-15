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
  execution_contract_version text,
  execution_contract_snapshot jsonb not null default '{}'::jsonb,
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
  constraint innerme_execution_plans_contract_snapshot_object check (jsonb_typeof(execution_contract_snapshot)='object'),
  constraint innerme_execution_plans_contract_version_check check (
    execution_contract_version is null or (
      execution_contract_version='innerme-execution-contract-v1'
      and execution_contract_snapshot->>'version'=execution_contract_version
      and nullif(trim(execution_contract_snapshot->>'goal'),'') is not null
      and jsonb_typeof(execution_contract_snapshot->'constraints')='array'
      and jsonb_typeof(execution_contract_snapshot->'output_format')='object'
      and jsonb_typeof(execution_contract_snapshot->'failure_conditions')='array'
    )
  ),
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
  attempt_count integer not null default 0,
  started_at timestamptz,
  checkpoint jsonb not null default '{}'::jsonb,
  checkpointed_at timestamptz,
  completion_evidence jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  blocked_reason text,
  last_error_code text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint innerme_execution_steps_order_check check (step_order between 1 and 50),
  constraint innerme_execution_steps_due_check check (due_offset_days is null or due_offset_days between 0 and 365),
  constraint innerme_execution_steps_dependency_check check (depends_on_step_order is null or (depends_on_step_order >= 1 and depends_on_step_order < step_order)),
  constraint innerme_execution_steps_risk_check check (risk_level in ('low','medium','high')),
  constraint innerme_execution_steps_status_check check (status in ('planned','approved','in_progress','completed','blocked','cancelled')),
  constraint innerme_execution_steps_attempt_count_check check (attempt_count >= 0),
  constraint innerme_execution_steps_checkpoint_object_check check (jsonb_typeof(checkpoint)='object'),
  constraint innerme_execution_steps_completion_evidence_object_check check (jsonb_typeof(completion_evidence)='object'),
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

create or replace function public.guard_innerme_execution_step_status_change()
returns trigger
language plpgsql
security invoker
set search_path=public
as $function$
declare
  v_guard_mode text := current_setting('innerme.execution_step_transition',true);
begin
  if tg_op='INSERT' then
    if v_guard_mode is distinct from 'authorized'
       and (
         new.status <> 'planned'
         or new.attempt_count <> 0
         or new.started_at is not null
         or new.checkpoint <> '{}'::jsonb
         or new.checkpointed_at is not null
         or new.completion_evidence <> '{}'::jsonb
         or new.completed_at is not null
         or new.completed_by is not null
         or new.blocked_reason is not null
         or new.last_error_code is not null
       ) then
      raise exception 'New execution steps must start in planned status with empty run-controller state.';
    end if;
    return new;
  end if;

  if v_guard_mode is distinct from 'authorized'
     and (
       new.attempt_count is distinct from old.attempt_count
       or new.started_at is distinct from old.started_at
       or new.checkpoint is distinct from old.checkpoint
       or new.checkpointed_at is distinct from old.checkpointed_at
       or new.completion_evidence is distinct from old.completion_evidence
       or new.completed_at is distinct from old.completed_at
       or new.completed_by is distinct from old.completed_by
       or new.blocked_reason is distinct from old.blocked_reason
       or new.last_error_code is distinct from old.last_error_code
     ) then
    raise exception 'Run-controller fields may only be changed through the governed transition RPC.';
  end if;

  if new.status is distinct from old.status then
    if v_guard_mode='authorized' then
      return new;
    elsif v_guard_mode='plan_review'
      and old.status='planned'
      and new.status in ('approved','cancelled') then
      return new;
    else
      raise exception 'Execution-step run status changes must use the governed transition RPC or plan-review RPC.';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.guard_innerme_execution_step_status_change() from public, anon;
drop trigger if exists guard_innerme_execution_step_status_change on public.innerme_execution_steps;
create trigger guard_innerme_execution_step_status_change
  before insert or update on public.innerme_execution_steps
  for each row execute function public.guard_innerme_execution_step_status_change();

create table if not exists public.innerme_execution_step_events (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.innerme_execution_plans(id) on delete cascade,
  step_id uuid not null references public.innerme_execution_steps(id) on delete cascade,
  event_type text not null check (event_type in ('started','resumed','checkpointed','completed','blocked')),
  from_status text not null check (from_status in ('planned','approved','in_progress','completed','blocked','cancelled')),
  to_status text not null check (to_status in ('planned','approved','in_progress','completed','blocked','cancelled')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  note text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object'),
  created_at timestamptz not null default now()
 );

alter table public.innerme_execution_step_events enable row level security;
drop policy if exists "InnerMe execution step events admins can read" on public.innerme_execution_step_events;
create policy "InnerMe execution step events admins can read"
  on public.innerme_execution_step_events for select to authenticated
  using ((select public.is_swayphics_admin()));
revoke all on table public.innerme_execution_step_events from public, anon, authenticated;
grant select on table public.innerme_execution_step_events to authenticated;
grant all on table public.innerme_execution_step_events to service_role;

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
    source_conversation_id, execution_contract_version, execution_contract_snapshot, created_by
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
    nullif(trim(coalesce(p_plan->>'execution_contract_version','')),''),
    case when jsonb_typeof(coalesce(p_plan->'execution_contract_snapshot','{}'::jsonb))='object' then coalesce(p_plan->'execution_contract_snapshot','{}'::jsonb) else '{}'::jsonb end,
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
  perform set_config('innerme.execution_step_transition','plan_review',true);
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


-- Durable execution-step transitions and auditable checkpoints.
create or replace function public.transition_innerme_execution_step(
  p_step_id uuid,
  p_transition text,
  p_note text default null,
  p_checkpoint jsonb default '{}'::jsonb,
  p_completion_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_step public.innerme_execution_steps%rowtype;
  v_plan public.innerme_execution_plans%rowtype;
  v_transition text := lower(trim(coalesce(p_transition,'')));
  v_note text := nullif(trim(coalesce(p_note,'')),'');
  v_from_status text;
  v_event_type text;
  v_event_payload jsonb := '{}'::jsonb;
  v_dependency_status text;
  v_remaining integer;
  v_ref jsonb;
begin
  if auth.uid() is null or not public.is_swayphics_admin() then
    raise exception 'Active Swayphics admin access required.';
  end if;

  perform set_config('innerme.execution_step_transition','authorized',true);

  if v_transition not in ('start','resume','checkpoint','complete','block') then
    raise exception 'Unsupported execution-step transition.';
  end if;

  select * into v_step
  from public.innerme_execution_steps
  where id=p_step_id
  for update;

  if not found then
    raise exception 'The InnerMe execution step could not be found.';
  end if;

  select * into v_plan
  from public.innerme_execution_plans
  where id=v_step.plan_id
  for update;

  if not found then
    raise exception 'The execution plan for this step could not be found.';
  end if;

  if v_plan.status not in ('approved','active') then
    raise exception 'Step execution requires an approved or active execution plan.';
  end if;

  if v_transition in ('start','resume','complete') and v_step.depends_on_step_order is not null then
    select status into v_dependency_status
    from public.innerme_execution_steps
    where plan_id=v_step.plan_id
      and step_order=v_step.depends_on_step_order;

    if v_dependency_status is distinct from 'completed' then
      raise exception 'The prerequisite execution step must be explicitly verified as completed before this step can proceed.';
    end if;
  end if;

  v_from_status := v_step.status;

  if v_transition in ('start','resume','complete') and (
    nullif(trim(coalesce(v_step.success_signal,'')),'') is null
    or nullif(trim(coalesce(v_step.verification_method,'')),'') is null
  ) then
    raise exception 'This step requires an observable success signal and a verification method before it can run.';
  end if;

  if v_transition in ('resume','complete','block') and exists (
    select 1
    from public.innerme_action_proposals p
    left join public.innerme_action_execution_logs e on e.proposal_id=p.id
    where p.step_id=v_step.id
      and (
        p.status in ('proposed','approved','executing')
        or e.status='started'
      )
  ) then
    raise exception 'A controlled action for this step remains proposed, approved, executing, or has an open execution log. Review/reject it or reconcile its execution before resuming, completing, or blocking this step.';
  end if;

  if v_transition='start' then
    if v_step.status <> 'approved' then
      raise exception 'Only an approved step can be started. Resume a blocked step through the explicit resume transition.';
    end if;

    update public.innerme_execution_steps
    set status='in_progress',
        attempt_count=attempt_count+1,
        started_at=now(),
        blocked_reason=null,
        last_error_code=null,
        updated_at=now()
    where id=v_step.id
    returning * into v_step;

    v_event_type := 'started';
    v_note := coalesce(v_note,'Administrator started this step.');
    v_event_payload := jsonb_build_object('checkpoint',coalesce(v_step.checkpoint,'{}'::jsonb));

  elsif v_transition='resume' then
    if v_step.status <> 'blocked' then
      raise exception 'Only a blocked step can be resumed.';
    end if;

    update public.innerme_execution_steps
    set status='in_progress',
        attempt_count=attempt_count+1,
        started_at=now(),
        blocked_reason=null,
        last_error_code=null,
        updated_at=now()
    where id=v_step.id
    returning * into v_step;

    v_event_type := 'resumed';
    v_note := coalesce(v_note,'Administrator resumed the blocked step after review.');
    v_event_payload := jsonb_build_object('checkpoint',coalesce(v_step.checkpoint,'{}'::jsonb));

  elsif v_transition='checkpoint' then
    if v_step.status <> 'in_progress' then
      raise exception 'Only an in-progress step can save a checkpoint.';
    end if;
    if v_note is null or char_length(v_note)<10 or char_length(v_note)>1200 then
      raise exception 'A checkpoint note of 10 to 1,200 characters is required.';
    end if;
    if p_checkpoint is null or jsonb_typeof(p_checkpoint)<>'object'
       or octet_length(p_checkpoint::text)>8000 then
      raise exception 'The checkpoint must be a JSON object no larger than 8,000 bytes.';
    end if;
    if exists (
      select 1 from jsonb_object_keys(p_checkpoint) as k(key)
      where k.key not in ('phase','progress_summary','verified_artifact_refs','unresolved_items','next_action','error_code')
    ) then
      raise exception 'The checkpoint contains an unsupported field.';
    end if;
    if nullif(trim(coalesce(p_checkpoint->>'phase','')),'') is null
       or char_length(p_checkpoint->>'phase')>80
       or nullif(trim(coalesce(p_checkpoint->>'progress_summary','')),'') is null
       or char_length(p_checkpoint->>'progress_summary')>1200 then
      raise exception 'The checkpoint requires a phase and a progress summary within the documented limits.';
    end if;
    if p_checkpoint ? 'verified_artifact_refs'
       and jsonb_typeof(p_checkpoint->'verified_artifact_refs')<>'array' then
      raise exception 'verified_artifact_refs must be an array.';
    end if;
    if jsonb_array_length(coalesce(p_checkpoint->'verified_artifact_refs','[]'::jsonb))>12 then
      raise exception 'A checkpoint may contain at most 12 verified artifact references.';
    end if;
    if exists (
      select 1 from jsonb_array_elements(coalesce(p_checkpoint->'verified_artifact_refs','[]'::jsonb)) as a(value)
      where jsonb_typeof(a.value)<>'object'
         or (a.value - array['source','id','why'])<>'{}'::jsonb
         or coalesce(a.value->>'source','') not in ('workspace_record','task_record','email_message','test_result','external_url','manual_attestation','other')
         or nullif(trim(coalesce(a.value->>'id','')),'') is null
         or char_length(a.value->>'id')>240
         or nullif(trim(coalesce(a.value->>'why','')),'') is null
         or char_length(a.value->>'why')>500
    ) then
      raise exception 'Each checkpoint artifact reference must contain an approved source, an ID/reference, and a short explanation.';
    end if;
    if p_checkpoint ? 'unresolved_items'
       and jsonb_typeof(p_checkpoint->'unresolved_items')<>'array' then
      raise exception 'unresolved_items must be an array.';
    end if;
    if jsonb_array_length(coalesce(p_checkpoint->'unresolved_items','[]'::jsonb))>12 then
      raise exception 'A checkpoint may contain at most 12 unresolved items.';
    end if;
    if exists (
      select 1 from jsonb_array_elements(coalesce(p_checkpoint->'unresolved_items','[]'::jsonb)) as u(value)
      where jsonb_typeof(u.value)<>'string' or char_length(u.value#>>'{}')>500
    ) then
      raise exception 'Each unresolved item must be a string of at most 500 characters.';
    end if;
    if p_checkpoint ? 'next_action' and char_length(coalesce(p_checkpoint->>'next_action',''))>400 then
      raise exception 'next_action cannot exceed 400 characters.';
    end if;
    if p_checkpoint ? 'error_code' and char_length(coalesce(p_checkpoint->>'error_code',''))>80 then
      raise exception 'error_code cannot exceed 80 characters.';
    end if;

    update public.innerme_execution_steps
    set checkpoint=coalesce(checkpoint,'{}'::jsonb)||p_checkpoint,
        checkpointed_at=now(),
        last_error_code=nullif(trim(coalesce(p_checkpoint->>'error_code','')),''),
        updated_at=now()
    where id=v_step.id
    returning * into v_step;

    v_event_type := 'checkpointed';
    v_event_payload := p_checkpoint;

  elsif v_transition='complete' then
    if v_step.status <> 'in_progress' then
      raise exception 'Only an in-progress step can be marked completed.';
    end if;
    if v_note is null or char_length(v_note)<20 or char_length(v_note)>1200 then
      raise exception 'A verification note of 20 to 1,200 characters is required.';
    end if;
    if p_completion_evidence is null
       or jsonb_typeof(p_completion_evidence)<>'object'
       or octet_length(p_completion_evidence::text)>8000 then
      raise exception 'Completion evidence must be a JSON object no larger than 8,000 bytes.';
    end if;
    if exists (
      select 1 from jsonb_object_keys(p_completion_evidence) as k(key)
      where k.key not in ('verified_by_human','verification_method','summary','evidence_refs')
    ) then
      raise exception 'Completion evidence contains an unsupported field.';
    end if;
    if p_completion_evidence->'verified_by_human' is distinct from 'true'::jsonb then
      raise exception 'Completion requires explicit administrator verification.';
    end if;
    if nullif(trim(coalesce(p_completion_evidence->>'verification_method','')),'') is null
       or char_length(p_completion_evidence->>'verification_method')>500
       or nullif(trim(coalesce(p_completion_evidence->>'summary','')),'') is null
       or char_length(p_completion_evidence->>'summary')<20
       or char_length(p_completion_evidence->>'summary')>1200 then
      raise exception 'Completion evidence requires a verification method and a summary of 20 to 1,200 characters.';
    end if;
    if jsonb_typeof(p_completion_evidence->'evidence_refs') is distinct from 'array' then
      raise exception 'Completion evidence_refs must be an array.';
    end if;
    if jsonb_array_length(p_completion_evidence->'evidence_refs')<1
       or jsonb_array_length(p_completion_evidence->'evidence_refs')>12 then
      raise exception 'Completion requires between one and 12 evidence references.';
    end if;

    for v_ref in select value from jsonb_array_elements(p_completion_evidence->'evidence_refs')
    loop
      if jsonb_typeof(v_ref)<>'object'
         or (v_ref - array['source','id','why'])<>'{}'::jsonb
         or coalesce(v_ref->>'source','') not in ('workspace_record','task_record','email_message','test_result','external_url','manual_attestation','other')
         or nullif(trim(coalesce(v_ref->>'id','')),'') is null
         or char_length(v_ref->>'id')>240
         or nullif(trim(coalesce(v_ref->>'why','')),'') is null
         or char_length(v_ref->>'why')>500 then
        raise exception 'Each completion reference must contain an approved source, an ID/reference, and a short explanation.';
      end if;
    end loop;

    update public.innerme_execution_steps
    set status='completed',
        completion_evidence=p_completion_evidence||jsonb_build_object(
          'verification_note',v_note,
          'verified_at',now(),
          'verified_by',auth.uid()
        ),
        completed_at=now(),
        completed_by=auth.uid(),
        blocked_reason=null,
        last_error_code=null,
        updated_at=now()
    where id=v_step.id
    returning * into v_step;

    v_event_type := 'completed';
    v_event_payload := p_completion_evidence;

  elsif v_transition='block' then
    if v_step.status not in ('approved','in_progress') then
      raise exception 'Only an approved or in-progress step can be blocked.';
    end if;
    if v_note is null or char_length(v_note)<20 or char_length(v_note)>1200 then
      raise exception 'A blocking reason of 20 to 1,200 characters is required.';
    end if;

    update public.innerme_execution_steps
    set status='blocked',
        blocked_reason=v_note,
        updated_at=now()
    where id=v_step.id
    returning * into v_step;

    v_event_type := 'blocked';
    v_event_payload := jsonb_build_object('blocked_reason',v_note);
  end if;

  insert into public.innerme_execution_step_events(
    plan_id,step_id,event_type,from_status,to_status,actor_id,attempt_count,note,payload
  ) values (
    v_step.plan_id,v_step.id,v_event_type,v_from_status,v_step.status,auth.uid(),
    v_step.attempt_count,v_note,coalesce(v_event_payload,'{}'::jsonb)
  );

  select count(*) into v_remaining
  from public.innerme_execution_steps
  where plan_id=v_step.plan_id and status<>'completed';

  return jsonb_build_object(
    'ok',true,
    'step_id',v_step.id,
    'plan_id',v_step.plan_id,
    'transition',v_transition,
    'status',v_step.status,
    'attempt_count',v_step.attempt_count,
    'checkpointed_at',v_step.checkpointed_at,
    'completed_at',v_step.completed_at,
    'remaining_incomplete_steps',v_remaining,
    'plan_completion_status',case
      when v_remaining=0 then 'all_steps_completed_business_outcome_verification_still_required'
      else 'steps_remaining'
    end,
    'automatic_side_effect_performed',false
  );
end;
$function$;

revoke all on function public.transition_innerme_execution_step(uuid,text,text,jsonb,jsonb) from public, anon;
grant execute on function public.transition_innerme_execution_step(uuid,text,text,jsonb,jsonb) to authenticated;
