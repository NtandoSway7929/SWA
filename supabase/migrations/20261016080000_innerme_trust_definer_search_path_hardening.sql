-- These trust/calibration implementations are SECURITY DEFINER and use
-- schema-qualified application objects plus PostgreSQL built-ins. Restrict
-- object resolution to built-ins while preserving the existing function ACLs.
ALTER FUNCTION innerme_private.record_innerme_agent_trust_evidence(uuid, text, uuid, text, text, integer, text, jsonb) SET search_path = '';
ALTER FUNCTION innerme_private.refresh_innerme_agent_trust_calibration() SET search_path = '';
ALTER FUNCTION innerme_private.review_innerme_agent_trust_evidence(uuid, text) SET search_path = '';
ALTER FUNCTION innerme_private.review_innerme_trust_calibration(uuid, text) SET search_path = '';

-- Fail closed if any target is missing or its privilege/security posture drifts.
DO $verify_innerme_trust_definer_search_path$
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
    'innerme_private.record_innerme_agent_trust_evidence(uuid, text, uuid, text, text, integer, text, jsonb)'::regprocedure,
    'innerme_private.refresh_innerme_agent_trust_calibration()'::regprocedure,
    'innerme_private.review_innerme_agent_trust_evidence(uuid, text)'::regprocedure,
    'innerme_private.review_innerme_trust_calibration(uuid, text)'::regprocedure
  );

  IF v_function_count <> 4 OR v_hardened_count <> 4 OR v_access_posture_count <> 4 THEN
    RAISE EXCEPTION
      'InnerMe trust function hardening failed (functions %, pinned %, access posture %)',
      v_function_count, v_hardened_count, v_access_posture_count;
  END IF;
END;
$verify_innerme_trust_definer_search_path$;
