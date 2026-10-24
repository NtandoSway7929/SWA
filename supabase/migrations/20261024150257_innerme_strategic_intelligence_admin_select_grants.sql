-- The strategic intelligence tables already enforce access with RLS policies
-- restricted to authenticated users for whom public.is_swayphics_admin() is true.
-- Add the missing table-level SELECT privilege required before those policies
-- can filter rows. Do not grant read access to anon or service_role.
GRANT SELECT ON TABLE
  public.innerme_strategic_reviews,
  public.innerme_strategic_recommendations
TO authenticated;
