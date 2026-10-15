-- InnerMe durable execution-step controller.
-- This records explicit start/resume/checkpoint/complete/block transitions.
-- It never invokes a provider or performs a task/email side effect.

alter table public.innerme_execution_steps
  add column if not exists attempt_count integer not null default 0,
  add column if not exists started_at timestamptz,
  add column if not exists checkpoint jsonb not null default '{}'::jsonb,
  add column if not exists checkpointed_at timestamptz,
  add column if not exists completion_evidence jsonb not null default '{}'::jsonb,
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid references auth.users(id) on delete set null,
  add column if not exists blocked_reason text,
  add column if not exists last_error_code text;

-- Older action execution already moved a step to in_progress after its side
-- effect was observed. Preserve those in-flight records as resumable legacy runs.
update public.innerme_execution_steps
set started_at=coalesce(updated_at,created_at,now()),
    attempt_count=greatest(attempt_count,1)
where status='in_progress' and started_at is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.innerme_execution_steps'::regclass
      and conname='innerme_execution_steps_attempt_count_check'
  ) then
    alter table public.innerme_execution_steps
      add constraint innerme_execution_steps_attempt_count_check
      check (attempt_count >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.innerme_execution_steps'::regclass
      and conname='innerme_execution_steps_checkpoint_object_check'
  ) then
    alter table public.innerme_execution_steps
      add constraint innerme_execution_steps_checkpoint_object_check
      check (jsonb_typeof(checkpoint)='object');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.innerme_execution_steps'::regclass
      and conname='innerme_execution_steps_completion_evidence_object_check'
  ) then
    alter table public.innerme_execution_steps
      add constraint innerme_execution_steps_completion_evidence_object_check
      check (jsonb_typeof(completion_evidence)='object');
  end if;
end $$;

-- Protect step status transitions even though the existing admin RLS policy
-- permits administrators to edit rows. Only this controller may perform run
-- transitions; the existing plan-review path may still approve/cancel drafts.
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

revoke all on function public.review_innerme_execution_plan(uuid,text) from public, anon;
grant execute on function public.review_innerme_execution_plan(uuid,text) to authenticated;

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

create index if not exists innerme_execution_step_events_step_created_idx
  on public.innerme_execution_step_events(step_id,created_at desc);
create index if not exists innerme_execution_step_events_plan_created_idx
  on public.innerme_execution_step_events(plan_id,created_at desc);

alter table public.innerme_execution_step_events enable row level security;
drop policy if exists "InnerMe execution step events admins can read" on public.innerme_execution_step_events;
create policy "InnerMe execution step events admins can read"
  on public.innerme_execution_step_events for select to authenticated
  using ((select public.is_swayphics_admin()));

revoke all on table public.innerme_execution_step_events from public, anon, authenticated;
grant select on table public.innerme_execution_step_events to authenticated;
grant all on table public.innerme_execution_step_events to service_role;

-- Keep the privileged implementation outside the PostgREST-exposed public schema.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.transition_innerme_execution_step_internal(
  p_step_id uuid,
  p_transition text,
  p_note text default null,
  p_checkpoint jsonb default '{}'::jsonb,
  p_completion_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
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

  -- Transaction-local capability used by the trigger above. A later request
  -- cannot inherit it after this RPC transaction commits or rolls back.
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

revoke all on function private.transition_innerme_execution_step_internal(uuid,text,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function private.transition_innerme_execution_step_internal(uuid,text,text,jsonb,jsonb) to authenticated;

create or replace function public.transition_innerme_execution_step(
  p_step_id uuid,
  p_transition text,
  p_note text default null,
  p_checkpoint jsonb default '{}'::jsonb,
  p_completion_evidence jsonb default '{}'::jsonb
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog
as $function$
  select private.transition_innerme_execution_step_internal(
    p_step_id,p_transition,p_note,p_checkpoint,p_completion_evidence
  );
$function$;

revoke all on function public.transition_innerme_execution_step(uuid,text,text,jsonb,jsonb) from public, anon;
grant execute on function public.transition_innerme_execution_step(uuid,text,text,jsonb,jsonb) to authenticated;
