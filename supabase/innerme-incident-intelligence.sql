-- InnerMe Phase 19: deterministic incident intelligence
-- Calculates reproducible impact, urgency, dependency and priority scores
-- for active operational incidents. No AI-generated root causes or business
-- workspace mutations are performed.

create table if not exists public.innerme_incident_intelligence (
    id uuid primary key default gen_random_uuid(),
    incident_id uuid not null unique references public.innerme_operational_incidents(id) on delete cascade,
    priority_score integer not null default 0 check (priority_score between 0 and 100),
    priority_band text not null default 'low' check (priority_band in ('critical','high','medium','low')),
    impact_score integer not null default 0 check (impact_score between 0 and 100),
    urgency_score integer not null default 0 check (urgency_score between 0 and 100),
    dependency_score integer not null default 0 check (dependency_score between 0 and 100),
    dominant_risk text not null,
    primary_dependency text not null,
    decision_required text not null,
    recommended_first_review text not null,
    reasoning text not null,
    evidence jsonb not null default '{}'::jsonb,
    condition_fingerprint text not null,
    generated_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_innerme_incident_intelligence_priority
    on public.innerme_incident_intelligence(priority_score desc, updated_at desc);

alter table public.innerme_incident_intelligence enable row level security;

drop policy if exists "InnerMe incident intelligence admins can manage"
    on public.innerme_incident_intelligence;
create policy "InnerMe incident intelligence admins can manage"
    on public.innerme_incident_intelligence
    for all to authenticated
    using ((select public.is_swayphics_admin()))
    with check ((select public.is_swayphics_admin()));

revoke all on table public.innerme_incident_intelligence from anon;
grant select, insert, update on table public.innerme_incident_intelligence to authenticated;

create or replace function public.refresh_innerme_incident_intelligence()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_count integer := 0;
    v_categories jsonb;
    v_category_count integer;
    v_source_count integer;
    v_days_overdue integer;
    v_age_hours integer;
    v_amount numeric;
    v_impact integer;
    v_urgency integer;
    v_dependency integer;
    v_priority integer;
    v_band text;
    v_dominant_risk text;
    v_primary_dependency text;
    v_decision_required text;
    v_first_review text;
    v_reasoning text;
    v_evidence jsonb;
    r public.innerme_operational_incidents%rowtype;
begin
    if current_user <> 'postgres' and not public.is_swayphics_admin() then
        raise exception 'Swayphics admin access required.';
    end if;

    for r in
        select *
        from public.innerme_operational_incidents
        where status in ('open','acknowledged')
        order by last_detected_at desc
    loop
        v_categories := case
            when jsonb_typeof(r.categories)='array' then r.categories
            else '[]'::jsonb
        end;
        v_category_count := jsonb_array_length(v_categories);
        v_source_count := greatest(r.source_count,0);

        select coalesce(max(
            case
                when (x->>'due_date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                    then greatest(0, current_date - ((x->>'due_date')::date))
                else 0
            end
        ),0)
        into v_days_overdue
        from jsonb_array_elements(
            case when jsonb_typeof(r.source_snapshot)='array'
                 then r.source_snapshot else '[]'::jsonb end
        ) x;

        select greatest(0, floor(extract(epoch from (now()-r.first_detected_at))/3600))::integer
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
            case when jsonb_typeof(r.source_snapshot)='array'
                 then r.source_snapshot else '[]'::jsonb end
        ) x;

        v_impact := least(100,
            case r.severity
                when 'critical' then 40
                when 'high' then 32
                when 'medium' then 22
                else 12
            end
            + least(20, v_source_count * 5)
            + case
                when v_category_count >= 3 then 15
                when v_category_count = 2 then 8
                else 0
              end
            + case
                when v_amount >= 10000 then 15
                when v_amount >= 5000 then 12
                when v_amount >= 1500 then 8
                when v_amount > 0 then 4
                else 0
              end
        );

        v_urgency := least(100,
            case
                when v_days_overdue >= 14 then 40
                when v_days_overdue >= 7 then 32
                when v_days_overdue >= 3 then 24
                when v_days_overdue >= 1 then 16
                else 8
            end
            + case
                when v_age_hours >= 72 then 25
                when v_age_hours >= 48 then 20
                when v_age_hours >= 24 then 15
                else 5
              end
            + case
                when r.severity='critical' then 25
                when r.severity='high' then 18
                when r.severity='medium' then 10
                else 5
              end
        );

        v_dependency := least(100,
            case
                when v_category_count >= 3 then 45
                when v_category_count = 2 then 30
                when v_category_count = 1 then 15
                else 5
            end
            + case
                when v_source_count >= 5 then 35
                when v_source_count >= 3 then 25
                when v_source_count >= 2 then 15
                else 5
              end
            + case
                when r.incident_type in ('automation_compound','cross_domain_pressure') then 20
                else 0
              end
        );

        v_priority := least(100, greatest(0,
            round(v_impact * 0.45 + v_urgency * 0.35 + v_dependency * 0.20)::integer
        ));

        v_band := case
            when v_priority >= 80 then 'critical'
            when v_priority >= 65 then 'high'
            when v_priority >= 45 then 'medium'
            else 'low'
        end;

        v_dominant_risk := case
            when v_categories ? 'cash' then 'Cash collection'
            when v_categories ? 'automation' then 'Execution integrity'
            when v_categories ? 'sales' then 'Sales conversion and follow-up'
            when v_categories ? 'delivery' then 'Delivery execution'
            when v_categories ? 'knowledge' then 'Knowledge validity'
            when v_categories ? 'strategy' then 'Strategic review backlog'
            else 'Operational continuity'
        end;

        v_primary_dependency := case
            when r.incident_type='automation_compound' then 'InnerMe action execution chain'
            when r.incident_type='cross_domain_pressure' then 'Cross-domain dependency load'
            when r.incident_type='cash_delivery_compound' then 'Client cash collection and delivery dependency'
            when r.incident_type='sales_delivery_compound' then 'Lead conversion and delivery dependency'
            when r.incident_type='sales_compound' then 'Lead contact and follow-up cadence'
            when r.incident_type='knowledge_strategy_compound' then 'Knowledge verification before strategic use'
            else 'The correlated operational conditions'
        end;

        v_decision_required := case
            when r.incident_type='automation_compound' then 'Decide whether the affected execution chain is safe to retry only after the failure and side effects are understood.'
            when r.incident_type='cash_delivery_compound' then 'Decide how to balance collection priority with delivery commitments for the same client.'
            when r.incident_type='sales_delivery_compound' then 'Decide whether the opportunity remains commercially active and which delivery dependency should be addressed first.'
            when r.incident_type='sales_compound' then 'Decide whether the lead remains worth pursuing and what the next justified contact should be.'
            when r.incident_type='knowledge_strategy_compound' then 'Decide whether verification debt must be cleared before strategic recommendations are relied upon.'
            when r.incident_type='cross_domain_pressure' then 'Decide which dependency carries the greatest business consequence before treating individual alerts separately.'
            else 'Determine the first admin-controlled response to the correlated incident.'
        end;

        v_first_review := case
            when r.incident_type='automation_compound' then 'Inspect the failed proposal error and its stalled execution record together.'
            when r.incident_type='cash_delivery_compound' then 'Review the outstanding invoice state and the overdue delivery work for this client together.'
            when r.incident_type='sales_delivery_compound' then 'Review the lead status, follow-up age and attached overdue tasks together.'
            when r.incident_type='sales_compound' then 'Review the last contact, current lead status and overdue follow-up date.'
            when r.incident_type='knowledge_strategy_compound' then 'Verify due knowledge first, then reassess the pending strategic recommendations.'
            when r.incident_type='cross_domain_pressure' then 'Open the highest-priority incident and inspect its underlying source records before acting.'
            else 'Open the incident source records and validate the correlated conditions.'
        end;

        v_reasoning :=
            'Deterministic priority score = 45% impact + 35% urgency + 20% dependency. ' ||
            'Impact=' || v_impact::text || ', urgency=' || v_urgency::text ||
            ', dependency=' || v_dependency::text || ', priority=' || v_priority::text || '. ' ||
            'The assessment uses only stored incident metadata and its source snapshot.';

        v_evidence := jsonb_build_object(
            'method','deterministic_v1',
            'severity',r.severity,
            'source_count',v_source_count,
            'category_count',v_category_count,
            'days_overdue',v_days_overdue,
            'age_hours',v_age_hours,
            'outstanding_amount',v_amount,
            'condition_fingerprint',r.condition_fingerprint,
            'components',jsonb_build_object(
                'impact',v_impact,
                'urgency',v_urgency,
                'dependency',v_dependency,
                'priority',v_priority
            )
        );

        insert into public.innerme_incident_intelligence(
            incident_id,priority_score,priority_band,impact_score,urgency_score,
            dependency_score,dominant_risk,primary_dependency,decision_required,
            recommended_first_review,reasoning,evidence,condition_fingerprint,
            generated_at,updated_at
        )
        values(
            r.id,v_priority,v_band,v_impact,v_urgency,v_dependency,
            v_dominant_risk,v_primary_dependency,v_decision_required,v_first_review,
            v_reasoning,v_evidence,r.condition_fingerprint,now(),now()
        )
        on conflict(incident_id) do update set
            priority_score=excluded.priority_score,
            priority_band=excluded.priority_band,
            impact_score=excluded.impact_score,
            urgency_score=excluded.urgency_score,
            dependency_score=excluded.dependency_score,
            dominant_risk=excluded.dominant_risk,
            primary_dependency=excluded.primary_dependency,
            decision_required=excluded.decision_required,
            recommended_first_review=excluded.recommended_first_review,
            reasoning=excluded.reasoning,
            evidence=excluded.evidence,
            condition_fingerprint=excluded.condition_fingerprint,
            generated_at=now(),
            updated_at=now();

        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$$;

revoke all on function public.refresh_innerme_incident_intelligence() from public;
revoke all on function public.refresh_innerme_incident_intelligence() from anon;
grant execute on function public.refresh_innerme_incident_intelligence() to authenticated;

notify pgrst, 'reload schema';



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

    return v_count;
end;
$$;

revoke all on function public.run_innerme_incident_intelligence() from public;
revoke all on function public.run_innerme_incident_intelligence() from anon;
grant execute on function public.run_innerme_incident_intelligence() to authenticated;

-- Create the 15-minute intelligence sweep. The DO block keeps this idempotent.
do $$
declare
    v_jobid bigint;
begin
    select jobid into v_jobid
    from cron.job
    where jobname='innerme-incident-intelligence'
    limit 1;

    if v_jobid is not null then
        perform cron.unschedule(v_jobid);
    end if;
end;
$$;

select cron.schedule(
    'innerme-incident-intelligence',
    '*/15 * * * *',
    'select public.run_innerme_incident_intelligence();'
);

notify pgrst, 'reload schema';
