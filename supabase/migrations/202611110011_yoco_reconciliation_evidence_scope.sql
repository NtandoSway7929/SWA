-- Stage 1.54: constrain evidence capture to Yoco test reconciliation cases.
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

revoke all on function public.admin_add_payment_reconciliation_evidence(uuid, text, text, text)
    from public, anon;
grant execute on function public.admin_add_payment_reconciliation_evidence(uuid, text, text, text)
    to authenticated;

commit;
