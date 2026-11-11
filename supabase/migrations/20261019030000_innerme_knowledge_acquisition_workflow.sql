-- InnerMe Phase 5B: governed knowledge acquisition workflow.
-- Adds the missing task lifecycle and keeps candidate knowledge out of retrieval
-- until a verified source, reviewed draft, ready embedding, and explicit publish.
-- Apply via the normal migration process only after reviewing the open PR.

CREATE TABLE IF NOT EXISTS public.innerme_knowledge_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gap_key text NOT NULL UNIQUE,
  title text NOT NULL,
  gap_statement text NOT NULL,
  domain text NOT NULL,
  jurisdiction text,
  why_needed text,
  evidence_basis text NOT NULL,
  recommended_evidence_level text NOT NULL DEFAULT 'practitioner',
  recommended_source_type text,
  acquisition_target text,
  example_queries jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  demand_count integer NOT NULL DEFAULT 1,
  priority integer NOT NULL DEFAULT 50,
  confidence text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'candidate',
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  acquired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT innerme_knowledge_gaps_recommended_evidence_level_check
    CHECK (recommended_evidence_level IN ('authoritative','established','practitioner','internal')),
  CONSTRAINT innerme_knowledge_gaps_confidence_check
    CHECK (confidence IN ('high','medium','low')),
  CONSTRAINT innerme_knowledge_gaps_status_check
    CHECK (status IN ('candidate','approved','dismissed','acquired')),
  CONSTRAINT innerme_knowledge_gaps_demand_count_check CHECK (demand_count >= 1),
  CONSTRAINT innerme_knowledge_gaps_priority_check CHECK (priority BETWEEN 1 AND 100)
);

-- Keep an existing installation compatible with the acquired end-state.
ALTER TABLE public.innerme_knowledge_gaps
  DROP CONSTRAINT IF EXISTS innerme_knowledge_gaps_status_check;
ALTER TABLE public.innerme_knowledge_gaps
  ADD CONSTRAINT innerme_knowledge_gaps_status_check
  CHECK (status IN ('candidate','approved','dismissed','acquired'));

ALTER TABLE public.innerme_knowledge_gaps ENABLE ROW LEVEL SECURITY;

DO $policies$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'innerme_knowledge_gaps'
      AND policyname = 'innerme knowledge gaps admins can select'
  ) THEN
    EXECUTE 'CREATE POLICY "innerme knowledge gaps admins can select"
      ON public.innerme_knowledge_gaps FOR SELECT TO authenticated
      USING ((SELECT public.is_swayphics_admin()))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'innerme_knowledge_gaps'
      AND policyname = 'innerme knowledge gaps admins can insert'
  ) THEN
    EXECUTE 'CREATE POLICY "innerme knowledge gaps admins can insert"
      ON public.innerme_knowledge_gaps FOR INSERT TO authenticated
      WITH CHECK ((SELECT public.is_swayphics_admin()))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'innerme_knowledge_gaps'
      AND policyname = 'innerme knowledge gaps admins can update'
  ) THEN
    EXECUTE 'CREATE POLICY "innerme knowledge gaps admins can update"
      ON public.innerme_knowledge_gaps FOR UPDATE TO authenticated
      USING ((SELECT public.is_swayphics_admin()))
      WITH CHECK ((SELECT public.is_swayphics_admin()))';
  END IF;
END
$policies$;

REVOKE ALL ON TABLE public.innerme_knowledge_gaps FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.innerme_knowledge_gaps TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.innerme_knowledge_gaps TO service_role;

CREATE INDEX IF NOT EXISTS innerme_knowledge_gaps_status_priority_idx
  ON public.innerme_knowledge_gaps (status, priority DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS innerme_knowledge_gaps_domain_idx
  ON public.innerme_knowledge_gaps (domain, status);

CREATE TABLE IF NOT EXISTS public.innerme_knowledge_acquisition_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gap_id uuid NOT NULL UNIQUE
    REFERENCES public.innerme_knowledge_gaps(id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.innerme_knowledge_sources(id) ON DELETE SET NULL,
  source_excerpt text,
  acquisition_notes text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','source_identified','source_verified','knowledge_drafted','published','dismissed')),
  source_verified_at timestamptz,
  knowledge_drafted_at timestamptz,
  knowledge_draft_id uuid REFERENCES public.innerme_knowledge(id) ON DELETE SET NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS innerme_knowledge_acquisition_tasks_status_created_idx
  ON public.innerme_knowledge_acquisition_tasks (status, created_at DESC);
CREATE INDEX IF NOT EXISTS innerme_knowledge_acquisition_tasks_source_idx
  ON public.innerme_knowledge_acquisition_tasks (source_id);

ALTER TABLE public.innerme_knowledge_acquisition_tasks ENABLE ROW LEVEL SECURITY;

DO $policies$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'innerme_knowledge_acquisition_tasks'
      AND policyname = 'innerme acquisition tasks admins can select'
  ) THEN
    EXECUTE 'CREATE POLICY "innerme acquisition tasks admins can select"
      ON public.innerme_knowledge_acquisition_tasks FOR SELECT TO authenticated
      USING ((SELECT public.is_swayphics_admin()))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'innerme_knowledge_acquisition_tasks'
      AND policyname = 'innerme acquisition tasks admins can insert'
  ) THEN
    EXECUTE 'CREATE POLICY "innerme acquisition tasks admins can insert"
      ON public.innerme_knowledge_acquisition_tasks FOR INSERT TO authenticated
      WITH CHECK ((SELECT public.is_swayphics_admin()))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'innerme_knowledge_acquisition_tasks'
      AND policyname = 'innerme acquisition tasks admins can update'
  ) THEN
    EXECUTE 'CREATE POLICY "innerme acquisition tasks admins can update"
      ON public.innerme_knowledge_acquisition_tasks FOR UPDATE TO authenticated
      USING ((SELECT public.is_swayphics_admin()))
      WITH CHECK ((SELECT public.is_swayphics_admin()))';
  END IF;
END
$policies$;

REVOKE ALL ON TABLE public.innerme_knowledge_acquisition_tasks FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.innerme_knowledge_acquisition_tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.innerme_knowledge_acquisition_tasks TO service_role;

-- The admin UI creates source rows and the Edge Function stores draft records
-- using the signed-in admin JWT. Grants complement (not replace) RLS policies.
GRANT SELECT, INSERT, UPDATE ON TABLE public.innerme_knowledge_sources TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.innerme_knowledge TO authenticated;

DO $policies$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'innerme_knowledge_sources'
      AND policyname = 'innerme acquisition admins can manage sources'
  ) THEN
    EXECUTE 'CREATE POLICY "innerme acquisition admins can manage sources"
      ON public.innerme_knowledge_sources FOR ALL TO authenticated
      USING ((SELECT public.is_swayphics_admin()))
      WITH CHECK ((SELECT public.is_swayphics_admin()))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'innerme_knowledge'
      AND policyname = 'innerme acquisition admins can manage knowledge'
  ) THEN
    EXECUTE 'CREATE POLICY "innerme acquisition admins can manage knowledge"
      ON public.innerme_knowledge FOR ALL TO authenticated
      USING ((SELECT public.is_swayphics_admin()))
      WITH CHECK ((SELECT public.is_swayphics_admin()))';
  END IF;
END
$policies$;

-- Some older installs created the governance routines without the audit table.
-- This creates the expected append-only verification log only when it is absent.
CREATE TABLE IF NOT EXISTS public.innerme_knowledge_verification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_id uuid NOT NULL REFERENCES public.innerme_knowledge(id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.innerme_knowledge_sources(id) ON DELETE SET NULL,
  verification_status text NOT NULL CHECK (verification_status IN ('verified','needs_review','stale','unverified')),
  verification_method text NOT NULL,
  verification_notes text NOT NULL,
  verified_source_url text,
  verified_at timestamptz NOT NULL DEFAULT now(),
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.innerme_knowledge_verification_log ENABLE ROW LEVEL SECURITY;

DO $policies$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'innerme_knowledge_verification_log'
      AND policyname = 'innerme verification log admins can select'
  ) THEN
    EXECUTE 'CREATE POLICY "innerme verification log admins can select"
      ON public.innerme_knowledge_verification_log FOR SELECT TO authenticated
      USING ((SELECT public.is_swayphics_admin()))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'innerme_knowledge_verification_log'
      AND policyname = 'innerme verification log admins can insert'
  ) THEN
    EXECUTE 'CREATE POLICY "innerme verification log admins can insert"
      ON public.innerme_knowledge_verification_log FOR INSERT TO authenticated
      WITH CHECK ((SELECT public.is_swayphics_admin())
        AND verified_by = (SELECT auth.uid()))';
  END IF;
END
$policies$;

REVOKE ALL ON TABLE public.innerme_knowledge_verification_log FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.innerme_knowledge_verification_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.innerme_knowledge_verification_log TO service_role;
CREATE INDEX IF NOT EXISTS innerme_knowledge_verification_log_knowledge_time_idx
  ON public.innerme_knowledge_verification_log (knowledge_id, verified_at DESC);

CREATE OR REPLACE FUNCTION public.create_innerme_acquisition_task_for_approved_gap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
BEGIN
  IF NEW.status = 'approved'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO public.innerme_knowledge_acquisition_tasks (gap_id, status)
    VALUES (NEW.id, 'open')
    ON CONFLICT (gap_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS innerme_knowledge_gap_create_acquisition_task
  ON public.innerme_knowledge_gaps;
CREATE TRIGGER innerme_knowledge_gap_create_acquisition_task
AFTER INSERT OR UPDATE OF status ON public.innerme_knowledge_gaps
FOR EACH ROW
EXECUTE FUNCTION public.create_innerme_acquisition_task_for_approved_gap();

-- Backfill approved candidates that pre-date the task lifecycle.
INSERT INTO public.innerme_knowledge_acquisition_tasks (gap_id, status)
SELECT id, 'open'
FROM public.innerme_knowledge_gaps
WHERE status = 'approved'
ON CONFLICT (gap_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.review_innerme_knowledge_gap(
  p_gap_id uuid,
  p_decision text
)
RETURNS public.innerme_knowledge_gaps
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_gap public.innerme_knowledge_gaps;
  v_decision text := lower(trim(coalesce(p_decision, '')));
BEGIN
  IF NOT public.is_swayphics_admin() THEN
    RAISE EXCEPTION 'Only active Swayphics admins can review InnerMe knowledge gaps.';
  END IF;

  IF v_decision NOT IN ('approved', 'dismissed') THEN
    RAISE EXCEPTION 'Knowledge gap decision must be approved or dismissed.';
  END IF;

  SELECT * INTO v_gap
  FROM public.innerme_knowledge_gaps
  WHERE id = p_gap_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The InnerMe knowledge gap could not be found.';
  END IF;

  IF v_gap.status <> 'candidate' THEN
    RAISE EXCEPTION 'Only candidate knowledge gaps can be reviewed.';
  END IF;

  UPDATE public.innerme_knowledge_gaps
  SET status = v_decision,
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      updated_at = now()
  WHERE id = p_gap_id
  RETURNING * INTO v_gap;

  RETURN v_gap;
END;
$function$;

REVOKE ALL ON FUNCTION public.review_innerme_knowledge_gap(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_innerme_knowledge_gap(uuid, text) TO authenticated;

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

  IF v_task.status NOT IN ('source_identified', 'source_verified') THEN
    RAISE EXCEPTION 'Identify a source before verifying the acquisition task.';
  END IF;

  IF v_task.source_id IS NULL OR char_length(trim(coalesce(v_task.source_excerpt, ''))) < 50 THEN
    RAISE EXCEPTION 'A linked source and excerpt of at least 50 characters are required.';
  END IF;

  SELECT * INTO v_source
  FROM public.innerme_knowledge_sources
  WHERE id = v_task.source_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The acquisition source could not be found.';
  END IF;

  IF v_source.status <> 'active'
     OR nullif(trim(coalesce(v_source.url, '')), '') IS NULL
     OR v_source.url !~* '^https?://' THEN
    RAISE EXCEPTION 'The acquisition source must be active and have an HTTP or HTTPS URL.';
  END IF;

  UPDATE public.innerme_knowledge_sources
  SET verification_status = 'verified',
      verification_method = 'admin_source_review',
      verification_notes = v_notes,
      last_verified_at = now(),
      review_after = now() + interval '90 days',
      updated_at = now()
  WHERE id = v_source.id;

  UPDATE public.innerme_knowledge_acquisition_tasks
  SET status = 'source_verified',
      source_verified_at = now(),
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
     OR nullif(trim(coalesce(v_source.url, '')), '') IS NULL THEN
    RAISE EXCEPTION 'The linked source must remain active and source-verified.';
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

  -- Respect configured per-evidence review windows where present; otherwise use 90 days.
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
     OR v_source.review_after <= now() THEN
    RAISE EXCEPTION 'The linked source is not currently verified and active.';
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
