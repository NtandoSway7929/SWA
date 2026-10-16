-- The public InnerMe rate-limit RPC only references application objects via
-- fully-qualified names. Restrict name resolution to PostgreSQL built-ins.
ALTER FUNCTION public.consume_public_innerme_rate_limit(text, text) SET search_path = '';

-- Fail closed if the path setting does not persist or access posture drifts.
DO $verify_public_innerme_rate_limit_search_path$
DECLARE
  v_function_count integer;
  v_hardened_count integer;
  v_access_posture_count integer;
BEGIN
  SELECT
    count(*),
    count(*) FILTER (
      WHERE p.proconfig @> ARRAY['search_path=""']
    ),
    count(*) FILTER (
      WHERE NOT p.prosecdef
        AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
    )
  INTO v_function_count, v_hardened_count, v_access_posture_count
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = 'public.consume_public_innerme_rate_limit(text, text)'::regprocedure;

  IF v_function_count <> 1 OR v_hardened_count <> 1 OR v_access_posture_count <> 1 THEN
    RAISE EXCEPTION
      'Public InnerMe rate-limit RPC hardening failed (functions %, pinned %, access posture %)',
      v_function_count,
      v_hardened_count,
      v_access_posture_count;
  END IF;
END;
$verify_public_innerme_rate_limit_search_path$;
