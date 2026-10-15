-- Undo the older table-wide SELECT grant from the telemetry upsert migration.
-- A table-level SELECT grant overrides any intended column-only restriction.
-- Keep only the conflict-key reads required for idempotent server-side telemetry writes.
REVOKE SELECT ON TABLE public.innerme_provider_usage FROM service_role;

GRANT SELECT (request_id, attempt_number)
  ON TABLE public.innerme_provider_usage
  TO service_role;
