-- InnerMe Phase 27: Multi-Agent Coordination
-- Governed coordination of specialist InnerMe agents. Coordination creates
-- auditable team plans and handoffs only. It never grants permissions or
-- executes external actions automatically.

create table if not exists public.innerme_agent_coordination_runs (
    id uuid primary key default gen_random_uuid(),
    run_key text not null unique,
    target_type text not null check (target_type in ('incident','strategic_recommendation')),
    target_id uuid not null,
    objective text not null,
    rationale text not null,
    coordination_mode text not null default 'sequential' check (coordination_mode in ('sequential','parallel_then_review')),
    status text not null default 'proposed' check (status in ('proposed','approved','active','completed','blocked','cancelled')),
    conflict_status text not null default 'none' check (conflict_status in ('none','review_required','blocked')),
    conflict_notes jsonb not null default '[]'::jsonb,
    agent_count integer not null default 0 check (agent_count between 0 and 8),
    condition_fingerprint text not null,
    approval_required boolean not null default true,
    approved_by uuid references auth.users(id) on delete set null,
    approved_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(target_type,target_id,condition_fingerprint)
);

create table if not exists public.innerme_agent_coordination_assignments (
    id uuid primary key default gen_random_uuid(),
    run_id uuid not null references public.innerme_agent_coordination_runs(id) on delete cascade,
    agent_id uuid not null references public.innerme_agents(id) on delete restrict,
    assignment_role text not null check (assignment_role in ('lead','specialist','reviewer')),
    sequence_rank integer not null check (sequence_rank between 1 and 8),
    objective text not null,
    required_inputs jsonb not null default '[]'::jsonb,
    expected_output text not null,
    trust_stage integer not null check (trust_stage between 1 and 3),
    permission_snapshot jsonb not null default '[]'::jsonb,
    status text not null default 'pending' check (status in ('pending','ready','completed','skipped','blocked')),
    depends_on_assignment_id uuid references public.innerme_agent_coordination_assignments(id) on delete set null,
    handoff_required boolean not null default true,
    output jsonb,
    reviewed_by uuid references auth.users(id) on delete set null,
    reviewed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(run_id,sequence_rank),
    unique(run_id,agent_id)
);

create table if not exists public.innerme_agent_coordination_handoffs (
    id uuid primary key default gen_random_uuid(),
    run_id uuid not null references public.innerme_agent_coordination_runs(id) on delete cascade,
    from_assignment_id uuid not null references public.innerme_agent_coordination_assignments(id) on delete cascade,
    to_assignment_id uuid not null references public.innerme_agent_coordination_assignments(id) on delete cascade,
    sequence_rank integer not null check (sequence_rank between 1 and 8),
    status text not null default 'pending' check (status in ('pending','ready','acknowledged','rejected')),
    handoff_contract text not null,
    context jsonb not null default '{}'::jsonb,
    acknowledged_by uuid references auth.users(id) on delete set null,
    acknowledged_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(run_id,from_assignment_id,to_assignment_id)
);

create table if not exists public.innerme_agent_coordination_conflicts (
    id uuid primary key default gen_random_uuid(),
    run_id uuid not null references public.innerme_agent_coordination_runs(id) on delete cascade,
    conflict_key text not null unique,
    conflict_type text not null check (conflict_type in ('role_overlap','permission_boundary','recommendation_tension','evidence_gap','execution_gate')),
    severity text not null check (severity in ('low','medium','high','critical')),
    status text not null default 'open' check (status in ('open','resolved','ignored')),
    description text not null,
    resolution_gate text not null,
    evidence jsonb not null default '{}'::jsonb,
    resolved_by uuid references auth.users(id) on delete set null,
    resolved_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_innerme_agent_coordination_runs_target on public.innerme_agent_coordination_runs(target_type,target_id,status,updated_at desc);
create index if not exists idx_innerme_agent_coordination_runs_status on public.innerme_agent_coordination_runs(status,conflict_status,updated_at desc);
create index if not exists idx_innerme_agent_coordination_runs_approved_by on public.innerme_agent_coordination_runs(approved_by);
create index if not exists idx_innerme_agent_coordination_assignments_run on public.innerme_agent_coordination_assignments(run_id,sequence_rank);
create index if not exists idx_innerme_agent_coordination_assignments_agent on public.innerme_agent_coordination_assignments(agent_id,status,updated_at desc);
create index if not exists idx_innerme_agent_coordination_assignments_depends_on on public.innerme_agent_coordination_assignments(depends_on_assignment_id);
create index if not exists idx_innerme_agent_coordination_assignments_reviewed_by on public.innerme_agent_coordination_assignments(reviewed_by);
create index if not exists idx_innerme_agent_coordination_handoffs_run on public.innerme_agent_coordination_handoffs(run_id,sequence_rank,status);
create index if not exists idx_innerme_agent_coordination_handoffs_from on public.innerme_agent_coordination_handoffs(from_assignment_id);
create index if not exists idx_innerme_agent_coordination_handoffs_to on public.innerme_agent_coordination_handoffs(to_assignment_id);
create index if not exists idx_innerme_agent_coordination_handoffs_acknowledged_by on public.innerme_agent_coordination_handoffs(acknowledged_by);
create index if not exists idx_innerme_agent_coordination_conflicts_run on public.innerme_agent_coordination_conflicts(run_id,status,severity);
create index if not exists idx_innerme_agent_coordination_conflicts_resolved_by on public.innerme_agent_coordination_conflicts(resolved_by);

alter table public.innerme_agent_coordination_runs enable row level security;
alter table public.innerme_agent_coordination_assignments enable row level security;
alter table public.innerme_agent_coordination_handoffs enable row level security;
alter table public.innerme_agent_coordination_conflicts enable row level security;

drop policy if exists "InnerMe coordination runs admins can manage" on public.innerme_agent_coordination_runs;
create policy "InnerMe coordination runs admins can manage"
on public.innerme_agent_coordination_runs for all to authenticated
using ((select public.is_swayphics_admin()))
with check ((select public.is_swayphics_admin()));

drop policy if exists "InnerMe coordination assignments admins can manage" on public.innerme_agent_coordination_assignments;
create policy "InnerMe coordination assignments admins can manage"
on public.innerme_agent_coordination_assignments for all to authenticated
using ((select public.is_swayphics_admin()))
with check ((select public.is_swayphics_admin()));

drop policy if exists "InnerMe coordination handoffs admins can manage" on public.innerme_agent_coordination_handoffs;
create policy "InnerMe coordination handoffs admins can manage"
on public.innerme_agent_coordination_handoffs for all to authenticated
using ((select public.is_swayphics_admin()))
with check ((select public.is_swayphics_admin()));

drop policy if exists "InnerMe coordination conflicts admins can manage" on public.innerme_agent_coordination_conflicts;
create policy "InnerMe coordination conflicts admins can manage"
on public.innerme_agent_coordination_conflicts for all to authenticated
using ((select public.is_swayphics_admin()))
with check ((select public.is_swayphics_admin()));

revoke all on table public.innerme_agent_coordination_runs from anon;
revoke all on table public.innerme_agent_coordination_assignments from anon;
revoke all on table public.innerme_agent_coordination_handoffs from anon;
revoke all on table public.innerme_agent_coordination_conflicts from anon;

grant select,insert,update on table public.innerme_agent_coordination_runs to authenticated;
grant select,insert,update on table public.innerme_agent_coordination_assignments to authenticated;
grant select,insert,update on table public.innerme_agent_coordination_handoffs to authenticated;
grant select,insert,update on table public.innerme_agent_coordination_conflicts to authenticated;

grant all on table public.innerme_agent_coordination_runs to service_role;
grant all on table public.innerme_agent_coordination_assignments to service_role;
grant all on table public.innerme_agent_coordination_handoffs to service_role;
grant all on table public.innerme_agent_coordination_conflicts to service_role;

CREATE OR REPLACE FUNCTION public.refresh_innerme_agent_coordination()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    v_count integer := 0;
    v_run_id uuid;
    v_prev_assignment_id uuid;
    v_assignment_id uuid;
    v_reviewer_assignment_id uuid;
    v_rank integer;
    v_slug text;
    v_role text;
    v_objective text;
    v_expected text;
    v_run_key text;
    v_conflict_status text;
    v_conflict_notes jsonb;
    v_slugs text[];
    v_target_id uuid;
    v_target_type text;
    v_fingerprint text;
    v_review_id uuid;
    v_rec record;
    v_agent public.innerme_agents%rowtype;
    v_assignments uuid[] := '{}';
    r public.innerme_operational_incidents%rowtype;
begin
    if current_user <> 'postgres' and not public.is_swayphics_admin() then
        raise exception 'Swayphics admin access required.';
    end if;

    for r in
        select *
        from public.innerme_operational_incidents
        where status in ('open','acknowledged')
        order by case severity when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,last_detected_at desc
    loop
        v_target_type := 'incident';
        v_target_id := r.id;
        v_fingerprint := r.condition_fingerprint;
        v_run_key := 'incident-coordination:'||r.id::text||':'||r.condition_fingerprint;

        if exists (
            select 1
            from public.innerme_agent_coordination_runs
            where target_type=v_target_type and target_id=v_target_id and condition_fingerprint=v_fingerprint
        ) then
            continue;
        end if;

        v_slugs := case r.incident_type
            when 'sales_compound' then array['sales-outreach-operator','revenue-operator','analytics-operator']
            when 'sales_delivery_compound' then array['sales-outreach-operator','delivery-operations-operator','analytics-operator']
            when 'cash_delivery_compound' then array['revenue-operator','delivery-operations-operator','analytics-operator']
            when 'automation_compound' then array['delivery-operations-operator','analytics-operator','client-success-operator']
            when 'knowledge_strategy_compound' then array['analytics-operator','growth-operator','revenue-operator']
            when 'cross_domain_pressure' then array['analytics-operator','revenue-operator','delivery-operations-operator','client-success-operator','growth-operator']
            else array['analytics-operator']
        end;

        v_conflict_status := case
            when r.severity in ('critical','high') or r.incident_type='automation_compound' then 'review_required'
            else 'none'
        end;

        v_conflict_notes := case
            when v_conflict_status='review_required' then
                jsonb_build_array(
                    'Multi-agent review is required before recommendations from this coordination run are treated as a combined decision.',
                    case when r.incident_type='automation_compound'
                        then 'Automation-related coordination cannot inherit execution authority from participating agents.'
                        else 'Severity requires explicit human review of the coordinated recommendation.'
                    end
                )
            else '[]'::jsonb
        end;

        insert into public.innerme_agent_coordination_runs(
            run_key,target_type,target_id,objective,rationale,coordination_mode,status,
            conflict_status,conflict_notes,agent_count,condition_fingerprint,approval_required
        ) values (
            v_run_key,v_target_type,v_target_id,
            'Coordinate specialist analysis of incident "'||r.title||'" without allowing any agent to exceed its registered permissions.',
            r.summary||' '||r.correlation_reason,
            case when cardinality(v_slugs)>3 then 'parallel_then_review' else 'sequential' end,
            'proposed',v_conflict_status,v_conflict_notes,cardinality(v_slugs),v_fingerprint,true
        ) returning id into v_run_id;

        v_prev_assignment_id := null;
        v_reviewer_assignment_id := null;
        v_rank := 0;
        v_assignments := '{}';

        foreach v_slug in array v_slugs loop
            select * into v_agent
            from public.innerme_agents
            where slug=v_slug and status='active'
            limit 1;

            if v_agent.id is null then
                continue;
            end if;

            v_rank:=v_rank+1;
            v_role:=case when v_rank=1 then 'lead'
                         when v_rank=cardinality(v_slugs) then 'reviewer'
                         else 'specialist' end;

            v_objective:=case v_agent.slug
                when 'analytics-operator' then 'Quantify the incident, separate observed facts from interpretation, and identify measurable signals for review.'
                when 'sales-outreach-operator' then 'Assess prospecting and follow-up conditions using recorded communication evidence only.'
                when 'revenue-operator' then 'Assess commercial and cash implications without conflating pipeline, collected cash or profit.'
                when 'delivery-operations-operator' then 'Assess operational workload, missed work and execution dependencies using current workspace evidence.'
                when 'client-success-operator' then 'Assess client trust, onboarding and retention implications without inventing client dissatisfaction.'
                when 'growth-operator' then 'Identify a measurable experiment or growth response where the evidence supports one.'
                when 'brand-copy-operator' then 'Assess any communication or positioning implications without inventing proof.'
                else 'Review the incident from the scope defined by the agent registry.'
            end;

            v_expected:=case v_role
                when 'lead' then 'Structured incident brief with facts, uncertainties, measurable signals and questions for specialists.'
                when 'reviewer' then 'Integrated review of specialist outputs, unresolved conflicts and a bounded recommendation for administrator review.'
                else 'Specialist findings with evidence, constraints, uncertainties and explicit handoff points.'
            end;

            insert into public.innerme_agent_coordination_assignments(
                run_id,agent_id,assignment_role,sequence_rank,objective,required_inputs,
                expected_output,trust_stage,permission_snapshot,status,depends_on_assignment_id,handoff_required
            ) values (
                v_run_id,v_agent.id,v_role,v_rank,v_objective,
                jsonb_build_array(
                    jsonb_build_object('source','incident','incident_id',r.id,'condition_fingerprint',r.condition_fingerprint),
                    jsonb_build_object('agent_permissions',v_agent.permissions,'agent_trust_stage',v_agent.trust_stage)
                ),
                v_expected,v_agent.trust_stage,v_agent.permissions,'pending',
                case when cardinality(v_slugs)<=3 then v_prev_assignment_id else null end,
                v_role <> 'reviewer'
            ) returning id into v_assignment_id;

            v_assignments:=array_append(v_assignments,v_assignment_id);

            if v_role='reviewer' then
                v_reviewer_assignment_id:=v_assignment_id;
            end if;

            if cardinality(v_slugs)<=3 then
                if v_prev_assignment_id is not null then
                    insert into public.innerme_agent_coordination_handoffs(
                        run_id,from_assignment_id,to_assignment_id,sequence_rank,status,handoff_contract,context
                    ) values (
                        v_run_id,v_prev_assignment_id,v_assignment_id,v_rank-1,'pending',
                        'Pass only evidence, calculations, uncertainties, constraints and unanswered questions. Do not transfer authority or credentials.',
                        jsonb_build_object('condition_fingerprint',r.condition_fingerprint,'handoff_sequence',v_rank-1)
                    );
                end if;
                v_prev_assignment_id:=v_assignment_id;
            end if;
        end loop;

        if cardinality(v_slugs)>3 and v_reviewer_assignment_id is not null then
            v_rank:=0;
            foreach v_assignment_id in array v_assignments loop
                select assignment_role,sequence_rank
                into v_role,v_rank
                from public.innerme_agent_coordination_assignments
                where id=v_assignment_id;

                if v_role <> 'reviewer' then
                    insert into public.innerme_agent_coordination_handoffs(
                        run_id,from_assignment_id,to_assignment_id,sequence_rank,status,handoff_contract,context
                    ) values (
                        v_run_id,v_assignment_id,v_reviewer_assignment_id,v_rank,'pending',
                        'Pass specialist evidence, calculations, uncertainties and unresolved tensions to the reviewer. Do not transfer authority or credentials.',
                        jsonb_build_object('condition_fingerprint',r.condition_fingerprint,'parallel_review',true)
                    )
                    on conflict(run_id,from_assignment_id,to_assignment_id) do nothing;
                end if;
            end loop;
        end if;

        if v_conflict_status='review_required' then
            insert into public.innerme_agent_coordination_conflicts(
                run_id,conflict_key,conflict_type,severity,status,description,resolution_gate,evidence
            ) values (
                v_run_id,
                'coordination-review:'||v_run_id::text,
                case when r.incident_type='automation_compound' then 'execution_gate' else 'recommendation_tension' end,
                r.severity,
                'open',
                case when r.incident_type='automation_compound'
                    then 'Specialist agents may analyse an automation incident, but execution authority remains outside the agent coordination layer.'
                    else 'Multiple specialist perspectives must be reconciled by the lead/reviewer before a combined recommendation is accepted.'
                end,
                'Administrator review of the coordinated recommendation is required.',
                jsonb_build_object('incident_id',r.id,'incident_type',r.incident_type,'severity',r.severity)
            )
            on conflict(conflict_key) do nothing;
        end if;

        v_count:=v_count+1;
    end loop;

    for v_rec in
        select *
        from public.innerme_strategic_recommendations
        where status='promoted'
        order by updated_at desc
        limit 25
    loop
        v_target_type:='strategic_recommendation';
        v_target_id:=v_rec.id;
        v_fingerprint:='strategic:'||v_rec.recommendation_key||':'||coalesce(v_rec.updated_at::text,'');
        v_run_key:='strategic-coordination:'||v_rec.id::text;

        if exists(select 1 from public.innerme_agent_coordination_runs where run_key=v_run_key) then continue; end if;

        v_slugs:=case
            when lower(v_rec.domains::text) like '%sales%' then array['sales-outreach-operator','revenue-operator','analytics-operator']
            when lower(v_rec.domains::text) like '%client%' then array['client-success-operator','growth-operator','analytics-operator']
            when lower(v_rec.domains::text) like '%delivery%' then array['delivery-operations-operator','analytics-operator','revenue-operator']
            else array['analytics-operator','growth-operator']
        end;

        insert into public.innerme_agent_coordination_runs(
            run_key,target_type,target_id,objective,rationale,coordination_mode,status,
            conflict_status,conflict_notes,agent_count,condition_fingerprint,approval_required
        ) values (
            v_run_key,v_target_type,v_target_id,
            'Coordinate specialist review of promoted strategic recommendation "'||v_rec.title||'".',
            v_rec.rationale,'parallel_then_review','proposed','review_required',
            jsonb_build_array('Strategic recommendations require coordinated review before any execution plan inherits the recommendation.'),
            cardinality(v_slugs),v_fingerprint,true
        ) returning id into v_run_id;

        v_rank:=0;
        v_reviewer_assignment_id:=null;
        v_assignments:='{}';

        foreach v_slug in array v_slugs loop
            select * into v_agent from public.innerme_agents where slug=v_slug and status='active' limit 1;
            if v_agent.id is null then continue; end if;

            v_rank:=v_rank+1;
            v_role:=case when v_rank=1 then 'lead'
                         when v_rank=cardinality(v_slugs) then 'reviewer'
                         else 'specialist' end;

            insert into public.innerme_agent_coordination_assignments(
                run_id,agent_id,assignment_role,sequence_rank,objective,required_inputs,
                expected_output,trust_stage,permission_snapshot,status,depends_on_assignment_id,handoff_required
            ) values (
                v_run_id,v_agent.id,v_role,v_rank,
                'Review the strategic recommendation from the specialist perspective defined in the agent registry.',
                jsonb_build_array(
                    jsonb_build_object('source','strategic_recommendation','recommendation_id',v_rec.id),
                    jsonb_build_object('agent_permissions',v_agent.permissions,'agent_trust_stage',v_agent.trust_stage)
                ),
                case when v_role='reviewer'
                    then 'Integrated strategic review with conflicts, assumptions and explicit decision gate.'
                    else 'Specialist assessment with evidence, constraints and measurable implications.'
                end,
                v_agent.trust_stage,v_agent.permissions,'pending',null,v_role<>'reviewer'
            ) returning id into v_assignment_id;

            v_assignments:=array_append(v_assignments,v_assignment_id);
            if v_role='reviewer' then v_reviewer_assignment_id:=v_assignment_id; end if;
        end loop;

        if v_reviewer_assignment_id is not null then
            foreach v_assignment_id in array v_assignments loop
                select assignment_role,sequence_rank into v_role,v_rank
                from public.innerme_agent_coordination_assignments where id=v_assignment_id;
                if v_role <> 'reviewer' then
                    insert into public.innerme_agent_coordination_handoffs(
                        run_id,from_assignment_id,to_assignment_id,sequence_rank,status,handoff_contract,context
                    ) values (
                        v_run_id,v_assignment_id,v_reviewer_assignment_id,v_rank,'pending',
                        'Pass evidence and uncertainties only. Specialist outputs do not grant execution authority.',
                        jsonb_build_object('recommendation_id',v_rec.id,'parallel_review',true)
                    ) on conflict(run_id,from_assignment_id,to_assignment_id) do nothing;
                end if;
            end loop;
        end if;

        v_count:=v_count+1;
    end loop;

    return v_count;
end;
$function$


CREATE OR REPLACE FUNCTION public.review_innerme_agent_coordination_conflict(p_conflict_id uuid, p_resolution text)
 RETURNS innerme_agent_coordination_conflicts
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    v_conflict public.innerme_agent_coordination_conflicts%rowtype;
begin
    if not public.is_swayphics_admin() then
        raise exception 'Only active Swayphics admins can resolve coordination conflicts.';
    end if;

    if p_resolution not in ('resolved','ignored') then
        raise exception 'Resolution must be resolved or ignored.';
    end if;

    update public.innerme_agent_coordination_conflicts
    set status=p_resolution,
        resolved_by=auth.uid(),
        resolved_at=now(),
        updated_at=now()
    where id=p_conflict_id
    returning * into v_conflict;

    if not found then
        raise exception 'The coordination conflict could not be found.';
    end if;

    if p_resolution='resolved' then
        update public.innerme_agent_coordination_runs r
        set conflict_status='none',
            updated_at=now()
        where r.id=v_conflict.run_id
          and not exists (
              select 1
              from public.innerme_agent_coordination_conflicts c
              where c.run_id=r.id and c.status='open'
          );
    end if;

    return v_conflict;
end;
$function$


CREATE OR REPLACE FUNCTION public.review_innerme_agent_coordination_handoff(p_handoff_id uuid, p_decision text)
 RETURNS innerme_agent_coordination_handoffs
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    v_handoff public.innerme_agent_coordination_handoffs%rowtype;
begin
    if not public.is_swayphics_admin() then
        raise exception 'Only active Swayphics admins can review coordination handoffs.';
    end if;

    if p_decision not in ('acknowledged','rejected') then
        raise exception 'Decision must be acknowledged or rejected.';
    end if;

    select * into v_handoff
    from public.innerme_agent_coordination_handoffs
    where id=p_handoff_id
    for update;

    if not found then
        raise exception 'The coordination handoff could not be found.';
    end if;

    if v_handoff.status not in ('pending','ready') then
        return v_handoff;
    end if;

    update public.innerme_agent_coordination_handoffs
    set status=p_decision,
        acknowledged_by=auth.uid(),
        acknowledged_at=now(),
        updated_at=now()
    where id=p_handoff_id
    returning * into v_handoff;

    if p_decision='acknowledged' then
        update public.innerme_agent_coordination_assignments
        set status='completed',
            reviewed_by=auth.uid(),
            reviewed_at=now(),
            updated_at=now()
        where id=v_handoff.from_assignment_id
          and status in ('ready','pending');

        update public.innerme_agent_coordination_assignments
        set status='ready',
            updated_at=now()
        where id=v_handoff.to_assignment_id
          and status='pending';
    else
        update public.innerme_agent_coordination_assignments
        set status='blocked',
            updated_at=now()
        where id=v_handoff.to_assignment_id
          and status='pending';
    end if;

    return v_handoff;
end;
$function$


CREATE OR REPLACE FUNCTION public.review_innerme_agent_coordination_run(p_run_id uuid, p_decision text)
 RETURNS innerme_agent_coordination_runs
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    v_run public.innerme_agent_coordination_runs%rowtype;
begin
    if not public.is_swayphics_admin() then
        raise exception 'Only active Swayphics admins can review agent coordination runs.';
    end if;

    if p_decision not in ('approved','blocked','cancelled') then
        raise exception 'Decision must be approved, blocked or cancelled.';
    end if;

    select * into v_run
    from public.innerme_agent_coordination_runs
    where id=p_run_id
    for update;

    if not found then
        raise exception 'The agent coordination run could not be found.';
    end if;

    if v_run.status not in ('proposed','approved') then
        return v_run;
    end if;

    if p_decision='approved' then
        update public.innerme_agent_coordination_runs
        set status='active',
            approved_by=auth.uid(),
            approved_at=now(),
            updated_at=now()
        where id=p_run_id
        returning * into v_run;

        update public.innerme_agent_coordination_assignments
        set status=case when sequence_rank=1 then 'ready' else 'pending' end,
            updated_at=now()
        where run_id=p_run_id;
    else
        update public.innerme_agent_coordination_runs
        set status=p_decision,
            updated_at=now()
        where id=p_run_id
        returning * into v_run;

        update public.innerme_agent_coordination_assignments
        set status='blocked',
            updated_at=now()
        where run_id=p_run_id;
    end if;

    return v_run;
end;
$function$


CREATE OR REPLACE FUNCTION public.run_innerme_incident_intelligence()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
    v_count:=v_count+coalesce(public.refresh_innerme_incident_intervention_selection(),0);
    v_count:=v_count+coalesce(public.refresh_innerme_agent_coordination(),0);
    return v_count;
end;
$function$


revoke all on function public.refresh_innerme_agent_coordination() from public;
revoke all on function public.refresh_innerme_agent_coordination() from anon;
grant execute on function public.refresh_innerme_agent_coordination() to authenticated;

revoke all on function public.review_innerme_agent_coordination_run(uuid,text) from public;
revoke all on function public.review_innerme_agent_coordination_run(uuid,text) from anon;
grant execute on function public.review_innerme_agent_coordination_run(uuid,text) to authenticated;

revoke all on function public.review_innerme_agent_coordination_handoff(uuid,text) from public;
revoke all on function public.review_innerme_agent_coordination_handoff(uuid,text) from anon;
grant execute on function public.review_innerme_agent_coordination_handoff(uuid,text) to authenticated;

revoke all on function public.review_innerme_agent_coordination_conflict(uuid,text) from public;
revoke all on function public.review_innerme_agent_coordination_conflict(uuid,text) from anon;
grant execute on function public.review_innerme_agent_coordination_conflict(uuid,text) to authenticated;

revoke all on function public.run_innerme_incident_intelligence() from public;
revoke all on function public.run_innerme_incident_intelligence() from anon;
grant execute on function public.run_innerme_incident_intelligence() to authenticated;

notify pgrst,'reload schema';
