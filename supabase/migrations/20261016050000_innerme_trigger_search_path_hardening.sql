-- Pin InnerMe's trigger helpers to PostgreSQL built-ins only.
-- Both functions operate solely on NEW fields and built-in functions/operators.
-- No application-schema objects are referenced by either function body.
ALTER FUNCTION public.set_innerme_updated_at() SET search_path = pg_catalog;
ALTER FUNCTION public.refresh_innerme_embedding_text() SET search_path = pg_catalog;

-- Fail the migration if either function is missing or its setting did not persist.
DO $verify_innerme_trigger_search_path$
DECLARE
  v_function_count integer;
  v_hardened_count integer;
BEGIN
  SELECT
    count(*),
    count(*) FILTER (
      WHERE p.proconfig @> ARRAY['search_path=pg_catalog']
    )
  INTO v_function_count, v_hardened_count
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid IN (
    'public.set_innerme_updated_at()'::regprocedure,
    'public.refresh_innerme_embedding_text()'::regprocedure
  );

  IF v_function_count <> 2 OR v_hardened_count <> 2 THEN
    RAISE EXCEPTION
      'InnerMe trigger search_path hardening failed: % of % functions configured',
      v_hardened_count,
      v_function_count;
  END IF;
END
$verify_innerme_trigger_search_path$;
