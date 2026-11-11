# Reconciliation history pagination and completeness — Stage 1.57

## Changes
- Replaced the global 500-row evidence/action history fetch with per-case history retrieval.
- The administrator Edge Function accepts a reconciliation case ID and independent evidence/action offsets.
- A history request is accepted only when the supplied case ID is a valid UUID and belongs to the current Yoco test-environment open/investigating queue.
- Evidence and action history are fetched independently, scoped to that case, ordered newest-first by timestamp and ID, and paginated in pages of 100.
- Each query fetches one look-ahead row. The response returns only the first 100 rows and sets an exact `has_more` indicator based on whether the look-ahead row exists.
- The dashboard loads the first history page when a case is selected and exposes separate “Load older evidence” and “Load older actions” controls.
- Selecting another case clears the prior case's history before loading the new case, preventing history from one case appearing under another.
- Regression coverage checks case scoping, pagination offsets, stable ordering, exact has-more calculation, and UI load-more controls.

## Source verification
- Browser reconciliation JavaScript parses successfully.
- Node regression test JavaScript parses successfully.
- Source inspection confirms authorization precedes service-role client creation.
- Source inspection confirms per-case scoping, offset pagination, independent evidence/action pages, and look-ahead has-more calculation.

## Not yet verified
- Node tests have not been executed.
- Deno type-check/tests and SQL runtime tests have not been run.
- Authenticated browser and RPC interaction has not been tested.
- Disposable Supabase migration validation remains blocked by the existing missing foundational `public.leads` relation.

## Safety boundary
Changes are confined to `feature/yoco-client-payments`. No production migration, merge, deployment, Yoco webhook registration, secrets configuration, or live payment activation occurred.
