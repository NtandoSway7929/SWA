-- InnerMe Phase 26: adaptive strategy and optimisation
-- Historical measured intervention outcomes influence future intervention ranking
-- through a bounded strategy-class adjustment. Fewer than three decisive
-- measured outcomes produce no ranking adjustment. Historical performance
-- never overrides hypothesis, safety, conflict or administrator-approval gates.

create table if not exists public.innerme_intervention_strategy_profiles (
    id uuid primary key default gen_random_uuid(),
    strategy_key text not null unique,
    strategy_label text not null,
    sample_count integer not null default 0 check (sample_count >= 0),
    improved_count integer not null default 0 check (improved_count >= 0),
    unchanged_count integer not null default 0 check (unchanged_count >= 0),
    worsened_count integer not null default 0 check (worsened_count >= 0),
    inconclusive_count integer not null default 0 check (inconclusive_count >= 0),
    mean_priority_delta numeric(10,2),
    effectiveness_score integer not null default 50 check (effectiveness_score between 0 and 100),
    adjustment_score integer not null default 0 check (adjustment_score between -15 and 15),
    confidence text not null default 'low' check (confidence in ('high','medium','low')),
    evidence jsonb not null default '{}'::jsonb,
    last_outcome_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_innerme_intervention_strategy_profiles_effectiveness
on public.innerme_intervention_strategy_profiles(effectiveness_score desc, updated_at desc);

create index if not exists idx_innerme_intervention_strategy_profiles_confidence
on public.innerme_intervention_strategy_profiles(confidence, adjustment_score desc);

alter table public.innerme_intervention_strategy_profiles enable row level security;

drop policy if exists "InnerMe intervention strategy profiles admins can read"
on public.innerme_intervention_strategy_profiles;
create policy "InnerMe intervention strategy profiles admins can read"
on public.innerme_intervention_strategy_profiles
for select to authenticated
using ((select public.is_swayphics_admin()));

revoke all on table public.innerme_intervention_strategy_profiles from anon;
grant select on table public.innerme_intervention_strategy_profiles to authenticated;
grant all on table public.innerme_intervention_strategy_profiles to service_role;

create or replace function public.refresh_innerme_intervention_strategy_profiles()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_count integer := 0;
    r record;
    v_decisive integer;
    v_effectiveness integer;
    v_adjustment integer;
    v_confidence text;
begin
    if current_user <> 'postgres' and not public.is_swayphics_admin() then
        raise exception 'Swayphics admin access required.';
    end if;

    for r in
        with measured as (
            select
                c.intervention_class as strategy_key,
                count(*) filter (where o.outcome_status in ('improved','unchanged','worsened'))::integer as sample_count,
                count(*) filter (where o.outcome_status='improved')::integer as improved_count,
                count(*) filter (where o.outcome_status='unchanged')::integer as unchanged_count,
                count(*) filter (where o.outcome_status='worsened')::integer as worsened_count,
                count(*) filter (where o.outcome_status='inconclusive')::integer as inconclusive_count,
                avg(o.priority_delta) filter (where o.outcome_status in ('improved','unchanged','worsened')) as mean_priority_delta,
                max(o.measured_at) as last_outcome_at
            from public.innerme_intervention_outcomes o
            join public.innerme_incident_intervention_executions e on e.id=o.execution_id
            join public.innerme_incident_intervention_options io on io.id=e.option_id
            join public.innerme_incident_counterfactuals c on c.id=io.counterfactual_id
            where o.outcome_measurement_status='measured'
            group by c.intervention_class
        )
        select * from measured
    loop
        v_decisive := r.sample_count;

        if v_decisive=0 then
            v_effectiveness := 50;
            v_adjustment := 0;
            v_confidence := 'low';
        else
            v_effectiveness := least(100,greatest(0,
                round(
                    (
                        (greatest(0,least(100,50 - coalesce(r.mean_priority_delta,0)*2)) * 0.60)
                        +
                        ((r.improved_count::numeric + r.unchanged_count::numeric*0.50) / r.sample_count * 100 * 0.40)
                    )
                )::integer
            ));

            v_adjustment := case
                when v_decisive < 3 then 0
                else least(15,greatest(-15,round((v_effectiveness-50)*0.30)::integer))
            end;

            v_confidence := case
                when v_decisive >= 8 then 'high'
                when v_decisive >= 4 then 'medium'
                else 'low'
            end;
        end if;

        insert into public.innerme_intervention_strategy_profiles(
            strategy_key,strategy_label,sample_count,improved_count,unchanged_count,
            worsened_count,inconclusive_count,mean_priority_delta,effectiveness_score,
            adjustment_score,confidence,evidence,last_outcome_at,updated_at
        )
        values (
            r.strategy_key,replace(r.strategy_key,'-',' '),r.sample_count,r.improved_count,
            r.unchanged_count,r.worsened_count,r.inconclusive_count,r.mean_priority_delta,
            v_effectiveness,v_adjustment,v_confidence,
            jsonb_build_object(
                'method','adaptive_intervention_strategy_v1',
                'minimum_samples_for_adjustment',3,
                'high_confidence_samples',8,
                'effectiveness_model',jsonb_build_object(
                    'priority_delta_weight',0.60,
                    'outcome_quality_weight',0.40
                ),
                'adjustment_cap',15
            ),
            r.last_outcome_at,now()
        )
        on conflict(strategy_key) do update set
            strategy_label=excluded.strategy_label,
            sample_count=excluded.sample_count,
            improved_count=excluded.improved_count,
            unchanged_count=excluded.unchanged_count,
            worsened_count=excluded.worsened_count,
            inconclusive_count=excluded.inconclusive_count,
            mean_priority_delta=excluded.mean_priority_delta,
            effectiveness_score=excluded.effectiveness_score,
            adjustment_score=excluded.adjustment_score,
            confidence=excluded.confidence,
            evidence=excluded.evidence,
            last_outcome_at=excluded.last_outcome_at,
            updated_at=now();

        v_count:=v_count+1;
    end loop;

    return v_count;
end;
$$;

revoke all on function public.refresh_innerme_intervention_strategy_profiles() from public;
revoke all on function public.refresh_innerme_intervention_strategy_profiles() from anon;
grant execute on function public.refresh_innerme_intervention_strategy_profiles() to authenticated;

-- Phase 26 selection replacement is intentionally included here so the
-- adaptive profile is used before a new intervention sequence is generated.
create or replace function public.refresh_innerme_incident_intervention_selection()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_count integer := 0;
    v_reduction integer;
    v_risk_score integer;
    v_reversibility_score integer;
    v_support_score integer;
    v_directness_score integer;
    v_risk_adjust integer;
    v_selection_score integer;
    v_sequence_score integer;
    v_adaptive_adjustment integer;
    v_status text;
    v_confidence text;
    v_gate text;
    v_conflict_status text;
    v_conflict_notes jsonb;
    v_sequence_reason text;
    v_action text;
    v_strategy_key text;
    v_adaptive_confidence text;
    v_best_id uuid;
    v_best_score integer;
    v_best_reduction integer;
    v_best_risk integer;
    v_has_supported boolean;
    v_sequence jsonb;
    v_alternatives jsonb;
    r public.innerme_operational_incidents%rowtype;
    c public.innerme_incident_counterfactuals%rowtype;
    h public.innerme_incident_hypothesis_tests%rowtype;
    d public.innerme_incident_dependencies%rowtype;
    o public.innerme_incident_intervention_options%rowtype;
begin
    if current_user <> 'postgres' and not public.is_swayphics_admin() then
        raise exception 'Swayphics admin access required.';
    end if;

    for r in select * from public.innerme_operational_incidents where status in ('open','acknowledged')
    loop
        delete from public.innerme_incident_intervention_selection where incident_id=r.id;
        delete from public.innerme_incident_intervention_options where incident_id=r.id;

        v_best_id:=null; v_best_score:=-1; v_best_reduction:=0; v_best_risk:=100; v_has_supported:=false;

        for c in
            select * from public.innerme_incident_counterfactuals
            where incident_id=r.id
            order by estimated_priority_delta asc,counterfactual_priority asc
        loop
            select * into h from public.innerme_incident_hypothesis_tests
            where incident_id=r.id and dependency_id=c.dependency_id limit 1;
            select * into d from public.innerme_incident_dependencies where id=c.dependency_id limit 1;

            v_reduction:=greatest(0,c.current_priority-c.counterfactual_priority);
            v_risk_score:=case
                when lower(c.intervention_risk)='low' then 10
                when lower(c.intervention_risk)='low to medium' then 25
                when lower(c.intervention_risk)='medium' then 50
                else 70 end;
            v_reversibility_score:=case
                when lower(c.reversibility)='high' then 100
                when lower(c.reversibility)='medium' then 65
                else 25 end;
            v_support_score:=case
                when h.validation_status='supported' then 100
                when h.validation_status='inconclusive' then 45
                when h.validation_status='weakened' then 10
                else 25 end;
            v_directness_score:=case when c.intervention_class='direct-condition-clearance' then 100 else 55 end;
            v_risk_adjust:=case
                when lower(c.intervention_risk)='low' then 10
                when lower(c.intervention_risk)='low to medium' then 6
                when lower(c.intervention_risk)='medium' then 2
                else 0 end;

            v_strategy_key:=c.intervention_class;
            select adjustment_score,confidence
            into v_adaptive_adjustment,v_adaptive_confidence
            from public.innerme_intervention_strategy_profiles
            where strategy_key=v_strategy_key;
            v_adaptive_adjustment:=coalesce(v_adaptive_adjustment,0);
            v_adaptive_confidence:=coalesce(v_adaptive_confidence,'low');

            v_selection_score:=least(100,greatest(0,
                least(35,v_reduction*2)
                + round(v_support_score*0.25)::integer
                + round(v_reversibility_score*0.25)::integer
                + round(v_directness_score*0.10)::integer
                + v_risk_adjust
                + v_adaptive_adjustment
                - case when v_reduction=0 then 30 else 0 end
            ));

            v_sequence_score:=least(100,greatest(0,
                v_selection_score
                + case when h.validation_status='supported' then 10 else 0 end
                - case when v_risk_score>=50 then 10 else 0 end
            ));

            if v_reduction>0 and h.validation_status='supported' then v_has_supported:=true; end if;

            v_conflict_notes:='[]'::jsonb;
            v_conflict_status:='none';
            if h.validation_status='weakened' then
                v_conflict_status:='blocked';
                v_conflict_notes:=jsonb_build_array('Hypothesis testing weakened this dependency.');
            elsif v_reduction<=0 then
                v_conflict_status:='review_required';
                v_conflict_notes:=jsonb_build_array('Counterfactual does not reduce incident priority under the current model.');
            end if;

            if d.source_table='innerme_action_proposals' or d.source_table='innerme_action_execution_logs' then
                v_conflict_status:=case when v_conflict_status='none' then 'review_required' else v_conflict_status end;
                v_conflict_notes:=v_conflict_notes || jsonb_build_array(
                    'Automation-related intervention requires explicit review before any retry, reversal or execution.'
                );
            end if;

            v_action:=c.proposed_intervention;
            v_sequence_reason:=case
                when h.validation_status='supported' and v_reduction>0 and lower(c.reversibility)='high' and v_adaptive_adjustment>0
                    then 'Place early because evidence supports it, the simulation shows lower priority, the intervention is highly reversible, and this strategy has a positive measured track record.'
                when h.validation_status='supported' and v_reduction>0 and v_adaptive_adjustment>0
                    then 'Place ahead of weaker alternatives because evidence supports it, the simulated priority falls, and this strategy has a positive measured track record.'
                when h.validation_status='supported' and v_reduction>0 and v_adaptive_adjustment<0
                    then 'Keep below comparable alternatives where possible because historical outcomes for this strategy are weaker.'
                when h.validation_status='supported' and v_reduction>0
                    then 'Place ahead of weaker alternatives because evidence supports it and the simulated priority falls.'
                when h.validation_status='inconclusive' and v_reduction>0
                    then 'Keep behind supported options because the simulated priority falls but the causal hypothesis remains inconclusive.'
                when h.validation_status='weakened' then 'Defer because hypothesis testing weakened the dependency.'
                else 'Do not prioritise because the counterfactual does not show a meaningful improvement.'
            end;

            insert into public.innerme_incident_intervention_options(
                incident_id,counterfactual_id,dependency_id,hypothesis_test_id,
                selection_score,expected_priority_reduction,risk_score,reversibility_score,
                evidence_support_score,directness_score,sequence_score,sequence_rank,
                recommendation_status,conflict_status,action_statement,sequencing_reason,
                conflict_notes,evidence,decision_gate,condition_fingerprint
            ) values (
                r.id,c.id,c.dependency_id,h.id,v_selection_score,v_reduction,v_risk_score,
                v_reversibility_score,v_support_score,v_directness_score,v_sequence_score,
                999,
                case when h.validation_status='weakened' then 'not_recommended'
                     when v_reduction<=0 then 'deferred' else 'alternative' end,
                v_conflict_status,v_action,v_sequence_reason,v_conflict_notes,
                jsonb_build_object(
                    'method','adaptive_intervention_selection_v1',
                    'counterfactual_id',c.id,
                    'strategy_key',v_strategy_key,
                    'adaptive_adjustment',v_adaptive_adjustment,
                    'adaptive_confidence',v_adaptive_confidence,
                    'hypothesis_status',coalesce(h.validation_status,'unavailable'),
                    'selection_components',jsonb_build_object(
                        'priority_reduction',v_reduction,
                        'support',v_support_score,
                        'reversibility',v_reversibility_score,
                        'directness',v_directness_score,
                        'risk_score',v_risk_score,
                        'adaptive_adjustment',v_adaptive_adjustment
                    ),
                    'condition_fingerprint',r.condition_fingerprint
                ),
                c.decision_gate,r.condition_fingerprint
            );

            select * into o from public.innerme_incident_intervention_options
            where incident_id=r.id and counterfactual_id=c.id limit 1;

            if v_selection_score>v_best_score and v_reduction>0 and h.validation_status<>'weakened' then
                v_best_id:=o.id; v_best_score:=v_selection_score; v_best_reduction:=v_reduction; v_best_risk:=v_risk_score;
            end if;
        end loop;

        with ranked as (
            select id,row_number() over(
                order by case when id=v_best_id then 0 else 1 end,
                         selection_score desc,expected_priority_reduction desc,risk_score asc,id
            )::integer as rank
            from public.innerme_incident_intervention_options
            where incident_id=r.id
        )
        update public.innerme_incident_intervention_options o
        set sequence_rank=ranked.rank,
            recommendation_status=case
                when ranked.rank=1 and o.id=v_best_id then 'recommended'
                when o.conflict_status='blocked' then 'not_recommended'
                when ranked.rank<=3 and o.expected_priority_reduction>0 then 'alternative'
                else 'deferred' end,
            updated_at=now()
        from ranked where o.id=ranked.id;

        select jsonb_agg(
            jsonb_build_object(
                'rank',sequence_rank,'option_id',id,'dependency_id',dependency_id,
                'selection_score',selection_score,'expected_priority_reduction',expected_priority_reduction,
                'risk_score',risk_score,'status',recommendation_status,'action',action_statement
            ) order by sequence_rank
        ) into v_sequence
        from public.innerme_incident_intervention_options where incident_id=r.id;

        select coalesce(jsonb_agg(
            jsonb_build_object(
                'option_id',id,'selection_score',selection_score,
                'status',recommendation_status,'action',action_statement
            ) order by selection_score desc
        ),'[]'::jsonb) into v_alternatives
        from public.innerme_incident_intervention_options
        where incident_id=r.id and id<>coalesce(v_best_id,'00000000-0000-0000-0000-000000000000'::uuid);

        if v_best_id is null then
            insert into public.innerme_incident_intervention_selection(
                incident_id,selected_option_id,selection_status,recommended_first_action,
                selection_rationale,sequence,alternatives,decision_gate,confidence,condition_fingerprint
            ) values (
                r.id,null,'do_not_intervene',
                'Do not execute an intervention yet. Validate the incident and dependency evidence first.',
                case
                    when not exists (select 1 from public.innerme_incident_hypothesis_tests where incident_id=r.id)
                        then 'No hypothesis tests are available for this incident.'
                    when not exists (select 1 from public.innerme_incident_hypothesis_tests where incident_id=r.id and validation_status='supported')
                        then 'No dependency hypothesis is currently supported strongly enough to justify a first intervention.'
                    else 'The available counterfactuals do not produce a positive priority reduction for a non-weakened dependency.'
                end,
                coalesce(v_sequence,'[]'::jsonb),v_alternatives,
                'Administrative validation is required before any intervention. Historical strategy performance cannot override this gate.',
                'low',r.condition_fingerprint
            );
        else
            update public.innerme_incident_intervention_options
            set recommendation_status='recommended',updated_at=now()
            where id=v_best_id;

            v_status:=case when v_best_reduction>=15 and v_has_supported then 'selected' else 'no_clear_winner' end;

            select action_statement,decision_gate
            into v_action,v_gate
            from public.innerme_incident_intervention_options where id=v_best_id;

            select coalesce((evidence->>'adaptive_adjustment')::integer,0),coalesce(evidence->>'adaptive_confidence','low')
            into v_adaptive_adjustment,v_adaptive_confidence
            from public.innerme_incident_intervention_options where id=v_best_id;

            v_confidence:=case
                when v_status='selected' and v_best_risk<=25 and v_adaptive_adjustment>=0 and v_adaptive_confidence='high' then 'high'
                when v_status='selected' then 'medium'
                else 'low' end;

            insert into public.innerme_incident_intervention_selection(
                incident_id,selected_option_id,selection_status,recommended_first_action,
                selection_rationale,sequence,alternatives,decision_gate,confidence,condition_fingerprint
            ) values (
                r.id,v_best_id,v_status,v_action,
                'Selected using deterministic intervention scoring plus bounded historical strategy performance. Historical outcomes can adjust ranking but cannot override evidence, safety gates or administrator approval.',
                coalesce(v_sequence,'[]'::jsonb),v_alternatives,v_gate,v_confidence,r.condition_fingerprint
            );
        end if;

        v_count:=v_count+1;
    end loop;

    return v_count;
end;
$$;

revoke all on function public.refresh_innerme_incident_intervention_selection() from public;
revoke all on function public.refresh_innerme_incident_intervention_selection() from anon;
grant execute on function public.refresh_innerme_incident_intervention_selection() to authenticated;

create or replace function public.run_innerme_incident_intelligence()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare v_count integer := 0;
begin
    if current_user <> 'postgres' and not public.is_swayphics_admin() then
        raise exception 'Swayphics admin access required.';
    end if;
    v_count:=v_count+coalesce(public.generate_innerme_operational_incidents(),0);
    v_count:=v_count+coalesce(public.refresh_innerme_incident_intelligence(),0);
    v_count:=v_count+coalesce(public.refresh_innerme_incident_root_analysis(),0);
    v_count:=v_count+coalesce(public.refresh_innerme_incident_hypothesis_tests(),0);
    v_count:=v_count+coalesce(public.refresh_innerme_incident_counterfactuals(),0);
    v_count:=v_count+coalesce(public.refresh_innerme_intervention_outcomes(),0);
    v_count:=v_count+coalesce(public.refresh_innerme_intervention_strategy_profiles(),0);
    v_count:=v_count+coalesce(public.refresh_innerme_incident_intervention_selection(),0);
    return v_count;
end;
$$;

revoke all on function public.run_innerme_incident_intelligence() from public;
revoke all on function public.run_innerme_incident_intelligence() from anon;
grant execute on function public.run_innerme_incident_intelligence() to authenticated;

notify pgrst,'reload schema';