-- The contact-clock recalculation is an internal helper invoked by
-- SECURITY DEFINER wrappers and communication-log triggers, not a public RPC.
revoke all privileges on function public.recalculate_swayphics_lead_contact_clock(uuid)
from public, anon, authenticated, service_role;
