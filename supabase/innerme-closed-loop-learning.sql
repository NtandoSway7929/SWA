-- InnerMe Phase 13: Closed-Loop Learning
-- Reviewed outcomes and experiments can generate governed learning candidates.
-- No live knowledge is changed automatically.

alter table public.innerme_learning_candidates
  alter column feedback_id drop not null;

alter table public.innerme_learning_candidates
  add column if not exists candidate_key text,
  add column if not exists source_type text default 'feedback',
  add column if not exists source_id uuid,
  add column if not exists source_label text,
  add column if not exists source_evidence jsonb not null default '[]'::jsonb,
  add column if not exists requires_verification boolean not null default true,
  add column if not exists requires_regression boolean not null default true;

update public.innerme_learning_candidates
set candidate_key=coalesce(candidate_key,'feedback:'||coalesce(feedback_id::text,id::text)),
    source_type=coalesce(source_type,'feedback'),
    source_id=coalesce(source_id,feedback_id),
    source_label=coalesce(source_label,'Admin feedback'),
    source_evidence=coalesce(source_evidence,'[]'::jsonb)
where candidate_key is null
   or source_type is null
   or source_label is null
   or source_evidence is null;

alter table public.innerme_learning_candidates
  alter column candidate_key set not null,
  alter column source_type set not null;

alter table public.innerme_learning_candidates
  drop constraint if exists innerme_learning_candidates_source_type_check;

alter table public.innerme_learning_candidates
  add constraint innerme_learning_candidates_source_type_check
  check (source_type in ('feedback','outcome','experiment'));

alter table public.innerme_learning_candidates
  drop constraint if exists innerme_learning_candidates_source_evidence_check;

alter table public.innerme_learning_candidates
  add constraint innerme_learning_candidates_source_evidence_check
  check (jsonb_typeof(source_evidence)='array');

create unique index if not exists innerme_learning_candidates_candidate_key_idx
  on public.innerme_learning_candidates(candidate_key);

create index if not exists innerme_learning_candidates_source_idx
  on public.innerme_learning_candidates(source_type,source_id,created_at desc);

create table if not exists public.innerme_learning_loop_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null,
  candidate_id uuid references public.innerme_learning_candidates(id) on delete set null,
  source_type text,
  source_id uuid,
  knowledge_id uuid references public.innerme_knowledge(id) on delete set null,
  evaluation_required boolean not null default true,
  verification_required boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint innerme_learning_loop_events_type_check
    check (event_type in (
      'signal_detected','candidate_created','candidate_approved',
      'candidate_rejected','candidate_applied','knowledge_verified',
      'regression_reviewed'
    )),
  constraint innerme_learning_loop_events_source_check
    check (source_type is null or source_type in ('feedback','outcome','experiment')),
  constraint innerme_learning_loop_events_metadata_check
    check (jsonb_typeof(metadata)='object')
);

create index if not exists innerme_learning_loop_events_source_idx
  on public.innerme_learning_loop_events(source_type,source_id,created_at desc);

create index if not exists innerme_learning_loop_events_candidate_idx
  on public.innerme_learning_loop_events(candidate_id,created_at desc);

alter table public.innerme_learning_loop_events enable row level security;

drop policy if exists "innerme learning loop events admins can manage"
  on public.innerme_learning_loop_events;

create policy "innerme learning loop events admins can manage"
  on public.innerme_learning_loop_events
  for all to authenticated
  using ((select public.is_swayphics_admin()))
  with check ((select public.is_swayphics_admin()));

create or replace function public.create_innerme_learning_loop_event(
  p_event_type text,
  p_candidate_id uuid default null,
  p_source_type text default null,
  p_source_id uuid default null,
  p_knowledge_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare v_event public.innerme_learning_loop_events%rowtype;
begin
  if auth.uid() is null or not public.is_swayphics_admin() then
    raise exception 'Admin authentication is required.';
  end if;
  if p_event_type not in (
    'signal_detected','candidate_created','candidate_approved',
    'candidate_rejected','candidate_applied','knowledge_verified',
    'regression_reviewed'
  ) then raise exception 'Invalid learning loop event type.'; end if;
  if p_source_type is not null
     and p_source_type not in ('feedback','outcome','experiment') then
    raise exception 'Invalid learning loop source type.';
  end if;
  if jsonb_typeof(coalesce(p_metadata,'{}'::jsonb)) <> 'object' then
    raise exception 'Learning loop metadata must be a JSON object.';
  end if;

  insert into public.innerme_learning_loop_events
    (event_key,event_type,candidate_id,source_type,source_id,knowledge_id,metadata,created_by)
  values
    ('event:'||gen_random_uuid()::text,p_event_type,p_candidate_id,
     p_source_type,p_source_id,p_knowledge_id,coalesce(p_metadata,'{}'::jsonb),auth.uid())
  returning * into v_event;

  return to_jsonb(v_event);
end;
$$;

revoke execute on function public.create_innerme_learning_loop_event(text,uuid,text,uuid,uuid,jsonb) from public;
grant execute on function public.create_innerme_learning_loop_event(text,uuid,text,uuid,uuid,jsonb) to authenticated;

create or replace function public.mark_innerme_learning_candidate_reviewed(
  p_candidate_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare v_candidate public.innerme_learning_candidates%rowtype;
begin
  if auth.uid() is null or not public.is_swayphics_admin() then
    raise exception 'Admin authentication is required.';
  end if;
  if p_decision not in ('approved','rejected') then
    raise exception 'Decision must be approved or rejected.';
  end if;

  select * into v_candidate
  from public.innerme_learning_candidates
  where id=p_candidate_id for update;

  if not found then
    raise exception 'The InnerMe learning candidate could not be found.';
  end if;

  if v_candidate.status <> 'candidate' then
    return jsonb_build_object('ok',true,'candidate',to_jsonb(v_candidate),'changed',false);
  end if;

  update public.innerme_learning_candidates
  set status=p_decision,reviewed_at=now(),reviewed_by=auth.uid(),updated_at=now()
  where id=p_candidate_id
  returning * into v_candidate;

  insert into public.innerme_learning_loop_events
    (event_key,event_type,candidate_id,source_type,source_id,metadata,created_by)
  values
    ('candidate-review:'||v_candidate.id::text||':'||p_decision||':'||gen_random_uuid()::text,
     case when p_decision='approved' then 'candidate_approved' else 'candidate_rejected' end,
     v_candidate.id,v_candidate.source_type,v_candidate.source_id,
     jsonb_build_object('feedback_id',v_candidate.feedback_id),auth.uid());

  return jsonb_build_object('ok',true,'candidate',to_jsonb(v_candidate),'changed',true);
end;
$$;

revoke execute on function public.mark_innerme_learning_candidate_reviewed(uuid,text) from public;
grant execute on function public.mark_innerme_learning_candidate_reviewed(uuid,text) to authenticated;

create or replace function public.apply_innerme_learning_candidate(p_candidate_id uuid)
returns public.innerme_learning_candidates
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_candidate public.innerme_learning_candidates;
  v_knowledge public.innerme_knowledge;
begin
  if auth.uid() is null or not public.is_swayphics_admin() then
    raise exception 'Only active Swayphics admins can apply InnerMe learning candidates.';
  end if;

  select * into v_candidate
  from public.innerme_learning_candidates
  where id=p_candidate_id for update;

  if not found then
    raise exception 'The InnerMe learning candidate could not be found.';
  end if;

  if v_candidate.status <> 'approved' then
    raise exception 'Only an approved InnerMe learning candidate can be applied.';
  end if;

  if v_candidate.candidate_type <> 'amend_existing'
     or v_candidate.target_knowledge_id is null then
    raise exception 'New InnerMe knowledge requires the controlled knowledge acquisition pipeline before it can be applied.';
  end if;

  select * into v_knowledge
  from public.innerme_knowledge
  where id=v_candidate.target_knowledge_id for update;

  if not found then
    raise exception 'The target InnerMe knowledge record could not be found.';
  end if;

  update public.innerme_knowledge
  set title=v_candidate.title,
      domain=v_candidate.domain,
      knowledge_type=v_candidate.knowledge_type,
      statement=v_candidate.statement,
      application=v_candidate.application,
      constraints=v_candidate.constraints,
      do_not_use_when=v_candidate.do_not_use_when,
      confidence=v_candidate.confidence,
      verification_status='needs_review',
      verification_method='learning_candidate_applied',
      verification_notes='Applied from approved InnerMe learning candidate '||v_candidate.id::text||
        '. Re-verify against the linked knowledge source before retrieval is restored.',
      last_verified_at=null,
      review_after=null,
      embedding=null,
      embedding_model=null,
      embedding_version=null,
      embedding_status='pending',
      embedding_error=null,
      embedded_at=null,
      updated_at=now()
  where id=v_candidate.target_knowledge_id;

  insert into public.innerme_knowledge_verification_log
    (knowledge_id,source_id,verification_status,verification_method,
     verification_notes,verified_source_url,verified_at,verified_by)
  select k.id,k.source_id,'needs_review','learning_candidate_applied',
    'Approved Phase 13 learning candidate applied. Source verification and re-indexing are required before retrieval can use the revised knowledge.',
    k.verified_source_url,now(),auth.uid()
  from public.innerme_knowledge k
  where k.id=v_candidate.target_knowledge_id;

  update public.innerme_learning_candidates
  set status='applied',applied_at=now(),applied_knowledge_id=v_candidate.target_knowledge_id,updated_at=now()
  where id=v_candidate.id
  returning * into v_candidate;

  insert into public.innerme_learning_loop_events
    (event_key,event_type,candidate_id,source_type,source_id,knowledge_id,metadata,created_by)
  values
    ('candidate-applied:'||v_candidate.id::text||':'||gen_random_uuid()::text,
     'candidate_applied',v_candidate.id,v_candidate.source_type,v_candidate.source_id,
     v_candidate.target_knowledge_id,
     jsonb_build_object(
       'requires_verification',true,
       'requires_regression',v_candidate.requires_regression,
       'applied_at',v_candidate.applied_at
     ),auth.uid());

  return v_candidate;
end;
$$;

revoke execute on function public.apply_innerme_learning_candidate(uuid) from public;
grant execute on function public.apply_innerme_learning_candidate(uuid) to authenticated;
