-- Repair the server-only insertion grant for InnerMe provider telemetry.
-- The table remains inaccessible for inserts to anon/authenticated roles.
GRANT INSERT ON TABLE public.innerme_provider_usage TO service_role;
