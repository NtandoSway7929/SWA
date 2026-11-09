-- Trigger-only function; direct RPC execution is not required.
revoke all privileges on function public.touch_swayphics_lead_contacted()
from public, anon, authenticated, service_role;
