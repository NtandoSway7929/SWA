-- These Phase 30 policy implementations are SECURITY DEFINER and use only
-- schema-qualified application objects plus PostgreSQL built-ins. Keep object
-- resolution out of application schemas while preserving their existing ACLs.
ALTER FUNCTION innerme_private.innerme_action_policy_fingerprint(uuid) SET search_path = '';
ALTER FUNCTION innerme_private.evaluate_innerme_action_policy(uuid, text) SET search_path = '';

-- Fail closed if either function is missing or if its security boundary drifts.
DO $verify_innerme_policy_search_path$
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
      WHERE p.prosecdef
        AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
        AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    )
  INTO v_function_count, v_hardened_count, v_access_posture_count
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid IN (
    'innerme_private.innerme_action_policy_fingerprint(uuid)'::regprocedure,
    'innerme_private.evaluate_innerme_action_policy(uuid, text)'::regprocedure
  );

  IF v_function_count <> 2 OR v_hardened_count <> 2 OR v_access_posture_count <> 2 THEN
    RAISE EXCEPTION
      'InnerMe Phase 30 policy hardening failed (functions %, pinned %, access posture %)',
      v_function_count,
      v_hardened_count,
      v_access_posture_count;
  END IF;
END;
$verify_innerme_policy_search_path$;
