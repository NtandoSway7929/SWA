-- Permit admins to remove only retryable provider-error result rows.
-- Scored benchmark results remain immutable through the authenticated Data API.
grant delete on table public.innerme_evaluation_results to authenticated;

drop policy if exists "innerme evaluation admins can delete retryable provider errors"
  on public.innerme_evaluation_results;

create policy "innerme evaluation admins can delete retryable provider errors"
on public.innerme_evaluation_results
for delete to authenticated
using (
  (select public.is_swayphics_admin())
  and failure_flags @> '["execution_error"]'::jsonb
);
