-- Structured proposal content and immutable revision snapshots.
-- No proposal is sent or accepted by this migration.
begin;

alter table public.lead_proposals
    add column if not exists structured_content jsonb not null default '{}'::jsonb,
    add column if not exists current_version integer not null default 1;

alter table public.lead_proposals
    drop constraint if exists lead_proposals_structured_content_object_check;
alter table public.lead_proposals
    add constraint lead_proposals_structured_content_object_check
    check (jsonb_typeof(structured_content) = 'object');

alter table public.lead_proposals
    drop constraint if exists lead_proposals_current_version_check;
alter table public.lead_proposals
    add constraint lead_proposals_current_version_check
    check (current_version >= 1);

update public.lead_proposals
   set structured_content = jsonb_build_object(
       'schema_version', 1,
       'sections', jsonb_build_object('project_overview', content)
   )
 where structured_content = '{}'::jsonb
   and length(btrim(content)) > 0;

create table if not exists public.lead_proposal_versions (
    id uuid primary key default gen_random_uuid(),
    proposal_id uuid not null
        references public.lead_proposals(id) on delete cascade,
    version_number integer not null check (version_number >= 1),
    title text not null,
    subject text,
    content text not null,
    structured_content jsonb not null default '{}'::jsonb
        check (jsonb_typeof(structured_content) = 'object'),
    assessment_snapshot jsonb not null default '{}'::jsonb,
    status text not null
        check (status = any (array['draft','approved','rejected']::text[])),
    changed_by uuid references public.admin_users(user_id) on delete set null,
    change_reason text not null,
    created_at timestamptz not null default now(),
    constraint lead_proposal_versions_proposal_version_key
        unique (proposal_id, version_number)
);

create index if not exists idx_lead_proposal_versions_proposal_created
    on public.lead_proposal_versions (proposal_id, version_number desc);

alter table public.lead_proposal_versions enable row level security;

drop policy if exists "Swayphics admins can view lead proposal versions"
    on public.lead_proposal_versions;
create policy "Swayphics admins can view lead proposal versions"
    on public.lead_proposal_versions
    for select
    to authenticated
    using (public.is_swayphics_admin());

revoke all on table public.lead_proposal_versions
    from public, anon, authenticated, service_role;
grant select on table public.lead_proposal_versions to authenticated;

insert into public.lead_proposal_versions (
    proposal_id, version_number, title, subject, content, structured_content,
    assessment_snapshot, status, changed_by, change_reason, created_at
)
select
    p.id, p.current_version, p.title, p.subject, p.content, p.structured_content,
    p.assessment_snapshot, p.status, coalesce(p.approved_by, p.created_by),
    'Initial snapshot imported when revision history was enabled',
    coalesce(p.updated_at, p.created_at, now())
from public.lead_proposals p
on conflict (proposal_id, version_number) do nothing;

create or replace function public.prepare_lead_proposal_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_content_changed boolean;
begin
    if tg_op = 'INSERT' then
        new.current_version := 1;
        return new;
    end if;

    v_content_changed :=
        new.title is distinct from old.title
        or new.subject is distinct from old.subject
        or new.content is distinct from old.content
        or new.structured_content is distinct from old.structured_content
        or new.assessment_snapshot is distinct from old.assessment_snapshot;

    if old.status in ('approved', 'rejected')
       and v_content_changed
       and new.status <> 'draft' then
        raise exception 'Create a draft revision before editing an approved or rejected proposal.'
            using errcode = '55000';
    end if;

    if new.status = 'draft' then
        new.approved_by := null;
        new.approved_at := null;
    end if;

    if v_content_changed
       or (
            new.status in ('approved', 'rejected')
            and new.status is distinct from old.status
       ) then
        new.current_version := old.current_version + 1;
    else
        new.current_version := old.current_version;
    end if;

    return new;
end;
$function$;

revoke all on function public.prepare_lead_proposal_version()
    from public, anon, authenticated, service_role;

create or replace function public.capture_lead_proposal_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_reason text;
    v_actor uuid;
begin
    if tg_op = 'UPDATE'
       and new.current_version is not distinct from old.current_version then
        return new;
    end if;

    if tg_op = 'INSERT' then
        v_reason := 'Initial proposal draft';
    elsif new.status = 'approved' and new.status is distinct from old.status then
        v_reason := 'Proposal approved';
    elsif new.status = 'rejected' and new.status is distinct from old.status then
        v_reason := 'Proposal rejected';
    else
        v_reason := 'Proposal draft saved';
    end if;

    v_actor := coalesce(auth.uid(), new.approved_by, new.created_by);

    insert into public.lead_proposal_versions (
        proposal_id, version_number, title, subject, content,
        structured_content, assessment_snapshot, status,
        changed_by, change_reason, created_at
    ) values (
        new.id, new.current_version, new.title, new.subject, new.content,
        new.structured_content, new.assessment_snapshot, new.status,
        v_actor, v_reason, now()
    );

    return new;
end;
$function$;

revoke all on function public.capture_lead_proposal_version()
    from public, anon, authenticated, service_role;

create or replace function public.prevent_lead_proposal_version_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
    raise exception 'Lead proposal revision history is immutable.'
        using errcode = '55000';
end;
$function$;

revoke all on function public.prevent_lead_proposal_version_mutation()
    from public, anon, authenticated, service_role;

drop trigger if exists trg_prepare_lead_proposal_version on public.lead_proposals;
create trigger trg_prepare_lead_proposal_version
before insert or update on public.lead_proposals
for each row
execute function public.prepare_lead_proposal_version();

drop trigger if exists trg_capture_lead_proposal_version on public.lead_proposals;
create trigger trg_capture_lead_proposal_version
after insert or update on public.lead_proposals
for each row
execute function public.capture_lead_proposal_version();

drop trigger if exists trg_prevent_lead_proposal_version_mutation
    on public.lead_proposal_versions;
create trigger trg_prevent_lead_proposal_version_mutation
before update or delete on public.lead_proposal_versions
for each row
execute function public.prevent_lead_proposal_version_mutation();

comment on table public.lead_proposal_versions is
    'Append-only snapshots of each saved Swayphics lead proposal version and its approval state.';
comment on column public.lead_proposals.structured_content is
    'Versioned JSON structure for proposal sections; content remains a plain-text compatibility rendering.';
comment on column public.lead_proposals.current_version is
    'Current immutable snapshot number, advanced transactionally for content or approval changes.';

commit;
