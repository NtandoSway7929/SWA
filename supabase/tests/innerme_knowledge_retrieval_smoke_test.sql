-- Positive-path smoke test for InnerMe verified-knowledge retrieval.
-- RUN ONLY in the isolated "Swayphics InnerMe Test" project.
-- This uses a synthetic 384-dimensional vector, no embedding/LLM provider,
-- and an explicit transaction that is rolled back at the end.

BEGIN;

INSERT INTO public.innerme_knowledge (
  slug,
  title,
  domain,
  knowledge_type,
  statement,
  application,
  evidence_level,
  confidence,
  jurisdiction,
  priority,
  status,
  last_verified_at,
  review_after,
  verification_status,
  verification_method,
  verification_notes,
  embedding,
  embedding_model,
  embedding_status,
  embedded_at
)
VALUES (
  '__innerme_retrieval_smoke_test__',
  'Synthetic retrieval smoke test',
  'synthetic-retrieval-test',
  'definition',
  'Synthetic test record used only to prove vector retrieval.',
  'Never use outside this isolated smoke test.',
  'internal',
  'high',
  'Global',
  100,
  'active',
  now(),
  now() + interval '1 day',
  'verified',
  'transactional_smoke_test',
  'No production data; inserted only to validate match_innerme_knowledge.',
  ('[' || '1' || repeat(',0', 383) || ']')::extensions.vector(384),
  'synthetic-test-vector',
  'ready',
  now()
)
RETURNING id, slug;

-- Fail the script if the exact synthetic record is not returned at the
-- expected similarity. A successful HTTP/RPC call with zero matches is not
-- sufficient to pass this positive-path test.
DO $assert_retrieval$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.match_innerme_knowledge(
      ('[' || '1' || repeat(',0', 383) || ']')::extensions.vector(384),
      0.99,
      10,
      'synthetic-retrieval-test',
      'Global',
      'definition'
    ) AS matched
    WHERE matched.slug = '__innerme_retrieval_smoke_test__'
      AND matched.similarity >= 0.999
  ) THEN
    RAISE EXCEPTION
      'InnerMe knowledge retrieval smoke test failed: synthetic record was not returned with similarity >= 0.999.';
  END IF;
END
$assert_retrieval$;

-- Expected: exactly one row for this slug, similarity = 1.
SELECT
  matched.id,
  matched.slug,
  matched.title,
  matched.similarity
FROM public.match_innerme_knowledge(
  ('[' || '1' || repeat(',0', 383) || ']')::extensions.vector(384),
  0.99,
  10,
  'synthetic-retrieval-test',
  'Global',
  'definition'
) AS matched
WHERE matched.slug = '__innerme_retrieval_smoke_test__';

-- Do not commit the synthetic record.
ROLLBACK;
