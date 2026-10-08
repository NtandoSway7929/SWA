-- InnerMe Phase 18: operational incident correlation
-- Deterministically groups independent InnerMe monitoring exceptions into
-- auditable incidents. This phase does not mutate business workspace records.

create table if not exists public.innerme_operational_incidents (
    id uuid primary key default gen_random_uuid(),
    incident_key text not null unique,
    incident_type text not null,
    severity text not null check (severity in ('critical','high','medium','low')),
    status text not null default 'open' check (status in ('open','acknowledged','resolved','ignored')),
    title text not null,
    summary text not null,
    categories jsonb not null default '[]'::jsonb,
    source_count integer not null default 0 check (source_count >= 0),
    source_snapshot jsonb not null default '[]'::jsonb,
    correlation_reason text not null,
    recommended_response text not null,
    condition_fingerprint text not null,
    first_detected_at timestamptz not null default now(),
    last_detected_at timestamptz not null default now(),
    acknowledged_by uuid references auth.users(id) on delete set null,
    acknowledged_at timestamptz,
    resolved_by uuid references auth.users(id) on delete set null,
    resolved_at timestamptz,
    ignored_by uuid references auth.users(id) on delete set null,
    ignored_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_innerme_operational_incidents_status
    on public.innerme_operational_incidents(status, severity, last_detected_at desc);

create index if not exists idx_innerme_operational_incidents_type
    on public.innerme_operational_incidents(incident_type, last_detected_at desc);

create table if not exists public.innerme_operational_incident_events (
    id uuid primary key default gen_random_uuid(),
    event_key text not null unique,
    incident_id uuid not null references public.innerme_operational_incidents(id) on delete cascade,
    event_type text not null check (event_type in (
        'detected','reopened','severity_escalated','acknowledged','resolved','ignored'
    )),
    condition_fingerprint text,
    severity text not null check (severity in ('critical','high','medium','low')),
    status text not null check (status in ('open','acknowledged','resolved','ignored')),
    source_snapshot jsonb not null default '[]'::jsonb,
    note text,
    actor_id uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);

create index if not exists idx_innerme_operational_incident_events_incident
    on public.innerme_operational_incident_events(incident_id, created_at desc);

alter table public.innerme_operational_incidents enable row level security;
alter table public.innerme_operational_incident_events enable row level security;

drop policy if exists "InnerMe operational incidents admins can manage"
    on public.innerme_operational_incidents;
create policy "InnerMe operational incidents admins can manage"
    on public.innerme_operational_incidents
    for all to authenticated
    using ((select public.is_swayphics_admin()))
    with check ((select public.is_swayphics_admin()));

drop policy if exists "InnerMe operational incident events admins can view"
    on public.innerme_operational_incident_events;
create policy "InnerMe operational incident events admins can view"
    on public.innerme_operational_incident_events
    for select to authenticated
    using ((select public.is_swayphics_admin()));

drop policy if exists "InnerMe operational incident events admins can insert"
    on public.innerme_operational_incident_events;
create policy "InnerMe operational incident events admins can insert"
    on public.innerme_operational_incident_events
    for insert to authenticated
    with check ((select public.is_swayphics_admin()));

revoke all on table public.innerme_operational_incidents from anon;
revoke all on table public.innerme_operational_incident_events from anon;
grant select, insert, update on table public.innerme_operational_incidents to authenticated;
grant select, insert on table public.innerme_operational_incident_events to authenticated;

create or replace function public.generate_innerme_operational_incidents()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_count integer := 0;
    v_existing public.innerme_operational_incidents%rowtype;
    v_incident_id uuid;
    v_should_notify boolean;
    v_event_type text;
    v_snapshot jsonb;
    v_fingerprint text;
    v_severity text;
    v_status text;
    v_title text;
    v_summary text;
    v_reason text;
    v_response text;
    v_categories jsonb;
    v_source_count integer;
    r record;
begin
    if current_user <> 'postgres' and not public.is_swayphics_admin() then
        raise exception 'Swayphics admin access required.';
    end if;

    for r in
        select
            l.id,
            coalesce(l.business_name, l.contact_name, 'Lead') as business_name,
            l.next_follow_up,
            coalesce(l.last_contacted_at, l.created_at) as last_contacted_at
        from public.leads l
        where l.status not in ('won','lost')
          and l.next_follow_up is not null
          and l.next_follow_up < current_date
          and coalesce(l.last_contacted_at, l.created_at) <= now() - interval '14 days'
          and l.status in ('contacted','interested','proposal sent','negotiating','follow-up')
    loop
        v_snapshot := jsonb_build_array(
            jsonb_build_object(
                'category','sales','exception_type','overdue_follow_up',
                'source_table','leads','source_id',r.id,'due_date',r.next_follow_up
            ),
            jsonb_build_object(
                'category','sales','exception_type','lead_quiet',
                'source_table','leads','source_id',r.id,'last_contacted_at',r.last_contacted_at
            )
        );
        v_fingerprint := md5(v_snapshot::text);
        v_severity := 'high';
        v_title := 'Compound sales risk on ' || r.business_name;
        v_summary := r.business_name || ' is overdue for follow-up and has had no recorded contact activity for at least 14 days.';
        v_reason := 'The same active lead satisfies two independent monitoring conditions: overdue follow-up and prolonged contact inactivity.';
        v_response := 'Review the latest communication, verify whether the opportunity is still live, and set the next justified action.';
        v_categories := '["sales"]'::jsonb;
        v_source_count := 2;

        select * into v_existing
        from public.innerme_operational_incidents
        where incident_key = 'sales-lead:' || r.id::text || ':compound';

        v_should_notify := false;
        v_status := null;
        if not found then
            insert into public.innerme_operational_incidents (
                incident_key, incident_type, severity, status, title, summary,
                categories, source_count, source_snapshot, correlation_reason,
                recommended_response, condition_fingerprint
            ) values (
                'sales-lead:' || r.id::text || ':compound',
                'sales_compound',v_severity,'open',v_title,v_summary,
                v_categories,v_source_count,v_snapshot,v_reason,v_response,v_fingerprint
            ) returning id into v_incident_id;
            v_event_type := 'detected';
            v_should_notify := true;
            v_count := v_count + 1;
        else
            v_incident_id := v_existing.id;
            if v_existing.condition_fingerprint is distinct from v_fingerprint then
                v_event_type := case when v_existing.status in ('resolved','ignored') then 'reopened' else 'detected' end;
                v_should_notify := true;
                v_status := case when v_event_type='reopened' then 'open' else v_existing.status end;
                update public.innerme_operational_incidents
                set severity=v_severity,status=v_status,title=v_title,summary=v_summary,
                    categories=v_categories,source_count=v_source_count,source_snapshot=v_snapshot,
                    correlation_reason=v_reason,recommended_response=v_response,
                    condition_fingerprint=v_fingerprint,last_detected_at=now(),
                    acknowledged_by=case when v_status='open' then null else acknowledged_by end,
                    acknowledged_at=case when v_status='open' then null else acknowledged_at end,
                    resolved_by=case when v_status='open' then null else resolved_by end,
                    resolved_at=case when v_status='open' then null else resolved_at end,
                    ignored_by=case when v_status='open' then null else ignored_by end,
                    ignored_at=case when v_status='open' then null else ignored_at end,
                    updated_at=now()
                where id=v_incident_id;
                v_count := v_count + 1;
            elsif v_existing.severity in ('medium','low') and v_severity in ('high','critical') then
                v_event_type := 'severity_escalated';
                v_should_notify := true;
                update public.innerme_operational_incidents
                set severity=v_severity,last_detected_at=now(),updated_at=now()
                where id=v_incident_id;
                v_count := v_count + 1;
            else
                v_event_type := null;
                update public.innerme_operational_incidents
                set last_detected_at=now(),updated_at=now()
                where id=v_incident_id;
            end if;
        end if;

        if v_event_type is not null then
            insert into public.innerme_operational_incident_events(
                event_key,incident_id,event_type,condition_fingerprint,severity,status,source_snapshot,note
            ) values (
                'incident:'||v_incident_id::text||':'||v_event_type||':'||v_fingerprint,
                v_incident_id,v_event_type,v_fingerprint,v_severity,
                case when v_event_type='reopened' then 'open' else coalesce(v_status,'open') end,
                v_snapshot,v_reason
            ) on conflict(event_key) do nothing;
        end if;

        if v_should_notify then
            perform public.notify_admins(
                null,
                case when v_severity in ('critical','high') then 'danger' else 'warning' end,
                'innerme.incident.sales_compound',
                v_title,v_summary,'innerme_operational_incident',v_incident_id,'innerme',
                'innerme-incident:'||v_incident_id::text||':'||v_fingerprint,true
            );
        end if;
    end loop;

    for r in
        select
            l.id,
            coalesce(l.business_name, l.contact_name, 'Lead') as business_name,
            l.next_follow_up,
            count(t.id)::integer as overdue_task_count,
            coalesce(
                jsonb_agg(
                    jsonb_build_object(
                        'category','delivery','exception_type','overdue_task',
                        'source_table','tasks','source_id',t.id,
                        'due_date',t.due_date,'priority',t.priority,'title',t.title
                    )
                    order by t.due_date, t.id
                ) filter (where t.id is not null),
                '[]'::jsonb
            ) as task_sources
        from public.leads l
        join public.tasks t
          on t.lead_id=l.id
         and t.status<>'completed'
         and t.due_date is not null
         and t.due_date<current_date
        where l.status not in ('won','lost')
          and l.next_follow_up is not null
          and l.next_follow_up<current_date
        group by l.id,l.business_name,l.contact_name,l.next_follow_up
    loop
        v_snapshot := jsonb_build_array(
            jsonb_build_object(
                'category','sales','exception_type','overdue_follow_up',
                'source_table','leads','source_id',r.id,'due_date',r.next_follow_up
            )
        ) || r.task_sources;
        v_fingerprint:=md5(v_snapshot::text);
        v_severity:='high';
        v_title:='Sales and delivery pressure on '||r.business_name;
        v_summary:=r.business_name||' has an overdue sales follow-up plus '||
            r.overdue_task_count::text||' overdue task(s) attached to the same lead.';
        v_reason:='A single lead has unresolved sales follow-up pressure and attached delivery work that is also past due.';
        v_response:='Review the lead, identify the blocking dependency, and assign or reschedule the affected delivery work.';
        v_categories:='["sales","delivery"]'::jsonb;
        v_source_count:=1+r.overdue_task_count;

        select * into v_existing from public.innerme_operational_incidents
        where incident_key='sales-delivery-lead:'||r.id::text;

        v_should_notify:=false;
        v_status:=null;
        if not found then
            insert into public.innerme_operational_incidents(
                incident_key,incident_type,severity,status,title,summary,categories,source_count,
                source_snapshot,correlation_reason,recommended_response,condition_fingerprint
            ) values (
                'sales-delivery-lead:'||r.id::text,'sales_delivery_compound',v_severity,'open',
                v_title,v_summary,v_categories,v_source_count,v_snapshot,v_reason,v_response,v_fingerprint
            ) returning id into v_incident_id;
            v_event_type:='detected';v_should_notify:=true;v_count:=v_count+1;
        else
            v_incident_id:=v_existing.id;
            if v_existing.condition_fingerprint is distinct from v_fingerprint then
                v_event_type:=case when v_existing.status in ('resolved','ignored') then 'reopened' else 'detected' end;
                v_should_notify:=true;
                v_status:=case when v_event_type='reopened' then 'open' else v_existing.status end;
                update public.innerme_operational_incidents
                set severity=v_severity,status=v_status,title=v_title,summary=v_summary,
                    categories=v_categories,source_count=v_source_count,source_snapshot=v_snapshot,
                    correlation_reason=v_reason,recommended_response=v_response,
                    condition_fingerprint=v_fingerprint,last_detected_at=now(),updated_at=now(),
                    acknowledged_by=case when v_status='open' then null else acknowledged_by end,
                    acknowledged_at=case when v_status='open' then null else acknowledged_at end,
                    resolved_by=case when v_status='open' then null else resolved_by end,
                    resolved_at=case when v_status='open' then null else resolved_at end,
                    ignored_by=case when v_status='open' then null else ignored_by end,
                    ignored_at=case when v_status='open' then null else ignored_at end
                where id=v_incident_id;
                v_count:=v_count+1;
            else
                update public.innerme_operational_incidents set last_detected_at=now(),updated_at=now()
                where id=v_incident_id;
                v_event_type:=null;
            end if;
        end if;

        if v_event_type is not null then
            insert into public.innerme_operational_incident_events(
                event_key,incident_id,event_type,condition_fingerprint,severity,status,source_snapshot,note
            ) values (
                'incident:'||v_incident_id::text||':'||v_event_type||':'||v_fingerprint,
                v_incident_id,v_event_type,v_fingerprint,v_severity,
                case when v_event_type='reopened' then 'open' else coalesce(v_status,'open') end,
                v_snapshot,v_reason
            ) on conflict(event_key) do nothing;
        end if;

        if v_should_notify then
            perform public.notify_admins(
                null,'danger','innerme.incident.sales_delivery_compound',
                v_title,v_summary,'innerme_operational_incident',v_incident_id,'innerme',
                'innerme-incident:'||v_incident_id::text||':'||v_fingerprint,true
            );
        end if;
    end loop;

    for r in
        select
            c.id as client_id,
            coalesce(c.business_name,'Client') as business_name,
            count(distinct i.id)::integer as overdue_invoice_count,
            count(distinct t.id)::integer as overdue_task_count,
            coalesce(
                jsonb_agg(
                    distinct jsonb_build_object(
                        'category','cash','exception_type','overdue_invoice',
                        'source_table','invoices','source_id',i.id,
                        'invoice_number',i.invoice_number,'due_date',i.due_date,
                        'amount_outstanding',i.amount_outstanding
                    )
                ) filter (where i.id is not null),
                '[]'::jsonb
            ) as invoice_sources,
            coalesce(
                jsonb_agg(
                    distinct jsonb_build_object(
                        'category','delivery','exception_type','overdue_task',
                        'source_table','tasks','source_id',t.id,
                        'due_date',t.due_date,'priority',t.priority,'title',t.title
                    )
                ) filter (where t.id is not null),
                '[]'::jsonb
            ) as task_sources
        from public.clients c
        join public.invoices i
          on i.client_id=c.id
         and i.archived=false
         and coalesce(i.amount_outstanding,i.total,0)>0
         and i.due_date is not null
         and i.due_date<current_date
         and coalesce(i.status,'') not in ('paid','cancelled')
        join public.tasks t
          on t.client_id=c.id
         and t.status<>'completed'
         and t.due_date is not null
         and t.due_date<current_date
        group by c.id,c.business_name
    loop
        v_snapshot:=r.invoice_sources||r.task_sources;
        v_fingerprint:=md5(v_snapshot::text);
        v_severity:='high';
        v_title:='Cash and delivery pressure on '||r.business_name;
        v_summary:=r.business_name||' has '||r.overdue_invoice_count::text||
            ' overdue invoice(s) with outstanding balance and '||r.overdue_task_count::text||
            ' overdue task(s).';
        v_reason:='The same client simultaneously has unresolved receivables and overdue delivery work.';
        v_response:='Review cash collection status and delivery dependencies together before taking client-facing action.';
        v_categories:='["cash","delivery"]'::jsonb;
        v_source_count:=r.overdue_invoice_count+r.overdue_task_count;

        select * into v_existing from public.innerme_operational_incidents
        where incident_key='cash-delivery-client:'||r.client_id::text;

        v_should_notify:=false;
        v_status:=null;
        if not found then
            insert into public.innerme_operational_incidents(
                incident_key,incident_type,severity,status,title,summary,categories,source_count,
                source_snapshot,correlation_reason,recommended_response,condition_fingerprint
            ) values (
                'cash-delivery-client:'||r.client_id::text,'cash_delivery_compound',v_severity,'open',
                v_title,v_summary,v_categories,v_source_count,v_snapshot,v_reason,v_response,v_fingerprint
            ) returning id into v_incident_id;
            v_event_type:='detected';v_should_notify:=true;v_count:=v_count+1;
        else
            v_incident_id:=v_existing.id;
            if v_existing.condition_fingerprint is distinct from v_fingerprint then
                v_event_type:=case when v_existing.status in ('resolved','ignored') then 'reopened' else 'detected' end;
                v_should_notify:=true;
                v_status:=case when v_event_type='reopened' then 'open' else v_existing.status end;
                update public.innerme_operational_incidents
                set severity=v_severity,status=v_status,title=v_title,summary=v_summary,
                    categories=v_categories,source_count=v_source_count,source_snapshot=v_snapshot,
                    correlation_reason=v_reason,recommended_response=v_response,
                    condition_fingerprint=v_fingerprint,last_detected_at=now(),updated_at=now(),
                    acknowledged_by=case when v_status='open' then null else acknowledged_by end,
                    acknowledged_at=case when v_status='open' then null else acknowledged_at end,
                    resolved_by=case when v_status='open' then null else resolved_by end,
                    resolved_at=case when v_status='open' then null else resolved_at end,
                    ignored_by=case when v_status='open' then null else ignored_by end,
                    ignored_at=case when v_status='open' then null else ignored_at end
                where id=v_incident_id;
                v_count:=v_count+1;
            else
                update public.innerme_operational_incidents set last_detected_at=now(),updated_at=now()
                where id=v_incident_id;
                v_event_type:=null;
            end if;
        end if;

        if v_event_type is not null then
            insert into public.innerme_operational_incident_events(
                event_key,incident_id,event_type,condition_fingerprint,severity,status,source_snapshot,note
            ) values (
                'incident:'||v_incident_id::text||':'||v_event_type||':'||v_fingerprint,
                v_incident_id,v_event_type,v_fingerprint,v_severity,
                case when v_event_type='reopened' then 'open' else coalesce(v_status,'open') end,
                v_snapshot,v_reason
            ) on conflict(event_key) do nothing;
        end if;

        if v_should_notify then
            perform public.notify_admins(
                null,'danger','innerme.incident.cash_delivery_compound',v_title,v_summary,
                'innerme_operational_incident',v_incident_id,'innerme',
                'innerme-incident:'||v_incident_id::text||':'||v_fingerprint,true
            );
        end if;
    end loop;

    for r in
        select
            p.id as proposal_id,
            coalesce(p.title,p.action_type,'InnerMe action') as action_title,
            e.id as execution_log_id,
            e.started_at
        from public.innerme_action_proposals p
        join public.innerme_action_execution_logs e
          on e.proposal_id=p.id
         and e.status='started'
         and e.started_at<now()-interval '7 days'
        where p.status='failed'
          and p.updated_at>=now()-interval '7 days'
    loop
        v_snapshot:=jsonb_build_array(
            jsonb_build_object(
                'category','automation','exception_type','failed_action',
                'source_table','innerme_action_proposals','source_id',r.proposal_id,'title',r.action_title
            ),
            jsonb_build_object(
                'category','automation','exception_type','stalled_execution',
                'source_table','innerme_action_execution_logs','source_id',r.execution_log_id,'started_at',r.started_at
            )
        );
        v_fingerprint:=md5(v_snapshot::text);
        v_severity:='critical';
        v_title:='Automation failure with stalled execution';
        v_summary:=r.action_title||' is marked failed while its execution history also contains a run stalled beyond seven days.';
        v_reason:='A failed proposal and a long-running started execution record point to the same action chain.';
        v_response:='Inspect the proposal error and execution log together. Do not retry until the failure state and side effects are understood.';
        v_categories:='["automation"]'::jsonb;
        v_source_count:=2;

        select * into v_existing from public.innerme_operational_incidents
        where incident_key='automation-proposal:'||r.proposal_id::text||':failure-stall';

        v_should_notify:=false;
        v_status:=null;
        if not found then
            insert into public.innerme_operational_incidents(
                incident_key,incident_type,severity,status,title,summary,categories,source_count,
                source_snapshot,correlation_reason,recommended_response,condition_fingerprint
            ) values (
                'automation-proposal:'||r.proposal_id::text||':failure-stall','automation_compound',
                v_severity,'open',v_title,v_summary,v_categories,v_source_count,v_snapshot,v_reason,v_response,v_fingerprint
            ) returning id into v_incident_id;
            v_event_type:='detected';v_should_notify:=true;v_count:=v_count+1;
        else
            v_incident_id:=v_existing.id;
            if v_existing.condition_fingerprint is distinct from v_fingerprint then
                v_event_type:=case when v_existing.status in ('resolved','ignored') then 'reopened' else 'detected' end;
                v_should_notify:=true;
                v_status:=case when v_event_type='reopened' then 'open' else v_existing.status end;
                update public.innerme_operational_incidents
                set severity=v_severity,status=v_status,title=v_title,summary=v_summary,
                    categories=v_categories,source_count=v_source_count,source_snapshot=v_snapshot,
                    correlation_reason=v_reason,recommended_response=v_response,
                    condition_fingerprint=v_fingerprint,last_detected_at=now(),updated_at=now(),
                    acknowledged_by=case when v_status='open' then null else acknowledged_by end,
                    acknowledged_at=case when v_status='open' then null else acknowledged_at end,
                    resolved_by=case when v_status='open' then null else resolved_by end,
                    resolved_at=case when v_status='open' then null else resolved_at end,
                    ignored_by=case when v_status='open' then null else ignored_by end,
                    ignored_at=case when v_status='open' then null else ignored_at end
                where id=v_incident_id;
                v_count:=v_count+1;
            else
                update public.innerme_operational_incidents set last_detected_at=now(),updated_at=now()
                where id=v_incident_id;
                v_event_type:=null;
            end if;
        end if;

        if v_event_type is not null then
            insert into public.innerme_operational_incident_events(
                event_key,incident_id,event_type,condition_fingerprint,severity,status,source_snapshot,note
            ) values (
                'incident:'||v_incident_id::text||':'||v_event_type||':'||v_fingerprint,
                v_incident_id,v_event_type,v_fingerprint,v_severity,
                case when v_event_type='reopened' then 'open' else coalesce(v_status,'open') end,
                v_snapshot,v_reason
            ) on conflict(event_key) do nothing;
        end if;

        if v_should_notify then
            perform public.notify_admins(
                null,'danger','innerme.incident.automation_compound',v_title,v_summary,
                'innerme_operational_incident',v_incident_id,'innerme',
                'innerme-incident:'||v_incident_id::text||':'||v_fingerprint,true
            );
        end if;
    end loop;

    declare
        v_knowledge_count integer := 0;
        v_strategy_count integer := 0;
        v_knowledge_sources jsonb := '[]'::jsonb;
        v_strategy_sources jsonb := '[]'::jsonb;
    begin
        select count(*) into v_knowledge_count
        from public.innerme_knowledge
        where status='active'
          and (
              verification_status in ('stale','needs_review','unverified')
              or review_after <= now()
          );

        select count(*) into v_strategy_count
        from public.innerme_strategic_recommendations
        where status='candidate';

        if v_knowledge_count > 0 and v_strategy_count > 0 then
            select coalesce(
                jsonb_agg(
                    jsonb_build_object(
                        'category','knowledge','exception_type','verification_due',
                        'source_table','innerme_knowledge','source_id',k.id,'title',k.title
                    )
                    order by k.updated_at desc
                ) filter (where k.id is not null),
                '[]'::jsonb
            ) into v_knowledge_sources
            from public.innerme_knowledge k
            where k.status='active'
              and (
                  k.verification_status in ('stale','needs_review','unverified')
                  or k.review_after <= now()
              );

            select coalesce(
                jsonb_agg(
                    jsonb_build_object(
                        'category','strategy','exception_type','candidate_waiting',
                        'source_table','innerme_strategic_recommendations','source_id',s.id,'title',s.title
                    )
                    order by s.created_at desc
                ) filter (where s.id is not null),
                '[]'::jsonb
            ) into v_strategy_sources
            from public.innerme_strategic_recommendations s
            where s.status='candidate';

            v_snapshot := (
                select coalesce(jsonb_agg(value),'[]'::jsonb)
                from (
                    select value
                    from jsonb_array_elements(v_knowledge_sources || v_strategy_sources) with ordinality
                    where ordinality <= 20
                ) x
            );

            v_fingerprint:=md5(jsonb_build_object(
                'knowledge_count',v_knowledge_count,
                'strategy_count',v_strategy_count
            )::text);
            v_severity:=case when v_knowledge_count>=5 or v_strategy_count>=3 then 'high' else 'medium' end;
            v_title:='Knowledge governance is behind strategic output';
            v_summary:=v_knowledge_count::text||' knowledge record(s) need verification while '||
                v_strategy_count::text||' strategic recommendation(s) remain candidate status.';
            v_reason:='Strategic recommendations exist while part of the knowledge base remains outside its verified retrieval window.';
            v_response:='Verify due knowledge before relying on strategic recommendations, then review or re-run the affected strategy work.';
            v_categories:='["knowledge","strategy"]'::jsonb;
            v_source_count:=v_knowledge_count+v_strategy_count;

            select * into v_existing from public.innerme_operational_incidents
            where incident_key='knowledge-strategy:governance';

            v_should_notify:=false;
            v_status:=null;
            if not found then
                insert into public.innerme_operational_incidents(
                    incident_key,incident_type,severity,status,title,summary,categories,source_count,
                    source_snapshot,correlation_reason,recommended_response,condition_fingerprint
                ) values (
                    'knowledge-strategy:governance','knowledge_strategy_compound',v_severity,'open',
                    v_title,v_summary,v_categories,v_source_count,v_snapshot,v_reason,v_response,v_fingerprint
                ) returning id into v_incident_id;
                v_event_type:='detected';v_should_notify:=true;v_count:=v_count+1;
            else
                v_incident_id:=v_existing.id;
                if v_existing.condition_fingerprint is distinct from v_fingerprint then
                    v_event_type:=case when v_existing.status in ('resolved','ignored') then 'reopened' else 'detected' end;
                    v_should_notify:=true;
                    v_status:=case when v_event_type='reopened' then 'open' else v_existing.status end;
                    update public.innerme_operational_incidents
                    set severity=v_severity,status=v_status,title=v_title,summary=v_summary,
                        categories=v_categories,source_count=v_source_count,source_snapshot=v_snapshot,
                        correlation_reason=v_reason,recommended_response=v_response,
                        condition_fingerprint=v_fingerprint,last_detected_at=now(),updated_at=now(),
                        acknowledged_by=case when v_status='open' then null else acknowledged_by end,
                        acknowledged_at=case when v_status='open' then null else acknowledged_at end,
                        resolved_by=case when v_status='open' then null else resolved_by end,
                        resolved_at=case when v_status='open' then null else resolved_at end,
                        ignored_by=case when v_status='open' then null else ignored_by end,
                        ignored_at=case when v_status='open' then null else ignored_at end
                    where id=v_incident_id;
                    v_count:=v_count+1;
                else
                    update public.innerme_operational_incidents set last_detected_at=now(),updated_at=now() where id=v_incident_id;
                    v_event_type:=null;
                end if;
            end if;

            if v_event_type is not null then
                insert into public.innerme_operational_incident_events(
                    event_key,incident_id,event_type,condition_fingerprint,severity,status,source_snapshot,note
                ) values (
                    'incident:'||v_incident_id::text||':'||v_event_type||':'||v_fingerprint,
                    v_incident_id,v_event_type,v_fingerprint,v_severity,
                    case when v_event_type='reopened' then 'open' else coalesce(v_status,'open') end,
                    v_snapshot,v_reason
                ) on conflict(event_key) do nothing;
            end if;

            if v_should_notify then
                perform public.notify_admins(
                    null,
                    case when v_severity='high' then 'danger' else 'warning' end,
                    'innerme.incident.knowledge_strategy_compound',
                    v_title,v_summary,'innerme_operational_incident',v_incident_id,'innerme',
                    'innerme-incident:'||v_incident_id::text||':'||v_fingerprint,true
                );
            end if;
        end if;
    end;

    declare
        s_count integer:=0;
        d_count integer:=0;
        c_count integer:=0;
        a_count integer:=0;
        strategy_count integer:=0;
        v_category_count integer:=0;
        v_high_total integer:=0;
    begin
        select count(*) into s_count
        from public.leads
        where status not in ('won','lost')
          and next_follow_up is not null
          and next_follow_up<current_date;

        select count(*) into d_count
        from public.tasks
        where status<>'completed'
          and due_date is not null
          and due_date<current_date
          and priority in ('urgent','high');

        select count(*) into c_count
        from public.invoices
        where archived=false
          and coalesce(amount_outstanding,total,0)>0
          and due_date is not null
          and due_date<current_date
          and coalesce(status,'') not in ('paid','cancelled');

        select count(*) into a_count
        from public.innerme_action_proposals
        where status='failed'
          and updated_at>=now()-interval '7 days';

        select count(*) into strategy_count
        from public.innerme_strategic_recommendations
        where status='candidate'
          and urgency in ('critical','high');

        v_high_total:=s_count+d_count+c_count+a_count+strategy_count;
        v_category_count:=
            (case when s_count>0 then 1 else 0 end)+
            (case when d_count>0 then 1 else 0 end)+
            (case when c_count>0 then 1 else 0 end)+
            (case when a_count>0 then 1 else 0 end)+
            (case when strategy_count>0 then 1 else 0 end);

        if v_high_total>=3 and v_category_count>=2 then
            v_snapshot:=jsonb_build_array(
                jsonb_build_object('category','sales','high_exception_count',s_count),
                jsonb_build_object('category','delivery','high_exception_count',d_count),
                jsonb_build_object('category','cash','high_exception_count',c_count),
                jsonb_build_object('category','automation','high_exception_count',a_count),
                jsonb_build_object('category','strategy','high_exception_count',strategy_count)
            );
            v_fingerprint:=md5(v_snapshot::text);
            v_severity:=case when v_high_total>=5 or v_category_count>=3 then 'critical' else 'high' end;
            v_title:='Cross-domain operational pressure detected';
            v_summary:=v_high_total::text||' high-severity exception signal(s) are active across '||
                v_category_count::text||' operational categories.';
            v_reason:='Independent monitoring conditions are accumulating across multiple business domains, increasing the chance that isolated issues are masking a compound operational problem.';
            v_response:='Review the incident set together, prioritize the highest-impact dependency, and avoid treating each alert as an isolated task.';
            v_categories:=jsonb_build_array('sales','delivery','cash','automation','strategy');
            v_source_count:=v_high_total;

            select * into v_existing from public.innerme_operational_incidents
            where incident_key='cross-domain:global';

            v_should_notify:=false;
            v_status:=null;
            if not found then
                insert into public.innerme_operational_incidents(
                    incident_key,incident_type,severity,status,title,summary,categories,source_count,
                    source_snapshot,correlation_reason,recommended_response,condition_fingerprint
                ) values (
                    'cross-domain:global','cross_domain_pressure',v_severity,'open',v_title,v_summary,
                    v_categories,v_source_count,v_snapshot,v_reason,v_response,v_fingerprint
                ) returning id into v_incident_id;
                v_event_type:='detected';v_should_notify:=true;v_count:=v_count+1;
            else
                v_incident_id:=v_existing.id;
                if v_existing.condition_fingerprint is distinct from v_fingerprint then
                    v_event_type:=case when v_existing.status in ('resolved','ignored') then 'reopened' else 'detected' end;
                    v_should_notify:=true;
                    v_status:=case when v_event_type='reopened' then 'open' else v_existing.status end;
                    update public.innerme_operational_incidents
                    set severity=v_severity,status=v_status,title=v_title,summary=v_summary,
                        categories=v_categories,source_count=v_source_count,source_snapshot=v_snapshot,
                        correlation_reason=v_reason,recommended_response=v_response,
                        condition_fingerprint=v_fingerprint,last_detected_at=now(),updated_at=now(),
                        acknowledged_by=case when v_status='open' then null else acknowledged_by end,
                        acknowledged_at=case when v_status='open' then null else acknowledged_at end,
                        resolved_by=case when v_status='open' then null else resolved_by end,
                        resolved_at=case when v_status='open' then null else resolved_at end,
                        ignored_by=case when v_status='open' then null else ignored_by end,
                        ignored_at=case when v_status='open' then null else ignored_at end
                    where id=v_incident_id;
                    v_count:=v_count+1;
                else
                    update public.innerme_operational_incidents set last_detected_at=now(),updated_at=now() where id=v_incident_id;
                    v_event_type:=null;
                end if;
            end if;

            if v_event_type is not null then
                insert into public.innerme_operational_incident_events(
                    event_key,incident_id,event_type,condition_fingerprint,severity,status,source_snapshot,note
                ) values (
                    'incident:'||v_incident_id::text||':'||v_event_type||':'||v_fingerprint,
                    v_incident_id,v_event_type,v_fingerprint,v_severity,
                    case when v_event_type='reopened' then 'open' else coalesce(v_status,'open') end,
                    v_snapshot,v_reason
                ) on conflict(event_key) do nothing;
            end if;

            if v_should_notify then
                perform public.notify_admins(
                    null,'danger','innerme.incident.cross_domain_pressure',
                    v_title,v_summary,'innerme_operational_incident',v_incident_id,'innerme',
                    'innerme-incident:'||v_incident_id::text||':'||v_fingerprint,true
                );
            end if;
        end if;
    end;

    return v_count;
end;
$$;

revoke all on function public.generate_innerme_operational_incidents() from public;
revoke all on function public.generate_innerme_operational_incidents() from anon;
grant execute on function public.generate_innerme_operational_incidents() to authenticated;

create or replace function public.review_innerme_operational_incident(
    p_incident_id uuid,
    p_status text
)
returns public.innerme_operational_incidents
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_row public.innerme_operational_incidents;
    v_previous_status text;
begin
    if not public.is_swayphics_admin() then
        raise exception 'Swayphics admin access required.';
    end if;

    if p_status not in ('open','acknowledged','resolved','ignored') then
        raise exception 'Unsupported incident status.';
    end if;

    select status into v_previous_status
    from public.innerme_operational_incidents
    where id=p_incident_id
    for update;

    if not found then
        raise exception 'Operational incident not found.';
    end if;

    update public.innerme_operational_incidents
    set status=p_status,
        acknowledged_by=case when p_status='acknowledged' then auth.uid()
                              when p_status='open' then null
                              else acknowledged_by end,
        acknowledged_at=case when p_status='acknowledged' then now()
                              when p_status='open' then null
                              else acknowledged_at end,
        resolved_by=case when p_status='resolved' then auth.uid()
                         when p_status in ('open','acknowledged') then null
                         else resolved_by end,
        resolved_at=case when p_status='resolved' then now()
                         when p_status in ('open','acknowledged') then null
                         else resolved_at end,
        ignored_by=case when p_status='ignored' then auth.uid()
                        when p_status in ('open','acknowledged') then null
                        else ignored_by end,
        ignored_at=case when p_status='ignored' then now()
                        when p_status in ('open','acknowledged') then null
                        else ignored_at end,
        updated_at=now()
    where id=p_incident_id
    returning * into v_row;

    insert into public.innerme_operational_incident_events(
        event_key,incident_id,event_type,condition_fingerprint,severity,status,
        source_snapshot,note,actor_id
    ) values (
        'incident-review:'||v_row.id::text||':'||gen_random_uuid()::text,
        v_row.id,
        case p_status
            when 'acknowledged' then 'acknowledged'
            when 'resolved' then 'resolved'
            when 'ignored' then 'ignored'
            else 'reopened'
        end,
        v_row.condition_fingerprint,
        v_row.severity,
        v_row.status,
        v_row.source_snapshot,
        'Incident status changed from '||coalesce(v_previous_status,'unknown')||' to '||p_status||'.',
        auth.uid()
    );

    return v_row;
end;
$$;

revoke all on function public.review_innerme_operational_incident(uuid,text) from public;
revoke all on function public.review_innerme_operational_incident(uuid,text) from anon;
grant execute on function public.review_innerme_operational_incident(uuid,text) to authenticated;

notify pgrst, 'reload schema';
