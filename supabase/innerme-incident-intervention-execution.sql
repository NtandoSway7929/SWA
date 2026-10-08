-- InnerMe Phase 24: controlled intervention execution and verification
-- Only the explicitly selected recommendation can be prepared.
-- Approval is separate from execution. The execution gateway only supports
-- create_task, validates the current condition fingerprint, logs the result,
-- and verifies that the expected workspace task was created.

create table if not exists public.innerme_incident_intervention_executions (
    id uuid primary key default gen_random_uuid(),
    selection_id uuid not null,
    option_id uuid not null,
    incident_id uuid not null references public.innerme_operational_incidents(id) on delete cascade,
    dependency_id uuid not null references public.innerme_incident_dependencies(id) on delete cascade,
    action_type text not null default 'create_task'
        check (action_type in ('create_task')),
    status text not null default 'proposed'
        check (status in ('proposed','approved','executing','succeeded','failed','cancelled')),
    approval_required boolean not null default true,
    approved_by uuid references auth.users(id) on delete restrict,
    approved_at timestamptz,
    executed_by uuid references auth.users(id) on delete restrict,
    execution_started_at timestamptz,
    execution_completed_at timestamptz,
    task_id uuid references public.tasks(id) on delete set null,
    verification_status text not null default 'pending'
        check (verification_status in ('pending','passed','failed')),
    verification_note text,
    request_payload jsonb not null default '{}'::jsonb,
    result_payload jsonb,
    error_message text,
    condition_fingerprint text not null,
    idempotency_key text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (selection_id)
);

create unique index if not exists idx_innerme_intervention_executions_idempotency
on public.innerme_incident_intervention_executions(idempotency_key)
where idempotency_key is not null;

create index if not exists idx_innerme_intervention_executions_incident
on public.innerme_incident_intervention_executions(incident_id,status,created_at desc);

create index if not exists idx_innerme_intervention_executions_verification
on public.innerme_incident_intervention_executions(verification_status,updated_at desc);

alter table public.innerme_incident_intervention_executions enable row level security;

drop policy if exists "InnerMe intervention executions admins can read"
on public.innerme_incident_intervention_executions;
create policy "InnerMe intervention executions admins can read"
on public.innerme_incident_intervention_executions
for select to authenticated
using ((select public.is_swayphics_admin()));

revoke all on table public.innerme_incident_intervention_executions from anon;
grant select on table public.innerme_incident_intervention_executions to authenticated;
grant all on table public.innerme_incident_intervention_executions to service_role;

create or replace function public.prepare_innerme_intervention_execution(p_selection_id uuid)
returns public.innerme_incident_intervention_executions
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_selection public.innerme_incident_intervention_selection;
    v_option public.innerme_incident_intervention_options;
    v_execution public.innerme_incident_intervention_executions;
begin
    if not public.is_swayphics_admin() then
        raise exception 'Only active Swayphics admins can prepare an intervention execution.';
    end if;

    select * into v_selection
    from public.innerme_incident_intervention_selection
    where id=p_selection_id;

    if not found then
        raise exception 'The intervention selection could not be found.';
    end if;

    if v_selection.selection_status <> 'selected' or v_selection.selected_option_id is null then
        raise exception 'Only a selected intervention can enter execution.';
    end if;

    select * into v_option
    from public.innerme_incident_intervention_options
    where id=v_selection.selected_option_id
      and incident_id=v_selection.incident_id;

    if not found then
        raise exception 'The selected intervention option could not be found.';
    end if;

    if v_option.recommendation_status <> 'recommended' then
        raise exception 'Only the recommended intervention can enter execution.';
    end if;

    if v_option.conflict_status = 'blocked' then
        raise exception 'The selected intervention is blocked by its evidence gates.';
    end if;

    select * into v_execution
    from public.innerme_incident_intervention_executions
    where selection_id=p_selection_id
    for update;

    if found and v_execution.status in ('approved','executing','succeeded') then
        return v_execution;
    end if;

    insert into public.innerme_incident_intervention_executions(
        selection_id,option_id,incident_id,dependency_id,action_type,status,
        approval_required,request_payload,condition_fingerprint,idempotency_key
    ) values (
        v_selection.id,v_option.id,v_selection.incident_id,v_option.dependency_id,
        'create_task','proposed',true,
        jsonb_build_object(
            'action','create_task',
            'action_statement',v_option.action_statement,
            'selection_rationale',v_selection.selection_rationale,
            'decision_gate',v_selection.decision_gate
        ),
        v_selection.condition_fingerprint,
        'incident-intervention:'||v_selection.id::text
    )
    on conflict(selection_id) do update set
        option_id=excluded.option_id,
        incident_id=excluded.incident_id,
        dependency_id=excluded.dependency_id,
        request_payload=excluded.request_payload,
        condition_fingerprint=excluded.condition_fingerprint,
        idempotency_key=excluded.idempotency_key,
        updated_at=now()
    returning * into v_execution;

    return v_execution;
end;
$$;

revoke all on function public.prepare_innerme_intervention_execution(uuid) from public;
revoke all on function public.prepare_innerme_intervention_execution(uuid) from anon;
grant execute on function public.prepare_innerme_intervention_execution(uuid) to authenticated;

create or replace function public.review_innerme_intervention_execution(
    p_execution_id uuid,
    p_decision text
)
returns public.innerme_incident_intervention_executions
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_execution public.innerme_incident_intervention_executions;
    v_decision text := lower(trim(coalesce(p_decision,'')));
    v_selection public.innerme_incident_intervention_selection;
    v_option public.innerme_incident_intervention_options;
begin
    if not public.is_swayphics_admin() then
        raise exception 'Only active Swayphics admins can review intervention executions.';
    end if;

    if v_decision not in ('approved','cancelled') then
        raise exception 'Execution review must be approved or cancelled.';
    end if;

    select * into v_execution
    from public.innerme_incident_intervention_executions
    where id=p_execution_id
    for update;

    if not found then
        raise exception 'The intervention execution could not be found.';
    end if;

    if v_execution.status <> 'proposed' then
        raise exception 'Only proposed intervention executions can be reviewed.';
    end if;

    select * into v_selection
    from public.innerme_incident_intervention_selection
    where id=v_execution.selection_id;

    select * into v_option
    from public.innerme_incident_intervention_options
    where id=v_execution.option_id;

    if not found or v_selection.selection_status <> 'selected' or v_selection.selected_option_id <> v_option.id then
        raise exception 'The intervention selection is no longer valid.';
    end if;

    if v_selection.condition_fingerprint <> v_execution.condition_fingerprint
       or v_option.condition_fingerprint <> v_execution.condition_fingerprint then
        raise exception 'The intervention conditions have changed. Re-run incident analysis before approval.';
    end if;

    update public.innerme_incident_intervention_executions
    set status=v_decision,
        approved_by=case when v_decision='approved' then auth.uid() else null end,
        approved_at=case when v_decision='approved' then now() else null end,
        updated_at=now()
    where id=v_execution.id
    returning * into v_execution;

    return v_execution;
end;
$$;

revoke all on function public.review_innerme_intervention_execution(uuid,text) from public;
revoke all on function public.review_innerme_intervention_execution(uuid,text) from anon;
grant execute on function public.review_innerme_intervention_execution(uuid,text) to authenticated;

create or replace function public.cancel_innerme_intervention_execution(p_execution_id uuid)
returns public.innerme_incident_intervention_executions
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_execution public.innerme_incident_intervention_executions;
begin
    if not public.is_swayphics_admin() then
        raise exception 'Only active Swayphics admins can cancel intervention executions.';
    end if;

    update public.innerme_incident_intervention_executions
    set status='cancelled',updated_at=now()
    where id=p_execution_id and status in ('proposed','approved')
    returning * into v_execution;

    if not found then
        raise exception 'Only proposed or approved intervention executions can be cancelled.';
    end if;

    return v_execution;
end;
$$;

revoke all on function public.cancel_innerme_intervention_execution(uuid) from public;
revoke all on function public.cancel_innerme_intervention_execution(uuid) from anon;
grant execute on function public.cancel_innerme_intervention_execution(uuid) to authenticated;

notify pgrst, 'reload schema';
