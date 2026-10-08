-- InnerMe Phase 23: intervention selection and sequencing
-- Compares counterfactual intervention options and recommends the safest
-- evidence-backed order. It never executes the intervention.

create table if not exists public.innerme_incident_intervention_options (
    id uuid primary key default gen_random_uuid(),
    incident_id uuid not null references public.innerme_operational_incidents(id) on delete cascade,
    counterfactual_id uuid not null references public.innerme_incident_counterfactuals(id) on delete cascade,
    dependency_id uuid not null references public.innerme_incident_dependencies(id) on delete cascade,
    hypothesis_test_id uuid references public.innerme_incident_hypothesis_tests(id) on delete set null,
    selection_score integer not null default 0 check (selection_score between 0 and 100),
    expected_priority_reduction integer not null default 0 check (expected_priority_reduction between 0 and 100),
    risk_score integer not null default 0 check (risk_score between 0 and 100),
    reversibility_score integer not null default 0 check (reversibility_score between 0 and 100),
    evidence_support_score integer not null default 0 check (evidence_support_score between 0 and 100),
    directness_score integer not null default 0 check (directness_score between 0 and 100),
    sequence_score integer not null default 0 check (sequence_score between 0 and 100),
    sequence_rank integer not null default 1,
    recommendation_status text not null default 'alternative'
        check (recommendation_status in ('recommended','alternative','deferred','not_recommended')),
    conflict_status text not null default 'none'
        check (conflict_status in ('none','review_required','blocked')),
    action_statement text not null,
    sequencing_reason text not null,
    conflict_notes jsonb not null default '[]'::jsonb,
    evidence jsonb not null default '{}'::jsonb,
    decision_gate text not null,
    condition_fingerprint text not null,
    generated_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (incident_id, counterfactual_id)
);

create index if not exists idx_innerme_incident_intervention_options_incident
on public.innerme_incident_intervention_options(incident_id, sequence_rank, selection_score desc);

create index if not exists idx_innerme_incident_intervention_options_status
on public.innerme_incident_intervention_options(recommendation_status, updated_at desc);

create table if not exists public.innerme_incident_intervention_selection (
    id uuid primary key default gen_random_uuid(),
    incident_id uuid not null unique references public.innerme_operational_incidents(id) on delete cascade,
    selected_option_id uuid references public.innerme_incident_intervention_options(id) on delete set null,
    selection_status text not null
        check (selection_status in ('selected','no_clear_winner','do_not_intervene')),
    recommended_first_action text not null,
    selection_rationale text not null,
    sequence jsonb not null default '[]'::jsonb,
    alternatives jsonb not null default '[]'::jsonb,
    decision_gate text not null,
    confidence text not null check (confidence in ('high','medium','low')),
    condition_fingerprint text not null,
    method text not null default 'deterministic_intervention_selection_v1',
    generated_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_innerme_incident_intervention_selection_status
on public.innerme_incident_intervention_selection(selection_status, confidence, updated_at desc);

alter table public.innerme_incident_intervention_options enable row level security;
alter table public.innerme_incident_intervention_selection enable row level security;

drop policy if exists "InnerMe incident intervention options admins can manage"
on public.innerme_incident_intervention_options;
create policy "InnerMe incident intervention options admins can manage"
on public.innerme_incident_intervention_options
for all to authenticated
using ((select public.is_swayphics_admin()))
with check ((select public.is_swayphics_admin()));

drop policy if exists "InnerMe incident intervention selection admins can manage"
on public.innerme_incident_intervention_selection;
create policy "InnerMe incident intervention selection admins can manage"
on public.innerme_incident_intervention_selection
for all to authenticated
using ((select public.is_swayphics_admin()))
with check ((select public.is_swayphics_admin()));

revoke all on table public.innerme_incident_intervention_options from anon;
revoke all on table public.innerme_incident_intervention_selection from anon;
grant select, insert, update, delete on table public.innerme_incident_intervention_options to authenticated;
grant select, insert, update on table public.innerme_incident_intervention_selection to authenticated;

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
    v_status text;
    v_confidence text;
    v_gate text;
    v_conflict_status text;
    v_conflict_notes jsonb;
    v_sequence_reason text;
    v_action text;
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

    for r in
        select * from public.innerme_operational_incidents
        where status in ('open','acknowledged')
    loop
        delete from public.innerme_incident_intervention_selection where incident_id=r.id;
        delete from public.innerme_incident_intervention_options where incident_id=r.id;

        v_best_id := null;
        v_best_score := -1;
        v_best_reduction := 0;
        v_best_risk := 100;
        v_has_supported := false;

        for c in
            select *
            from public.innerme_incident_counterfactuals
            where incident_id=r.id
            order by estimated_priority_delta asc, counterfactual_priority asc
        loop
            select * into h
            from public.innerme_incident_hypothesis_tests
            where incident_id=r.id and dependency_id=c.dependency_id
            limit 1;

            select * into d
            from public.innerme_incident_dependencies
            where id=c.dependency_id
            limit 1;

            v_reduction := greatest(0,c.current_priority-c.counterfactual_priority);

            v_risk_score := case
                when lower(c.intervention_risk)='low' then 10
                when lower(c.intervention_risk)='low to medium' then 25
                when lower(c.intervention_risk)='medium' then 50
                else 70
            end;

            v_reversibility_score := case
                when lower(c.reversibility)='high' then 100
                when lower(c.reversibility)='medium' then 65
                else 25
            end;

            v_support_score := case
                when h.validation_status='supported' then 100
                when h.validation_status='inconclusive' then 45
                when h.validation_status='weakened' then 10
                else 25
            end;

            v_directness_score := case
                when c.intervention_class='direct-condition-clearance' then 100
                else 55
            end;

            v_risk_adjust := case
                when lower(c.intervention_risk)='low' then 10
                when lower(c.intervention_risk)='low to medium' then 6
                when lower(c.intervention_risk)='medium' then 2
                else 0
            end;

            v_selection_score := least(100,greatest(0,
                least(35,v_reduction*2)
                + round(v_support_score*0.25)::integer
                + round(v_reversibility_score*0.25)::integer
                + round(v_directness_score*0.10)::integer
                + v_risk_adjust
                - case when v_reduction=0 then 30 else 0 end
            ));

            v_sequence_score := least(100,greatest(0,
                v_selection_score
                + case when h.validation_status='supported' then 10 else 0 end
                - case when v_risk_score>=50 then 10 else 0 end
            ));

            if v_reduction > 0 and h.validation_status='supported' then
                v_has_supported := true;
            end if;

            v_conflict_notes := '[]'::jsonb;
            v_conflict_status := 'none';

            if h.validation_status='weakened' then
                v_conflict_status := 'blocked';
                v_conflict_notes := jsonb_build_array('Hypothesis testing weakened this dependency.');
            elsif v_reduction <= 0 then
                v_conflict_status := 'review_required';
                v_conflict_notes := jsonb_build_array('Counterfactual does not reduce incident priority under the current model.');
            end if;

            if d.source_table in ('innerme_action_proposals','innerme_action_execution_logs') then
                v_conflict_status := case when v_conflict_status='none' then 'review_required' else v_conflict_status end;
                v_conflict_notes := v_conflict_notes || jsonb_build_array(
                    'Automation-related intervention requires explicit review before any retry, reversal or execution.'
                );
            end if;

            v_action := c.proposed_intervention;

            v_sequence_reason := case
                when h.validation_status='supported' and v_reduction>0 and lower(c.reversibility)='high' then
                    'Place early because the hypothesis is supported, the simulated priority falls, and the intervention is highly reversible.'
                when h.validation_status='supported' and v_reduction>0 then
                    'Place ahead of weaker alternatives because evidence supports it and the simulated priority falls.'
                when h.validation_status='inconclusive' and v_reduction>0 then
                    'Keep behind supported options because the simulated priority falls but the causal hypothesis remains inconclusive.'
                when h.validation_status='weakened' then
                    'Defer because hypothesis testing weakened the dependency.'
                else
                    'Do not prioritise because the counterfactual does not show a meaningful improvement.'
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
                case
                    when h.validation_status='weakened' then 'not_recommended'
                    when v_reduction<=0 then 'deferred'
                    else 'alternative'
                end,
                v_conflict_status,v_action,v_sequence_reason,v_conflict_notes,
                jsonb_build_object(
                    'method','deterministic_intervention_selection_v1',
                    'counterfactual_id',c.id,
                    'hypothesis_status',coalesce(h.validation_status,'unavailable'),
                    'selection_components',jsonb_build_object(
                        'priority_reduction',v_reduction,
                        'support',v_support_score,
                        'reversibility',v_reversibility_score,
                        'directness',v_directness_score,
                        'risk_score',v_risk_score
                    ),
                    'condition_fingerprint',r.condition_fingerprint
                ),
                c.decision_gate,r.condition_fingerprint
            );

            select * into o
            from public.innerme_incident_intervention_options
            where incident_id=r.id and counterfactual_id=c.id
            limit 1;

            if v_selection_score > v_best_score
               and v_reduction > 0
               and coalesce(h.validation_status,'inconclusive') <> 'weakened' then
                v_best_id := o.id;
                v_best_score := v_selection_score;
                v_best_reduction := v_reduction;
                v_best_risk := v_risk_score;
            end if;
        end loop;

        with ranked as (
            select id,
                   row_number() over(
                       order by
                           case when id=v_best_id then 0 else 1 end,
                           selection_score desc,
                           expected_priority_reduction desc,
                           risk_score asc,
                           id
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
                else 'deferred'
            end,
            updated_at=now()
        from ranked
        where o.id=ranked.id;

        select jsonb_agg(
            jsonb_build_object(
                'rank',sequence_rank,
                'option_id',id,
                'dependency_id',dependency_id,
                'selection_score',selection_score,
                'expected_priority_reduction',expected_priority_reduction,
                'risk_score',risk_score,
                'status',recommendation_status,
                'action',action_statement
            ) order by sequence_rank
        )
        into v_sequence
        from public.innerme_incident_intervention_options
        where incident_id=r.id;

        select coalesce(jsonb_agg(
            jsonb_build_object(
                'option_id',id,
                'selection_score',selection_score,
                'status',recommendation_status,
                'action',action_statement
            ) order by selection_score desc
        ),'[]'::jsonb)
        into v_alternatives
        from public.innerme_incident_intervention_options
        where incident_id=r.id and id<>coalesce(v_best_id,'00000000-0000-0000-0000-000000000000'::uuid);

        if v_best_id is null then
            insert into public.innerme_incident_intervention_selection(
                incident_id,selected_option_id,selection_status,recommended_first_action,
                selection_rationale,sequence,alternatives,decision_gate,confidence,condition_fingerprint
            ) values (
                r.id,null,'do_not_intervene',
                'Do not execute an intervention yet. Validate the incident and dependency evidence first.',
                'No intervention currently has sufficient evidence and a measurable priority reduction to justify selection.',
                coalesce(v_sequence,'[]'::jsonb),v_alternatives,
                'Administrative validation is required before any intervention.',
                'low',r.condition_fingerprint
            );
        else
            update public.innerme_incident_intervention_options
            set recommendation_status='recommended',updated_at=now()
            where id=v_best_id;

            v_status := case
                when v_best_reduction>=15 and v_has_supported then 'selected'
                else 'no_clear_winner'
            end;

            v_confidence := case
                when v_status='selected' and v_best_risk<=25 then 'high'
                when v_status='selected' then 'medium'
                else 'low'
            end;

            select action_statement,decision_gate
            into v_action,v_gate
            from public.innerme_incident_intervention_options
            where id=v_best_id;

            insert into public.innerme_incident_intervention_selection(
                incident_id,selected_option_id,selection_status,recommended_first_action,
                selection_rationale,sequence,alternatives,decision_gate,confidence,condition_fingerprint
            ) values (
                r.id,v_best_id,v_status,v_action,
                'Selected using deterministic intervention scoring. Preference is given to measurable priority reduction, stronger hypothesis support, reversibility, directness and lower intervention risk.',
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

    return v_count;
end;
$$;

revoke all on function public.run_innerme_incident_intelligence() from public;
revoke all on function public.run_innerme_incident_intelligence() from anon;
grant execute on function public.run_innerme_incident_intelligence() to authenticated;

notify pgrst, 'reload schema';