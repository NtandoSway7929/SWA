-- InnerMe Phase 30: Pre-Execution Action Safety Gate
-- Adds a mandatory, audited policy check before controlled actions can be approved or executed.
-- This gate does not execute actions or grant permissions.
-- Depends on Phase 10 action automation and Phase 29 private RPC hardening.

create schema if not exists innerme_private;
revoke all on schema innerme_private from public, anon;
grant usage on schema innerme_private to authenticated;

create table if not exists public.innerme_action_policy_reviews (
    id uuid primary key default gen_random_uuid(),
    proposal_id uuid not null references public.innerme_action_proposals(id) on delete restrict,
    gate_stage text not null check (gate_stage in ('approval','execution')),
    decision text not null check (decision in ('ready','blocked')),
    risk_level text not null check (risk_level in ('medium','high')),
    proposal_fingerprint text not null,
    checks jsonb not null default '[]'::jsonb check (jsonb_typeof(checks) = 'array'),
    blockers jsonb not null default '[]'::jsonb check (jsonb_typeof(blockers) = 'array'),
    reviewed_by uuid not null references auth.users(id) on delete restrict,
    created_at timestamptz not null default now()
);

create index if not exists idx_innerme_action_policy_reviews_proposal_stage
on public.innerme_action_policy_reviews(proposal_id,gate_stage,created_at desc);

create index if not exists idx_innerme_action_policy_reviews_decision
on public.innerme_action_policy_reviews(decision,created_at desc);

alter table public.innerme_action_policy_reviews enable row level security;

drop policy if exists "InnerMe action policy reviews admins can read"
on public.innerme_action_policy_reviews;

create policy "InnerMe action policy reviews admins can read"
on public.innerme_action_policy_reviews
for select to authenticated
using ((select public.is_swayphics_admin()));

revoke all on table public.innerme_action_policy_reviews from public, anon, authenticated;
grant select on table public.innerme_action_policy_reviews to authenticated;
grant all on table public.innerme_action_policy_reviews to service_role;

create or replace function innerme_private.innerme_action_policy_fingerprint(
    p_proposal_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
    v_snapshot jsonb;
begin
    if auth.uid() is null or not public.is_swayphics_admin() then
        raise exception 'Swayphics admin access required.';
    end if;

    select jsonb_build_object(
        'proposal_id',p.id,
        'plan_id',p.plan_id,
        'step_id',p.step_id,
        'action_type',p.action_type,
        'title',p.title,
        'purpose',p.purpose,
        'payload',p.payload,
        'evidence',p.evidence,
        'requires_confirmation',p.requires_confirmation,
        'plan_status',coalesce(pl.status,'missing'),
        'step_status',coalesce(st.status,'missing'),
        'linked_task_id',st.linked_task_id
    )
    into v_snapshot
    from public.innerme_action_proposals p
    left join public.innerme_execution_plans pl on pl.id=p.plan_id
    left join public.innerme_execution_steps st
      on st.id=p.step_id and st.plan_id=p.plan_id
    where p.id=p_proposal_id;

    if not found then
        raise exception 'The InnerMe action proposal could not be found.';
    end if;

    return md5(v_snapshot::text);
end;
$function$;

revoke all on function innerme_private.innerme_action_policy_fingerprint(uuid) from public, anon;
grant execute on function innerme_private.innerme_action_policy_fingerprint(uuid) to authenticated;

create or replace function innerme_private.evaluate_innerme_action_policy(
    p_proposal_id uuid,
    p_stage text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
    v_proposal public.innerme_action_proposals%rowtype;
    v_plan_status text;
    v_step_status text;
    v_linked_task_id uuid;
    v_plan_exists boolean := false;
    v_step_exists boolean := false;
    v_passed boolean := false;
    v_checks jsonb := '[]'::jsonb;
    v_blockers jsonb := '[]'::jsonb;
    v_fingerprint text;
    v_decision text;
    v_risk_level text := 'medium';
    v_reference text;
    v_contact_type text;
    v_due_text text;
    v_due_offset integer;
    v_previous_decision text;
    v_previous_fingerprint text;
    v_has_previous_approval boolean := false;
    v_review_id uuid;
    v_created_at timestamptz;
begin
    if auth.uid() is null or not public.is_swayphics_admin() then
        raise exception 'Swayphics admin access required.';
    end if;

    if p_stage is null or p_stage not in ('approval','execution') then
        raise exception 'Policy stage must be approval or execution.';
    end if;

    select *
    into v_proposal
    from public.innerme_action_proposals
    where id=p_proposal_id
    for update;

    if not found then
        raise exception 'The InnerMe action proposal could not be found.';
    end if;

    -- Permit rechecking a legacy approved proposal so Phase 30 does not strand
    -- pre-existing human approvals. New proposals still require a passing
    -- approval-stage gate before the status can transition to approved.
    if p_stage='approval'
       and not (
          v_proposal.status='proposed'
          or (
              v_proposal.status='approved'
              and v_proposal.reviewed_by is not null
              and v_proposal.approved_at is not null
          )
       ) then
        raise exception 'Approval-stage safety checks require a proposed action or a previously approved action.';
    end if;

    if p_stage='execution'
       and not (
          v_proposal.status='approved'
          and v_proposal.reviewed_by is not null
          and v_proposal.approved_at is not null
       ) then
        raise exception 'Execution-stage safety checks require an explicitly approved action.';
    end if;

    select status into v_plan_status
    from public.innerme_execution_plans
    where id=v_proposal.plan_id;
    v_plan_exists := found;

    select status,linked_task_id
    into v_step_status,v_linked_task_id
    from public.innerme_execution_steps
    where id=v_proposal.step_id
      and plan_id=v_proposal.plan_id;
    v_step_exists := found;

    v_fingerprint := innerme_private.innerme_action_policy_fingerprint(v_proposal.id);
    v_risk_level := case when v_proposal.action_type='send_email' then 'high' else 'medium' end;

    v_passed := (
        (p_stage='approval' and v_proposal.status='proposed')
        or
        (p_stage='approval' and v_proposal.status='approved'
            and v_proposal.reviewed_by is not null and v_proposal.approved_at is not null)
        or
        (p_stage='execution' and v_proposal.status='approved'
            and v_proposal.reviewed_by is not null and v_proposal.approved_at is not null)
    );
    v_checks := v_checks || jsonb_build_array(jsonb_build_object(
        'key','proposal_state','passed',v_passed,
        'detail',case when v_passed then 'Proposal is in a state permitted for this gate.'
                      else 'Proposal state does not permit this gate.' end
    ));
    if not v_passed then
        v_blockers := v_blockers || jsonb_build_array('Proposal state does not permit this gate.');
    end if;

    v_passed := coalesce(v_plan_exists,false) and coalesce(v_plan_status in ('approved','active'),false);
    v_checks := v_checks || jsonb_build_array(jsonb_build_object(
        'key','approved_plan','passed',v_passed,
        'detail',case when v_passed then 'Linked execution plan is approved or active.'
                      else 'The linked execution plan is missing or is not approved/active.' end
    ));
    if not v_passed then
        v_blockers := v_blockers || jsonb_build_array('The linked execution plan is missing or is not approved/active.');
    end if;

    v_passed := coalesce(v_step_exists,false) and coalesce(v_step_status in ('approved','in_progress'),false);
    v_checks := v_checks || jsonb_build_array(jsonb_build_object(
        'key','approved_step','passed',v_passed,
        'detail',case when v_passed then 'Linked step belongs to this plan and is approved/in progress.'
                      else 'The linked execution step is missing, mismatched, or not approved/in progress.' end
    ));
    if not v_passed then
        v_blockers := v_blockers || jsonb_build_array('The linked execution step is missing, mismatched, or not approved/in progress.');
    end if;

    v_passed := v_proposal.requires_confirmation is true;
    v_checks := v_checks || jsonb_build_array(jsonb_build_object(
        'key','explicit_confirmation','passed',v_passed,
        'detail',case when v_passed then 'Explicit human approval and execution remain required.'
                      else 'The proposal does not enforce explicit confirmation.' end
    ));
    if not v_passed then
        v_blockers := v_blockers || jsonb_build_array('The proposal must require explicit confirmation.');
    end if;

    v_passed := v_proposal.action_type in ('create_task','send_email');
    v_checks := v_checks || jsonb_build_array(jsonb_build_object(
        'key','allowed_action_type','passed',v_passed,
        'detail',case when v_passed then 'Action type is on the controlled allowlist.'
                      else 'Action type is not enabled for controlled execution.' end
    ));
    if not v_passed then
        v_blockers := v_blockers || jsonb_build_array('Action type is not enabled for controlled execution.');
    end if;

    select exists (
        select 1
        from jsonb_array_elements(
            case when jsonb_typeof(v_proposal.evidence)='array'
                 then v_proposal.evidence else '[]'::jsonb end
        ) as evidence_item(value)
        where jsonb_typeof(evidence_item.value)='object'
          and nullif(trim(coalesce(evidence_item.value->>'id','')),'') is not null
          and nullif(trim(coalesce(evidence_item.value->>'why','')),'') is not null
    ) into v_passed;
    v_checks := v_checks || jsonb_build_array(jsonb_build_object(
        'key','grounded_evidence','passed',v_passed,
        'detail',case when v_passed then 'At least one evidence item identifies a source record and explains its relevance.'
                      else 'Evidence must include at least one source record ID and a reason supporting this action.' end
    ));
    if not v_passed then
        v_blockers := v_blockers || jsonb_build_array('Evidence must include at least one source record ID and a reason supporting this action.');
    end if;

    if v_proposal.action_type='create_task' then
        v_passed := coalesce(nullif(trim(v_proposal.payload->>'title'),''),nullif(trim(v_proposal.title),'')) is not null;
        v_checks := v_checks || jsonb_build_array(jsonb_build_object(
            'key','task_title','passed',v_passed,
            'detail',case when v_passed then 'Task title is present.' else 'A task title is required.' end
        ));
        if not v_passed then
            v_blockers := v_blockers || jsonb_build_array('A task title is required.');
        end if;

        v_reference := nullif(trim(coalesce(v_proposal.payload->>'priority','')),'');
        v_passed := v_reference is null or v_reference in ('low','medium','high');
        v_checks := v_checks || jsonb_build_array(jsonb_build_object(
            'key','task_priority','passed',v_passed,
            'detail',case when v_passed then 'Task priority is valid or defaults safely to medium.'
                          else 'Task priority must be low, medium, or high.' end
        ));
        if not v_passed then
            v_blockers := v_blockers || jsonb_build_array('Task priority must be low, medium, or high.');
        end if;

        v_due_text := nullif(trim(coalesce(v_proposal.payload->>'due_offset_days','')),'');
        if v_due_text is null then
            v_passed := true;
        elsif v_due_text ~ '^[0-9]{1,3}$' then
            v_due_offset := v_due_text::integer;
            v_passed := v_due_offset between 0 and 365;
        else
            v_passed := false;
        end if;
        v_checks := v_checks || jsonb_build_array(jsonb_build_object(
            'key','task_due_offset','passed',v_passed,
            'detail',case when v_passed then 'Task timing is valid or intentionally unspecified.'
                          else 'Task due offset must be a whole number from 0 to 365 days.' end
        ));
        if not v_passed then
            v_blockers := v_blockers || jsonb_build_array('Task due offset must be a whole number from 0 to 365 days.');
        end if;

        foreach v_reference in array array[
            nullif(trim(coalesce(v_proposal.payload->>'client_id','')),''),
            nullif(trim(coalesce(v_proposal.payload->>'project_id','')),''),
            nullif(trim(coalesce(v_proposal.payload->>'lead_id','')),'')
        ] loop
            if v_reference is null then
                continue;
            end if;

            v_passed := v_reference ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
            if v_passed then
                if v_reference = nullif(trim(coalesce(v_proposal.payload->>'client_id','')),'') then
                    select exists(select 1 from public.clients where id=v_reference::uuid) into v_passed;
                elsif v_reference = nullif(trim(coalesce(v_proposal.payload->>'project_id','')),'') then
                    select exists(select 1 from public.client_projects where id=v_reference::uuid) into v_passed;
                else
                    select exists(select 1 from public.leads where id=v_reference::uuid) into v_passed;
                end if;
            end if;

            v_checks := v_checks || jsonb_build_array(jsonb_build_object(
                'key','linked_record','passed',v_passed,
                'detail',case when v_passed then 'Referenced workspace record exists.'
                              else 'A referenced client, project, or lead is invalid or no longer exists.' end
            ));
            if not v_passed then
                v_blockers := v_blockers || jsonb_build_array('A referenced client, project, or lead is invalid or no longer exists.');
            end if;
        end loop;

        v_passed := v_step_exists and v_linked_task_id is null;
        v_checks := v_checks || jsonb_build_array(jsonb_build_object(
            'key','duplicate_task_guard','passed',v_passed,
            'detail',case when v_passed then 'No task is already linked to this execution step.'
                          else 'The execution step already has a linked task or is unavailable.' end
        ));
        if not v_passed then
            v_blockers := v_blockers || jsonb_build_array('The execution step already has a linked task or is unavailable.');
        end if;

    elsif v_proposal.action_type='send_email' then
        v_contact_type := nullif(trim(coalesce(v_proposal.payload->>'contact_type','')),'');
        v_reference := nullif(trim(coalesce(v_proposal.payload->>'contact_id','')),'');

        if v_contact_type='lead'
           and v_reference ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
            select exists(
                select 1 from public.leads
                where id=v_reference::uuid
                  and nullif(trim(coalesce(email,'')),'') is not null
            ) into v_passed;
        elsif v_contact_type='client'
           and v_reference ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
            select exists(
                select 1 from public.clients
                where id=v_reference::uuid
                  and nullif(trim(coalesce(email,'')),'') is not null
            ) into v_passed;
        else
            v_passed := false;
        end if;

        v_checks := v_checks || jsonb_build_array(jsonb_build_object(
            'key','recipient','passed',v_passed,
            'detail',case when v_passed then 'Exact lead/client recipient exists and has an email address.'
                          else 'Email actions require an existing lead/client ID with a recorded email address.' end
        ));
        if not v_passed then
            v_blockers := v_blockers || jsonb_build_array('Email actions require an existing lead/client ID with a recorded email address.');
        end if;

        v_passed := nullif(trim(coalesce(v_proposal.payload->>'subject','')),'') is not null;
        v_checks := v_checks || jsonb_build_array(jsonb_build_object(
            'key','email_subject','passed',v_passed,
            'detail',case when v_passed then 'Email subject is present.' else 'Email subject is required.' end
        ));
        if not v_passed then
            v_blockers := v_blockers || jsonb_build_array('Email subject is required.');
        end if;

        v_passed := nullif(trim(coalesce(v_proposal.payload->>'message','')),'') is not null;
        v_checks := v_checks || jsonb_build_array(jsonb_build_object(
            'key','email_message','passed',v_passed,
            'detail',case when v_passed then 'Email message is present.' else 'Email message is required.' end
        ));
        if not v_passed then
            v_blockers := v_blockers || jsonb_build_array('Email message is required.');
        end if;
    end if;

    select not exists (
        select 1 from public.innerme_action_execution_logs
        where proposal_id=v_proposal.id
    ) into v_passed;
    v_checks := v_checks || jsonb_build_array(jsonb_build_object(
        'key','no_prior_execution','passed',v_passed,
        'detail',case when v_passed then 'No prior execution attempt exists for this proposal.'
                      else 'An execution attempt already exists; reconcile its result instead of retrying this proposal.' end
    ));
    if not v_passed then
        v_blockers := v_blockers || jsonb_build_array('An execution attempt already exists; reconcile its result instead of retrying this proposal.');
    end if;

    if p_stage='execution' then
        select decision,proposal_fingerprint
        into v_previous_decision,v_previous_fingerprint
        from public.innerme_action_policy_reviews
        where proposal_id=v_proposal.id
          and gate_stage='approval'
        order by created_at desc,id desc
        limit 1;
        v_has_previous_approval := found;

        v_passed := coalesce(
            v_has_previous_approval
            and v_previous_decision='ready'
            and v_previous_fingerprint=v_fingerprint,
            false
        );
        v_checks := v_checks || jsonb_build_array(jsonb_build_object(
            'key','fresh_approval_gate','passed',v_passed,
            'detail',case when v_passed then 'The latest approval-stage safety check still matches the current proposal.'
                          else 'Run a fresh passing approval-stage safety check before execution.' end
        ));
        if not v_passed then
            v_blockers := v_blockers || jsonb_build_array('Run a fresh passing approval-stage safety check before execution.');
        end if;
    end if;

    v_decision := case when jsonb_array_length(v_blockers)=0 then 'ready' else 'blocked' end;

    insert into public.innerme_action_policy_reviews(
        proposal_id,gate_stage,decision,risk_level,proposal_fingerprint,
        checks,blockers,reviewed_by
    )
    values (
        v_proposal.id,p_stage,v_decision,v_risk_level,v_fingerprint,
        v_checks,v_blockers,auth.uid()
    )
    returning id,created_at into v_review_id,v_created_at;

    return jsonb_build_object(
        'id',v_review_id,
        'proposal_id',v_proposal.id,
        'gate_stage',p_stage,
        'decision',v_decision,
        'risk_level',v_risk_level,
        'checks',v_checks,
        'blockers',v_blockers,
        'proposal_fingerprint',v_fingerprint,
        'created_at',v_created_at,
        'execution_authority_granted',false
    );
end;
$function$;

revoke all on function innerme_private.evaluate_innerme_action_policy(uuid,text) from public, anon;
grant execute on function innerme_private.evaluate_innerme_action_policy(uuid,text) to authenticated;

create or replace function public.evaluate_innerme_action_policy(
    p_proposal_id uuid,
    p_stage text
)
returns jsonb
language sql
security invoker
set search_path = public
as $function$
    select innerme_private.evaluate_innerme_action_policy(p_proposal_id,p_stage);
$function$;

revoke all on function public.evaluate_innerme_action_policy(uuid,text) from public, anon;
grant execute on function public.evaluate_innerme_action_policy(uuid,text) to authenticated;

create or replace function public.review_innerme_action_proposal(
    p_proposal_id uuid,
    p_decision text
)
returns public.innerme_action_proposals
language plpgsql
security invoker
set search_path = public
as $function$
declare
    v_proposal public.innerme_action_proposals;
    v_decision text := lower(trim(coalesce(p_decision,'')));
    v_fingerprint text;
    v_gate_decision text;
    v_gate_fingerprint text;
begin
    if not public.is_swayphics_admin() then
        raise exception 'Only active Swayphics admins can review InnerMe action proposals.';
    end if;

    if v_decision not in ('approved','rejected','cancelled') then
        raise exception 'Action proposal review must be approved, rejected or cancelled.';
    end if;

    select * into v_proposal
    from public.innerme_action_proposals
    where id=p_proposal_id
    for update;

    if not found then
        raise exception 'The InnerMe action proposal could not be found.';
    end if;

    if v_proposal.status <> 'proposed' then
        raise exception 'Only proposed InnerMe actions can be reviewed.';
    end if;

    if v_decision='approved' then
        v_fingerprint := innerme_private.innerme_action_policy_fingerprint(v_proposal.id);

        select decision,proposal_fingerprint
        into v_gate_decision,v_gate_fingerprint
        from public.innerme_action_policy_reviews
        where proposal_id=v_proposal.id
          and gate_stage='approval'
        order by created_at desc,id desc
        limit 1;

        if not found
           or v_gate_decision <> 'ready'
           or v_gate_fingerprint is distinct from v_fingerprint then
            raise exception 'Run a fresh passing safety check before approving this action.';
        end if;
    end if;

    update public.innerme_action_proposals
    set status=v_decision,
        reviewed_by=auth.uid(),
        approved_at=case when v_decision='approved' then now() else null end,
        updated_at=now()
    where id=v_proposal.id
    returning * into v_proposal;

    return v_proposal;
end;
$function$;

revoke all on function public.review_innerme_action_proposal(uuid,text) from public, anon;
grant execute on function public.review_innerme_action_proposal(uuid,text) to authenticated;

create or replace function public.guard_innerme_action_policy_status_transition()
returns trigger
language plpgsql
security invoker
set search_path = public
as $function$
declare
    v_fingerprint text;
    v_gate_decision text;
    v_gate_fingerprint text;
begin
    if new.status is not distinct from old.status then
        return new;
    end if;

    if old.status='proposed' and new.status in ('rejected','cancelled') then
        return new;
    end if;

    if old.status='approved' and new.status in ('rejected','cancelled') then
        return new;
    end if;

    if old.status='proposed' and new.status='approved' then
        v_fingerprint := innerme_private.innerme_action_policy_fingerprint(old.id);

        select decision,proposal_fingerprint
        into v_gate_decision,v_gate_fingerprint
        from public.innerme_action_policy_reviews
        where proposal_id=old.id
          and gate_stage='approval'
        order by created_at desc,id desc
        limit 1;

        if not found
           or v_gate_decision <> 'ready'
           or v_gate_fingerprint is distinct from v_fingerprint then
            raise exception 'Action approval blocked: run a fresh passing safety check first.';
        end if;
        return new;
    end if;

    if old.status='approved' and new.status='executing' then
        v_fingerprint := innerme_private.innerme_action_policy_fingerprint(old.id);

        select decision,proposal_fingerprint
        into v_gate_decision,v_gate_fingerprint
        from public.innerme_action_policy_reviews
        where proposal_id=old.id
          and gate_stage='execution'
        order by created_at desc,id desc
        limit 1;

        if not found
           or v_gate_decision <> 'ready'
           or v_gate_fingerprint is distinct from v_fingerprint then
            raise exception 'Action execution blocked: run a fresh passing execution safety check first.';
        end if;
        return new;
    end if;

    if old.status='executing' and new.status in ('executed','failed') then
        return new;
    end if;

    raise exception 'Blocked InnerMe action status transition: % -> %.',old.status,new.status;
end;
$function$;

revoke all on function public.guard_innerme_action_policy_status_transition() from public, anon, authenticated;

drop trigger if exists guard_innerme_action_policy_status_transition
on public.innerme_action_proposals;

create trigger guard_innerme_action_policy_status_transition
before update of status on public.innerme_action_proposals
for each row
execute function public.guard_innerme_action_policy_status_transition();

notify pgrst,'reload schema';
