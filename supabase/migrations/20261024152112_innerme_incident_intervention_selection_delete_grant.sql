-- The source function refresh_innerme_incident_intervention_selection()
-- deletes and rebuilds a per-incident recommendation under its existing
-- admin-only RLS policy. Grant the table-level privilege it requires.
GRANT DELETE ON TABLE public.innerme_incident_intervention_selection TO authenticated;
