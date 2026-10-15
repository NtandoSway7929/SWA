-- Undo the older table-wide SELECT/UPDATE grants from the telemetry upsert migration.
-- The writer uses resolution=ignore-duplicates; it needs INSERT and conflict-key
-- SELECT access, but it does not need to update existing telemetry rows.
REVOKE SELECT, UPDATE ON TABLE public.innerme_provider_usage FROM service_role;

-- Remove any old column-level SELECT grants on non-conflict telemetry fields too.
REVOKE SELECT (
  id,
  task_category,
  provider,
  model,
  outcome,
  http_status,
  latency_ms,
  input_tokens,
  output_tokens,
  total_tokens,
  error_code,
  fallback_reason,
  created_at
) ON TABLE public.innerme_provider_usage FROM service_role;

GRANT SELECT (request_id, attempt_number)
  ON TABLE public.innerme_provider_usage
  TO service_role;
