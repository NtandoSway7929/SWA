-- ISOLATED TEST PROJECT ONLY.
-- Target: ofqofhnlzbouclvvrmzd.
-- Never place this file in supabase/migrations or apply it to production.
--
-- Purpose: provide only the prerequisites required to exercise the existing
-- verify_innerme_knowledge contract against a temporary source-backed QA row.
-- The audit-log cascade and TEST ONLY deletion policy are cleanup affordances
-- for synthetic test rows, not production audit-retention policy.

CREATE TABLE IF NOT EXISTS public.innerme_knowledge_governance (
  evidence_level text PRIMARY KEY CHECK (
    evidence_level IN ('authoritative', 'established', 'practitioner', 'internal')
  ),
  default_review_days integer NOT NULL DEFAULT 90 CHECK (default_review_days BETWEEN 1 AND 3650),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.innerme_knowledge_governance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.innerme_knowledge_governance FROM PUBLIC, anon, service_role;
GRANT SELECT ON TABLE public.innerme_knowledge_governance TO authenticated;

DROP POLICY IF EXISTS "InnerMe governance admins can read test policy" ON public.innerme_knowledge_governance;
CREATE POLICY "InnerMe governance admins can read test policy"
  ON public.innerme_knowledge_governance
  FOR SELECT TO authenticated
  USING (public.is_swayphics_admin());

INSERT INTO public.innerme_knowledge_governance (evidence_level, default_review_days)
VALUES ('internal', 90)
ON CONFLICT (evidence_level) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.innerme_knowledge_verification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_id uuid NOT NULL REFERENCES public.innerme_knowledge(id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.innerme_knowledge_sources(id) ON DELETE SET NULL,
  verification_status text NOT NULL CHECK (
    verification_status IN ('verified', 'stale', 'needs_review', 'unverified')
  ),
  verification_method text NOT NULL CHECK (
    verification_method IN (
      'official_source_confirmation',
      'source_recheck',
      'practitioner_source_recheck',
      'internal_review',
      'manual_review',
      'learning_candidate_applied'
    )
  ),
  verification_notes text NOT NULL,
  verified_source_url text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.innerme_knowledge_verification_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.innerme_knowledge_verification_log FROM PUBLIC, anon, service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.innerme_knowledge_verification_log TO authenticated;

DROP POLICY IF EXISTS "InnerMe verification log admins can read test rows" ON public.innerme_knowledge_verification_log;
CREATE POLICY "InnerMe verification log admins can read test rows"
  ON public.innerme_knowledge_verification_log
  FOR SELECT TO authenticated
  USING (public.is_swayphics_admin());

DROP POLICY IF EXISTS "InnerMe verification log admins can insert test rows" ON public.innerme_knowledge_verification_log;
CREATE POLICY "InnerMe verification log admins can insert test rows"
  ON public.innerme_knowledge_verification_log
  FOR INSERT TO authenticated
  WITH CHECK (public.is_swayphics_admin());

DROP POLICY IF EXISTS "InnerMe verification log admins can delete TEST ONLY rows" ON public.innerme_knowledge_verification_log;
CREATE POLICY "InnerMe verification log admins can delete TEST ONLY rows"
  ON public.innerme_knowledge_verification_log
  FOR DELETE TO authenticated
  USING (public.is_swayphics_admin() AND verification_notes LIKE 'TEST ONLY:%');

CREATE OR REPLACE FUNCTION public.verify_innerme_knowledge(
  p_knowledge_id uuid,
  p_verification_method text,
  p_verification_notes text,
  p_verified_source_url text DEFAULT NULL
)
RETURNS public.innerme_knowledge
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_knowledge public.innerme_knowledge;
  v_source public.innerme_knowledge_sources;
  v_review_days integer;
  v_notes text;
  v_source_url text;
BEGIN
  IF NOT public.is_swayphics_admin() THEN
    RAISE EXCEPTION 'Only active Swayphics admins can verify InnerMe knowledge.';
  END IF;

  IF p_verification_method IS NULL OR p_verification_method NOT IN (
    'official_source_confirmation',
    'source_recheck',
    'practitioner_source_recheck',
    'internal_review',
    'manual_review'
  ) THEN
    RAISE EXCEPTION 'Invalid InnerMe verification method.';
  END IF;

  v_notes := trim(coalesce(p_verification_notes, ''));
  IF char_length(v_notes) < 10 THEN
    RAISE EXCEPTION 'Verification notes must contain at least 10 characters.';
  END IF;

  SELECT *
  INTO v_knowledge
  FROM public.innerme_knowledge
  WHERE id = p_knowledge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The InnerMe knowledge record could not be found.';
  END IF;

  IF v_knowledge.status <> 'active' THEN
    RAISE EXCEPTION 'Only active InnerMe knowledge can be verified.';
  END IF;

  SELECT *
  INTO v_source
  FROM public.innerme_knowledge_sources
  WHERE id = v_knowledge.source_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This knowledge record has no source record and cannot be verified.';
  END IF;

  IF v_source.status <> 'active' OR v_source.verification_status <> 'verified' THEN
    RAISE EXCEPTION 'The linked knowledge source is not currently verified.';
  END IF;

  v_source_url := nullif(trim(coalesce(p_verified_source_url, '')), '');
  IF v_source_url IS NULL THEN
    v_source_url := nullif(trim(coalesce(v_knowledge.verified_source_url, '')), '');
  END IF;
  IF v_source_url IS NULL THEN
    v_source_url := nullif(trim(coalesce(v_source.url, '')), '');
  END IF;
  IF v_source_url IS NULL OR v_source_url !~* '^https?://' THEN
    RAISE EXCEPTION 'A valid HTTP(S) verified source URL is required for this knowledge record.';
  END IF;

  SELECT coalesce(default_review_days, 90)
  INTO v_review_days
  FROM public.innerme_knowledge_governance
  WHERE evidence_level = v_knowledge.evidence_level
  LIMIT 1;

  v_review_days := greatest(coalesce(v_review_days, 90), 1);

  UPDATE public.innerme_knowledge
  SET
    verification_status = 'verified',
    verification_method = p_verification_method,
    verification_notes = v_notes,
    verified_source_url = v_source_url,
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
    p_verification_method,
    v_notes,
    v_source_url,
    now(),
    auth.uid()
  );

  RETURN v_knowledge;
END;
$function$;

REVOKE ALL ON FUNCTION public.verify_innerme_knowledge(uuid, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.verify_innerme_knowledge(uuid, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
