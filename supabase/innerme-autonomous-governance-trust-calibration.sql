-- InnerMe Phase 29: Autonomous Governance & Trust Calibration
-- Trust is evidence-calibrated, auditable and administrator-gated.
-- Calibration never grants permissions or executes external actions.

alter table public.innerme_intervention_strategy_profiles
    add column if not exists trust_stage integer not null default 1
        check (trust_stage between 1 and 3);

create table if not exists public.innerme_agent_trust_evidence (
    id uuid primary key default gen_random_uuid(),
    evidence_key text not null unique,
    agent_id uuid not null references public.innerme_agents(id) on delete restrict,
    source_type text not null check (source_type in ('coordination_assignment','admin_assessment')),
    source_record_id uuid,
    outcome_signal text not null check (outcome_signal in ('positive','neutral','negative','inconclusive')),
    confidence text not null check (confidence in ('high','medium','low')),
    quality_score integer check (quality_score between 0 and 100),
    summary text not null,
    evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
    evidence_status text not null default 'pending'
        check (evidence_status in ('pending','verified','rejected')),
    created_by uuid references auth.users(id) on delete set null,
    verified_by uuid references auth.users(id) on delete set null,
    verified_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (
        (source_type='coordination_assignment' and source_record_id is not null)
        or (source_type='admin_assessment' and source_record_id is null)
    ),
    check (
        (evidence_status='verified' and verified_by is not null and verified_at is not null)
        or evidence_status <> 'verified'
    )
);

create unique index if not exists idx_innerme_agent_trust_evidence_source
on public.innerme_agent_trust_evidence(agent_id,source_type,source_record_id)
where source_record_id is not null;
create index if not exists idx_innerme_agent_trust_evidence_agent_status
on public.innerme_agent_trust_evidence(agent_id,evidence_status,verified_at desc);
create index if not exists idx_innerme_agent_trust_evidence_created_by
on public.innerme_agent_trust_evidence(created_by);

create table if not exists public.innerme_trust_calibration_reviews (
    id uuid primary key default gen_random_uuid(),
    target_type text not null check (target_type in ('agent','strategy')),
    target_key text not null,
    agent_id uuid references public.innerme_agents(id) on delete restrict,
    strategy_key text,
    current_trust_stage integer not null check (current_trust_stage between 1 and 3),
    proposed_trust_stage integer not null check (proposed_trust_stage between 1 and 3),
    sample_count integer not null default 0 check (sample_count >= 0),
    positive_count integer not null default 0 check (positive_count >= 0),
    neutral_count integer not null default 0 check (neutral_count >= 0),
    negative_count integer not null default 0 check (negative_count >= 0),
    evidence_confidence text not null check (evidence_confidence in ('high','medium','low','insufficient')),
    status text not null check (status in ('insufficient_evidence','no_change','review_required','rejected','applied')),
    rationale text not null,
    evidence_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence_snapshot) = 'object'),
    condition_fingerprint text not null,
    evidence_window_start timestamptz,
    evidence_window_end timestamptz not null default now(),
    calculated_at timestamptz not null default now(),
    reviewed_by uuid references auth.users(id) on delete set null,
    reviewed_at timestamptz,
    applied_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(target_type,target_key,condition_fingerprint),
    check (
        (target_type='agent' and agent_id is not null and strategy_key is null)
        or (target_type='strategy' and agent_id is null and strategy_key is not null)
    ),
    check (
        (status='applied' and reviewed_by is not null and reviewed_at is not null and applied_at is not null)
        or status <> 'applied'
    )
);

create index if not exists idx_innerme_trust_calibration_target
on public.innerme_trust_calibration_reviews(target_type,target_key,calculated_at desc);
create index if not exists idx_innerme_trust_calibration_status
on public.innerme_trust_calibration_reviews(status,calculated_at desc);
create index if not exists idx_innerme_trust_calibration_agent
on public.innerme_trust_calibration_reviews(agent_id,calculated_at desc);

alter table public.innerme_agent_trust_evidence enable row level security;
alter table public.innerme_trust_calibration_reviews enable row level security;

drop policy if exists "InnerMe agent trust evidence admins can read" on public.innerme_agent_trust_evidence;
create policy "InnerMe agent trust evidence admins can read"
on public.innerme_agent_trust_evidence for select to authenticated
using ((select public.is_swayphics_admin()));

drop policy if exists "InnerMe trust calibrations admins can read" on public.innerme_trust_calibration_reviews;
create policy "InnerMe trust calibrations admins can read"
on public.innerme_trust_calibration_reviews for select to authenticated
using ((select public.is_swayphics_admin()));

revoke all on table public.innerme_agent_trust_evidence from anon, authenticated;
revoke all on table public.innerme_trust_calibration_reviews from anon, authenticated;
grant select on table public.innerme_agent_trust_evidence to authenticated;
grant select on table public.innerme_trust_calibration_reviews to authenticated;
grant all on table public.innerme_agent_trust_evidence to service_role;
grant all on table public.innerme_trust_calibration_reviews to service_role;

create or replace function public.record_innerme_agent_trust_evidence(
    p_agent_id uuid,
    p_source_type text,
    p_source_record_id uuid,
    p_outcome_signal text,
    p_confidence text,
    p_quality_score integer,
    p_summary text,
    p_evidence jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid;
    v_key text;
begin
    if auth.uid() is null or not public.is_swayphics_admin() then
        raise exception 'Swayphics admin access required.';
    end if;

    if p_outcome_signal not in ('positive','neutral','negative','inconclusive')
       or p_confidence not in ('high','medium','low') then
        raise exception 'Invalid trust evidence signal or confidence.';
    end if;
    if p_quality_score is not null and (p_quality_score < 0 or p_quality_score > 100) then
        raise exception 'Quality score must be between 0 and 100.';
    end if;
    if nullif(trim(coalesce(p_summary,'')),'') is null then
        raise exception 'A concise evidence summary is required.';
    end if;
    if jsonb_typeof(coalesce(p_evidence,'{}'::jsonb)) <> 'object' then
        raise exception 'Evidence must be a JSON object.';
    end if;

    if p_source_type='coordination_assignment' then
        if p_source_record_id is null or not exists (
            select 1
            from public.innerme_agent_coordination_assignments a
            where a.id=p_source_record_id
              and a.agent_id=p_agent_id
              and a.status='completed'
              and a.reviewed_by is not null
              and a.reviewed_at is not null
        ) then
            raise exception 'Agent evidence must reference a completed, reviewed assignment belonging to that agent.';
        end if;
        v_key := md5(p_agent_id::text||'|coordination_assignment|'||p_source_record_id::text);
    elsif p_source_type='admin_assessment' then
        if p_source_record_id is not null then
            raise exception 'Administrator assessments cannot include a source record ID.';
        end if;
        v_key := gen_random_uuid()::text;
    else
        raise exception 'Unsupported trust evidence source type.';
    end if;

    insert into public.innerme_agent_trust_evidence(
        evidence_key,agent_id,source_type,source_record_id,outcome_signal,
        confidence,quality_score,summary,evidence,evidence_status,created_by
    ) values (
        v_key,p_agent_id,p_source_type,p_source_record_id,p_outcome_signal,
        p_confidence,p_quality_score,trim(p_summary),coalesce(p_evidence,'{}'::jsonb),
        'pending',auth.uid()
    )
    on conflict do nothing
    returning id into v_id;

    if v_id is null and p_source_record_id is not null then
        select id into v_id
        from public.innerme_agent_trust_evidence
        where agent_id=p_agent_id
          and source_type=p_source_type
          and source_record_id=p_source_record_id
        limit 1;
    end if;

    return v_id;
end;
$$;

create or replace function public.review_innerme_agent_trust_evidence(
    p_evidence_id uuid,
    p_decision text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_status text;
begin
    if auth.uid() is null or not public.is_swayphics_admin() then
        raise exception 'Swayphics admin access required.';
    end if;
    if p_decision is null or p_decision not in ('verify','reject') then
        raise exception 'Decision must be verify or reject.';
    end if;

    select evidence_status into v_status
    from public.innerme_agent_trust_evidence
    where id=p_evidence_id
    for update;

    if not found then
        raise exception 'Trust evidence record not found.';
    end if;
    if v_status <> 'pending' then
        raise exception 'Only pending trust evidence can be reviewed.';
    end if;

    update public.innerme_agent_trust_evidence
    set evidence_status=case when p_decision='verify' then 'verified' else 'rejected' end,
        verified_by=case when p_decision='verify' then auth.uid() else null end,
        verified_at=case when p_decision='verify' then now() else null end,
        updated_at=now()
    where id=p_evidence_id;
    return true;
end;
$$;

create or replace function public.refresh_innerme_agent_trust_calibration()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_count integer := 0;
    v_agent record;
    v_profile record;
    v_checkpoint timestamptz;
    v_start timestamptz;
    v_latest_evidence timestamptz;
    v_sample integer;
    v_positive integer;
    v_neutral integer;
    v_negative integer;
    v_high_confidence integer;
    v_current_stage integer;
    v_proposed_stage integer;
    v_status text;
    v_confidence text;
    v_fingerprint text;
    v_rationale text;
    v_snapshot jsonb;
begin
    if auth.uid() is not null and not public.is_swayphics_admin() then
        raise exception 'Swayphics admin access required.';
    end if;

    -- Only verified medium/high-confidence evidence can calibrate agents.
    -- Completed work alone is not treated as successful work.
    for v_agent in
        select id,slug,name,trust_stage
        from public.innerme_agents
        where status='active'
        order by slug
    loop
        select coalesce(max(applied_at),'epoch'::timestamptz)
        into v_checkpoint
        from public.innerme_trust_calibration_reviews
        where target_type='agent' and target_key=v_agent.slug and status='applied';

        select
            count(*) filter (where outcome_signal in ('positive','neutral','negative'))::integer,
            count(*) filter (where outcome_signal='positive')::integer,
            count(*) filter (where outcome_signal='neutral')::integer,
            count(*) filter (where outcome_signal='negative')::integer,
            count(*) filter (where confidence='high')::integer,
            max(verified_at)
        into v_sample,v_positive,v_neutral,v_negative,v_high_confidence,v_latest_evidence
        from public.innerme_agent_trust_evidence
        where agent_id=v_agent.id
          and evidence_status='verified'
          and confidence in ('high','medium')
          and verified_at > v_checkpoint;

        v_sample:=coalesce(v_sample,0);
        v_positive:=coalesce(v_positive,0);
        v_neutral:=coalesce(v_neutral,0);
        v_negative:=coalesce(v_negative,0);
        v_high_confidence:=coalesce(v_high_confidence,0);
        v_current_stage:=v_agent.trust_stage;
        v_proposed_stage:=v_current_stage;
        v_confidence:=case when v_sample>=8 and v_high_confidence>=4 then 'high'
                           when v_sample>=4 then 'medium'
                           when v_sample>0 then 'low'
                           else 'insufficient' end;

        if v_sample >= 5
           and v_positive::numeric / greatest(v_sample,1) >= 0.80
           and v_negative=0
           and v_current_stage < 3 then
            v_proposed_stage:=v_current_stage+1;
            v_status:='review_required';
            v_rationale:=format(
                'Promotion candidate: %s verified positive outcomes from %s eligible outcomes since the last applied calibration. Administrator approval changes the trust stage only; the registered permission set remains unchanged.',
                v_positive,v_sample
            );
        elsif v_sample >= 3
          and v_negative::numeric / greatest(v_sample,1) >= 0.34
          and v_current_stage > 1 then
            v_proposed_stage:=v_current_stage-1;
            v_status:='review_required';
            v_rationale:=format(
                'Reduction candidate: %s of %s verified eligible outcomes were negative since the last applied calibration. Review the evidence before reducing the agent trust stage.',
                v_negative,v_sample
            );
        elsif v_sample < 3 then
            v_status:='insufficient_evidence';
            v_rationale:=format(
                'No trust-stage change proposed. Only %s verified medium/high-confidence outcome record(s) are available since the last applied calibration; at least 3 are needed before evaluating a reduction and 5 positive outcomes are needed before considering promotion.',
                v_sample
            );
        else
            v_status:='no_change';
            v_rationale:=format(
                'Current trust stage retained. The evidence window contains %s eligible outcomes, but promotion requires at least 80%% positive outcomes with no negative outcomes, while reduction requires at least 34%% negative outcomes.',
                v_sample
            );
        end if;

        v_start:=case when v_checkpoint='epoch'::timestamptz then v_latest_evidence else v_checkpoint end;
        v_fingerprint:=md5(
            'agent|'||v_agent.slug||'|'||v_current_stage::text||'|'||
            v_sample::text||'|'||v_positive::text||'|'||v_neutral::text||'|'||
            v_negative::text||'|'||coalesce(v_latest_evidence::text,'none')||'|'||
            v_checkpoint::text
        );
        v_snapshot:=jsonb_build_object(
            'evidence_source','innerme_agent_trust_evidence',
            'eligible_sample_count',v_sample,
            'positive_count',v_positive,
            'neutral_count',v_neutral,
            'negative_count',v_negative,
            'high_confidence_count',v_high_confidence,
            'confidence_rule','Only admin-verified medium/high-confidence evidence is eligible.',
            'checkpoint',v_checkpoint,
            'latest_verified_evidence_at',v_latest_evidence,
            'permissions_change_on_approval',false
        );

        insert into public.innerme_trust_calibration_reviews(
            target_type,target_key,agent_id,strategy_key,current_trust_stage,
            proposed_trust_stage,sample_count,positive_count,neutral_count,negative_count,
            evidence_confidence,status,rationale,evidence_snapshot,condition_fingerprint,
            evidence_window_start,evidence_window_end,calculated_at,updated_at
        ) values (
            'agent',v_agent.slug,v_agent.id,null,v_current_stage,v_proposed_stage,
            v_sample,v_positive,v_neutral,v_negative,v_confidence,v_status,v_rationale,
            v_snapshot,v_fingerprint,v_start,now(),now(),now()
        )
        on conflict(target_type,target_key,condition_fingerprint) do nothing;
        if found then v_count:=v_count+1; end if;
    end loop;

    -- Strategy calibration uses measured outcomes since the last applied
    -- strategy calibration, not lifetime aggregates alone.
    for v_profile in
        select strategy_key,strategy_label,trust_stage,effectiveness_score,
               adjustment_score,confidence,last_outcome_at
        from public.innerme_intervention_strategy_profiles
        order by strategy_key
    loop
        select coalesce(max(applied_at),'epoch'::timestamptz)
        into v_checkpoint
        from public.innerme_trust_calibration_reviews
        where target_type='strategy' and target_key=v_profile.strategy_key and status='applied';

        select
            count(*) filter (where o.outcome_status in ('improved','unchanged','worsened'))::integer,
            count(*) filter (where o.outcome_status='improved')::integer,
            count(*) filter (where o.outcome_status='unchanged')::integer,
            count(*) filter (where o.outcome_status='worsened')::integer,
            max(coalesce(o.measured_at,o.updated_at))
        into v_sample,v_positive,v_neutral,v_negative,v_latest_evidence
        from public.innerme_intervention_outcomes o
        join public.innerme_incident_intervention_executions e on e.id=o.execution_id
        join public.innerme_incident_intervention_options io on io.id=e.option_id
        join public.innerme_incident_counterfactuals c on c.id=io.counterfactual_id
        where c.intervention_class=v_profile.strategy_key
          and o.outcome_measurement_status='measured'
          and o.outcome_status in ('improved','unchanged','worsened')
          and coalesce(o.measured_at,o.updated_at) > v_checkpoint;

        v_sample:=coalesce(v_sample,0);
        v_positive:=coalesce(v_positive,0);
        v_neutral:=coalesce(v_neutral,0);
        v_negative:=coalesce(v_negative,0);
        v_current_stage:=v_profile.trust_stage;
        v_proposed_stage:=v_current_stage;
        v_confidence:=case when v_sample>=8 then 'high'
                           when v_sample>=4 then 'medium'
                           when v_sample>0 then 'low'
                           else 'insufficient' end;

        if v_sample >= 5
           and v_positive::numeric / greatest(v_sample,1) >= 0.80
           and v_negative=0
           and v_current_stage < 3 then
            v_proposed_stage:=v_current_stage+1;
            v_status:='review_required';
            v_rationale:=format(
                'Strategy promotion candidate: %s of %s newly measured decisive outcomes improved, with no worsened outcomes. Approval raises the strategy trust stage and increases its maximum ranking adjustment, but never authorises action execution.',
                v_positive,v_sample
            );
        elsif v_sample >= 3
          and v_negative::numeric / greatest(v_sample,1) >= 0.34
          and v_current_stage > 1 then
            v_proposed_stage:=v_current_stage-1;
            v_status:='review_required';
            v_rationale:=format(
                'Strategy reduction candidate: %s of %s newly measured decisive outcomes worsened. Review before lowering the strategy trust stage.',
                v_negative,v_sample
            );
        elsif v_sample < 3 then
            v_status:='insufficient_evidence';
            v_rationale:=format(
                'No strategy trust-stage change proposed. Only %s newly measured decisive outcome(s) are available since the last applied calibration.',
                v_sample
            );
        else
            v_status:='no_change';
            v_rationale:='Strategy trust stage retained because observed outcome rates do not meet the promotion or reduction threshold.';
        end if;

        v_start:=case when v_checkpoint='epoch'::timestamptz then v_latest_evidence else v_checkpoint end;
        v_fingerprint:=md5(
            'strategy|'||v_profile.strategy_key||'|'||v_current_stage::text||'|'||
            v_sample::text||'|'||v_positive::text||'|'||v_neutral::text||'|'||
            v_negative::text||'|'||coalesce(v_latest_evidence::text,'none')||'|'||
            v_checkpoint::text
        );
        v_snapshot:=jsonb_build_object(
            'evidence_source','innerme_intervention_outcomes',
            'strategy_key',v_profile.strategy_key,
            'eligible_sample_count',v_sample,
            'improved_count',v_positive,
            'unchanged_count',v_neutral,
            'worsened_count',v_negative,
            'lifetime_effectiveness_score',v_profile.effectiveness_score,
            'lifetime_profile_confidence',v_profile.confidence,
            'checkpoint',v_checkpoint,
            'latest_measured_outcome_at',v_latest_evidence,
            'execution_authority_granted',false
        );

        insert into public.innerme_trust_calibration_reviews(
            target_type,target_key,agent_id,strategy_key,current_trust_stage,
            proposed_trust_stage,sample_count,positive_count,neutral_count,negative_count,
            evidence_confidence,status,rationale,evidence_snapshot,condition_fingerprint,
            evidence_window_start,evidence_window_end,calculated_at,updated_at
        ) values (
            'strategy',v_profile.strategy_key,null,v_profile.strategy_key,v_current_stage,
            v_proposed_stage,v_sample,v_positive,v_neutral,v_negative,v_confidence,v_status,
            v_rationale,v_snapshot,v_fingerprint,v_start,now(),now(),now()
        )
        on conflict(target_type,target_key,condition_fingerprint) do nothing;
        if found then v_count:=v_count+1; end if;
    end loop;

    -- Stage 1 has the smallest influence on ranking; Stage 3 the largest
    -- bounded influence. The Phase 26 +/-15 ceiling remains unchanged.
    update public.innerme_intervention_strategy_profiles
    set adjustment_score=greatest(
            -case trust_stage when 1 then 5 when 2 then 10 else 15 end,
            least(case trust_stage when 1 then 5 when 2 then 10 else 15 end,adjustment_score)
        ),
        updated_at=now()
    where adjustment_score < -case trust_stage when 1 then 5 when 2 then 10 else 15 end
       or adjustment_score > case trust_stage when 1 then 5 when 2 then 10 else 15 end;

    return v_count;
end;
$$;

create or replace function public.review_innerme_trust_calibration(
    p_calibration_id uuid,
    p_decision text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_review public.innerme_trust_calibration_reviews%rowtype;
    v_current_stage integer;
begin
    if auth.uid() is null or not public.is_swayphics_admin() then
        raise exception 'Swayphics admin access required.';
    end if;
    if p_decision is null or p_decision not in ('approve','reject') then
        raise exception 'Decision must be approve or reject.';
    end if;

    select * into v_review
    from public.innerme_trust_calibration_reviews
    where id=p_calibration_id
    for update;

    if not found then
        raise exception 'Trust calibration review not found.';
    end if;
    if v_review.status <> 'review_required' then
        raise exception 'Only pending trust calibration proposals can be reviewed.';
    end if;

    if p_decision='reject' then
        update public.innerme_trust_calibration_reviews
        set status='rejected',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
        where id=p_calibration_id;
        return true;
    end if;

    if exists (
        select 1 from public.innerme_trust_calibration_reviews newer
        where newer.target_type=v_review.target_type
          and newer.target_key=v_review.target_key
          and newer.calculated_at > v_review.calculated_at
    ) then
        raise exception 'A newer trust proposal exists. Refresh calibration and review the latest proposal.';
    end if;

    if v_review.target_type='agent' then
        select trust_stage into v_current_stage
        from public.innerme_agents
        where id=v_review.agent_id and status='active'
        for update;

        if not found or v_current_stage <> v_review.current_trust_stage then
            raise exception 'The agent trust stage changed after this proposal was generated.';
        end if;

        update public.innerme_agents
        set trust_stage=v_review.proposed_trust_stage,updated_at=now()
        where id=v_review.agent_id;
        -- Deliberately do not change permissions or execute any agent action.
    else
        select trust_stage into v_current_stage
        from public.innerme_intervention_strategy_profiles
        where strategy_key=v_review.strategy_key
        for update;

        if not found or v_current_stage <> v_review.current_trust_stage then
            raise exception 'The strategy trust stage changed after this proposal was generated.';
        end if;

        update public.innerme_intervention_strategy_profiles
        set trust_stage=v_review.proposed_trust_stage,
            adjustment_score=greatest(
                -case v_review.proposed_trust_stage when 1 then 5 when 2 then 10 else 15 end,
                least(case v_review.proposed_trust_stage when 1 then 5 when 2 then 10 else 15 end,adjustment_score)
            ),
            updated_at=now()
        where strategy_key=v_review.strategy_key;
        -- Strategy trust influences ranking only; execution still requires
        -- the established separate administrator-approved intervention gate.
    end if;

    update public.innerme_trust_calibration_reviews
    set status='applied',reviewed_by=auth.uid(),reviewed_at=now(),
        applied_at=now(),updated_at=now()
    where id=p_calibration_id;
    return true;
end;
$$;

revoke all on function public.record_innerme_agent_trust_evidence(uuid,text,uuid,text,text,integer,text,jsonb) from public, anon;
revoke all on function public.review_innerme_agent_trust_evidence(uuid,text) from public, anon;
revoke all on function public.refresh_innerme_agent_trust_calibration() from public, anon;
revoke all on function public.review_innerme_trust_calibration(uuid,text) from public, anon;
grant execute on function public.record_innerme_agent_trust_evidence(uuid,text,uuid,text,text,integer,text,jsonb) to authenticated;
grant execute on function public.review_innerme_agent_trust_evidence(uuid,text) to authenticated;
grant execute on function public.refresh_innerme_agent_trust_calibration() to authenticated;
grant execute on function public.review_innerme_trust_calibration(uuid,text) to authenticated;

create or replace function public.run_innerme_incident_intelligence()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare v_count integer:=0;
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
    v_count:=v_count+coalesce(public.refresh_innerme_agent_trust_calibration(),0);
    v_count:=v_count+coalesce(public.refresh_innerme_incident_intervention_selection(),0);
    v_count:=v_count+coalesce(public.refresh_innerme_agent_coordination(),0);
    v_count:=v_count+coalesce(public.refresh_innerme_predictive_business_intelligence(),0);
    return v_count;
end;
$$;

revoke all on function public.run_innerme_incident_intelligence() from public, anon;
grant execute on function public.run_innerme_incident_intelligence() to authenticated;

notify pgrst,'reload schema';
