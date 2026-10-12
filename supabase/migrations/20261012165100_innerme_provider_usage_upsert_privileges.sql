-- PostgREST upsert with an ON CONFLICT target needs SELECT, INSERT, and UPDATE grants.
-- Keep these table privileges limited to server-side telemetry writes/verification.
GRANT SELECT, INSERT, UPDATE ON TABLE public.innerme_provider_usage TO service_role;
