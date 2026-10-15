-- Keep the isolated InnerMe test project schema-compatible with production's
-- verified knowledge retrieval path, without copying any production knowledge rows.
-- Existing production tables, indexes, policies and the RPC are retained in place.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.innerme_knowledge_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  publisher text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN (
    'primary_authority', 'established_framework', 'academic', 'practitioner', 'internal'
  )),
  authority_level integer NOT NULL DEFAULT 3 CHECK (authority_level BETWEEN 1 AND 5),
  jurisdiction text,
  url text,
  licence_status text NOT NULL DEFAULT 'unknown' CHECK (licence_status IN (
    'open', 'permission_required', 'proprietary', 'unknown', 'internal'
  )),
  usage_notes text,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tags) = 'array'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  last_verified_at timestamptz,
  review_after timestamptz,
  created_by uuid REFERENCES public.admin_users(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN (
    'unverified', 'verified', 'stale', 'needs_review'
  )),
  verification_method text,
  verification_notes text
);

CREATE TABLE IF NOT EXISTS public.innerme_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid REFERENCES public.innerme_knowledge_sources(id) ON DELETE SET NULL,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  domain text NOT NULL,
  knowledge_type text NOT NULL CHECK (knowledge_type IN (
    'principle', 'framework', 'heuristic', 'definition', 'metric', 'decision_rule', 'regulatory_rule'
  )),
  statement text NOT NULL,
  application text,
  constraints text,
  do_not_use_when text,
  evidence_level text NOT NULL DEFAULT 'established' CHECK (evidence_level IN (
    'authoritative', 'established', 'practitioner', 'internal'
  )),
  confidence text NOT NULL DEFAULT 'high' CHECK (confidence IN ('high', 'medium', 'low')),
  jurisdiction text NOT NULL DEFAULT 'Global',
  effective_from timestamptz,
  effective_to timestamptz,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tags) = 'array'),
  priority integer NOT NULL DEFAULT 50 CHECK (priority BETWEEN 1 AND 100),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  last_verified_at timestamptz,
  review_after timestamptz,
  created_by uuid REFERENCES public.admin_users(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN (
    'unverified', 'verified', 'stale', 'needs_review'
  )),
  verification_method text,
  verification_notes text,
  verified_source_url text,
  embedding_text text,
  embedding extensions.vector(384),
  embedding_model text,
  embedding_version integer,
  embedding_status text NOT NULL DEFAULT 'pending' CHECK (embedding_status IN ('pending', 'ready', 'error')),
  embedding_error text,
  embedded_at timestamptz
);

ALTER TABLE public.innerme_knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.innerme_knowledge ENABLE ROW LEVEL SECURITY;

-- Supabase can grant default Data API privileges to newly created public tables.
-- Remove public/anonymous and direct service-role access while preserving existing
-- production permissions on tables that were already present.
REVOKE ALL ON TABLE public.innerme_knowledge_sources FROM PUBLIC, anon, service_role;
REVOKE ALL ON TABLE public.innerme_knowledge FROM PUBLIC, anon, service_role;
GRANT SELECT ON TABLE public.innerme_knowledge_sources TO authenticated;
GRANT SELECT ON TABLE public.innerme_knowledge TO authenticated;

DO $policies$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'innerme_knowledge_sources'
      AND policyname = 'Swayphics admins can manage InnerMe knowledge sources'
  ) THEN
    CREATE POLICY "Swayphics admins can manage InnerMe knowledge sources"
      ON public.innerme_knowledge_sources
      FOR ALL TO authenticated
      USING (public.is_swayphics_admin())
      WITH CHECK (public.is_swayphics_admin());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'innerme_knowledge'
      AND policyname = 'Swayphics admins can manage InnerMe knowledge'
  ) THEN
    CREATE POLICY "Swayphics admins can manage InnerMe knowledge"
      ON public.innerme_knowledge
      FOR ALL TO authenticated
      USING (public.is_swayphics_admin())
      WITH CHECK (public.is_swayphics_admin());
  END IF;
END
$policies$;

CREATE INDEX IF NOT EXISTS innerme_knowledge_domain_idx
  ON public.innerme_knowledge (domain);
CREATE INDEX IF NOT EXISTS innerme_knowledge_priority_idx
  ON public.innerme_knowledge (priority DESC);
CREATE INDEX IF NOT EXISTS innerme_knowledge_source_idx
  ON public.innerme_knowledge (source_id);
CREATE INDEX IF NOT EXISTS innerme_knowledge_status_idx
  ON public.innerme_knowledge (status);
CREATE INDEX IF NOT EXISTS innerme_knowledge_type_idx
  ON public.innerme_knowledge (knowledge_type);
CREATE INDEX IF NOT EXISTS innerme_knowledge_verification_idx
  ON public.innerme_knowledge (verification_status);
CREATE INDEX IF NOT EXISTS innerme_knowledge_embedding_hnsw_idx
  ON public.innerme_knowledge USING hnsw (embedding extensions.vector_cosine_ops);

CREATE INDEX IF NOT EXISTS innerme_knowledge_sources_authority_idx
  ON public.innerme_knowledge_sources (authority_level);
CREATE INDEX IF NOT EXISTS innerme_knowledge_sources_status_idx
  ON public.innerme_knowledge_sources (status);
CREATE INDEX IF NOT EXISTS innerme_knowledge_sources_type_idx
  ON public.innerme_knowledge_sources (source_type);
CREATE INDEX IF NOT EXISTS innerme_knowledge_sources_verification_idx
  ON public.innerme_knowledge_sources (verification_status);

DO $match_function_migration$
BEGIN
  -- Production already has this signature. Avoid replacing its live definition;
  -- install the exact contract only when the isolated/fresh schema lacks it.
  IF to_regprocedure('public.match_innerme_knowledge(extensions.vector,double precision,integer,text,text,text)') IS NULL THEN
    EXECUTE $function_definition$
    CREATE FUNCTION public.match_innerme_knowledge(
      query_embedding extensions.vector,
      match_threshold double precision DEFAULT 0.45,
      match_count integer DEFAULT 8,
      filter_domain text DEFAULT NULL,
      filter_jurisdiction text DEFAULT NULL,
      filter_knowledge_type text DEFAULT NULL
    )
    RETURNS TABLE(
      id uuid,
      slug text,
      title text,
      domain text,
      knowledge_type text,
      statement text,
      application text,
      constraints text,
      do_not_use_when text,
      evidence_level text,
      confidence text,
      jurisdiction text,
      priority integer,
      source_name text,
      source_publisher text,
      source_url text,
      similarity double precision
    )
    LANGUAGE sql
    STABLE
    SET search_path TO 'public', 'extensions'
    AS $match_body$
      SELECT
        k.id,
        k.slug,
        k.title,
        k.domain,
        k.knowledge_type,
        k.statement,
        k.application,
        k.constraints,
        k.do_not_use_when,
        k.evidence_level,
        k.confidence,
        k.jurisdiction,
        k.priority,
        s.name,
        s.publisher,
        s.url,
        (1 - (k.embedding <=> query_embedding))::double precision
      FROM public.innerme_knowledge k
      LEFT JOIN public.innerme_knowledge_sources s ON s.id = k.source_id
      WHERE k.status = 'active'
        AND k.verification_status = 'verified'
        AND k.review_after > now()
        AND k.embedding_status = 'ready'
        AND k.embedding IS NOT NULL
        AND (filter_domain IS NULL OR k.domain = filter_domain)
        AND (filter_jurisdiction IS NULL OR k.jurisdiction = filter_jurisdiction OR k.jurisdiction = 'Global')
        AND (filter_knowledge_type IS NULL OR k.knowledge_type = filter_knowledge_type)
        AND (1 - (k.embedding <=> query_embedding)) >= match_threshold
      ORDER BY
        (1 - (k.embedding <=> query_embedding)) DESC,
        CASE k.evidence_level
          WHEN 'authoritative' THEN 4
          WHEN 'established' THEN 3
          WHEN 'practitioner' THEN 2
          WHEN 'internal' THEN 1
          ELSE 0
        END DESC,
        k.priority DESC,
        k.updated_at DESC
      LIMIT LEAST(GREATEST(match_count, 1), 20);
    $match_body$;
    $function_definition$;
  END IF;
END
$match_function_migration$;

REVOKE ALL ON FUNCTION public.match_innerme_knowledge(
  extensions.vector, double precision, integer, text, text, text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.match_innerme_knowledge(
  extensions.vector, double precision, integer, text, text, text
) TO authenticated;

NOTIFY pgrst, 'reload schema';
