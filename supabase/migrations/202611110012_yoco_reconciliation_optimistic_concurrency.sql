-- Stage 1.59: optimistic concurrency for administrator reconciliation decisions.
-- Feature branch only. Do not execute against production without separate approval.
begin;

create or replace function public.admin_add_payment_reconciliation_evidence(
    p_reconciliation_id uuid,
    p_evidence_type text,
    p_note text,
    p_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := auth.uid();
    v_case public.payment_reconciliation%rowtype;
    v_evidence_id uuid;
begin
    if v_actor is null or not coalesce(public.is_swayphics_admin(), false) then
        raise exception 'Administrator access is required.' using errcode = '42501';
    end if;
    if p_reconciliation_id is null then
        raise exception 'A reconciliation case is required.';
    end if;
    if p_evidence_type is null or p_evidence_type not in (
        'provider_dashboard','bank_statement','client_confirmation',
        'provider_support','internal_review','other'
    ) then
        raise exception 'Unsupported evidence category.';
    end if;
    if p_note is null or length(btrim(p_note)) not between 1 and 2000 then
        raise exception 'Evidence notes must contain between 1 and 2000 characters.';
    end if;
    if p_reference is not null and length(btrim(p_reference)) not between 1 and 240 then
        raise exception 'Evidence reference must contain between 1 and 240 characters.';
    end if;

    select c.* into v_case
    from public.payment_reconciliation c
    where c.id = p_reconciliation_id
    for update;
    if not found then
        raise exception 'Reconciliation case not found.';
    end if;
    if v_case.provider <> 'yoco' or v_case.environment <> 'test' then
        raise exception 'Evidence can only be added to Yoco test reconciliation cases.';
    end if;
    if v_case.status in ('resolved','dismissed') then
        raise exception 'Evidence cannot be added to a closed reconciliation case.';
    end if;

    -- Evidence changes the case version so stale decisions cannot ignore new evidence.
    update public.payment_reconciliation set updated_at = now() where id = p_reconciliation_id;

    insert into public.payment_reconciliation_evidence (
        reconciliation_id, evidence_type, reference, note, created_by
    ) values (
        p_reconciliation_id, p_evidence_type, nullif(btrim(p_reference), ''),
        btrim(p_note), v_actor
    ) returning id into v_evidence_id;

    insert into public.payment_reconciliation_actions (
        reconciliation_id, action, previous_status, new_status, actor_user_id, reason
    ) values (
        p_reconciliation_id, 'evidence_added', v_case.status, v_case.status, v_actor,
        'Evidence record ' || v_evidence_id::text || ' added.'
    );

    return v_evidence_id;
end;
$$;


revoke all on function public.admin_add_payment_reconciliation_evidence(uuid, text, text, text) from public, anon;
grant execute on function public.admin_add_payment_reconciliation_evidence(uuid, text, text, text) to authenticated;

create or replace function public.admin_set_payment_reconciliation_status_v2(
    p_reconciliation_id uuid,
    p_new_status text,
    p_reason text default null,
    p_outcome text default null,
    p_related_payment_id uuid default null,
    p_related_refund_id uuid default null,
    p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := auth.uid();
    v_case public.payment_reconciliation%rowtype;
    v_action text;
    v_case_invoice_id uuid;
begin
    if v_actor is null or not coalesce(public.is_swayphics_admin(), false) then
        raise exception 'Administrator access is required.' using errcode = '42501';
    end if;
    if p_reconciliation_id is null then
        raise exception 'A reconciliation case is required.';
    end if;
    if p_new_status is null or p_new_status not in ('open','investigating','resolved','dismissed') then
        raise exception 'Unsupported reconciliation status.';
    end if;
    if p_reason is null or length(btrim(p_reason)) not between 1 and 2000 then
        raise exception 'A reason between 1 and 2000 characters is required.';
    end if;

    select c.* into v_case
    from public.payment_reconciliation c
    where c.id = p_reconciliation_id
    for update;
    if not found then
        raise exception 'Reconciliation case not found.';
    end if;

    if p_expected_updated_at is null or v_case.updated_at is distinct from p_expected_updated_at then
        raise exception 'This case changed after it was loaded. Refresh the case and review its latest status and history before trying again.'
            using errcode = '40001';
    end if;
    if v_case.provider <> 'yoco' or v_case.environment <> 'test' then
        raise exception 'Only Yoco test reconciliation cases can be changed.';
    end if;

    -- Resolve the invoice from the case's own immutable financial anchors.
    v_case_invoice_id := coalesce(
        (select a.invoice_id
         from public.payment_attempts a
         where a.id = v_case.payment_attempt_id
           and a.provider = 'yoco'
           and a.environment = 'test'),
        (select p.invoice_id
         from public.payments p
         where p.id = v_case.payment_id
           and p.provider = 'yoco'),
        (select p.invoice_id
         from public.payment_refunds r
         join public.payments p on p.id = r.payment_id
         where r.id = v_case.refund_id
           and r.provider = 'yoco'
           and r.environment = 'test'
           and p.provider = 'yoco')
    );
    if v_case_invoice_id is null then
        raise exception 'The reconciliation case has no valid Yoco invoice anchor.';
    end if;

    if v_case.status in ('resolved','dismissed') then
        raise exception 'Closed reconciliation cases cannot be changed.';
    end if;
    if v_case.status = p_new_status then
        raise exception 'The reconciliation case is already in that status.';
    end if;
    if not (
        (v_case.status = 'open' and p_new_status = 'investigating')
        or (v_case.status = 'investigating' and p_new_status in ('open','resolved','dismissed'))
    ) then
        raise exception 'That reconciliation status transition is not permitted.';
    end if;

    if p_new_status in ('resolved','dismissed') then
        if p_outcome is null or p_outcome not in (
            'provider_state_confirmed','duplicate_or_replay',
            'financial_correction_recorded','no_financial_effect','false_positive'
        ) then
            raise exception 'A valid outcome is required to close a reconciliation case.';
        end if;
    elsif p_outcome is not null or p_related_payment_id is not null or p_related_refund_id is not null then
        raise exception 'Outcome and financial references are only allowed when closing a case.';
    end if;

    if p_outcome = 'financial_correction_recorded' then
        if p_related_payment_id is null and p_related_refund_id is null then
            raise exception 'A separately recorded payment or refund reference is required.';
        end if;
        if p_related_payment_id is not null and not exists (
            select 1 from public.payments p
            where p.id = p_related_payment_id
              and p.provider = 'yoco'
              and p.invoice_id = v_case_invoice_id
        ) then
            raise exception 'The referenced Yoco payment does not belong to this reconciliation invoice.';
        end if;
        if p_related_refund_id is not null and not exists (
            select 1
            from public.payment_refunds r
            join public.payments p on p.id = r.payment_id
            where r.id = p_related_refund_id
              and r.provider = 'yoco'
              and r.environment = 'test'
              and p.provider = 'yoco'
              and p.invoice_id = v_case_invoice_id
        ) then
            raise exception 'The referenced Yoco refund does not belong to this reconciliation invoice.';
        end if;
    elsif p_related_payment_id is not null or p_related_refund_id is not null then
        raise exception 'Financial references require the financial-correction outcome.';
    end if;

    v_action := case
        when p_new_status = 'investigating' then 'investigation_started'
        when p_new_status = 'open' then 'investigation_reopened'
        when p_new_status = 'resolved' then 'case_resolved'
        else 'case_dismissed'
    end;

    update public.payment_reconciliation
    set status = p_new_status,
        resolution = case when p_new_status in ('resolved','dismissed') then btrim(p_reason) else resolution end,
        resolved_at = case when p_new_status in ('resolved','dismissed') then now() else null end,
        updated_at = now()
    where id = p_reconciliation_id;

    insert into public.payment_reconciliation_actions (
        reconciliation_id, action, previous_status, new_status, outcome,
        reason, related_payment_id, related_refund_id, actor_user_id
    ) values (
        p_reconciliation_id, v_action, v_case.status, p_new_status, p_outcome,
        btrim(p_reason), p_related_payment_id, p_related_refund_id, v_actor
    );

    return jsonb_build_object(
        'reconciliation_id', p_reconciliation_id,
        'previous_status', v_case.status,
        'status', p_new_status,
        'outcome', p_outcome
    );
end;
$$;


revoke all on function public.admin_set_payment_reconciliation_status_v2(uuid, text, text, text, uuid, uuid, timestamptz)
    from public, anon;
grant execute on function public.admin_set_payment_reconciliation_status_v2(uuid, text, text, text, uuid, uuid, timestamptz)
    to authenticated;

-- The UI must use the version-checked RPC; prevent authenticated callers from
-- bypassing the optimistic concurrency check through the legacy signature.
revoke execute on function public.admin_set_payment_reconciliation_status(uuid, text, text, text, uuid, uuid)
    from authenticated;

commit;
