-- InnerMe Phase 8: Decision Intelligence
-- Generated recommendations remain candidates until an admin approves them.

create table if not exists public.innerme_decision_candidates (
  id uuid primary key default gen_random_uuid(),
  candidate_key text not null unique,
  title text not null,
  decision text not null,
  context text,
  rationale text,
  evidence jsonb not null default '[]'::jsonb,
  expected_impact text,
  effort text not null default 'medium',
  urgency text not null default 'normal',
  confidence text not null default 'medium',
  recommended_next_action text,
  priority integer not null default 50,
  source_conversation_id text,
  status text not null default 'candidate',
  created_by uuid references auth.users(id) on delete restrict,
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint innerme_decision_candidates_effort_check check (effort in ('low','medium','high')),
  constraint innerme_decision_candidates_urgency_check check (urgency in ('critical','high','normal','low')),
  constraint innerme_decision_candidates_confidence_check check (confidence in ('high','medium','low')),
  constraint innerme_decision_candidates_status_check check (status in ('candidate','approved','dismissed')),
  constraint innerme_decision_candidates_priority_check check (priority between 1 and 100),
  constraint innerme_decision_candidates_evidence_check check (jsonb_typeof(evidence)='array')
);

alter table public.innerme_decision_candidates enable row level security;

drop policy if exists "innerme decision candidates admins can manage" on public.innerme_decision_candidates;
create policy "innerme decision candidates admins can manage"
on public.innerme_decision_candidates
for all to authenticated
using ((select public.is_swayphics_admin()))
with check ((select public.is_swayphics_admin()));

revoke all on table public.innerme_decision_candidates from anon;
grant select,insert,update,delete on public.innerme_decision_candidates to authenticated;
grant all on public.innerme_decision_candidates to service_role;

create index if not exists innerme_decision_candidates_status_priority_idx
on public.innerme_decision_candidates(status, priority desc, created_at desc);

alter table public.innerme_decisions enable row level security;
drop policy if exists "innerme decisions admins can manage" on public.innerme_decisions;
create policy "innerme decisions admins can manage"
on public.innerme_decisions
for all to authenticated
using ((select public.is_swayphics_admin()))
with check ((select public.is_swayphics_admin()));

revoke all on table public.innerme_decisions from anon;
grant select,insert,update,delete on public.innerme_decisions to authenticated;
grant all on public.innerme_decisions to service_role;

create or replace function public.review_innerme_decision_candidate(
  p_candidate_id uuid,
  p_decision text
)
returns public.innerme_decision_candidates
language plpgsql
security invoker
set search_path=public
as $function$
declare
  v_candidate public.innerme_decision_candidates;
  v_decision text:=lower(trim(coalesce(p_decision,'')));
begin
  if not public.is_swayphics_admin() then
    raise exception 'Only active Swayphics admins can review InnerMe decision candidates.';
  end if;
  if v_decision not in ('approved','dismissed') then
    raise exception 'Decision candidate review must be approved or dismissed.';
  end if;

  select * into v_candidate from public.innerme_decision_candidates where id=p_candidate_id for update;
  if not found then
    raise exception 'The InnerMe decision candidate could not be found.';
  end if;
  if v_candidate.status <> 'candidate' then
    raise exception 'Only candidate decisions can be reviewed.';
  end if;

  if v_decision='approved' then
    insert into public.innerme_decisions (
      title,decision,context,rationale,status,source_conversation_id,created_by
    )
    values (
      v_candidate.title,
      v_candidate.decision,
      v_candidate.context,
      v_candidate.rationale,
      'active',
      coalesce(v_candidate.source_conversation_id,'phase8_decision_intelligence'),
      auth.uid()
    );
  end if;

  update public.innerme_decision_candidates
  set status=v_decision, reviewed_by=auth.uid(), reviewed_at=now(), updated_at=now()
  where id=p_candidate_id
  returning * into v_candidate;

  return v_candidate;
end;
$function$;

revoke all on function public.review_innerme_decision_candidate(uuid,text) from public;
revoke all on function public.review_innerme_decision_candidate(uuid,text) from anon;
grant execute on function public.review_innerme_decision_candidate(uuid,text) to authenticated;
