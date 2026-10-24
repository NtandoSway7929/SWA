-- Match the production correction applied as version 20261024151728.
-- Qualify the CTE's ranking value to avoid resolving the unqualified `rank` as a PL/pgSQL record.
-- Preserve SECURITY INVOKER and the existing Swayphics-admin check/RLS protections.
create or replace function public.refresh_innerme_incident_root_analysis()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_count integer := 0;
    v_score integer;
    v_label text;
    v_type text;
    v_relationship text;
    v_unresolved boolean;
    v_evidence jsonb;
    v_fp text;
    v_lead_id uuid;
    v_client_id uuid;
    v_project_id uuid;
    v_proposal_id uuid;
    v_source_id uuid;
    r public.innerme_operational_incidents%rowtype;
    x jsonb;
    lead_dep public.innerme_incident_dependencies%rowtype;
begin
    if current_user <> 'postgres' and not public.is_swayphics_admin() then
        raise exception 'Swayphics admin access required.';
    end if;

    for r in
        select *
        from public.innerme_operational_incidents
        where status in ('open','acknowledged')
    loop
        delete from public.innerme_incident_dependencies
        where incident_id = r.id;

        if jsonb_typeof(r.source_snapshot) = 'array' then
            for x in select value from jsonb_array_elements(r.source_snapshot)
            loop
                v_source_id := null;
                begin
                    v_source_id := nullif(x->>'source_id','')::uuid;
                exception when others then
                    v_source_id := null;
                end;

                v_type := coalesce(x->>'exception_type','signal');
                v_relationship := 'direct exception source';
                v_unresolved := true;

                v_score := case
                    when v_type in ('failed_action','stalled_execution') then 85
                    when v_type in ('overdue_invoice','overdue_follow_up','overdue_task') then 75
                    when v_type in ('lead_quiet','verification_due') then 65
                    when v_type in ('candidate_waiting') then 55
                    else 40
                end;

                if (x->>'priority') in ('urgent','high') then
                    v_score := least(100,v_score+12);
                end if;

                if (x->>'amount_outstanding') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                   and (x->>'amount_outstanding')::numeric > 0 then
                    v_score := least(100,v_score+10);
                end if;

                if (x->>'due_date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then
                    v_score := least(100,v_score + least(15,greatest(0,current_date-((x->>'due_date')::date))));
                end if;

                v_label := coalesce(x->>'title',replace(v_type,'_',' '),'Incident source');

                v_evidence := jsonb_build_object(
                    'category',coalesce(x->>'category','operational'),
                    'exception_type',v_type,
                    'source_table',coalesce(x->>'source_table','unknown'),
                    'source_id',v_source_id,
                    'snapshot',x
                );

                insert into public.innerme_incident_dependencies(
                    incident_id,dependency_rank,dependency_score,dependency_type,
                    source_table,source_id,relationship,label,is_unresolved,evidence,condition_fingerprint
                ) values (
                    r.id,999,v_score,v_type,coalesce(x->>'source_table','unknown'),
                    v_source_id,v_relationship,v_label,v_unresolved,v_evidence,r.condition_fingerprint
                );

                if coalesce(x->>'source_table','')='leads' and v_source_id is not null then
                    select id,converted_client_id into v_lead_id,v_client_id
                    from public.leads where id=v_source_id;

                    if v_lead_id is not null then
                        insert into public.innerme_incident_dependencies(
                            incident_id,dependency_rank,dependency_score,dependency_type,
                            source_table,source_id,relationship,label,is_unresolved,evidence,condition_fingerprint
                        )
                        select
                            r.id,999,72,'lead_delivery_dependency','tasks',t.id,
                            'task depends on same lead',
                            coalesce(t.title,'Task attached to lead'),
                            t.status<>'completed',
                            jsonb_build_object('lead_id',v_source_id,'task_id',t.id,'status',t.status,'due_date',t.due_date,'priority',t.priority),
                            r.condition_fingerprint
                        from public.tasks t
                        where t.lead_id=v_lead_id;

                        if v_client_id is not null then
                            insert into public.innerme_incident_dependencies(
                                incident_id,dependency_rank,dependency_score,dependency_type,
                                source_table,source_id,relationship,label,is_unresolved,evidence,condition_fingerprint
                            )
                            select
                                r.id,999,50,'lead_client_dependency','clients',c.id,
                                'lead converted to client',
                                coalesce(c.business_name,c.contact_name,'Converted client'),
                                c.status not in ('inactive','lost'),
                                jsonb_build_object('lead_id',v_source_id,'client_id',c.id,'status',c.status),
                                r.condition_fingerprint
                            from public.clients c where c.id=v_client_id;
                        end if;
                    end if;

                elsif coalesce(x->>'source_table','')='tasks' and v_source_id is not null then
                    select lead_id,client_id,project_id into v_lead_id,v_client_id,v_project_id
                    from public.tasks where id=v_source_id;

                    if v_lead_id is not null then
                        insert into public.innerme_incident_dependencies(
                            incident_id,dependency_rank,dependency_score,dependency_type,
                            source_table,source_id,relationship,label,is_unresolved,evidence,condition_fingerprint
                        )
                        select
                            r.id,999,58,'task_lead_dependency','leads',l.id,
                            'task attached to lead',
                            coalesce(l.business_name,l.contact_name,'Lead'),
                            l.status not in ('won','lost'),
                            jsonb_build_object('task_id',v_source_id,'lead_id',l.id,'status',l.status,'next_follow_up',l.next_follow_up),
                            r.condition_fingerprint
                        from public.leads l where l.id=v_lead_id;
                    end if;

                    if v_client_id is not null then
                        insert into public.innerme_incident_dependencies(
                            incident_id,dependency_rank,dependency_score,dependency_type,
                            source_table,source_id,relationship,label,is_unresolved,evidence,condition_fingerprint
                        )
                        select
                            r.id,999,55,'task_client_dependency','clients',c.id,
                            'task attached to client',
                            coalesce(c.business_name,c.contact_name,'Client'),
                            c.status not in ('inactive','lost'),
                            jsonb_build_object('task_id',v_source_id,'client_id',c.id,'status',c.status),
                            r.condition_fingerprint
                        from public.clients c where c.id=v_client_id;
                    end if;

                    if v_project_id is not null then
                        insert into public.innerme_incident_dependencies(
                            incident_id,dependency_rank,dependency_score,dependency_type,
                            source_table,source_id,relationship,label,is_unresolved,evidence,condition_fingerprint
                        )
                        select
                            r.id,999,60,'task_project_dependency','client_projects',cp.id,
                            'task attached to client project',
                            coalesce(cp.name,cp.service,'Client project'),
                            cp.status not in ('completed','cancelled'),
                            jsonb_build_object('task_id',v_source_id,'project_id',cp.id,'status',cp.status,'due_date',cp.due_date),
                            r.condition_fingerprint
                        from public.client_projects cp where cp.id=v_project_id;
                    end if;

                elsif coalesce(x->>'source_table','')='invoices' and v_source_id is not null then
                    select client_id,project_id into v_client_id,v_project_id
                    from public.invoices where id=v_source_id;

                    if v_client_id is not null then
                        insert into public.innerme_incident_dependencies(
                            incident_id,dependency_rank,dependency_score,dependency_type,
                            source_table,source_id,relationship,label,is_unresolved,evidence,condition_fingerprint
                        )
                        select
                            r.id,999,82,'invoice_client_dependency','clients',c.id,
                            'invoice owed by client',
                            coalesce(c.business_name,c.contact_name,'Client'),
                            c.status not in ('inactive','lost'),
                            jsonb_build_object('invoice_id',v_source_id,'client_id',c.id,'status',c.status),
                            r.condition_fingerprint
                        from public.clients c where c.id=v_client_id;
                    end if;

                    if v_project_id is not null then
                        insert into public.innerme_incident_dependencies(
                            incident_id,dependency_rank,dependency_score,dependency_type,
                            source_table,source_id,relationship,label,is_unresolved,evidence,condition_fingerprint
                        )
                        select
                            r.id,999,68,'invoice_project_dependency','client_projects',cp.id,
                            'invoice attached to client project',
                            coalesce(cp.name,cp.service,'Client project'),
                            cp.status not in ('completed','cancelled'),
                            jsonb_build_object('invoice_id',v_source_id,'project_id',cp.id,'status',cp.status,'payment_status',cp.payment_status),
                            r.condition_fingerprint
                        from public.client_projects cp where cp.id=v_project_id;
                    end if;

                elsif coalesce(x->>'source_table','')='innerme_action_proposals' and v_source_id is not null then
                    insert into public.innerme_incident_dependencies(
                        incident_id,dependency_rank,dependency_score,dependency_type,
                        source_table,source_id,relationship,label,is_unresolved,evidence,condition_fingerprint
                    )
                    select
                        r.id,999,88,'execution_chain_dependency','innerme_action_execution_logs',e.id,
                        'execution history for failed proposal',
                        coalesce(e.error_message,'Action execution'),
                        e.status not in ('completed','failed','cancelled'),
                        jsonb_build_object('proposal_id',v_source_id,'execution_log_id',e.id,'status',e.status,'started_at',e.started_at,'error_message',e.error_message),
                        r.condition_fingerprint
                    from public.innerme_action_execution_logs e
                    where e.proposal_id=v_source_id;

                elsif coalesce(x->>'source_table','')='innerme_action_execution_logs' and v_source_id is not null then
                    select proposal_id into v_proposal_id
                    from public.innerme_action_execution_logs where id=v_source_id;

                    if v_proposal_id is not null then
                        insert into public.innerme_incident_dependencies(
                            incident_id,dependency_rank,dependency_score,dependency_type,
                            source_table,source_id,relationship,label,is_unresolved,evidence,condition_fingerprint
                        )
                        select
                            r.id,999,84,'failed_proposal_dependency','innerme_action_proposals',p.id,
                            'execution log belongs to proposal',
                            coalesce(p.title,p.action_type,'InnerMe action'),
                            p.status not in ('completed','cancelled'),
                            jsonb_build_object('execution_log_id',v_source_id,'proposal_id',p.id,'status',p.status,'error_message',p.error_message),
                            r.condition_fingerprint
                        from public.innerme_action_proposals p where p.id=v_proposal_id;
                    end if;
                end if;
            end loop;
        end if;

        with ranked as (
            select id,row_number() over(order by dependency_score desc,is_unresolved desc,id)::integer as rank
            from public.innerme_incident_dependencies
            where incident_id=r.id
        )
        update public.innerme_incident_dependencies d
        set dependency_rank=ranked.rank,updated_at=now()
        from ranked where d.id=ranked.id;

        select d.* into lead_dep
        from public.innerme_incident_dependencies d
        where d.incident_id=r.id
        order by d.dependency_score desc,d.is_unresolved desc,d.dependency_rank
        limit 1;

        if lead_dep.id is null then
            insert into public.innerme_incident_root_analysis(
                incident_id,analysis_status,confidence,leading_factor,blocking_factor,
                evidence_summary,alternative_explanations,next_validation_step,condition_fingerprint
            ) values (
                r.id,'insufficient_evidence','low',
                'No source dependency could be resolved.',
                'No resolved dependency is currently available.',
                'The incident contains no resolvable source records in its current snapshot.',
                '[]'::jsonb,
                'Re-run incident monitoring after the source snapshot contains resolvable records.',
                r.condition_fingerprint
            )
            on conflict(incident_id) do update set
                analysis_status=excluded.analysis_status,
                confidence=excluded.confidence,
                leading_dependency_id=null,
                leading_factor=excluded.leading_factor,
                blocking_factor=excluded.blocking_factor,
                evidence_summary=excluded.evidence_summary,
                alternative_explanations=excluded.alternative_explanations,
                next_validation_step=excluded.next_validation_step,
                condition_fingerprint=excluded.condition_fingerprint,
                updated_at=now();
            v_count:=v_count+1;
            continue;
        end if;

        if r.incident_type='cross_domain_pressure' then
            v_label:='Cross-domain dependency load, not a single proven root cause';
        elsif r.incident_type='automation_compound' then
            v_label:='Execution integrity: failed proposal and linked execution history';
        elsif r.incident_type='cash_delivery_compound' then
            v_label:='Client cash-and-delivery dependency';
        elsif r.incident_type='sales_delivery_compound' then
            v_label:='Lead conversion and delivery dependency';
        elsif r.incident_type='sales_compound' then
            v_label:='Lead follow-up and contact dependency';
        elsif r.incident_type='knowledge_strategy_compound' then
            v_label:='Knowledge verification as a strategy dependency';
        else
            v_label:=lead_dep.label;
        end if;

        if r.incident_type='cross_domain_pressure' then
            insert into public.innerme_incident_root_analysis(
                incident_id,leading_dependency_id,analysis_status,confidence,leading_factor,
                blocking_factor,evidence_summary,alternative_explanations,next_validation_step,condition_fingerprint
            ) values (
                r.id,lead_dep.id,'no_single_factor','low',v_label,
                'The incident is currently systemic rather than attributable to one verified dependency.',
                'The incident combines multiple independent exception categories. Deterministic evidence supports compound pressure, not a singular cause.',
                '["One category may be a downstream symptom.","The current snapshot does not establish temporal causality between categories."]'::jsonb,
                'Inspect the highest-priority incident in the contributing categories and validate the dependency chain before treating one source as the cause.',
                r.condition_fingerprint
            )
            on conflict(incident_id) do update set
                leading_dependency_id=excluded.leading_dependency_id,analysis_status=excluded.analysis_status,
                confidence=excluded.confidence,leading_factor=excluded.leading_factor,
                blocking_factor=excluded.blocking_factor,evidence_summary=excluded.evidence_summary,
                alternative_explanations=excluded.alternative_explanations,next_validation_step=excluded.next_validation_step,
                condition_fingerprint=excluded.condition_fingerprint,updated_at=now();
        else
            insert into public.innerme_incident_root_analysis(
                incident_id,leading_dependency_id,analysis_status,confidence,leading_factor,
                blocking_factor,evidence_summary,alternative_explanations,next_validation_step,condition_fingerprint
            ) values (
                r.id,lead_dep.id,'active',
                case when r.source_count>=2 and lead_dep.is_unresolved then 'high' else 'medium' end,
                v_label,
                lead_dep.label || ' is the highest-scoring unresolved dependency in the incident evidence graph.',
                'The analysis traces the incident source snapshot into directly related workspace records. It identifies the strongest unresolved dependency but does not establish causation beyond the stored relationships.',
                case r.incident_type
                    when 'sales_delivery_compound' then '["The overdue follow-up may be a symptom of a different sales issue.","The overdue task may be downstream rather than the blocker."]'::jsonb
                    when 'cash_delivery_compound' then '["The overdue invoice may reflect a client-side payment delay rather than a delivery issue.","The overdue task may be operationally independent."]'::jsonb
                    when 'automation_compound' then '["The execution log may be a symptom of an earlier proposal-level failure.","A retry may create additional side effects unless the execution state is validated."]'::jsonb
                    when 'sales_compound' then '["The lead may have disengaged for reasons not recorded in the CRM.","The overdue follow-up may not be the primary commercial blocker."]'::jsonb
                    when 'knowledge_strategy_compound' then '["Pending strategic recommendations may remain valid despite some knowledge debt.","The knowledge review debt may be unrelated to the affected strategy."]'::jsonb
                    else '["The highest-scoring dependency may be downstream rather than causal.","The available workspace records may not contain the true blocking factor."]'::jsonb
                end,
                'Validate the highest-scoring dependency against its linked source record and the surrounding incident evidence before acting.',
                r.condition_fingerprint
            )
            on conflict(incident_id) do update set
                leading_dependency_id=excluded.leading_dependency_id,analysis_status=excluded.analysis_status,
                confidence=excluded.confidence,leading_factor=excluded.leading_factor,
                blocking_factor=excluded.blocking_factor,evidence_summary=excluded.evidence_summary,
                alternative_explanations=excluded.alternative_explanations,next_validation_step=excluded.next_validation_step,
                condition_fingerprint=excluded.condition_fingerprint,updated_at=now();
        end if;

        v_count:=v_count+1;
    end loop;

    return v_count;
end;
$$;
