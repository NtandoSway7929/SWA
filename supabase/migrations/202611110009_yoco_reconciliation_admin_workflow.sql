-- Stage 1.52: append-only Yoco reconciliation evidence and admin workflow RPCs.
-- Feature branch only. Not approved for production execution.
begin;

create table if not exists public.payment_reconciliation_evidence (
    id uuid primary key default gen_random_uuid(),
    reconciliation_id uuid not null
        references public.payment_reconciliation(id) on delete restrict,
    evidence_type text not null check (evidence_type in (
        'provider_dashboard',
        'bank_statement',
        'client_confirmation',
        'provider_support',
        'internal_review',
        'other'
    )),
    reference text,
    note text not null,
    created_by uuid not null references auth.users(id) on delete restrict,
    created_at timestamptz not null default now(),
    constraint payment_reconciliation_evidence_reference_length
        check (reference is null or length(btrim(reference)) between 1 and 240),
    constraint payment_reconciliation_evidence_note_length
        check (length(btrim(note)) between 1 and 2000)
);

create index if not exists payment_reconciliation_evidence_case_created_idx
    on public.payment_reconciliation_evidence(reconciliation_id, created_at, id);

create table if not exists public.payment_reconciliation_actions (
    id uuid primary key default gen_random_uuid(),
    reconciliation_id uuid not null
        references public.payment_reconciliation(id) on delete restrict,
    action text not null check (action in (
        'investigation_started',
        'investigation_reopened',
        'evidence_added',
        'case_resolved',
        'case_dismissed'
    )),
    previous_status text not null check (previous_status in ('open','investigating','resolved','dismissed')),
    new_status text not null check (new_status in ('open','investigating','resolved','dismissed')),
    outcome text check (outcome in (
        'provider_state_confirmed',
        'duplicate_or_replay',
        'financial_correction_recorded',
        'no_financial_effect',
        'false_positive'
    )),
    reason text,
    related_payment_id uuid references public.payments(id) on delete restrict,
    related_refund_id uuid references public.payment_refunds(id) on delete restrict,
    actor_user_id uuid not null references auth.users(id) on delete restrict,
    created_at timestamptz not null default now(),
    constraint payment_reconciliation_actions_reason_length
        check (reason is null or length(btrim(reason)) between 1 and 2000),
    constraint payment_reconciliation_actions_financial_reference
        check (outcome <> 'financial_correction_recorded'
            or related_payment_id is not null or related_refund_id is not null)
);

create index if not exists payment_reconciliation_actions_case_created_idx
    on public.payment_reconciliation_actions(reconciliation_id, created_at, id);

alter table public.payment_reconciliation_evidence enable row level security;
alter table public.payment_reconciliation_actions enable row level security;

revoke all privileges on table
    public.payment_reconciliation_evidence,
    public.payment_reconciliation_actions
from public, anon, authenticated;

grant select on table
    public.payment_reconciliation_evidence,
    public.payment_reconciliation_actions
to service_role;

create or replace function public.prevent_yoco_reconciliation_history_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    raise exception 'Reconciliation evidence and action history are append-only.'
        using errcode = '55000';
end;
$$;

revoke all on function public.prevent_yoco_reconciliation_history_mutation()
    from public, anon, authenticated, service_role;

drop trigger if exists payment_reconciliation_evidence_immutable
    on public.payment_reconciliation_evidence;
create trigger payment_reconciliation_evidence_immutable
before update or delete on public.payment_reconciliation_evidence
for each row execute function public.prevent_yoco_reconciliation_history_mutation();

drop trigger if exists payment_reconciliation_actions_immutable
    on public.payment_reconciliation_actions;
create trigger payment_reconciliation_actions_immutable
before update or delete on public.payment_reconciliation_actions
for each row execute function public.prevent_yoco_reconciliation_history_mutation();

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

create or replace function public.admin_set_payment_reconciliation_status(
    p_reconciliation_id uuid,
    p_new_status text,
    p_reason text default null,
    p_outcome text default null,
    p_related_payment_id uuid default null,
    p_related_refund_id uuid default null
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
            where p.id = p_related_payment_id and p.provider = 'yoco'
        ) then
            raise exception 'The referenced Yoco payment does not exist.';
        end if;
        if p_related_refund_id is not null and not exists (
            select 1 from public.payment_refunds r
            where r.id = p_related_refund_id and r.provider = 'yoco'
        ) then
            raise exception 'The referenced Yoco refund does not exist.';
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

revoke all on function public.admin_add_payment_reconciliation_evidence(uuid, text, text, text)
    from public, anon;
grant execute on function public.admin_add_payment_reconciliation_evidence(uuid, text, text, text)
    to authenticated;

revoke all on function public.admin_set_payment_reconciliation_status(uuid, text, text, text, uuid, uuid)
    from public, anon;
grant execute on function public.admin_set_payment_reconciliation_status(uuid, text, text, text, uuid, uuid)
    to authenticated;

commit;
