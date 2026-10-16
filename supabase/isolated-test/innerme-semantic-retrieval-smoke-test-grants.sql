-- ISOLATED TEST PROJECT ONLY. DO NOT PLACE THIS FILE IN supabase/migrations.
-- Apply manually only to Supabase project ref: ofqofhnlzbouclvvrmzd
--
-- The semantic smoke helper uses the dedicated test admin's JWT for fixture
-- operations. This grants only INSERT/DELETE to authenticated in the isolated
-- test project; existing SELECT/UPDATE grants and admin-only RLS stay in force.
-- service_role intentionally receives no direct privileges on innerme_knowledge.

DO $preflight$
DECLARE
  v_rls_enabled boolean;
  v_admin_policy boolean;
BEGIN
  SELECT c.relrowsecurity
    INTO v_rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'innerme_knowledge';

  IF COALESCE(v_rls_enabled, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Safety stop: public.innerme_knowledge must exist with RLS enabled.';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.tablename = 'innerme_knowledge'
       AND p.policyname = 'Swayphics admins can manage InnerMe knowledge'
       AND p.cmd = 'ALL'
       AND 'authenticated' = ANY (p.roles)
       AND p.qual LIKE '%is_swayphics_admin%'
       AND p.with_check LIKE '%is_swayphics_admin%'
  ) INTO v_admin_policy;

  IF v_admin_policy IS NOT TRUE THEN
    RAISE EXCEPTION 'Safety stop: expected active-admin RLS policy is missing or changed.';
  END IF;
END
$preflight$;

GRANT INSERT, DELETE ON TABLE public.innerme_knowledge TO authenticated;

DO $postflight$
BEGIN
  IF has_table_privilege('service_role', 'public.innerme_knowledge', 'INSERT')
     OR has_table_privilege('service_role', 'public.innerme_knowledge', 'DELETE') THEN
    RAISE EXCEPTION 'Safety stop: service_role must not have direct INSERT/DELETE privileges on innerme_knowledge.';
  END IF;
END
$postflight$;
