-- InnerMe Phase 25: outcome verification and intervention learning
-- Execution success is not treated as business success. A verified execution
-- creates a pending outcome checkpoint. After 24 hours, or earlier if the
-- linked incident is resolved/ignored, the system measures the observed
-- incident priority and records temporal attribution evidence.
-- Positive outcomes may be promoted by an administrator into a learning
-- candidate. Learning candidates remain subject to verification and regression.

create table if not exists public.innerme_intervention_outcomes (
    id uuid primary key default gen_random_uuid(),
    execution_id uuid not null unique references public.innerme_incident_intervention_executions(id) on delete cascade,
    incident_id uuid not null references public.innerme_operational_incidents(id) on delete cascade,
    dependency_id uuid not null references public.innerme_incident_dependencies(id) on delete cascade,
    action_type text not null,
    outcome_measurement_status text not null default 'pending'
        check (outcome_measurement_status in ('pending','measured')),
    outcome_status text not null default 'pending'
        check (outcome_status in ('pending','improved','unchanged','worsened','inconclusive')),
    attribution text not null default 'unproven'
        check (attribution in ('unproven','temporally_consistent','mixed','not_applicable')),
    confidence text not null default 'low'
        check (confidence in ('high','medium','low')),
    baseline_priority integer check (baseline_priority between 0 and 100),
    expected_priority integer check (expected_priority between 0 and 100),
    observed_priority integer check (observed_priority between 0 and 100),
    priority_delta integer check (priority_delta between -100 and 100),
    expected_signal text not null,
    observed_signal text not null,
    incident_status_at_measurement text,
    task_status_at_measurement text,
    competing_interventions_count integer not null default 0,
    condition_changed boolean not null default false,
    measurement_due_at timestamptz not null,
    measured_at timestamptz,
    evidence jsonb not null default '{}'::jsonb,
    learning_candidate_id uuid references public.innerme_learning_candidates(id) on delete set null,
    condition_fingerprint text not null,
    method text not null default 'deterministic_intervention_outcome_v1',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_innerme_intervention_outcomes_incident
on public.innerme_intervention_outcomes(incident_id,outcome_status,updated_at desc);

create index if not exists idx_innerme_intervention_outcomes_measurement
on public.innerme_intervention_outcomes(outcome_measurement_status,measurement_due_at);

create index if not exists idx_innerme_intervention_outcomes_attribution
on public.innerme_intervention_outcomes(attribution,outcome_status,updated_at desc);

create index if not exists idx_innerme_intervention_outcomes_dependency
on public.innerme_intervention_outcomes(dependency_id);

create index if not exists idx_innerme_intervention_outcomes_learning_candidate
on public.innerme_intervention_outcomes(learning_candidate_id);

alter table public.innerme_intervention_outcomes enable row level security;

drop policy if exists "InnerMe intervention outcomes admins can read"
on public.innerme_intervention_outcomes;

drop policy if exists "InnerMe intervention outcomes admins can manage"
on public.innerme_intervention_outcomes;
create policy "InnerMe intervention outcomes admins can manage"
on public.innerme_intervention_outcomes
for all to authenticated
using ((select public.is_swayphics_admin()))
with check ((select public.is_swayphics_admin()));

revoke all on table public.innerme_intervention_outcomes from anon;
grant select,insert,update on table public.innerme_intervention_outcomes to authenticated;
grant all on table public.innerme_intervention_outcomes to service_role;

create or replace function public.refresh_innerme_intervention_outcomes()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_count integer := 0;
    v_now timestamptz := now();
    v_baseline integer;
    v_expected integer;
    v_observed integer;
    v_delta integer;
    v_competing integer;
    v_outcome_status text;
    v_attribution text;
    v_confidence text;
    v_incident_status text;
    v_incident_fingerprint text;
    v_task_status text;
    v_signal text;
    v_expected_signal text;
    v_condition_changed boolean;
    v_measure_now boolean;
    v_outcome_exists boolean;
    v_evidence jsonb;
    v_outcome public.innerme_intervention_outcomes%rowtype;
    e public.innerme_incident_intervention_executions%rowtype;
    c public.innerme_incident_counterfactuals%rowtype;
    r public.innerme_operational_incidents%rowtype;
    t public.tasks%rowtype;
begin
    if current_user <> 'postgres' and not public.is_swayphics_admin() then
        raise exception 'Swayphics admin access required.';
    end if;

    for e in
        select *
        from public.innerme_incident_intervention_executions
        where status='succeeded'
        order by execution_completed_at desc nulls last
    loop
        select exists(
            select 1 from public.innerme_intervention_outcomes where execution_id=e.id
        ) into v_outcome_exists;

        if v_outcome_exists then
            select * into v_outcome
            from public.innerme_intervention_outcomes
            where execution_id=e.id limit 1;
        else
            v_outcome := null;
        end if;

        select * into c
        from public.innerme_incident_counterfactuals
        where incident_id=e.incident_id and dependency_id=e.dependency_id
        order by updated_at desc limit 1;

        v_baseline := case when c.id is not null then c.current_priority else null end;
        v_expected := case when c.id is not null then c.counterfactual_priority else null end;
        v_expected_signal := coalesce(
            nullif(c.expected_signal,''),
            'Observe whether the incident state or measured priority improves after the approved action.'
        );

        if not v_outcome_exists then
            insert into public.innerme_intervention_outcomes(
                execution_id,incident_id,dependency_id,action_type,
                baseline_priority,expected_priority,expected_signal,observed_signal,
                measurement_due_at,condition_fingerprint,evidence
            ) values (
                e.id,e.incident_id,e.dependency_id,e.action_type,
                v_baseline,v_expected,v_expected_signal,
                'Outcome measurement pending. The execution was verified, but business effect has not yet been measured.',
                coalesce(e.execution_completed_at,v_now)+interval '24 hours',
                e.condition_fingerprint,
                jsonb_build_object(
                    'method','deterministic_intervention_outcome_v1',
                    'execution_id',e.id,
                    'execution_verified_at',e.execution_completed_at,
                    'baseline_priority',v_baseline,
                    'expected_priority',v_expected,
                    'expected_signal',v_expected_signal,
                    'measurement_rule','Measure after 24 hours or earlier when the linked incident is resolved or ignored.'
                )
            )
            returning * into v_outcome;
            v_count:=v_count+1;
        end if;

        if v_outcome.outcome_measurement_status='measured' then
            continue;
        end if;

        select status,condition_fingerprint,title,last_detected_at
        into v_incident_status,v_incident_fingerprint,r.title,r.last_detected_at
        from public.innerme_operational_incidents
        where id=e.incident_id;

        v_condition_changed := coalesce(v_incident_fingerprint,'')
            <> coalesce(e.condition_fingerprint,'');

        v_measure_now :=
            v_now >= v_outcome.measurement_due_at
            or v_incident_status in ('resolved','ignored');

        if not v_measure_now then
            continue;
        end if;

        if e.task_id is not null then
            select * into t from public.tasks where id=e.task_id;
            v_task_status := case
                when t.id is not null then t.status
                else 'missing'
            end;
        else
            v_task_status := 'not_applicable';
        end if;

        select priority_score into v_observed
        from public.innerme_incident_intelligence
        where incident_id=e.incident_id
        order by updated_at desc limit 1;

        if v_incident_status in ('resolved','ignored') then
            v_observed := 0;
            v_signal := 'The incident is no longer active at measurement time.';
        elsif v_observed is not null then
            v_signal := 'Incident priority measured at ' || v_observed::text || '/100 at the outcome checkpoint.';
        else
            v_signal := 'No current incident priority assessment is available at the outcome checkpoint.';
        end if;

        v_delta := case
            when v_baseline is not null and v_observed is not null then v_observed-v_baseline
            else null
        end;

        v_outcome_status := case
            when v_baseline is null or v_observed is null then 'inconclusive'
            when v_observed <= v_baseline-10 then 'improved'
            when v_observed >= v_baseline+10 then 'worsened'
            else 'unchanged'
        end;

        select count(*) into v_competing
        from public.innerme_incident_intervention_executions other_e
        where other_e.incident_id=e.incident_id
          and other_e.id<>e.id
          and other_e.status='succeeded'
          and other_e.execution_completed_at is not null
          and e.execution_completed_at is not null
          and other_e.execution_completed_at > e.execution_completed_at
          and other_e.execution_completed_at <= v_now;

        v_attribution := case
            when v_outcome_status in ('improved','worsened') and v_competing=0 then 'temporally_consistent'
            when v_outcome_status in ('improved','worsened') and v_competing>0 then 'mixed'
            when v_outcome_status='unchanged' then 'unproven'
            else 'not_applicable'
        end;

        v_confidence := case
            when v_outcome_status in ('improved','worsened')
                 and v_competing=0
                 and abs(v_delta)>=20
                 and not v_condition_changed then 'high'
            when v_outcome_status in ('improved','worsened')
                 and v_competing=0
                 and abs(v_delta)>=10 then 'medium'
            else 'low'
        end;

        v_evidence := jsonb_build_object(
            'method','deterministic_intervention_outcome_v1',
            'execution_id',e.id,
            'incident_id',e.incident_id,
            'dependency_id',e.dependency_id,
            'baseline_priority',v_baseline,
            'expected_priority',v_expected,
            'observed_priority',v_observed,
            'priority_delta',v_delta,
            'expected_signal',v_expected_signal,
            'observed_signal',v_signal,
            'incident_status',v_incident_status,
            'task_status',v_task_status,
            'competing_interventions_count',v_competing,
            'condition_changed',v_condition_changed,
            'measurement_due_at',v_outcome.measurement_due_at,
            'measured_at',v_now,
            'attribution_basis',case
                when v_competing=0 then 'No later successful intervention execution for this incident was observed before measurement.'
                else 'Later successful intervention executions for this incident were observed before measurement.'
            end
        );

        update public.innerme_intervention_outcomes
        set outcome_measurement_status='measured',
            outcome_status=v_outcome_status,
            attribution=v_attribution,
            confidence=v_confidence,
            observed_priority=v_observed,
            priority_delta=v_delta,
            observed_signal=v_signal,
            incident_status_at_measurement=v_incident_status,
            task_status_at_measurement=v_task_status,
            competing_interventions_count=v_competing,
            condition_changed=v_condition_changed,
            measured_at=v_now,
            evidence=v_evidence,
            updated_at=v_now
        where id=v_outcome.id;

        v_count:=v_count+1;
    end loop;

    return v_count;
end;
$$;

revoke all on function public.refresh_innerme_intervention_outcomes() from public;
revoke all on function public.refresh_innerme_intervention_outcomes() from anon;
grant execute on function public.refresh_innerme_intervention_outcomes() to authenticated;

create or replace function public.propose_innerme_intervention_learning_candidate(p_outcome_id uuid)
returns public.innerme_learning_candidates
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_outcome public.innerme_intervention_outcomes;
    v_dependency public.innerme_incident_dependencies;
    v_incident public.innerme_operational_incidents;
    v_candidate public.innerme_learning_candidates;
begin
    if not public.is_swayphics_admin() then
        raise exception 'Only active Swayphics admins can create learning candidates.';
    end if;

    select * into v_outcome
    from public.innerme_intervention_outcomes
    where id=p_outcome_id
    for update;

    if not found then
        raise exception 'The intervention outcome could not be found.';
    end if;

    if v_outcome.outcome_status <> 'improved' then
        raise exception 'Only an improved intervention outcome can become a learning candidate.';
    end if;

    if v_outcome.learning_candidate_id is not null then
        select * into v_candidate
        from public.innerme_learning_candidates
        where id=v_outcome.learning_candidate_id;
        if found then return v_candidate; end if;
    end if;

    select * into v_dependency from public.innerme_incident_dependencies where id=v_outcome.dependency_id;
    select * into v_incident from public.innerme_operational_incidents where id=v_outcome.incident_id;

    insert into public.innerme_learning_candidates(
        created_by,candidate_type,title,domain,knowledge_type,statement,application,
        constraints,do_not_use_when,rationale,confidence,status,candidate_key,
        source_type,source_id,source_label,source_evidence,requires_verification,requires_regression
    ) values (
        auth.uid(),
        'create_new',
        'Observed intervention outcome: ' || coalesce(v_incident.title,'Operational incident'),
        'operations',
        'observed_outcome',
        'A controlled InnerMe intervention was followed by a measured ' ||
            v_outcome.priority_delta::text || ' point change in incident priority, with the incident moving from ' ||
            v_outcome.baseline_priority::text || '/100 to ' || v_outcome.observed_priority::text || '/100.',
        'Treat this as a candidate operational pattern only after independent verification and regression review.',
        'This observation is temporal evidence, not proof of causation. Results may depend on the specific incident, dependency and workspace state.',
        'When attribution is mixed, evidence is incomplete, or the same pattern has not survived regression testing.',
        'Generated from a measured Phase 25 intervention outcome for dependency "' ||
            coalesce(v_dependency.label,'unknown') || '".',
        case
            when v_outcome.attribution='temporally_consistent' and v_outcome.confidence='high' then 'medium'
            else 'low'
        end,
        'candidate',
        'intervention-outcome:' || v_outcome.id::text,
        'outcome',
        v_outcome.id,
        'Phase 25 intervention outcome',
        jsonb_build_array(v_outcome.evidence),
        true,
        true
    )
    returning * into v_candidate;

    update public.innerme_intervention_outcomes
    set learning_candidate_id=v_candidate.id,updated_at=now()
    where id=v_outcome.id;

    insert into public.innerme_learning_loop_events(
        event_key,event_type,candidate_id,source_type,source_id,metadata,created_by
    ) values (
        'intervention-outcome-candidate:'||v_outcome.id::text,
        'candidate_created',
        v_candidate.id,
        'outcome',
        v_outcome.id,
        jsonb_build_object(
            'outcome_status',v_outcome.outcome_status,
            'attribution',v_outcome.attribution,
            'confidence',v_outcome.confidence,
            'priority_delta',v_outcome.priority_delta,
            'requires_verification',true,
            'requires_regression',true
        ),
        auth.uid()
    )
    on conflict(event_key) do nothing;

    return v_candidate;
end;
$$;

revoke all on function public.propose_innerme_intervention_learning_candidate(uuid) from public;
revoke all on function public.propose_innerme_intervention_learning_candidate(uuid) from anon;
grant execute on function public.propose_innerme_intervention_learning_candidate(uuid) to authenticated;

create or replace function public.run_innerme_incident_intelligence()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_count integer := 0;
begin
    if current_user <> 'postgres' and not public.is_swayphics_admin() then
        raise exception 'Swayphics admin access required.';
    end if;

    v_count := v_count + coalesce(public.generate_innerme_operational_incidents(),0);
    v_count := v_count + coalesce(public.refresh_innerme_incident_intelligence(),0);
    v_count := v_count + coalesce(public.refresh_innerme_incident_root_analysis(),0);
    v_count := v_count + coalesce(public.refresh_innerme_incident_hypothesis_tests(),0);
    v_count := v_count + coalesce(public.refresh_innerme_incident_counterfactuals(),0);
    v_count := v_count + coalesce(public.refresh_innerme_incident_intervention_selection(),0);
    v_count := v_count + coalesce(public.refresh_innerme_intervention_outcomes(),0);

    return v_count;
end;
$$;

revoke all on function public.run_innerme_incident_intelligence() from public;
revoke all on function public.run_innerme_incident_intelligence() from anon;
grant execute on function public.run_innerme_incident_intelligence() to authenticated;

notify pgrst, 'reload schema';