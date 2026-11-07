\set ON_ERROR_STOP on
BEGIN;

-- Minimal Supabase-compatible auth surface for an isolated PostgreSQL 17 test.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
GRANT USAGE ON SCHEMA auth TO authenticated, anon;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.is_swayphics_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('test.is_swayphics_admin', true), '')::boolean,
    false
  )
$$;
GRANT EXECUTE ON FUNCTION public.is_swayphics_admin() TO authenticated, anon;

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003'),
  ('00000000-0000-4000-8000-000000000004'),
  ('00000000-0000-4000-8000-000000000005');

-- Execute the exact feature-branch migration against PostgreSQL.
\ir ../migrations/20261104110000_innerme_integration_quota.sql

DO $test$
BEGIN
  IF NOT has_schema_privilege('authenticated', 'innerme_private', 'USAGE') THEN
    RAISE EXCEPTION 'authenticated role must have private schema usage for the narrow RPC helper';
  END IF;
  IF has_schema_privilege('anon', 'innerme_private', 'USAGE')
     OR has_schema_privilege('service_role', 'innerme_private', 'USAGE') THEN
    RAISE EXCEPTION 'anon/service_role must not have private schema usage';
  END IF;
  IF has_table_privilege('authenticated', 'innerme_private.innerme_integration_quota_windows', 'SELECT')
     OR has_table_privilege('authenticated', 'innerme_private.innerme_integration_quota_leases', 'SELECT')
     OR has_table_privilege('service_role', 'innerme_private.innerme_integration_quota_windows', 'SELECT')
     OR has_table_privilege('service_role', 'innerme_private.innerme_integration_quota_leases', 'SELECT') THEN
    RAISE EXCEPTION 'API roles must not have direct quota table access';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.innerme_reserve_integration_quota(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.innerme_release_integration_quota(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated role must be able to execute the two public RPCs';
  END IF;
  IF has_function_privilege('anon', 'public.innerme_reserve_integration_quota(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.innerme_release_integration_quota(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon role must not be able to execute the public RPCs';
  END IF;
  IF NOT (
    SELECT c.relrowsecurity
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'innerme_private'
      AND c.relname = 'innerme_integration_quota_windows'
  ) OR NOT (
    SELECT c.relrowsecurity
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'innerme_private'
      AND c.relname = 'innerme_integration_quota_leases'
  ) THEN
    RAISE EXCEPTION 'RLS must be enabled on both private quota tables';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('innerme_reserve_integration_quota', 'innerme_release_integration_quota')
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'Public RPC wrappers must remain SECURITY INVOKER';
  END IF;
END;
$test$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);
SELECT set_config('test.is_swayphics_admin', 'false', false);

DO $test$
BEGIN
  BEGIN
    PERFORM public.innerme_reserve_integration_quota(
      'za.municipal_money.income_expenditure.read'
    );
    RAISE EXCEPTION 'non-admin invocation unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
END;
$test$;

SELECT set_config('test.is_swayphics_admin', 'true', false);

DO $test$
DECLARE
  v_i integer;
  v_decision jsonb;
  v_release jsonb;
  v_reservation_id uuid;
  v_users uuid[] := ARRAY[
    '00000000-0000-4000-8000-000000000002'::uuid,
    '00000000-0000-4000-8000-000000000003'::uuid,
    '00000000-0000-4000-8000-000000000004'::uuid
  ];
  v_lease_ids uuid[] := ARRAY[]::uuid[];
  v_user_id uuid;
BEGIN
  FOR v_i IN 1..3 LOOP
    v_decision := public.innerme_reserve_integration_quota(
      'za.municipal_money.income_expenditure.read'
    );
    IF v_decision->>'allowed' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'expected first three reservations to pass; got %', v_decision;
    END IF;

    v_reservation_id := (v_decision->>'reservation_id')::uuid;
    v_release := public.innerme_release_integration_quota(
      v_reservation_id,
      'za.municipal_money.income_expenditure.read'
    );
    IF v_release->>'released' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'first release should succeed; got %', v_release;
    END IF;

    v_release := public.innerme_release_integration_quota(
      v_reservation_id,
      'za.municipal_money.income_expenditure.read'
    );
    IF v_release->>'released' IS DISTINCT FROM 'false'
       OR v_release->>'idempotent' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'second release should be idempotent; got %', v_release;
    END IF;
  END LOOP;

  v_decision := public.innerme_reserve_integration_quota(
    'za.municipal_money.income_expenditure.read'
  );
  IF v_decision->>'allowed' IS DISTINCT FROM 'false'
     OR v_decision->>'reason' IS DISTINCT FROM 'admin_minute_limit' THEN
    RAISE EXCEPTION 'fourth request should hit the admin minute ceiling; got %', v_decision;
  END IF;

  FOREACH v_user_id IN ARRAY v_users LOOP
    PERFORM set_config('request.jwt.claim.sub', v_user_id::text, false);
    v_decision := public.innerme_reserve_integration_quota(
      'za.municipal_money.income_expenditure.read'
    );
    IF v_decision->>'allowed' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'expected concurrent reservation to pass for %; got %',
        v_user_id, v_decision;
    END IF;
    v_lease_ids := pg_catalog.array_append(
      v_lease_ids,
      (v_decision->>'reservation_id')::uuid
    );
  END LOOP;

  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-0000-4000-8000-000000000005',
    false
  );
  v_decision := public.innerme_reserve_integration_quota(
    'za.municipal_money.income_expenditure.read'
  );
  IF v_decision->>'allowed' IS DISTINCT FROM 'false'
     OR v_decision->>'reason' IS DISTINCT FROM 'concurrent_limit'
     OR (v_decision->>'retry_after_seconds')::integer < 1 THEN
    RAISE EXCEPTION 'fourth in-flight request should hit concurrency cap; got %', v_decision;
  END IF;

  FOR v_i IN 1..pg_catalog.array_length(v_users, 1) LOOP
    PERFORM set_config('request.jwt.claim.sub', v_users[v_i]::text, false);
    v_release := public.innerme_release_integration_quota(
      v_lease_ids[v_i],
      'za.municipal_money.income_expenditure.read'
    );
    IF v_release->>'released' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'lease owner % could not release its lease', v_users[v_i];
    END IF;
  END LOOP;
END;
$test$;

RESET ROLE;

DO $test$
DECLARE
  v_admin_usage integer;
  v_project_usage integer;
BEGIN
  SELECT reserved_count INTO v_admin_usage
  FROM innerme_private.innerme_integration_quota_windows
  WHERE scope_type = 'admin'
    AND scope_id = '00000000-0000-4000-8000-000000000001'
    AND capability = 'za.municipal_money.income_expenditure.read'
    AND window_type = 'minute';

  SELECT reserved_count INTO v_project_usage
  FROM innerme_private.innerme_integration_quota_windows
  WHERE scope_type = 'project'
    AND scope_id = current_database()
    AND capability = 'za.municipal_money.income_expenditure.read'
    AND window_type = 'minute';

  IF v_admin_usage <> 3 THEN
    RAISE EXCEPTION 'admin request count should remain 3 after releases; got %', v_admin_usage;
  END IF;
  IF v_project_usage <> 6 THEN
    RAISE EXCEPTION 'project request count should remain 6 after releases; got %', v_project_usage;
  END IF;
END;
$test$;

ROLLBACK;
