-- InnerMe Phase 5B compatibility hardening.
-- Preserves production's existing acquisition metadata and stronger source-license
-- validation while completing the draft review/publish gate introduced earlier.
-- Safe to run after 20261019030000_innerme_knowledge_acquisition_workflow.sql.

ALTER TABLE public.innerme_knowledge_acquisition_tasks
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.innerme_knowledge_acquisition_tasks
  ADD COLUMN IF NOT EXISTS source_verified_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT;

-- One approved knowledge gap must map to no more than one acquisition task.
-- The production table predates this workflow and did not enforce this key.
CREATE UNIQUE INDEX IF NOT EXISTS innerme_knowledge_acquisition_tasks_gap_id_uidx
  ON public.innerme_knowledge_acquisition_tasks (gap_id);

CREATE INDEX IF NOT EXISTS innerme_knowledge_acquisition_tasks_created_by_idx
  ON public.innerme_knowledge_acquisition_tasks (created_by);
CREATE INDEX IF NOT EXISTS innerme_knowledge_acquisition_tasks_source_verified_by_idx
  ON public.innerme_knowledge_acquisition_tasks (source_verified_by);
CREATE INDEX IF NOT EXISTS innerme_knowledge_acquisition_tasks_knowledge_draft_idx
  ON public.innerme_knowledge_acquisition_tasks (knowledge_draft_id);
CREATE INDEX IF NOT EXISTS innerme_knowledge_gaps_reviewed_by_idx
  ON public.innerme_knowledge_gaps (reviewed_by);
CREATE INDEX IF NOT EXISTS innerme_knowledge_verification_log_source_idx
  ON public.innerme_knowledge_verification_log (source_id);
CREATE INDEX IF NOT EXISTS innerme_knowledge_verification_log_verified_by_idx
  ON public.innerme_knowledge_verification_log (verified_by);

CREATE OR REPLACE FUNCTION public.create_innerme_acquisition_task_for_approved_gap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
BEGIN
  IF NEW.status = 'approved'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO public.innerme_knowledge_acquisition_tasks (gap_id, created_by, status)
    VALUES (NEW.id, auth.uid(), 'open')
    ON CONFLICT (gap_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_innerme_acquisition_source(
  p_task_id uuid,
  p_verification_notes text
)
RETURNS public.innerme_knowledge_acquisition_tasks
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_task public.innerme_knowledge_acquisition_tasks;
  v_source public.innerme_knowledge_sources;
  v_notes text := trim(coalesce(p_verification_notes, ''));
  v_review_days integer;
BEGIN
  IF NOT public.is_swayphics_admin() THEN
    RAISE EXCEPTION 'Only active Swayphics admins can verify InnerMe acquisition sources.';
  END IF;

  IF char_length(v_notes) < 10 THEN
    RAISE EXCEPTION 'Source verification notes must contain at least 10 characters.';
  END IF;

  SELECT * INTO v_task
  FROM public.innerme_knowledge_acquisition_tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The InnerMe acquisition task could not be found.';
  END IF;

  IF v_task.status NOT IN ('open', 'source_identified', 'source_verified') THEN
    RAISE EXCEPTION 'This acquisition task is not ready for source verification.';
  END IF;

  IF v_task.source_id IS NULL
     OR char_length(trim(coalesce(v_task.source_excerpt, ''))) < 50 THEN
    RAISE EXCEPTION 'A linked source and excerpt of at least 50 characters are required.';
  END IF;

  SELECT * INTO v_source
  FROM public.innerme_knowledge_sources
  WHERE id = v_task.source_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The acquisition source could not be found.';
  END IF;

  IF v_source.status <> 'active' THEN
    RAISE EXCEPTION 'The acquisition source must be active before verification.';
  END IF;

  IF nullif(trim(coalesce(v_source.url, '')), '') IS NULL
     OR v_source.url !~* '^https?://' THEN
    RAISE EXCEPTION 'A valid HTTP or HTTPS source URL is required.';
  END IF;

  IF v_source.licence_status = 'unknown' THEN
    RAISE EXCEPTION 'The source licensing status must be classified before verification.';
  END IF;

  IF v_source.authority_level = 1 THEN
    v_review_days := 30;
  ELSIF v_source.authority_level <= 3 THEN
    v_review_days := 90;
  ELSE
    v_review_days := 180;
  END IF;

  UPDATE public.innerme_knowledge_sources
  SET verification_status = 'verified',
      verification_method = 'acquisition_source_review',
      verification_notes = v_notes,
      last_verified_at = now(),
      review_after = now() + make_interval(days => v_review_days),
      updated_at = now()
  WHERE id = v_source.id;

  UPDATE public.innerme_knowledge_acquisition_tasks
  SET status = 'source_verified',
      source_verified_at = now(),
      source_verified_by = auth.uid(),
      updated_at = now()
  WHERE id = v_task.id
  RETURNING * INTO v_task;

  RETURN v_task;
END;
$function$;

REVOKE ALL ON FUNCTION public.verify_innerme_acquisition_source(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_innerme_acquisition_source(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.verify_innerme_knowledge_draft(
  p_knowledge_id uuid,
  p_acquisition_task_id uuid,
  p_verification_notes text
)
RETURNS public.innerme_knowledge
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_task public.innerme_knowledge_acquisition_tasks;
  v_gap public.innerme_knowledge_gaps;
  v_source public.innerme_knowledge_sources;
  v_knowledge public.innerme_knowledge;
  v_notes text := trim(coalesce(p_verification_notes, ''));
  v_review_days integer := 90;
BEGIN
  IF NOT public.is_swayphics_admin() THEN
    RAISE EXCEPTION 'Only active Swayphics admins can verify InnerMe acquisition drafts.';
  END IF;

  IF char_length(v_notes) < 10 THEN
    RAISE EXCEPTION 'Verification notes must contain at least 10 characters.';
  END IF;

  SELECT * INTO v_task
  FROM public.innerme_knowledge_acquisition_tasks
  WHERE id = p_acquisition_task_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_task.status <> 'knowledge_drafted'
     OR v_task.knowledge_draft_id IS DISTINCT FROM p_knowledge_id THEN
    RAISE EXCEPTION 'The task must point to this generated knowledge draft before review.';
  END IF;

  SELECT * INTO v_gap
  FROM public.innerme_knowledge_gaps
  WHERE id = v_task.gap_id
  FOR UPDATE;

  IF NOT FOUND OR v_gap.status <> 'approved' THEN
    RAISE EXCEPTION 'The linked knowledge gap must still be approved.';
  END IF;

  SELECT * INTO v_source
  FROM public.innerme_knowledge_sources
  WHERE id = v_task.source_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_source.status <> 'active'
     OR v_source.verification_status <> 'verified'
     OR v_source.review_after IS NULL
     OR v_source.review_after <= now()
     OR v_source.licence_status = 'unknown'
     OR nullif(trim(coalesce(v_source.url, '')), '') IS NULL THEN
    RAISE EXCEPTION 'The linked source must remain active, licensed and source-verified.';
  END IF;

  SELECT * INTO v_knowledge
  FROM public.innerme_knowledge
  WHERE id = p_knowledge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The generated InnerMe knowledge draft could not be found.';
  END IF;

  IF v_knowledge.status <> 'draft'
     OR v_knowledge.source_id IS DISTINCT FROM v_task.source_id
     OR char_length(trim(coalesce(v_task.source_excerpt, ''))) < 50 THEN
    RAISE EXCEPTION 'Only the task-linked draft based on its verified source can be reviewed.';
  END IF;

  IF to_regclass('public.innerme_knowledge_governance') IS NOT NULL THEN
    EXECUTE
      'SELECT COALESCE(default_review_days, 90)
       FROM public.innerme_knowledge_governance
       WHERE evidence_level = $1
       LIMIT 1'
      INTO v_review_days
      USING v_knowledge.evidence_level;
  END IF;

  v_review_days := greatest(coalesce(v_review_days, 90), 1);

  UPDATE public.innerme_knowledge
  SET verification_status = 'verified',
      verification_method = 'manual_review',
      verification_notes = v_notes,
      verified_source_url = v_source.url,
      last_verified_at = now(),
      review_after = now() + make_interval(days => v_review_days),
      embedding = NULL,
      embedding_model = NULL,
      embedding_version = NULL,
      embedding_status = 'pending',
      embedding_error = NULL,
      embedded_at = NULL,
      updated_at = now()
  WHERE id = p_knowledge_id
  RETURNING * INTO v_knowledge;

  INSERT INTO public.innerme_knowledge_verification_log (
    knowledge_id,
    source_id,
    verification_status,
    verification_method,
    verification_notes,
    verified_source_url,
    verified_at,
    verified_by
  )
  VALUES (
    v_knowledge.id,
    v_knowledge.source_id,
    'verified',
    'manual_review',
    v_notes,
    v_source.url,
    now(),
    auth.uid()
  );

  RETURN v_knowledge;
END;
$function$;

REVOKE ALL ON FUNCTION public.verify_innerme_knowledge_draft(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_innerme_knowledge_draft(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.publish_innerme_knowledge_draft(
  p_knowledge_id uuid,
  p_acquisition_task_id uuid
)
RETURNS public.innerme_knowledge
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_task public.innerme_knowledge_acquisition_tasks;
  v_gap public.innerme_knowledge_gaps;
  v_source public.innerme_knowledge_sources;
  v_knowledge public.innerme_knowledge;
BEGIN
  IF NOT public.is_swayphics_admin() THEN
    RAISE EXCEPTION 'Only active Swayphics admins can publish InnerMe acquisition drafts.';
  END IF;

  SELECT * INTO v_task
  FROM public.innerme_knowledge_acquisition_tasks
  WHERE id = p_acquisition_task_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_task.status <> 'knowledge_drafted'
     OR v_task.knowledge_draft_id IS DISTINCT FROM p_knowledge_id THEN
    RAISE EXCEPTION 'The task must point to this knowledge draft before publication.';
  END IF;

  SELECT * INTO v_gap
  FROM public.innerme_knowledge_gaps
  WHERE id = v_task.gap_id
  FOR UPDATE;

  IF NOT FOUND OR v_gap.status <> 'approved' THEN
    RAISE EXCEPTION 'The linked knowledge gap must still be approved.';
  END IF;

  SELECT * INTO v_source
  FROM public.innerme_knowledge_sources
  WHERE id = v_task.source_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_source.status <> 'active'
     OR v_source.verification_status <> 'verified'
     OR v_source.review_after IS NULL
     OR v_source.review_after <= now()
     OR v_source.licence_status = 'unknown' THEN
    RAISE EXCEPTION 'The linked source is not currently verified, licensed and active.';
  END IF;

  SELECT * INTO v_knowledge
  FROM public.innerme_knowledge
  WHERE id = p_knowledge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The acquisition draft could not be found.';
  END IF;

  IF v_knowledge.status <> 'draft'
     OR v_knowledge.verification_status <> 'verified'
     OR v_knowledge.last_verified_at IS NULL
     OR v_knowledge.review_after IS NULL
     OR v_knowledge.review_after <= now()
     OR v_knowledge.source_id IS DISTINCT FROM v_source.id
     OR v_knowledge.verified_source_url IS DISTINCT FROM v_source.url
     OR v_knowledge.embedding_status <> 'ready'
     OR v_knowledge.embedding IS NULL
     OR v_knowledge.embedding_model <> 'gte-small'
     OR v_knowledge.embedded_at IS NULL THEN
    RAISE EXCEPTION 'Publication requires a verified, current, indexed draft and its verified source.';
  END IF;

  UPDATE public.innerme_knowledge
  SET status = 'active',
      updated_at = now()
  WHERE id = p_knowledge_id
  RETURNING * INTO v_knowledge;

  UPDATE public.innerme_knowledge_acquisition_tasks
  SET status = 'published',
      published_at = now(),
      updated_at = now()
  WHERE id = v_task.id;

  UPDATE public.innerme_knowledge_gaps
  SET status = 'acquired',
      acquired_at = now(),
      updated_at = now()
  WHERE id = v_gap.id;

  RETURN v_knowledge;
END;
$function$;

REVOKE ALL ON FUNCTION public.publish_innerme_knowledge_draft(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_innerme_knowledge_draft(uuid, uuid) TO authenticated;
