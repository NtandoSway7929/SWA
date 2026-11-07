-- Private, versioned demo assets linked to the lead and proposal they support.
-- The expiry value for each share is explicit; no retention interval is set here.

create table if not exists public.proposal_demo_versions (
    id uuid primary key default gen_random_uuid(),
    lead_id uuid not null references public.leads(id) on delete restrict,
    proposal_id uuid not null references public.lead_proposals(id) on delete restrict,
    version_number integer not null,
    title text not null check (length(trim(title)) between 1 and 160),
    asset_kind text not null check (asset_kind in ('file', 'static_site', 'hybrid')),
    file_name text,
    entry_path text,
    status text not null default 'draft' check (status in ('draft', 'published')),
    created_by uuid,
    created_at timestamptz not null default now(),
    published_at timestamptz,
    constraint proposal_demo_versions_number_unique unique (proposal_id, version_number),
    constraint proposal_demo_versions_kind_shape check (
        (asset_kind = 'file' and file_name is not null and entry_path is null)
        or (asset_kind = 'static_site' and file_name is null and entry_path is not null)
        or (asset_kind = 'hybrid' and file_name is not null and entry_path is not null)
    ),
    constraint proposal_demo_versions_file_name_safe check (
        file_name is null
        or (
            length(file_name) between 1 and 180
            and file_name not in ('.', '..')
            and position('/' in file_name) = 0
            and position(chr(92) in file_name) = 0
        )
    ),
    constraint proposal_demo_versions_entry_path_safe check (
        entry_path is null
        or (
            length(entry_path) between 1 and 512
            and left(entry_path, 1) <> '/'
            and position(chr(92) in entry_path) = 0
            and entry_path !~ '(^|/)[.][.]?(/|$)'
        )
    ),
    constraint proposal_demo_versions_publication_state check (
        (status = 'draft' and published_at is null)
        or (status = 'published' and published_at is not null)
    )
);

create table if not exists public.proposal_demo_shares (
    id uuid primary key default gen_random_uuid(),
    demo_version_id uuid not null references public.proposal_demo_versions(id) on delete restrict,
    target_type text not null check (target_type in ('file', 'static_site')),
    token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
    expires_at timestamptz not null,
    created_by uuid,
    created_at timestamptz not null default now(),
    revoked_at timestamptz,
    revoked_by uuid,
    constraint proposal_demo_shares_expiry_after_creation check (expires_at > created_at),
    constraint proposal_demo_shares_revocation_pair check (
        (revoked_at is null and revoked_by is null)
        or (revoked_at is not null and revoked_by is not null)
    )
);

create or replace function public.prepare_proposal_demo_share()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_asset_kind text;
    v_file_name text;
    v_entry_path text;
    v_version_status text;
begin
    select version.asset_kind, version.file_name, version.entry_path, version.status
    into v_asset_kind, v_file_name, v_entry_path, v_version_status
    from public.proposal_demo_versions as version
    where version.id = new.demo_version_id;

    if not found
       or v_version_status <> 'published'
       or (new.target_type = 'file' and (v_asset_kind not in ('file', 'hybrid') or v_file_name is null))
       or (new.target_type = 'static_site' and (v_asset_kind not in ('static_site', 'hybrid') or v_entry_path is null)) then
        raise exception 'The share target is not present in the published demo version.'
            using errcode = '23514';
    end if;

    if new.expires_at <= now() then
        raise exception 'The share expiry must be in the future.'
            using errcode = '23514';
    end if;

    return new;
end;
$$;

create index if not exists proposal_demo_versions_lead_idx
    on public.proposal_demo_versions (lead_id, created_at desc);

create index if not exists proposal_demo_versions_proposal_idx
    on public.proposal_demo_versions (proposal_id, version_number desc);

create index if not exists proposal_demo_shares_version_idx
    on public.proposal_demo_shares (demo_version_id, created_at desc);

create or replace function public.prepare_proposal_demo_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_proposal_lead_id uuid;
begin
    select proposal.lead_id
    into v_proposal_lead_id
    from public.lead_proposals as proposal
    where proposal.id = new.proposal_id
    for update;

    if not found or v_proposal_lead_id is distinct from new.lead_id then
        raise exception 'Proposal does not belong to the selected lead.'
            using errcode = '23514';
    end if;

    select coalesce(max(version.version_number), 0) + 1
    into new.version_number
    from public.proposal_demo_versions as version
    where version.proposal_id = new.proposal_id;

    new.status := 'draft';
    new.published_at := null;
    return new;
end;
$$;

create or replace function public.guard_proposal_demo_version_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if tg_op = 'DELETE' then
        raise exception 'Demo version history cannot be deleted before its retention policy is approved.'
            using errcode = '55000';
    end if;

    if old.status <> 'draft'
       or new.status <> 'published'
       or new.published_at is distinct from old.published_at
       or new.id is distinct from old.id
       or new.lead_id is distinct from old.lead_id
       or new.proposal_id is distinct from old.proposal_id
       or new.version_number is distinct from old.version_number
       or new.title is distinct from old.title
       or new.asset_kind is distinct from old.asset_kind
       or new.file_name is distinct from old.file_name
       or new.entry_path is distinct from old.entry_path
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
        raise exception 'A demo version may only be published once; its contents are immutable.'
            using errcode = '55000';
    end if;

    new.published_at := now();
    return new;
end;
$$;

drop trigger if exists proposal_demo_versions_prepare_insert
    on public.proposal_demo_versions;
create trigger proposal_demo_versions_prepare_insert
before insert on public.proposal_demo_versions
for each row execute function public.prepare_proposal_demo_version();

drop trigger if exists proposal_demo_versions_guard_mutation
    on public.proposal_demo_versions;
create trigger proposal_demo_versions_guard_mutation
before update or delete on public.proposal_demo_versions
for each row execute function public.guard_proposal_demo_version_mutation();

create or replace function public.guard_proposal_demo_share_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if tg_op = 'DELETE' then
        raise exception 'Demo share history cannot be deleted directly.'
            using errcode = '55000';
    end if;

    if old.revoked_at is not null
       or new.revoked_at is null
       or new.revoked_by is null
       or new.id is distinct from old.id
       or new.demo_version_id is distinct from old.demo_version_id
       or new.target_type is distinct from old.target_type
       or new.token_hash is distinct from old.token_hash
       or new.expires_at is distinct from old.expires_at
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
        raise exception 'A demo share may only be revoked once.'
            using errcode = '55000';
    end if;

    return new;
end;
$$;

drop trigger if exists proposal_demo_shares_guard_mutation
    on public.proposal_demo_shares;
create trigger proposal_demo_shares_guard_mutation
before update or delete on public.proposal_demo_shares
for each row execute function public.guard_proposal_demo_share_mutation();

drop trigger if exists proposal_demo_shares_prepare_insert
    on public.proposal_demo_shares;
create trigger proposal_demo_shares_prepare_insert
before insert on public.proposal_demo_shares
for each row execute function public.prepare_proposal_demo_share();

alter table public.proposal_demo_versions enable row level security;
alter table public.proposal_demo_shares enable row level security;

revoke all on table public.proposal_demo_versions from anon, authenticated;
revoke all on table public.proposal_demo_shares from anon, authenticated;
grant select on table public.proposal_demo_versions to authenticated;
grant select (
    id,
    demo_version_id,
    target_type,
    expires_at,
    created_by,
    created_at,
    revoked_at,
    revoked_by
) on table public.proposal_demo_shares to authenticated;
grant all on table public.proposal_demo_versions to service_role;
grant all on table public.proposal_demo_shares to service_role;

drop policy if exists "Swayphics admins can read proposal demo versions"
    on public.proposal_demo_versions;
create policy "Swayphics admins can read proposal demo versions"
on public.proposal_demo_versions
for select to authenticated
using ((select public.is_swayphics_admin()));

drop policy if exists "Swayphics admins can read proposal demo shares"
    on public.proposal_demo_shares;
create policy "Swayphics admins can read proposal demo shares"
on public.proposal_demo_shares
for select to authenticated
using ((select public.is_swayphics_admin()));

-- A separate private bucket keeps demos out of the public portfolio bucket and
-- prevents direct updates/deletes. The Edge Function is the only public-share path.
insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
values (
    'swayphics-proposal-demos',
    'swayphics-proposal-demos',
    false,
    52428800,
    array[
        'text/html', 'text/css', 'text/javascript', 'application/javascript',
        'application/json', 'text/plain', 'application/pdf',
        'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml',
        'font/woff', 'font/woff2', 'application/font-woff',
        'audio/mpeg', 'audio/ogg', 'video/mp4', 'video/webm',
        'application/wasm', 'application/octet-stream'
    ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Swayphics admins can read proposal demo files"
    on storage.objects;
create policy "Swayphics admins can read proposal demo files"
on storage.objects
for select to authenticated
using (
    bucket_id = 'swayphics-proposal-demos'
    and (select public.is_swayphics_admin())
);

drop policy if exists "Swayphics admins can upload draft proposal demo files"
    on storage.objects;
create policy "Swayphics admins can upload draft proposal demo files"
on storage.objects
for insert to authenticated
with check (
    bucket_id = 'swayphics-proposal-demos'
    and (select public.is_swayphics_admin())
    and name ~ '^proposal-demos/[0-9a-fA-F-]{36}/.+$'
    and exists (
        select 1
        from public.proposal_demo_versions as version
        where version.id::text = split_part(name, '/', 2)
          and version.status = 'draft'
    )
);

-- No UPDATE or DELETE policy is created for this bucket. New asset paths are
-- insert-only and become non-writable once their version is published.

comment on table public.proposal_demo_versions is
    'Lead- and proposal-linked demo revisions. Published metadata is immutable; files live in a private storage bucket.';
comment on table public.proposal_demo_shares is
    'Capability links scoped to one demo version and one target, with explicit expiry and irreversible revocation.';
