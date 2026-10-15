-- Persist the deterministic execution contract used to validate each newly generated plan.
-- Existing plans remain valid with NULL version and an empty snapshot; new contract-aware
-- plans record the exact contract that passed validation before the draft was saved.

alter table public.innerme_execution_plans
  add column if not exists execution_contract_version text,
  add column if not exists execution_contract_snapshot jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.innerme_execution_plans'::regclass
      and conname='innerme_execution_plans_contract_snapshot_object'
  ) then
    alter table public.innerme_execution_plans
      add constraint innerme_execution_plans_contract_snapshot_object
      check (jsonb_typeof(execution_contract_snapshot)='object');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.innerme_execution_plans'::regclass
      and conname='innerme_execution_plans_contract_version_check'
  ) then
    alter table public.innerme_execution_plans
      add constraint innerme_execution_plans_contract_version_check
      check (
        execution_contract_version is null or (
          execution_contract_version='innerme-execution-contract-v1'
          and execution_contract_snapshot->>'version'=execution_contract_version
          and nullif(trim(execution_contract_snapshot->>'goal'),'') is not null
          and jsonb_typeof(execution_contract_snapshot->'constraints')='array'
          and jsonb_typeof(execution_contract_snapshot->'output_format')='object'
          and jsonb_typeof(execution_contract_snapshot->'failure_conditions')='array'
        )
      );
  end if;
end $$;

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


