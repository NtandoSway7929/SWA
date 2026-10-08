-- InnerMe Phase 22: counterfactual and intervention analysis
-- Advisory only. Simulates the effect of clearing one dependency while other
-- stored incident conditions remain unchanged. It never executes the intervention.

create table if not exists public.innerme_incident_counterfactuals (
    id uuid primary key default gen_random_uuid(),
    incident_id uuid not null references public.innerme_operational_incidents(id) on delete cascade,
    dependency_id uuid not null references public.innerme_incident_dependencies(id) on delete cascade,
    hypothesis_test_id uuid references public.innerme_incident_hypothesis_tests(id) on delete set null,
    current_priority integer not null default 0 check (current_priority between 0 and 100),
    counterfactual_priority integer not null default 0 check (counterfactual_priority between 0 and 100),
    estimated_priority_delta integer not null default 0 check (estimated_priority_delta between -100 and 100),
    residual_risk_band text not null check (residual_risk_band in ('critical','high','medium','low')),
    intervention_class text not null,
    proposed_intervention text not null,
    expected_effect text not null,
    expected_signal text not null,
    reversibility text not null,
    intervention_risk text not null,
    decision_gate text not null,
    confidence text not null check (confidence in ('high','medium','low')),
    assumptions jsonb not null default '[]'::jsonb,
    evidence jsonb not null default '{}'::jsonb,
    condition_fingerprint text not null,
    method text not null default 'deterministic_counterfactual_v1',
    generated_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (incident_id, dependency_id)
);

create index if not exists idx_innerme_incident_counterfactuals_incident
on public.innerme_incident_counterfactuals(incident_id, estimated_priority_delta asc, counterfactual_priority asc);

create index if not exists idx_innerme_incident_counterfactuals_risk
on public.innerme_incident_counterfactuals(residual_risk_band, updated_at desc);

alter table public.innerme_incident_counterfactuals enable row level security;

drop policy if exists "InnerMe incident counterfactuals admins can manage"
on public.innerme_incident_counterfactuals;
create policy "InnerMe incident counterfactuals admins can manage"
on public.innerme_incident_counterfactuals
for all to authenticated
using ((select public.is_swayphics_admin()))
with check ((select public.is_swayphics_admin()));

revoke all on table public.innerme_incident_counterfactuals from anon;
grant select, insert, update, delete on table public.innerme_incident_counterfactuals to authenticated;

create or replace function public.refresh_innerme_incident_counterfactuals()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_count integer := 0;
    v_current_priority integer;
    v_counter_priority integer;
    v_delta integer;
    v_current_impact integer;
    v_current_urgency integer;
    v_current_dependency integer;
    v_cf_impact integer;
    v_cf_urgency integer;
    v_cf_dependency integer;
    v_source_count integer;
    v_cf_source_count integer;
    v_category_count integer;
    v_cf_category_count integer;
    v_days_overdue integer;
    v_cf_days_overdue integer;
    v_age_hours integer;
    v_amount numeric;
    v_cf_amount numeric;
    v_band text;
    v_class text;
    v_intervention text;
    v_effect text;
    v_signal text;
    v_reversibility text;
    v_risk text;
    v_gate text;
    v_confidence text;
    v_direct boolean;
    v_source_category text;
    v_source_amount numeric := 0;
    v_source_due_date date;
    v_assumption text;
    v_evidence jsonb;
    d public.innerme_incident_dependencies%rowtype;
    h public.innerme_incident_hypothesis_tests%rowtype;
    i public.innerme_incident_intelligence%rowtype;
    r public.innerme_operational_incidents%rowtype;
begin
    if current_user <> 'postgres' and not public.is_swayphics_admin() then
        raise exception 'Swayphics admin access required.';
    end if;

    for r in
        select * from public.innerme_operational_incidents
        where status in ('open','acknowledged')
    loop
        delete from public.innerme_incident_counterfactuals where incident_id=r.id;

        select * into i
        from public.innerme_incident_intelligence
        where incident_id=r.id
        limit 1;

        if i.id is null then
            continue;
        end if;

        v_current_priority := i.priority_score;
        v_current_impact := i.impact_score;
        v_current_urgency := i.urgency_score;
        v_current_dependency := i.dependency_score;
        v_source_count := greatest(r.source_count,0);

        select greatest(0,floor(extract(epoch from (now()-r.first_detected_at))/3600))::integer
        into v_age_hours;

        select coalesce(sum(
            case
                when (x->>'amount_outstanding') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                then (x->>'amount_outstanding')::numeric
                else 0
            end
        ),0)
        into v_amount
        from jsonb_array_elements(
            case when jsonb_typeof(r.source_snapshot)='array' then r.source_snapshot else '[]'::jsonb end
        ) x;

        select coalesce(max(
            case
                when (x->>'due_date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                then greatest(0,current_date-((x->>'due_date')::date))
                else 0
            end
        ),0)
        into v_days_overdue
        from jsonb_array_elements(
            case when jsonb_typeof(r.source_snapshot)='array' then r.source_snapshot else '[]'::jsonb end
        ) x;

        for d in
            select * from public.innerme_incident_dependencies
            where incident_id=r.id
            order by dependency_rank
            limit 5
        loop
            select * into h
            from public.innerme_incident_hypothesis_tests
            where incident_id=r.id and dependency_id=d.id
            limit 1;

            v_direct := d.relationship='direct exception source';
            v_source_category := nullif(d.evidence->>'category','');
            v_source_amount := 0;

            if (d.evidence->'snapshot'->>'amount_outstanding') ~ '^-?[0-9]+(\\.[0-9]+)?$' then
                v_source_amount := (d.evidence->'snapshot'->>'amount_outstanding')::numeric;
            end if;

            v_source_due_date := null;
            if (d.evidence->'snapshot'->>'due_date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then
                v_source_due_date := (d.evidence->'snapshot'->>'due_date')::date;
            end if;

            v_cf_source_count := case when v_direct then greatest(0,v_source_count-1) else v_source_count end;

            select count(*) into v_category_count
            from jsonb_array_elements(
                case when jsonb_typeof(r.categories)='array' then r.categories else '[]'::jsonb end
            ) x
            where x #>> '{}' = v_source_category;

            v_cf_category_count := case
                when v_direct and v_source_category is not null and v_category_count=1
                    then greatest(0,v_category_count-1)
                else v_category_count
            end;

            v_cf_amount := greatest(0,v_amount-case when v_direct then v_source_amount else 0 end);

            v_cf_days_overdue := case
                when v_direct and v_source_due_date is not null
                     and v_source_due_date = (
                        select max((x->>'due_date')::date)
                        from jsonb_array_elements(
                            case when jsonb_typeof(r.source_snapshot)='array'
                                 then r.source_snapshot else '[]'::jsonb end
                        ) x
                        where (x->>'due_date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                     )
                then 0
                else v_days_overdue
            end;

            v_cf_impact := least(100,
                case r.severity
                    when 'critical' then 40
                    when 'high' then 32
                    when 'medium' then 22
                    else 12
                end
                + least(20,v_cf_source_count*5)
                + case
                    when v_cf_category_count>=3 then 15
                    when v_cf_category_count=2 then 8
                    else 0
                  end
                + case
                    when v_cf_amount>=10000 then 15
                    when v_cf_amount>=5000 then 12
                    when v_cf_amount>=1500 then 8
                    when v_cf_amount>0 then 4
                    else 0
                  end
            );

            v_cf_urgency := least(100,
                case
                    when v_cf_days_overdue>=14 then 40
                    when v_cf_days_overdue>=7 then 32
                    when v_cf_days_overdue>=3 then 24
                    when v_cf_days_overdue>=1 then 16
                    else 8
                end
                + case
                    when v_age_hours>=72 then 25
                    when v_age_hours>=48 then 20
                    when v_age_hours>=24 then 15
                    else 5
                  end
                + case
                    when r.severity='critical' then 25
                    when r.severity='high' then 18
                    when r.severity='medium' then 10
                    else 5
                  end
            );

            v_cf_dependency := least(100,
                case
                    when v_cf_category_count>=3 then 45
                    when v_cf_category_count=2 then 30
                    when v_cf_category_count=1 then 15
                    else 5
                end
                + case
                    when v_cf_source_count>=5 then 35
                    when v_cf_source_count>=3 then 25
                    when v_cf_source_count>=2 then 15
                    else 5
                  end
                + case
                    when r.incident_type in ('automation_compound','cross_domain_pressure')
                         and v_cf_source_count>0 then 20
                    else 0
                  end
            );

            v_counter_priority := least(100,greatest(0,
                round(v_cf_impact*0.45 + v_cf_urgency*0.35 + v_cf_dependency*0.20)::integer
            ));
            v_delta := v_counter_priority-v_current_priority;

            v_band := case
                when v_counter_priority>=80 then 'critical'
                when v_counter_priority>=65 then 'high'
                when v_counter_priority>=45 then 'medium'
                else 'low'
            end;

            v_class := case
                when v_direct then 'direct-condition-clearance'
                else 'relationship-validation'
            end;

            v_intervention := case d.dependency_type
                when 'overdue_follow_up' then 'Bring the overdue lead follow-up current, using a justified contact plan.'
                when 'overdue_task' then 'Resolve or re-sequence the overdue task after confirming its business relevance.'
                when 'overdue_invoice' then 'Validate the invoice balance and pursue collection through the appropriate approved channel.'
                when 'lead_quiet' then 'Validate whether the lead remains active and set the next justified contact.'
                when 'failed_action' then 'Inspect the failure and side effects before considering a controlled retry.'
                when 'stalled_execution' then 'Inspect the execution state and dependent proposal before any retry or reversal.'
                when 'verification_due' then 'Complete knowledge verification before relying on the affected knowledge in decisions.'
                when 'candidate_waiting' then 'Review the waiting strategic recommendation against current verified evidence.'
                else 'Validate this dependency and address the smallest reversible condition that could change the incident.'
            end;

            v_effect := case
                when v_direct then
                    'Counterfactual assumes this direct exception clears while all other incident conditions remain unchanged.'
                else
                    'Counterfactual does not remove the incident source itself; it estimates the effect of clearing only this linked dependency.'
            end;

            v_signal := case d.dependency_type
                when 'overdue_follow_up' then 'The follow-up condition clears and the incident no longer contains this overdue-contact signal.'
                when 'overdue_task' then 'The task is no longer overdue or is explicitly re-sequenced with a recorded reason.'
                when 'overdue_invoice' then 'The invoice outstanding condition is resolved or formally reclassified.'
                when 'lead_quiet' then 'A current lead contact/status signal appears in the workspace.'
                when 'failed_action' then 'The failure is understood and the execution state can be safely re-evaluated.'
                when 'stalled_execution' then 'The execution record leaves the stalled state with an auditable state transition.'
                when 'verification_due' then 'The affected knowledge reaches a verified state.'
                when 'candidate_waiting' then 'The recommendation is explicitly reviewed and its evidence is current.'
                else 'The linked record changes state in a way that should alter the incident evidence snapshot.'
            end;

            v_reversibility := case
                when d.dependency_type in ('overdue_follow_up','lead_quiet','candidate_waiting') then 'High'
                when d.dependency_type in ('overdue_task','verification_due') then 'Medium'
                else 'Requires explicit review'
            end;

            v_risk := case
                when d.dependency_type in ('failed_action','stalled_execution','overdue_invoice') then 'Medium'
                when d.dependency_type in ('overdue_task','verification_due') then 'Low'
                else 'Low to medium'
            end;

            v_gate := case
                when h.validation_status='supported' then
                    'Evidence supports testing this dependency, but administrative confirmation remains required.'
                when h.validation_status='weakened' then
                    'Do not treat this as the primary intervention. Reassess alternative dependencies first.'
                else
                    'Hypothesis remains inconclusive. Validate the dependency before executing any intervention.'
            end;

            v_confidence := case
                when h.validation_status='supported' and abs(v_delta)>=10 then 'high'
                when h.validation_status='supported' or abs(v_delta)>=10 then 'medium'
                else 'low'
            end;

            v_assumption := case
                when v_direct then
                    'Only this direct exception condition is assumed to clear; all other stored incident conditions remain unchanged.'
                else
                    'Only the relationship-level dependency is assumed to change; no source exception is removed unless the workspace records demonstrate that change.'
            end;

            v_evidence := jsonb_build_object(
                'method','deterministic_counterfactual_v1',
                'current_priority',v_current_priority,
                'counterfactual_priority',v_counter_priority,
                'priority_delta',v_delta,
                'current_components',jsonb_build_object(
                    'impact',v_current_impact,'urgency',v_current_urgency,'dependency',v_current_dependency
                ),
                'counterfactual_components',jsonb_build_object(
                    'impact',v_cf_impact,'urgency',v_cf_urgency,'dependency',v_cf_dependency
                ),
                'current_source_count',v_source_count,
                'counterfactual_source_count',v_cf_source_count,
                'current_category_count',v_category_count,
                'counterfactual_category_count',v_cf_category_count,
                'current_days_overdue',v_days_overdue,
                'counterfactual_days_overdue',v_cf_days_overdue,
                'current_outstanding_amount',v_amount,
                'counterfactual_outstanding_amount',v_cf_amount,
                'hypothesis_status',coalesce(h.validation_status,'unavailable'),
                'condition_fingerprint',r.condition_fingerprint
            );

            insert into public.innerme_incident_counterfactuals(
                incident_id,dependency_id,hypothesis_test_id,current_priority,counterfactual_priority,
                estimated_priority_delta,residual_risk_band,intervention_class,proposed_intervention,
                expected_effect,expected_signal,reversibility,intervention_risk,decision_gate,
                confidence,assumptions,evidence,condition_fingerprint
            ) values (
                r.id,d.id,h.id,v_current_priority,v_counter_priority,v_delta,v_band,v_class,v_intervention,
                v_effect,v_signal,v_reversibility,v_risk,v_gate,v_confidence,
                jsonb_build_array(v_assumption),v_evidence,r.condition_fingerprint
            )
            on conflict(incident_id,dependency_id) do update set
                hypothesis_test_id=excluded.hypothesis_test_id,
                current_priority=excluded.current_priority,
                counterfactual_priority=excluded.counterfactual_priority,
                estimated_priority_delta=excluded.estimated_priority_delta,
                residual_risk_band=excluded.residual_risk_band,
                intervention_class=excluded.intervention_class,
                proposed_intervention=excluded.proposed_intervention,
                expected_effect=excluded.expected_effect,
                expected_signal=excluded.expected_signal,
                reversibility=excluded.reversibility,
                intervention_risk=excluded.intervention_risk,
                decision_gate=excluded.decision_gate,
                confidence=excluded.confidence,
                assumptions=excluded.assumptions,
                evidence=excluded.evidence,
                condition_fingerprint=excluded.condition_fingerprint,
                updated_at=now();

            v_count:=v_count+1;
        end loop;
    end loop;

    return v_count;
end;
$$;

revoke all on function public.refresh_innerme_incident_counterfactuals() from public;
revoke all on function public.refresh_innerme_incident_counterfactuals() from anon;
grant execute on function public.refresh_innerme_incident_counterfactuals() to authenticated;

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

    return v_count;
end;
$$;

revoke all on function public.run_innerme_incident_intelligence() from public;
revoke all on function public.run_innerme_incident_intelligence() from anon;
grant execute on function public.run_innerme_incident_intelligence() to authenticated;

notify pgrst, 'reload schema';
