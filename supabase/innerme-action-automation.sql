-- InnerMe Phase 10: Controlled Action Automation
-- Approved execution plans can produce action proposals.
-- Only explicitly approved proposals may be executed.
-- Phase 10 supports create_task and send_email, with audit logging.

create table if not exists public.innerme_action_proposals (
  id uuid primary key default gen_random_uuid(),
  proposal_key text not null unique,
  plan_id uuid not null references public.innerme_execution_plans(id) on delete restrict,
  step_id uuid not null references public.innerme_execution_steps(id) on delete restrict,
  action_type text not null,
  title text not null,
  purpose text,
  payload jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  requires_confirmation boolean not null default true,
  status text not null default 'proposed',
  created_by uuid references auth.users(id) on delete restrict,
  reviewed_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  executed_by uuid references auth.users(id) on delete restrict,
  executed_at timestamptz,
  execution_result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint innerme_action_proposals_type_check check (action_type in ('create_task','send_email')),
  constraint innerme_action_proposals_status_check check (status in ('proposed','approved','rejected','executing','executed','failed','cancelled')),
  constraint innerme_action_proposals_payload_check check (jsonb_typeof(payload)='object'),
  constraint innerme_action_proposals_evidence_check check (jsonb_typeof(evidence)='array')
);

alter table public.innerme_action_proposals enable row level security;
drop policy if exists "innerme action proposals admins can manage" on public.innerme_action_proposals;
create policy "innerme action proposals admins can manage"
on public.innerme_action_proposals
for all to authenticated
using ((select public.is_swayphics_admin()))
with check ((select public.is_swayphics_admin()));

revoke all on table public.innerme_action_proposals from anon;
grant select,insert,update,delete on public.innerme_action_proposals to authenticated;
grant all on public.innerme_action_proposals to service_role;

create index if not exists innerme_action_proposals_plan_status_idx
on public.innerme_action_proposals(plan_id,status,created_at desc);
create index if not exists innerme_action_proposals_step_idx
on public.innerme_action_proposals(step_id,created_at desc);

create unique index if not exists innerme_action_proposals_current_step_unique
on public.innerme_action_proposals(step_id,action_type)
where status in ('proposed','approved','executing');

create table if not exists public.innerme_action_execution_logs (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.innerme_action_proposals(id) on delete cascade,
  action_type text not null,
  status text not null default 'started',
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb,
  error_message text,
  executed_by uuid references auth.users(id) on delete restrict,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint innerme_action_execution_logs_status_check check (status in ('started','succeeded','failed')),
  constraint innerme_action_execution_logs_payload_check check (jsonb_typeof(request_payload)='object')
);

alter table public.innerme_action_execution_logs enable row level security;
drop policy if exists "innerme action execution logs admins can manage" on public.innerme_action_execution_logs;
create policy "innerme action execution logs admins can manage"
on public.innerme_action_execution_logs
for all to authenticated
using ((select public.is_swayphics_admin()))
with check ((select public.is_swayphics_admin()));

revoke all on table public.innerme_action_execution_logs from anon;
grant select,insert,update,delete on public.innerme_action_execution_logs to authenticated;
grant all on table public.innerme_action_execution_logs to service_role;

create index if not exists innerme_action_execution_logs_proposal_idx
on public.innerme_action_execution_logs(proposal_id,started_at desc);

create or replace function public.review_innerme_action_proposal(
  p_proposal_id uuid,
  p_decision text
)
returns public.innerme_action_proposals
language plpgsql
security invoker
set search_path=public
as $function$
declare
  v_proposal public.innerme_action_proposals;
  v_decision text:=lower(trim(coalesce(p_decision,'')));
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

revoke all on function public.review_innerme_action_proposal(uuid,text) from public;
revoke all on function public.review_innerme_action_proposal(uuid,text) from anon;
grant execute on function public.review_innerme_action_proposal(uuid,text) to authenticated;
