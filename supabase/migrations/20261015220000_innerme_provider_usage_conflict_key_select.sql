-- PostgREST's idempotent upsert requires SELECT permission on the conflict-key columns.
-- Keep service-role telemetry access limited to the two identifiers used for deduplication.
grant select (request_id, attempt_number)
  on public.innerme_provider_usage to service_role;
