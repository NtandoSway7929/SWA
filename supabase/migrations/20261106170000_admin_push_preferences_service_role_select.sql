-- The push dispatcher reads the browser-push preference with the project's
-- server-side secret API key. That key maps to service_role and bypasses RLS,
-- but Postgres table privileges are still required before PostgREST can read it.
-- Grant only the read operation the dispatcher needs; keep user-facing access
-- restricted to the existing authenticated policy.
grant select on table public.admin_notification_preferences to service_role;
