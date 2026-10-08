-- InnerMe Phase 28: Predictive Business Intelligence
-- Predictive outputs are evidence-aware projections, not promises.
-- Revenue, cash and delivery forecasts remain explicitly evidence-limited
-- until the workspace contains enough verified history.

create table if not exists public.innerme_predictive_forecasts (
    id uuid primary key default gen_random_uuid(),
    forecast_key text not null,
    forecast_type text not null check (forecast_type in ('pipeline_projection','lead_flow_projection','followup_load','revenue_conversion','cash_collection','delivery_load')),
    horizon_days integer not null check (horizon_days between 1 and 365),
    forecast_date date not null default current_date,
    status text not null check (status in ('forecast','insufficient_evidence')),
    confidence text not null check (confidence in ('high','medium','low')),
    unit text not null check (unit in ('zar','count','ratio','score')),
    baseline_value numeric,
    projected_value numeric,
    delta_value numeric,
    direction text check (direction in ('up','down','flat','unknown')),
    metric_label text not null,
    statement text not null,
    assumptions jsonb not null default '[]'::jsonb,
    evidence jsonb not null default '{}'::jsonb,
    evidence_window_start timestamptz,
    evidence_window_end timestamptz,
    horizon_start date not null,
    horizon_end date not null,
    verification_status text not null default 'pending'
        check (verification_status in ('pending','verified','expired')),
    actual_value numeric,
    forecast_error numeric,
    verified_at timestamptz,
    method text not null default 'deterministic_predictive_bi_v1',
    condition_fingerprint text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(forecast_key,horizon_days,forecast_date)
);

create index if not exists idx_innerme_predictive_forecasts_current
on public.innerme_predictive_forecasts(forecast_date desc,horizon_days,forecast_type);

create index if not exists idx_innerme_predictive_forecasts_status
on public.innerme_predictive_forecasts(status,confidence,updated_at desc);

create index if not exists idx_innerme_predictive_forecasts_verification
on public.innerme_predictive_forecasts(verification_status,horizon_end);

alter table public.innerme_predictive_forecasts enable row level security;

drop policy if exists "InnerMe predictive forecasts admins can manage"
on public.innerme_predictive_forecasts;
create policy "InnerMe predictive forecasts admins can manage"
on public.innerme_predictive_forecasts
for all to authenticated
using ((select public.is_swayphics_admin()))
with check ((select public.is_swayphics_admin()));

revoke all on table public.innerme_predictive_forecasts from anon;
grant select,insert,update on table public.innerme_predictive_forecasts to authenticated;
grant all on table public.innerme_predictive_forecasts to service_role;

-- The live function body is intentionally deterministic and uses only current
-- workspace records. It is defined in production through the Phase 28 rollout.
-- Recreate the function from the same production source when promoting this
-- migration into a separate database environment.

create or replace function public.refresh_innerme_predictive_business_intelligence()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_count integer:=0;
    v_today date:=current_date;
    v_now timestamptz:=now();
    v_horizon integer;
    v_min_created timestamptz;
    v_max_created timestamptz;
    v_age_days numeric;
    v_valued_leads integer;
    v_active_pipeline numeric;
    v_recent_pipeline numeric;
    v_recent_leads integer;
    v_daily_pipeline numeric;
    v_daily_leads numeric;
    v_upcoming_followups integer;
    v_overdue_followups integer;
    v_concentrated_value numeric;
    v_concentration_ratio numeric;
    v_quote_count integer;
    v_invoice_count integer;
    v_payment_count integer;
    v_task_count integer;
    v_confidence text;
    v_projection numeric;
    v_baseline numeric;
    v_delta numeric;
    v_direction text;
    v_fingerprint text;
    v_window_start timestamptz;
    v_statement text;
begin
    if current_user <> 'postgres' and not public.is_swayphics_admin() then
        raise exception 'Swayphics admin access required.';
    end if;

    select min(created_at),max(created_at),sum(coalesce(estimated_value,0))
    into v_min_created,v_max_created,v_active_pipeline
    from public.leads
    where status not in ('won','lost','closed','converted');

    v_valued_leads:=(
        select count(*)
        from public.leads
        where estimated_value is not null
          and status not in ('won','lost','closed','converted')
    );

    v_active_pipeline:=coalesce(v_active_pipeline,0);
    v_age_days:=greatest(1,coalesce(extract(epoch from (v_max_created-v_min_created))/86400,1));
    v_window_start:=v_now-interval '14 days';

    select coalesce(sum(coalesce(estimated_value,0)),0),count(*)
    into v_recent_pipeline,v_recent_leads
    from public.leads
    where created_at>=v_window_start
      and status not in ('won','lost','closed','converted');

    v_daily_pipeline:=v_recent_pipeline/14.0;
    v_daily_leads:=v_recent_leads/14.0;

    select count(*) into v_upcoming_followups
    from public.follow_ups
    where scheduled_for between v_today and (v_today+14)
      and status not in ('completed','cancelled');

    select count(*) into v_overdue_followups
    from public.follow_ups
    where scheduled_for<v_today
      and status not in ('completed','cancelled');

    select coalesce(sum(x.estimated_value),0)
    into v_concentrated_value
    from (
        select estimated_value
        from public.leads
        where estimated_value is not null
          and status not in ('won','lost','closed','converted')
        order by estimated_value desc
        limit 3
    ) x;

    v_concentration_ratio:=case
        when v_active_pipeline>0 then v_concentrated_value/v_active_pipeline
        else null
    end;

    select count(*) into v_quote_count from public.quotes;
    select count(*) into v_invoice_count from public.invoices where archived=false;
    select count(*) into v_payment_count from public.payments;
    select count(*) into v_task_count from public.tasks;

    foreach v_horizon in array array[7,30] loop
        v_projection:=v_active_pipeline+v_daily_pipeline*v_horizon;
        v_delta:=v_projection-v_active_pipeline;
        v_direction:=case when v_delta>0 then 'up' when v_delta<0 then 'down' else 'flat' end;
        v_confidence:=case
            when v_valued_leads>=7 and v_age_days>=7 then 'medium'
            when v_valued_leads>=3 and v_age_days>=7 then 'low'
            else 'low'
        end;
        v_fingerprint:=md5(
            'pipeline_projection|'||v_horizon::text||'|'||v_today::text||'|'||
            round(v_projection,2)::text||'|'||round(v_active_pipeline,2)::text||'|'||
            v_recent_leads::text||'|'||round(v_recent_pipeline,2)::text
        );

        insert into public.innerme_predictive_forecasts(
            forecast_key,forecast_type,horizon_days,forecast_date,status,confidence,unit,
            baseline_value,projected_value,delta_value,direction,metric_label,statement,
            assumptions,evidence,evidence_window_start,evidence_window_end,horizon_start,horizon_end,
            condition_fingerprint
        ) values (
            'active-pipeline-stock','pipeline_projection',v_horizon,v_today,
            'forecast',v_confidence,'zar',v_active_pipeline,v_projection,v_delta,v_direction,
            'Projected active pipeline stock',
            'Projected active pipeline stock if the recent 14-day lead-value creation pace continues. This is not a forecast of collected revenue.',
            jsonb_build_array(
                'Uses observed active lead estimated values created in the last 14 days.',
                'Assumes the recent lead-value creation pace continues unchanged.',
                'No conversion probability is assumed.'
            ),
            jsonb_build_object(
                'active_pipeline',v_active_pipeline,
                'recent_14d_pipeline_created',v_recent_pipeline,
                'recent_14d_leads_created',v_recent_leads,
                'daily_pipeline_creation_rate',v_daily_pipeline,
                'valued_active_leads',v_valued_leads,
                'observed_data_age_days',v_age_days,
                'concentration_top3_ratio',v_concentration_ratio
            ),
            v_window_start,v_now,v_today,v_today+v_horizon,v_fingerprint
        )
        on conflict(forecast_key,horizon_days,forecast_date) do update set
            status=excluded.status,confidence=excluded.confidence,
            baseline_value=excluded.baseline_value,projected_value=excluded.projected_value,
            delta_value=excluded.delta_value,direction=excluded.direction,
            metric_label=excluded.metric_label,statement=excluded.statement,
            assumptions=excluded.assumptions,evidence=excluded.evidence,
            evidence_window_start=excluded.evidence_window_start,evidence_window_end=excluded.evidence_window_end,
            horizon_start=excluded.horizon_start,horizon_end=excluded.horizon_end,
            condition_fingerprint=excluded.condition_fingerprint,updated_at=v_now;

        v_count:=v_count+1;
    end loop;

    foreach v_horizon in array array[7,30] loop
        v_projection:=v_daily_leads*v_horizon;
        v_baseline:=v_projection;
        v_delta:=0;
        v_direction:='flat';
        v_confidence:=case when v_recent_leads>=5 and v_age_days>=7 then 'medium' else 'low' end;
        v_fingerprint:=md5(
            'lead_flow_projection|'||v_horizon::text||'|'||v_today::text||'|'||
            v_recent_leads::text||'|'||round(v_projection,2)::text
        );

        insert into public.innerme_predictive_forecasts(
            forecast_key,forecast_type,horizon_days,forecast_date,status,confidence,unit,
            baseline_value,projected_value,delta_value,direction,metric_label,statement,
            assumptions,evidence,evidence_window_start,evidence_window_end,horizon_start,horizon_end,
            condition_fingerprint
        ) values (
            'new-lead-volume','lead_flow_projection',v_horizon,v_today,
            'forecast',v_confidence,'count',
            v_baseline,v_projection,v_delta,v_direction,
            'Projected new leads',
            'Projected new-lead volume for the horizon at the observed 14-day lead creation rate. This is a rate-based projection, not a conversion forecast.',
            jsonb_build_array(
                'Uses the observed number of leads created in the last 14 days.',
                'Assumes the current lead-creation rate continues.',
                'Does not predict lead quality or conversion.'
            ),
            jsonb_build_object(
                'recent_14d_leads_created',v_recent_leads,
                'daily_lead_creation_rate',v_daily_leads,
                'projected_horizon_leads',v_projection,
                'observed_data_age_days',v_age_days
            ),
            v_window_start,v_now,v_today,v_today+v_horizon,v_fingerprint
        )
        on conflict(forecast_key,horizon_days,forecast_date) do update set
            status=excluded.status,confidence=excluded.confidence,
            baseline_value=excluded.baseline_value,projected_value=excluded.projected_value,
            delta_value=excluded.delta_value,direction=excluded.direction,
            statement=excluded.statement,assumptions=excluded.assumptions,evidence=excluded.evidence,
            evidence_window_start=excluded.evidence_window_start,evidence_window_end=excluded.evidence_window_end,
            horizon_start=excluded.horizon_start,horizon_end=excluded.horizon_end,
            condition_fingerprint=excluded.condition_fingerprint,updated_at=v_now;

        v_count:=v_count+1;
    end loop;

    v_fingerprint:=md5(
        'followup_load|14|'||v_today::text||'|'||
        v_upcoming_followups::text||'|'||v_overdue_followups::text
    );

    insert into public.innerme_predictive_forecasts(
        forecast_key,forecast_type,horizon_days,forecast_date,status,confidence,unit,
        baseline_value,projected_value,delta_value,direction,metric_label,statement,
        assumptions,evidence,evidence_window_start,evidence_window_end,horizon_start,horizon_end,
        condition_fingerprint
    ) values (
        'followup-workload','followup_load',14,v_today,'forecast','high','count',
        v_overdue_followups,v_upcoming_followups,
        v_upcoming_followups-v_overdue_followups,
        case when v_upcoming_followups>v_overdue_followups then 'up'
             when v_upcoming_followups<v_overdue_followups then 'down'
             else 'flat' end,
        'Forward follow-up workload',
        'Scheduled follow-ups due in the next 14 days, with overdue follow-ups shown separately in the evidence.',
        jsonb_build_array('Uses currently scheduled follow-ups only.'),
        jsonb_build_object('upcoming_14d',v_upcoming_followups,'overdue',v_overdue_followups),
        v_now,v_now,v_today,v_today+14,v_fingerprint
    )
    on conflict(forecast_key,horizon_days,forecast_date) do update set
        baseline_value=excluded.baseline_value,projected_value=excluded.projected_value,
        delta_value=excluded.delta_value,direction=excluded.direction,evidence=excluded.evidence,
        condition_fingerprint=excluded.condition_fingerprint,updated_at=v_now;

    v_count:=v_count+1;

    v_confidence:='low';
    v_statement:=case
        when v_quote_count=0 and not exists(select 1 from public.leads where status in ('won','lost')) then
            'Insufficient evidence for a 30-day realized-revenue forecast: there are no recorded quotes and no won/lost lead history from which to estimate conversion.'
        else
            'A realized-revenue forecast requires a longer verified conversion history than is currently available.'
    end;

    v_fingerprint:=md5('revenue_conversion|30|'||v_today::text||'|'||v_quote_count::text||'|'||v_valued_leads::text);

    insert into public.innerme_predictive_forecasts(
        forecast_key,forecast_type,horizon_days,forecast_date,status,confidence,unit,
        baseline_value,projected_value,delta_value,direction,metric_label,statement,
        assumptions,evidence,evidence_window_start,evidence_window_end,horizon_start,horizon_end,
        condition_fingerprint
    ) values (
        'realized-revenue','revenue_conversion',30,v_today,'insufficient_evidence',v_confidence,'zar',
        v_active_pipeline,null,null,'unknown','Realized revenue',v_statement,
        jsonb_build_array('Do not convert pipeline value into revenue without verified conversion evidence.'),
        jsonb_build_object(
            'active_pipeline',v_active_pipeline,'quote_count',v_quote_count,
            'invoice_count',v_invoice_count,'payment_count',v_payment_count,
            'valued_active_leads',v_valued_leads
        ),
        v_window_start,v_now,v_today,v_today+30,v_fingerprint
    )
    on conflict(forecast_key,horizon_days,forecast_date) do update set
        status=excluded.status,confidence=excluded.confidence,baseline_value=excluded.baseline_value,
        projected_value=null,delta_value=null,direction='unknown',statement=excluded.statement,
        assumptions=excluded.assumptions,evidence=excluded.evidence,
        evidence_window_start=excluded.evidence_window_start,evidence_window_end=excluded.evidence_window_end,
        horizon_start=excluded.horizon_start,horizon_end=excluded.horizon_end,
        condition_fingerprint=excluded.condition_fingerprint,updated_at=v_now;

    v_count:=v_count+1;

    v_fingerprint:=md5('cash_collection|30|'||v_today::text||'|'||v_invoice_count::text||'|'||v_payment_count::text);

    insert into public.innerme_predictive_forecasts(
        forecast_key,forecast_type,horizon_days,forecast_date,status,confidence,unit,
        baseline_value,projected_value,delta_value,direction,metric_label,statement,
        assumptions,evidence,evidence_window_start,evidence_window_end,horizon_start,horizon_end,
        condition_fingerprint
    ) values (
        'cash-collection','cash_collection',30,v_today,'insufficient_evidence','low','zar',
        0,null,null,'unknown','Collected cash',
        'Insufficient evidence for a cash-collection forecast because the workspace currently has no recorded invoices or payments.',
        jsonb_build_array('Require recorded invoices or payments before projecting collections.'),
        jsonb_build_object('invoice_count',v_invoice_count,'payment_count',v_payment_count),
        v_window_start,v_now,v_today,v_today+30,v_fingerprint
    )
    on conflict(forecast_key,horizon_days,forecast_date) do update set
        status=excluded.status,confidence=excluded.confidence,baseline_value=excluded.baseline_value,
        projected_value=null,delta_value=null,direction='unknown',statement=excluded.statement,
        assumptions=excluded.assumptions,evidence=excluded.evidence,
        evidence_window_start=excluded.evidence_window_start,evidence_window_end=excluded.evidence_window_end,
        horizon_start=excluded.horizon_start,horizon_end=excluded.horizon_end,
        condition_fingerprint=excluded.condition_fingerprint,updated_at=v_now;

    v_count:=v_count+1;

    v_fingerprint:=md5('delivery_load|14|'||v_today::text||'|'||v_task_count::text);

    insert into public.innerme_predictive_forecasts(
        forecast_key,forecast_type,horizon_days,forecast_date,status,confidence,unit,
        baseline_value,projected_value,delta_value,direction,metric_label,statement,
        assumptions,evidence,evidence_window_start,evidence_window_end,horizon_start,horizon_end,
        condition_fingerprint
    ) values (
        'delivery-load','delivery_load',14,v_today,'insufficient_evidence','low','count',
        v_task_count,null,null,'unknown','Delivery workload',
        'Insufficient evidence for a 14-day delivery-load forecast because there are currently no recorded tasks.',
        jsonb_build_array('Require task history before projecting delivery workload.'),
        jsonb_build_object('task_count',v_task_count),
        v_window_start,v_now,v_today,v_today+14,v_fingerprint
    )
    on conflict(forecast_key,horizon_days,forecast_date) do update set
        status=excluded.status,confidence=excluded.confidence,
        baseline_value=excluded.baseline_value,projected_value=null,
        delta_value=null,direction='unknown',statement=excluded.statement,
        assumptions=excluded.assumptions,evidence=excluded.evidence,
        evidence_window_start=excluded.evidence_window_start,evidence_window_end=excluded.evidence_window_end,
        horizon_start=excluded.horizon_start,horizon_end=excluded.horizon_end,
        condition_fingerprint=excluded.condition_fingerprint,updated_at=v_now;

    v_count:=v_count+1;
    return v_count;
end;
$$;

revoke all on function public.refresh_innerme_predictive_business_intelligence() from public;
revoke all on function public.refresh_innerme_predictive_business_intelligence() from anon;
grant execute on function public.refresh_innerme_predictive_business_intelligence() to authenticated;

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
    v_count:=v_count+coalesce(public.refresh_innerme_incident_intervention_selection(),0);
    v_count:=v_count+coalesce(public.refresh_innerme_agent_coordination(),0);
    v_count:=v_count+coalesce(public.refresh_innerme_predictive_business_intelligence(),0);
    return v_count;
end;
$$;

revoke all on function public.run_innerme_incident_intelligence() from public;
revoke all on function public.run_innerme_incident_intelligence() from anon;
grant execute on function public.run_innerme_incident_intelligence() to authenticated;

notify pgrst,'reload schema';
