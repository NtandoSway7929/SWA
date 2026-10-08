-- InnerMe Phase 21: causal validation and hypothesis testing
-- Deterministic, evidence-backed hypothesis scoring for active operational incidents.
-- This does not establish causation. It tests whether a dependency is temporally
-- consistent with the incident, remains unresolved, and recurs in incident history.

create table if not exists public.innerme_incident_hypothesis_tests (
    id uuid primary key default gen_random_uuid(),
    incident_id uuid not null references public.innerme_operational_incidents(id) on delete cascade,
    dependency_id uuid not null references public.innerme_incident_dependencies(id) on delete cascade,
    support_score integer not null default 0 check (support_score between 0 and 100),
    contradiction_score integer not null default 0 check (contradiction_score between 0 and 100),
    temporal_score integer not null default 0 check (temporal_score between 0 and 100),
    persistence_score integer not null default 0 check (persistence_score between 0 and 100),
    recurrence_score integer not null default 0 check (recurrence_score between 0 and 100),
    validation_status text not null default 'inconclusive'
        check (validation_status in ('supported','weakened','inconclusive')),
    hypothesis text not null,
    evidence jsonb not null default '{}'::jsonb,
    alternative_explanations jsonb not null default '[]'::jsonb,
    next_test text not null,
    condition_fingerprint text not null,
    method text not null default 'deterministic_hypothesis_v1',
    generated_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (incident_id, dependency_id)
);

create index if not exists idx_innerme_incident_hypothesis_tests_incident
on public.innerme_incident_hypothesis_tests(incident_id, support_score desc, contradiction_score asc);

create index if not exists idx_innerme_incident_hypothesis_tests_status
on public.innerme_incident_hypothesis_tests(validation_status, updated_at desc);

alter table public.innerme_incident_hypothesis_tests enable row level security;

drop policy if exists "InnerMe incident hypothesis tests admins can manage"
on public.innerme_incident_hypothesis_tests;
create policy "InnerMe incident hypothesis tests admins can manage"
on public.innerme_incident_hypothesis_tests
for all to authenticated
using ((select public.is_swayphics_admin()))
with check ((select public.is_swayphics_admin()));

revoke all on table public.innerme_incident_hypothesis_tests from anon;
grant select, insert, update, delete on table public.innerme_incident_hypothesis_tests to authenticated;

create or replace function public.refresh_innerme_incident_hypothesis_tests()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_count integer := 0;
    v_created_at timestamptz;
    v_updated_at timestamptz;
    v_resolved_at timestamptz;
    v_current_unresolved boolean;
    v_status text;
    v_created_before boolean;
    v_resolved_before boolean;
    v_recurrence integer;
    v_temporal integer;
    v_persistence integer;
    v_recurrence_score integer;
    v_contradiction integer;
    v_support integer;
    v_validation text;
    v_evidence jsonb;
    v_alternatives jsonb;
    v_next text;
    d public.innerme_incident_dependencies%rowtype;
    r public.innerme_operational_incidents%rowtype;
begin
    if current_user <> 'postgres' and not public.is_swayphics_admin() then
        raise exception 'Swayphics admin access required.';
    end if;

    for r in
        select *
        from public.innerme_operational_incidents
        where status in ('open','acknowledged')
    loop
        delete from public.innerme_incident_hypothesis_tests where incident_id=r.id;

        for d in
            select *
            from public.innerme_incident_dependencies
            where incident_id=r.id
            order by dependency_rank
            limit 5
        loop
            v_created_at := null;
            v_updated_at := null;
            v_resolved_at := null;
            v_current_unresolved := d.is_unresolved;
            v_status := null;

            case d.source_table
                when 'leads' then
                    select created_at,updated_at,status
                    into v_created_at,v_updated_at,v_status
                    from public.leads where id=d.source_id;
                when 'tasks' then
                    select created_at,updated_at,status,completed_at
                    into v_created_at,v_updated_at,v_status,v_resolved_at
                    from public.tasks where id=d.source_id;
                when 'invoices' then
                    select created_at,updated_at,status,
                           case when status in ('paid','cancelled','void') then updated_at end
                    into v_created_at,v_updated_at,v_status,v_resolved_at
                    from public.invoices where id=d.source_id;
                when 'clients' then
                    select created_at,updated_at,status,
                           case when status in ('inactive','lost') then updated_at end
                    into v_created_at,v_updated_at,v_status,v_resolved_at
                    from public.clients where id=d.source_id;
                when 'client_projects' then
                    select created_at,updated_at,status,completed_at
                    into v_created_at,v_updated_at,v_status,v_resolved_at
                    from public.client_projects where id=d.source_id;
                when 'innerme_action_proposals' then
                    select created_at,updated_at,status,
                           case when status in ('executed','completed','cancelled','rejected') then coalesce(executed_at,updated_at) end
                    into v_created_at,v_updated_at,v_status,v_resolved_at
                    from public.innerme_action_proposals where id=d.source_id;
                when 'innerme_action_execution_logs' then
                    select started_at,coalesce(completed_at,started_at),status,
                           case when completed_at is not null or status in ('completed','failed','cancelled') then coalesce(completed_at,started_at) end
                    into v_created_at,v_updated_at,v_status,v_resolved_at
                    from public.innerme_action_execution_logs where id=d.source_id;
                when 'follow_ups' then
                    select created_at,created_at,status,completed_at
                    into v_created_at,v_updated_at,v_status,v_resolved_at
                    from public.follow_ups where id=d.source_id;
                when 'innerme_knowledge' then
                    select created_at,updated_at,verification_status,
                           case when verification_status in ('verified','rejected') then coalesce(last_verified_at,updated_at) end
                    into v_created_at,v_updated_at,v_status,v_resolved_at
                    from public.innerme_knowledge where id=d.source_id;
                when 'innerme_strategic_recommendations' then
                    select created_at,updated_at,status,
                           case when status in ('approved','rejected','promoted') then updated_at end
                    into v_created_at,v_updated_at,v_status,v_resolved_at
                    from public.innerme_strategic_recommendations where id=d.source_id;
                else
                    null;
            end case;

            v_created_before := v_created_at is not null and v_created_at <= r.first_detected_at;
            v_resolved_before := v_resolved_at is not null and v_resolved_at < r.first_detected_at;

            v_temporal := case
                when v_created_before then 25
                when v_created_at is null then 8
                else 0
            end;

            v_persistence := case
                when v_current_unresolved then 20
                when v_updated_at is not null and v_updated_at >= r.first_detected_at then 8
                else 0
            end;

            select count(*)
            into v_recurrence
            from public.innerme_incident_dependencies historical
            where historical.source_table=d.source_table
              and historical.source_id=d.source_id
              and historical.incident_id<>r.id;

            v_recurrence_score := case
                when v_recurrence >= 3 then 20
                when v_recurrence = 2 then 15
                when v_recurrence = 1 then 10
                else 0
            end;

            v_contradiction := 0;
            if v_resolved_before then v_contradiction := v_contradiction + 35; end if;
            if not v_current_unresolved and v_resolved_at is null then v_contradiction := v_contradiction + 15; end if;
            if v_created_at is not null and v_created_at > r.last_detected_at then v_contradiction := v_contradiction + 25; end if;
            v_contradiction := least(100,v_contradiction);

            v_support := greatest(
                0,
                least(100,35 + v_temporal + v_persistence + v_recurrence_score - v_contradiction)
            );

            v_validation := case
                when v_support >= 70 and v_contradiction < 30 then 'supported'
                when v_support < 45 or v_contradiction >= 50 then 'weakened'
                else 'inconclusive'
            end;

            if v_validation='supported' then
                v_next := 'Validate the linked record manually and confirm the same dependency remains unresolved before taking action.';
            elsif v_validation='weakened' then
                v_next := 'Re-check the incident snapshot and identify another dependency before treating this record as the likely blocker.';
            else
                v_next := 'Collect one more independent observation or a state transition before treating this dependency as supported.';
            end if;

            v_evidence := jsonb_build_object(
                'source_table',d.source_table,
                'source_id',d.source_id,
                'dependency_type',d.dependency_type,
                'dependency_label',d.label,
                'incident_first_detected_at',r.first_detected_at,
                'incident_last_detected_at',r.last_detected_at,
                'source_created_at',v_created_at,
                'source_updated_at',v_updated_at,
                'source_resolved_at',v_resolved_at,
                'source_status',v_status,
                'currently_unresolved',v_current_unresolved,
                'historical_recurrence_count',v_recurrence,
                'scores',jsonb_build_object(
                    'temporal',v_temporal,
                    'persistence',v_persistence,
                    'recurrence',v_recurrence_score,
                    'contradiction',v_contradiction
                )
            );

            v_alternatives := case d.dependency_type
                when 'lead_delivery_dependency' then '["The task can be downstream from an unrelated sales issue.","The lead itself may be blocked by unrecorded information."]'::jsonb
                when 'invoice_client_dependency' then '["The payment delay may be external to delivery.","The client relationship status may not explain the invoice delay."]'::jsonb
                when 'execution_chain_dependency' then '["The execution failure may originate in the proposal or earlier plan state.","The logged failure may be transient rather than the persistent blocker."]'::jsonb
                when 'failed_proposal_dependency' then '["The proposal may be valid while execution infrastructure is the actual blocker.","The error may not represent a recurring failure."]'::jsonb
                else '["The dependency may be downstream from another unrecorded factor.","The available workspace data may not contain the true blocker."]'::jsonb
            end;

            insert into public.innerme_incident_hypothesis_tests(
                incident_id,dependency_id,support_score,contradiction_score,temporal_score,
                persistence_score,recurrence_score,validation_status,hypothesis,evidence,
                alternative_explanations,next_test,condition_fingerprint
            ) values (
                r.id,d.id,v_support,v_contradiction,v_temporal,v_persistence,v_recurrence_score,
                v_validation,
                d.label || ' contributes materially to the current incident condition.',
                v_evidence,v_alternatives,v_next,r.condition_fingerprint
            )
            on conflict (incident_id,dependency_id) do update set
                support_score=excluded.support_score,
                contradiction_score=excluded.contradiction_score,
                temporal_score=excluded.temporal_score,
                persistence_score=excluded.persistence_score,
                recurrence_score=excluded.recurrence_score,
                validation_status=excluded.validation_status,
                hypothesis=excluded.hypothesis,
                evidence=excluded.evidence,
                alternative_explanations=excluded.alternative_explanations,
                next_test=excluded.next_test,
                condition_fingerprint=excluded.condition_fingerprint,
                updated_at=now();

            v_count:=v_count+1;
        end loop;
    end loop;

    return v_count;
end;
$$;

revoke all on function public.refresh_innerme_incident_hypothesis_tests() from public;
revoke all on function public.refresh_innerme_incident_hypothesis_tests() from anon;
grant execute on function public.refresh_innerme_incident_hypothesis_tests() to authenticated;

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

    v_count := v_count + coalesce(public.generate_innerme_operational_incidents(), 0);
    v_count := v_count + coalesce(public.refresh_innerme_incident_intelligence(), 0);
    v_count := v_count + coalesce(public.refresh_innerme_incident_root_analysis(), 0);
    v_count := v_count + coalesce(public.refresh_innerme_incident_hypothesis_tests(), 0);

    return v_count;
end;
$$;

revoke all on function public.run_innerme_incident_intelligence() from public;
revoke all on function public.run_innerme_incident_intelligence() from anon;
grant execute on function public.run_innerme_incident_intelligence() to authenticated;

notify pgrst, 'reload schema';