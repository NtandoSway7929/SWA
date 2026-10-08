-- InnerMe Phase 5: Knowledge Expansion Engine
-- Candidate targets are evidence-backed acquisition proposals only.
-- Nothing in this migration publishes external material into live retrieval.

create table if not exists public.innerme_knowledge_gaps (
  id uuid primary key default gen_random_uuid(),
  gap_key text not null unique,
  title text not null,
  gap_statement text not null,
  domain text not null,
  jurisdiction text,
  why_needed text,
  evidence_basis text not null,
  recommended_evidence_level text not null default 'practitioner',
  recommended_source_type text,
  acquisition_target text,
  example_queries jsonb not null default '[]'::jsonb,
  source_signals jsonb not null default '[]'::jsonb,
  demand_count integer not null default 1,
  priority integer not null default 50,
  confidence text not null default 'medium',
  status text not null default 'candidate',
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete restrict,
  acquired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint innerme_knowledge_gaps_recommended_evidence_level_check
    check (recommended_evidence_level in ('authoritative','established','practitioner','internal')),
  constraint innerme_knowledge_gaps_confidence_check
    check (confidence in ('high','medium','low')),
  constraint innerme_knowledge_gaps_status_check
    check (status in ('candidate','approved','dismissed','acquired')),
  constraint innerme_knowledge_gaps_demand_count_check
    check (demand_count >= 1),
  constraint innerme_knowledge_gaps_priority_check
    check (priority between 1 and 100)
);

alter table public.innerme_knowledge_gaps enable row level security;

drop policy if exists "innerme knowledge gaps admins can select" on public.innerme_knowledge_gaps;
create policy "innerme knowledge gaps admins can select"
on public.innerme_knowledge_gaps
for select to authenticated
using ((select public.is_swayphics_admin()));

drop policy if exists "innerme knowledge gaps admins can insert" on public.innerme_knowledge_gaps;
create policy "innerme knowledge gaps admins can insert"
on public.innerme_knowledge_gaps
for insert to authenticated
with check ((select public.is_swayphics_admin()));

drop policy if exists "innerme knowledge gaps admins can update" on public.innerme_knowledge_gaps;
create policy "innerme knowledge gaps admins can update"
on public.innerme_knowledge_gaps
for update to authenticated
using ((select public.is_swayphics_admin()))
with check ((select public.is_swayphics_admin()));

revoke all on table public.innerme_knowledge_gaps from anon;
grant select, insert, update on table public.innerme_knowledge_gaps to authenticated;
grant select, insert, update, delete on table public.innerme_knowledge_gaps to service_role;

create index if not exists innerme_knowledge_gaps_status_priority_idx
on public.innerme_knowledge_gaps (status, priority desc, created_at desc);

create index if not exists innerme_knowledge_gaps_domain_idx
on public.innerme_knowledge_gaps (domain, status);

create or replace function public.review_innerme_knowledge_gap(
  p_gap_id uuid,
  p_decision text
)
returns public.innerme_knowledge_gaps
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_gap public.innerme_knowledge_gaps;
  v_decision text := lower(trim(coalesce(p_decision, '')));
begin
  if not public.is_swayphics_admin() then
    raise exception 'Only active Swayphics admins can review InnerMe knowledge gaps.';
  end if;

  if v_decision not in ('approved', 'dismissed') then
    raise exception 'Knowledge gap decision must be approved or dismissed.';
  end if;

  select *
  into v_gap
  from public.innerme_knowledge_gaps
  where id = p_gap_id
  for update;

  if not found then
    raise exception 'The InnerMe knowledge gap could not be found.';
  end if;

  if v_gap.status <> 'candidate' then
    raise exception 'Only candidate knowledge gaps can be reviewed.';
  end if;

  update public.innerme_knowledge_gaps
  set
    status = v_decision,
    reviewed_at = now(),
    reviewed_by = auth.uid(),
    updated_at = now()
  where id = p_gap_id
  returning * into v_gap;

  return v_gap;
end;
$function$;

revoke all on function public.review_innerme_knowledge_gap(uuid, text) from public;
revoke all on function public.review_innerme_knowledge_gap(uuid, text) from anon;
grant execute on function public.review_innerme_knowledge_gap(uuid, text) to authenticated;
