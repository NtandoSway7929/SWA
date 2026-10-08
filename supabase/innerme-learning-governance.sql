-- InnerMe Phase 4 learning governance.
-- Idempotent database functions used by the admin learning workflow.
-- Live knowledge remains excluded from retrieval until it is explicitly
-- source-verified and re-indexed.

create or replace function public.review_innerme_learning_candidate(
  p_candidate_id uuid,
  p_decision text
)
returns public.innerme_learning_candidates
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_candidate public.innerme_learning_candidates;
begin
  if not public.is_swayphics_admin() then
    raise exception 'Only active Swayphics admins can review InnerMe learning candidates.';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.';
  end if;

  select *
  into v_candidate
  from public.innerme_learning_candidates
  where id = p_candidate_id
  for update;

  if not found then
    raise exception 'The InnerMe learning candidate could not be found.';
  end if;

  if v_candidate.status <> 'candidate' then
    return v_candidate;
  end if;

  update public.innerme_learning_candidates
  set
    status = p_decision,
    reviewed_at = now(),
    reviewed_by = auth.uid(),
    updated_at = now()
  where id = p_candidate_id
  returning * into v_candidate;

  update public.innerme_feedback
  set
    review_status = 'reviewed',
    reviewed_at = now(),
    reviewed_by = auth.uid()
  where id = v_candidate.feedback_id
    and review_status = 'unreviewed';

  return v_candidate;
end;
$$;

revoke all on function public.review_innerme_learning_candidate(uuid, text) from public;
grant execute on function public.review_innerme_learning_candidate(uuid, text) to authenticated;

create or replace function public.apply_innerme_learning_candidate(
  p_candidate_id uuid
)
returns public.innerme_learning_candidates
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_candidate public.innerme_learning_candidates;
  v_knowledge public.innerme_knowledge;
begin
  if not public.is_swayphics_admin() then
    raise exception 'Only active Swayphics admins can apply InnerMe learning candidates.';
  end if;

  select *
  into v_candidate
  from public.innerme_learning_candidates
  where id = p_candidate_id
  for update;

  if not found then
    raise exception 'The InnerMe learning candidate could not be found.';
  end if;

  if v_candidate.status <> 'approved' then
    raise exception 'Only an approved InnerMe learning candidate can be applied.';
  end if;

  if v_candidate.candidate_type <> 'amend_existing'
     or v_candidate.target_knowledge_id is null then
    raise exception 'New InnerMe knowledge requires an explicit verified source before it can be applied.';
  end if;

  select *
  into v_knowledge
  from public.innerme_knowledge
  where id = v_candidate.target_knowledge_id
  for update;

  if not found then
    raise exception 'The target InnerMe knowledge record could not be found.';
  end if;

  update public.innerme_knowledge
  set
    title = v_candidate.title,
    domain = v_candidate.domain,
    knowledge_type = v_candidate.knowledge_type,
    statement = v_candidate.statement,
    application = v_candidate.application,
    constraints = v_candidate.constraints,
    do_not_use_when = v_candidate.do_not_use_when,
    confidence = v_candidate.confidence,
    verification_status = 'needs_review',
    verification_method = 'learning_candidate_applied',
    verification_notes = 'Applied from approved InnerMe learning candidate ' || v_candidate.id::text || '. External/source verification is required before this knowledge can participate in retrieval.',
    last_verified_at = null,
    review_after = null,
    embedding = null,
    embedding_model = null,
    embedding_version = null,
    embedding_status = 'pending',
    embedding_error = null,
    embedded_at = null,
    updated_at = now()
  where id = v_candidate.target_knowledge_id;

  insert into public.innerme_knowledge_verification_log (
    knowledge_id,
    source_id,
    verification_status,
    verification_method,
    verification_notes,
    verified_source_url,
    verified_at,
    verified_by
  )
  select
    k.id,
    k.source_id,
    'needs_review',
    'learning_candidate_applied',
    'Approved learning candidate applied. Re-verify the changed claim against the existing source before publishing it back into retrieval.',
    k.verified_source_url,
    now(),
    auth.uid()
  from public.innerme_knowledge k
  where k.id = v_candidate.target_knowledge_id;

  update public.innerme_learning_candidates
  set
    status = 'applied',
    applied_at = now(),
    applied_knowledge_id = v_candidate.target_knowledge_id,
    updated_at = now()
  where id = p_candidate_id
  returning * into v_candidate;

  return v_candidate;
end;
$$;

revoke all on function public.apply_innerme_learning_candidate(uuid) from public;
grant execute on function public.apply_innerme_learning_candidate(uuid) to authenticated;

create or replace function public.verify_innerme_knowledge(
  p_knowledge_id uuid,
  p_verification_method text,
  p_verification_notes text,
  p_verified_source_url text default null
)
returns public.innerme_knowledge
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_knowledge public.innerme_knowledge;
  v_source public.innerme_knowledge_sources;
  v_review_days integer;
  v_notes text;
  v_source_url text;
begin
  if not public.is_swayphics_admin() then
    raise exception 'Only active Swayphics admins can verify InnerMe knowledge.';
  end if;

  if p_verification_method not in (
    'official_source_confirmation',
    'source_recheck',
    'practitioner_source_recheck',
    'internal_review',
    'manual_review'
  ) then
    raise exception 'Invalid InnerMe verification method.';
  end if;

  v_notes := trim(coalesce(p_verification_notes, ''));
  if char_length(v_notes) < 10 then
    raise exception 'Verification notes must contain at least 10 characters.';
  end if;

  select *
  into v_knowledge
  from public.innerme_knowledge
  where id = p_knowledge_id
  for update;

  if not found then
    raise exception 'The InnerMe knowledge record could not be found.';
  end if;

  if v_knowledge.status <> 'active' then
    raise exception 'Only active InnerMe knowledge can be verified.';
  end if;

  select *
  into v_source
  from public.innerme_knowledge_sources
  where id = v_knowledge.source_id;

  if not found then
    raise exception 'This knowledge record has no source record and cannot be verified.';
  end if;

  if v_source.status <> 'active'
     or v_source.verification_status <> 'verified' then
    raise exception 'The linked knowledge source is not currently verified.';
  end if;

  v_source_url :=
    nullif(trim(coalesce(p_verified_source_url, '')), '');

  if v_source_url is null then
    v_source_url := nullif(trim(coalesce(v_knowledge.verified_source_url, '')), '');
  end if;

  if v_source_url is null then
    v_source_url := nullif(trim(coalesce(v_source.url, '')), '');
  end if;

  if v_source_url is null then
    raise exception 'A verified source URL is required for this knowledge record.';
  end if;

  select coalesce(default_review_days, 90)
  into v_review_days
  from public.innerme_knowledge_governance
  where evidence_level = v_knowledge.evidence_level
  limit 1;

  v_review_days := greatest(coalesce(v_review_days, 90), 1);

  update public.innerme_knowledge
  set
    verification_status = 'verified',
    verification_method = p_verification_method,
    verification_notes = v_notes,
    verified_source_url = v_source_url,
    last_verified_at = now(),
    review_after = now() + make_interval(days => v_review_days),
    embedding = null,
    embedding_model = null,
    embedding_version = null,
    embedding_status = 'pending',
    embedding_error = null,
    embedded_at = null,
    updated_at = now()
  where id = p_knowledge_id
  returning * into v_knowledge;

  insert into public.innerme_knowledge_verification_log (
    knowledge_id,
    source_id,
    verification_status,
    verification_method,
    verification_notes,
    verified_source_url,
    verified_at,
    verified_by
  )
  values (
    v_knowledge.id,
    v_knowledge.source_id,
    'verified',
    p_verification_method,
    v_notes,
    v_source_url,
    now(),
    auth.uid()
  );

  return v_knowledge;
end;
$$;

revoke all on function public.verify_innerme_knowledge(uuid, text, text, text) from public;
grant execute on function public.verify_innerme_knowledge(uuid, text, text, text) to authenticated;
