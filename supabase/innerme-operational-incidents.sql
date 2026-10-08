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


create or replace function public.upsert_innerme_operational_incident(
    p_incident_key text,p_incident_type text,p_severity text,p_title text,p_summary text,
    p_categories jsonb,p_source_count integer,p_source_snapshot jsonb,
    p_correlation_reason text,p_recommended_response text,p_condition_fingerprint text
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_existing public.innerme_operational_incidents%rowtype;
    v_id uuid;
    v_status text;
    v_event_type text := null;
begin
    if current_user <> 'postgres' and not public.is_swayphics_admin() then
        raise exception 'Swayphics admin access required.';
    end if;

    select * into v_existing
    from public.innerme_operational_incidents
    where incident_key=p_incident_key
    for update;

    if not found then
        insert into public.innerme_operational_incidents(
            incident_key,incident_type,severity,status,title,summary,categories,
            source_count,source_snapshot,correlation_reason,recommended_response,condition_fingerprint
        ) values (
            p_incident_key,p_incident_type,p_severity,'open',p_title,p_summary,
            coalesce(p_categories,'[]'::jsonb),greatest(p_source_count,0),
            coalesce(p_source_snapshot,'[]'::jsonb),p_correlation_reason,
            p_recommended_response,p_condition_fingerprint
        )
        returning id into v_id;
        v_status:='open';
        v_event_type:='detected';
    elsif v_existing.status in ('resolved','ignored') then
        update public.innerme_operational_incidents
        set severity=p_severity,status='open',title=p_title,summary=p_summary,
            categories=coalesce(p_categories,'[]'::jsonb),source_count=greatest(p_source_count,0),
            source_snapshot=coalesce(p_source_snapshot,'[]'::jsonb),
            correlation_reason=p_correlation_reason,recommended_response=p_recommended_response,
            condition_fingerprint=p_condition_fingerprint,last_detected_at=now(),
            acknowledged_by=null,acknowledged_at=null,resolved_by=null,resolved_at=null,
            ignored_by=null,ignored_at=null,updated_at=now()
        where id=v_existing.id
        returning id into v_id;
        v_status:='open';
        v_event_type:='reopened';
    elsif v_existing.condition_fingerprint is distinct from p_condition_fingerprint then
        update public.innerme_operational_incidents
        set severity=p_severity,status=v_existing.status,title=p_title,summary=p_summary,
            categories=coalesce(p_categories,'[]'::jsonb),source_count=greatest(p_source_count,0),
            source_snapshot=coalesce(p_source_snapshot,'[]'::jsonb),
            correlation_reason=p_correlation_reason,recommended_response=p_recommended_response,
            condition_fingerprint=p_condition_fingerprint,last_detected_at=now(),updated_at=now()
        where id=v_existing.id
        returning id into v_id;
        v_status:=v_existing.status;
        v_event_type:='detected';
    elsif v_existing.severity in ('medium','low') and p_severity in ('critical','high') then
        update public.innerme_operational_incidents
        set severity=p_severity,last_detected_at=now(),updated_at=now()
        where id=v_existing.id
        returning id into v_id;
        v_status:=v_existing.status;
        v_event_type:='severity_escalated';
    else
        update public.innerme_operational_incidents
        set last_detected_at=now(),updated_at=now()
        where id=v_existing.id
        returning id into v_id;
        v_status:=v_existing.status;
    end if;

    if v_event_type is not null then
        insert into public.innerme_operational_incident_events(
            event_key,incident_id,event_type,condition_fingerprint,severity,status,
            source_snapshot,note,actor_id
        ) values (
            'incident:'||v_id::text||':'||gen_random_uuid()::text,
            v_id,v_event_type,p_condition_fingerprint,p_severity,v_status,
            coalesce(p_source_snapshot,'[]'::jsonb),
            case v_event_type
                when 'detected' then 'Operational incident detected or its condition changed.'
                when 'reopened' then 'Operational incident condition returned after closure.'
                else 'Operational incident state escalated.'
            end,
            auth.uid()
        );

        perform public.notify_admins(
            null,
            case when p_severity in ('critical','high') then 'danger' else 'warning' end,
            'innerme.incident.'||p_incident_type||'.'||v_event_type,
            p_title,p_summary,'innerme_operational_incident',v_id,'innerme',
            'innerme-incident:'||v_id::text||':'||v_event_type||':'||gen_random_uuid()::text,
            true
        );
        return 1;
    end if;
    return 0;
end;
$$;

create or replace function public.reconcile_innerme_operational_incidents()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_count integer:=0;
    v_present boolean;
    r public.innerme_operational_incidents%rowtype;
begin
    if current_user <> 'postgres' and not public.is_swayphics_admin() then
        raise exception 'Swayphics admin access required.';
    end if;

    for r in
        select * from public.innerme_operational_incidents
        where status in ('open','acknowledged')
        for update
    loop
        v_present:=true;
        case r.incident_type
            when 'sales_compound' then
                select exists(
                    select 1 from public.leads l
                    where ('sales-lead:'||l.id::text||':compound')=r.incident_key
                      and l.status not in ('won','lost')
                      and l.next_follow_up is not null and l.next_follow_up<current_date
                      and coalesce(l.last_contacted_at,l.created_at)<=now()-interval '14 days'
                      and l.status in ('contacted','interested','proposal sent','negotiating','follow-up')
                ) into v_present;
            when 'sales_delivery_compound' then
                select exists(
                    select 1 from public.leads l
                    join public.tasks t on t.lead_id=l.id
                    where ('sales-delivery-lead:'||l.id::text)=r.incident_key
                      and l.status not in ('won','lost')
                      and l.next_follow_up is not null and l.next_follow_up<current_date
                      and t.status<>'completed' and t.due_date is not null and t.due_date<current_date
                ) into v_present;
            when 'cash_delivery_compound' then
                select exists(
                    select 1 from public.clients c
                    join public.invoices i on i.client_id=c.id
                    join public.tasks t on t.client_id=c.id
                    where ('cash-delivery-client:'||c.id::text)=r.incident_key
                      and i.archived=false
                      and coalesce(i.amount_outstanding,i.total,0)>0
                      and i.due_date is not null and i.due_date<current_date
                      and coalesce(i.status,'') not in ('paid','cancelled')
                      and t.status<>'completed' and t.due_date is not null and t.due_date<current_date
                ) into v_present;
            when 'automation_compound' then
                select exists(
                    select 1 from public.innerme_action_proposals p
                    join public.innerme_action_execution_logs e
                      on e.proposal_id=p.id
                     and e.status='started'
                     and e.started_at<now()-interval '7 days'
                    where ('automation-proposal:'||p.id::text||':failure-stall')=r.incident_key
                      and p.status='failed'
                      and p.updated_at>=now()-interval '7 days'
                ) into v_present;
            when 'knowledge_strategy_compound' then
                select exists(
                    select 1 from public.innerme_knowledge k
                    where k.status='active'
                      and (k.verification_status in ('stale','needs_review','unverified') or k.review_after<=now())
                ) and exists(
                    select 1 from public.innerme_strategic_recommendations s where s.status='candidate'
                ) into v_present;
            when 'cross_domain_pressure' then
                declare
                    s integer:=0;d integer:=0;c integer:=0;a integer:=0;st integer:=0;t integer:=0;cats integer:=0;
                begin
                    select count(*) into s from public.leads
                    where status not in ('won','lost') and next_follow_up is not null and next_follow_up<current_date;
                    select count(*) into d from public.tasks
                    where status<>'completed' and due_date is not null and due_date<current_date and priority in ('urgent','high');
                    select count(*) into c from public.invoices
                    where archived=false and coalesce(amount_outstanding,total,0)>0 and due_date is not null
                      and due_date<current_date and coalesce(status,'') not in ('paid','cancelled');
                    select count(*) into a from public.innerme_action_proposals
                    where status='failed' and updated_at>=now()-interval '7 days';
                    select count(*) into st from public.innerme_strategic_recommendations
                    where status='candidate' and urgency in ('critical','high');
                    t:=s+d+c+a+st;
                    cats:=(case when s>0 then 1 else 0 end)+(case when d>0 then 1 else 0 end)+
                          (case when c>0 then 1 else 0 end)+(case when a>0 then 1 else 0 end)+
                          (case when st>0 then 1 else 0 end);
                    v_present:=(t>=3 and cats>=2);
                end;
            else
                v_present:=true;
        end case;

        if not v_present then
            update public.innerme_operational_incidents
            set status='resolved',resolved_by=auth.uid(),resolved_at=now(),updated_at=now()
            where id=r.id;

            insert into public.innerme_operational_incident_events(
                event_key,incident_id,event_type,condition_fingerprint,severity,status,
                source_snapshot,note,actor_id
            ) values (
                'incident:'||r.id::text||':'||gen_random_uuid()::text,
                r.id,'resolved',r.condition_fingerprint,r.severity,'resolved',r.source_snapshot,
                'Underlying correlation conditions are no longer present; incident automatically resolved.',
                auth.uid()
            );

            perform public.notify_admins(
                null,'info','innerme.incident.resolved',
                'Operational incident resolved',
                r.title||' is no longer supported by the monitored exception conditions.',
                'innerme_operational_incident',r.id,'innerme',
                'innerme-incident-resolved:'||r.id::text||':'||gen_random_uuid()::text,true
            );
            v_count:=v_count+1;
        end if;
    end loop;
    return v_count;
end;
$$;

create or replace function public.generate_innerme_operational_incidents()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_count integer:=0;
    v_snapshot jsonb;
    v_fp text;
    r record;
begin
    if current_user <> 'postgres' and not public.is_swayphics_admin() then
        raise exception 'Swayphics admin access required.';
    end if;

    for r in
        select l.id,coalesce(l.business_name,l.contact_name,'Lead') business_name,l.next_follow_up,
               coalesce(l.last_contacted_at,l.created_at) last_contacted_at
        from public.leads l
        where l.status not in ('won','lost')
          and l.next_follow_up is not null and l.next_follow_up<current_date
          and coalesce(l.last_contacted_at,l.created_at)<=now()-interval '14 days'
          and l.status in ('contacted','interested','proposal sent','negotiating','follow-up')
    loop
        v_snapshot:=jsonb_build_array(
            jsonb_build_object('category','sales','exception_type','overdue_follow_up','source_table','leads','source_id',r.id,'due_date',r.next_follow_up),
            jsonb_build_object('category','sales','exception_type','lead_quiet','source_table','leads','source_id',r.id,'last_contacted_at',r.last_contacted_at)
        );
        v_fp:=md5(v_snapshot::text);
        v_count:=v_count+public.upsert_innerme_operational_incident(
            'sales-lead:'||r.id::text||':compound','sales_compound','high',
            'Compound sales risk on '||r.business_name,
            r.business_name||' is overdue for follow-up and has had no recorded contact activity for at least 14 days.',
            '["sales"]'::jsonb,2,v_snapshot,
            'The same active lead satisfies two independent monitoring conditions: overdue follow-up and prolonged contact inactivity.',
            'Review the latest communication, verify whether the opportunity is still live, and set the next justified action.',
            v_fp
        );
    end loop;

    for r in
        select l.id,coalesce(l.business_name,l.contact_name,'Lead') business_name,l.next_follow_up,
               count(t.id)::integer overdue_task_count,
               coalesce(jsonb_agg(jsonb_build_object(
                   'category','delivery','exception_type','overdue_task','source_table','tasks','source_id',t.id,
                   'due_date',t.due_date,'priority',t.priority,'title',t.title
               ) order by t.due_date,t.id),'[]'::jsonb) task_sources
        from public.leads l
        join public.tasks t on t.lead_id=l.id and t.status<>'completed'
          and t.due_date is not null and t.due_date<current_date
        where l.status not in ('won','lost')
          and l.next_follow_up is not null and l.next_follow_up<current_date
        group by l.id,l.business_name,l.contact_name,l.next_follow_up
    loop
        v_snapshot:=jsonb_build_array(jsonb_build_object(
            'category','sales','exception_type','overdue_follow_up','source_table','leads','source_id',r.id,'due_date',r.next_follow_up
        ))||r.task_sources;
        v_fp:=md5(v_snapshot::text);
        v_count:=v_count+public.upsert_innerme_operational_incident(
            'sales-delivery-lead:'||r.id::text,'sales_delivery_compound','high',
            'Sales and delivery pressure on '||r.business_name,
            r.business_name||' has an overdue sales follow-up plus '||r.overdue_task_count::text||' overdue task(s) attached to the same lead.',
            '["sales","delivery"]'::jsonb,1+r.overdue_task_count,v_snapshot,
            'A single lead has unresolved sales follow-up pressure and attached delivery work that is also past due.',
            'Review the lead, identify the blocking dependency, and assign or reschedule the affected delivery work.',
            v_fp
        );
    end loop;

    for r in
        select c.id client_id,coalesce(c.business_name,'Client') business_name,
               count(distinct i.id)::integer overdue_invoice_count,count(distinct t.id)::integer overdue_task_count,
               coalesce(jsonb_agg(distinct jsonb_build_object(
                   'category','cash','exception_type','overdue_invoice','source_table','invoices','source_id',i.id,
                   'invoice_number',i.invoice_number,'due_date',i.due_date,'amount_outstanding',i.amount_outstanding
               )),'[]'::jsonb) invoice_sources,
               coalesce(jsonb_agg(distinct jsonb_build_object(
                   'category','delivery','exception_type','overdue_task','source_table','tasks','source_id',t.id,
                   'due_date',t.due_date,'priority',t.priority,'title',t.title
               )),'[]'::jsonb) task_sources
        from public.clients c
        join public.invoices i on i.client_id=c.id and i.archived=false
          and coalesce(i.amount_outstanding,i.total,0)>0 and i.due_date is not null and i.due_date<current_date
          and coalesce(i.status,'') not in ('paid','cancelled')
        join public.tasks t on t.client_id=c.id and t.status<>'completed'
          and t.due_date is not null and t.due_date<current_date
        group by c.id,c.business_name
    loop
        v_snapshot:=r.invoice_sources||r.task_sources;
        v_fp:=md5(v_snapshot::text);
        v_count:=v_count+public.upsert_innerme_operational_incident(
            'cash-delivery-client:'||r.client_id::text,'cash_delivery_compound','high',
            'Cash and delivery pressure on '||r.business_name,
            r.business_name||' has '||r.overdue_invoice_count::text||' overdue invoice(s) with outstanding balance and '||r.overdue_task_count::text||' overdue task(s).',
            '["cash","delivery"]'::jsonb,r.overdue_invoice_count+r.overdue_task_count,v_snapshot,
            'The same client simultaneously has unresolved receivables and overdue delivery work.',
            'Review cash collection status and delivery dependencies together before taking client-facing action.',
            v_fp
        );
    end loop;

    for r in
        select p.id proposal_id,coalesce(p.title,p.action_type,'InnerMe action') action_title,e.id execution_log_id,e.started_at
        from public.innerme_action_proposals p
        join public.innerme_action_execution_logs e on e.proposal_id=p.id and e.status='started'
          and e.started_at<now()-interval '7 days'
        where p.status='failed' and p.updated_at>=now()-interval '7 days'
    loop
        v_snapshot:=jsonb_build_array(
            jsonb_build_object('category','automation','exception_type','failed_action','source_table','innerme_action_proposals','source_id',r.proposal_id,'title',r.action_title),
            jsonb_build_object('category','automation','exception_type','stalled_execution','source_table','innerme_action_execution_logs','source_id',r.execution_log_id,'started_at',r.started_at)
        );
        v_fp:=md5(v_snapshot::text);
        v_count:=v_count+public.upsert_innerme_operational_incident(
            'automation-proposal:'||r.proposal_id::text||':failure-stall','automation_compound','critical',
            'Automation failure with stalled execution',
            r.action_title||' is marked failed while its execution history also contains a run stalled beyond seven days.',
            '["automation"]'::jsonb,2,v_snapshot,
            'A failed proposal and a long-running started execution record point to the same action chain.',
            'Inspect the proposal error and execution log together. Do not retry until the failure state and side effects are understood.',
            v_fp
        );
    end loop;

    declare
        k integer:=0;s integer:=0;ks jsonb:='[]'::jsonb;ss jsonb:='[]'::jsonb;
    begin
        select count(*) into k from public.innerme_knowledge
        where status='active' and (verification_status in ('stale','needs_review','unverified') or review_after<=now());
        select count(*) into s from public.innerme_strategic_recommendations where status='candidate';
        if k>0 and s>0 then
            select coalesce(jsonb_agg(jsonb_build_object(
                'category','knowledge','exception_type','verification_due','source_table','innerme_knowledge','source_id',id,'title',title
            ) order by updated_at desc),'[]'::jsonb) into ks
            from public.innerme_knowledge
            where status='active' and (verification_status in ('stale','needs_review','unverified') or review_after<=now());

            select coalesce(jsonb_agg(jsonb_build_object(
                'category','strategy','exception_type','candidate_waiting','source_table','innerme_strategic_recommendations','source_id',id,'title',title
            ) order by created_at desc),'[]'::jsonb) into ss
            from public.innerme_strategic_recommendations where status='candidate';

            select coalesce(jsonb_agg(value),'[]'::jsonb) into v_snapshot
            from (
                select value from jsonb_array_elements(ks||ss) with ordinality where ordinality<=20
            ) q;
            v_fp:=md5(jsonb_build_object('knowledge_count',k,'strategy_count',s)::text);

            v_count:=v_count+public.upsert_innerme_operational_incident(
                'knowledge-strategy:governance','knowledge_strategy_compound',
                case when k>=5 or s>=3 then 'high' else 'medium' end,
                'Knowledge governance is behind strategic output',
                k::text||' knowledge record(s) need verification while '||s::text||' strategic recommendation(s) remain candidate status.',
                '["knowledge","strategy"]'::jsonb,k+s,v_snapshot,
                'Strategic recommendations exist while part of the knowledge base remains outside its verified retrieval window.',
                'Verify due knowledge before relying on strategic recommendations, then review or re-run the affected strategy work.',
                v_fp
            );
        end if;
    end;

    declare
        s integer:=0;d integer:=0;c integer:=0;a integer:=0;st integer:=0;t integer:=0;cats integer:=0;
    begin
        select count(*) into s from public.leads
        where status not in ('won','lost') and next_follow_up is not null and next_follow_up<current_date;
        select count(*) into d from public.tasks
        where status<>'completed' and due_date is not null and due_date<current_date and priority in ('urgent','high');
        select count(*) into c from public.invoices
        where archived=false and coalesce(amount_outstanding,total,0)>0 and due_date is not null and due_date<current_date
          and coalesce(status,'') not in ('paid','cancelled');
        select count(*) into a from public.innerme_action_proposals
        where status='failed' and updated_at>=now()-interval '7 days';
        select count(*) into st from public.innerme_strategic_recommendations
        where status='candidate' and urgency in ('critical','high');
        t:=s+d+c+a+st;
        cats:=(case when s>0 then 1 else 0 end)+(case when d>0 then 1 else 0 end)+
              (case when c>0 then 1 else 0 end)+(case when a>0 then 1 else 0 end)+(case when st>0 then 1 else 0 end);

        if t>=3 and cats>=2 then
            v_snapshot:=jsonb_build_array(
                jsonb_build_object('category','sales','high_exception_count',s),
                jsonb_build_object('category','delivery','high_exception_count',d),
                jsonb_build_object('category','cash','high_exception_count',c),
                jsonb_build_object('category','automation','high_exception_count',a),
                jsonb_build_object('category','strategy','high_exception_count',st)
            );
            v_fp:=md5(v_snapshot::text);
            v_count:=v_count+public.upsert_innerme_operational_incident(
                'cross-domain:global','cross_domain_pressure',
                case when t>=5 or cats>=3 then 'critical' else 'high' end,
                'Cross-domain operational pressure detected',
                t::text||' high-severity exception signal(s) are active across '||cats::text||' operational categories.',
                '["sales","delivery","cash","automation","strategy"]'::jsonb,t,v_snapshot,
                'Independent monitoring conditions are accumulating across multiple business domains, increasing the chance that isolated issues are masking a compound operational problem.',
                'Review the incident set together, prioritize the highest-impact dependency, and avoid treating each alert as an isolated task.',
                v_fp
            );
        end if;
    end;

    v_count:=v_count+public.reconcile_innerme_operational_incidents();
    return v_count;
end;
$$;

revoke all on function public.upsert_innerme_operational_incident(text,text,text,text,text,jsonb,integer,jsonb,text,text,text) from public;
revoke all on function public.upsert_innerme_operational_incident(text,text,text,text,text,jsonb,integer,jsonb,text,text,text) from anon;
grant execute on function public.upsert_innerme_operational_incident(text,text,text,text,text,jsonb,integer,jsonb,text,text,text) to authenticated;

revoke all on function public.reconcile_innerme_operational_incidents() from public;
revoke all on function public.reconcile_innerme_operational_incidents() from anon;
grant execute on function public.reconcile_innerme_operational_incidents() to authenticated;

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
