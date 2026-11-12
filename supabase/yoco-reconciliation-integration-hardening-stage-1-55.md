# Yoco reconciliation integration hardening — Stage 1.55

## Changes
- The administrator Edge Function now caps evidence-history results at 500 rows and action-history results at 500 rows per read request. This bounds the size of the response when case history grows.
- The browser validates the read-model contract before replacing its current data: the response must be successful, explicitly test-environment, and contain all expected collection arrays.
- The browser rejects malformed case-list records that do not include a string case ID and status.
- Financial-correction payment/refund references are checked for UUID syntax in the UI before the authenticated RPC is called. Database-side invoice ownership checks remain authoritative.
- The Node regression suite now includes checks for bounded history reads and response-contract/UUID validation.

## Source validation
- Browser reconciliation script JavaScript syntax parsed successfully.
- Node regression test script JavaScript syntax parsed successfully.
- Edge Function source inspection confirms both history queries use `limit(500)`.
- The Edge Function still returns evidence and action history only after its administrator authorization check.

## Outstanding validation
- The Node test suite has not been executed in this environment; only syntax parsing was performed.
- The GitHub workflow is configured to run the Node tests and Deno/SQL checks on feature-branch pushes, but no run result was available for this commit at the time of documentation.
- Browser interaction tests and authenticated RPC integration tests have not been performed.
- SQL runtime and pgTAP remain blocked by the previously documented disposable-database baseline failure involving the missing foundational `public.leads` relation.

## Safety boundary
No production migrations were executed. No merge, deployment, Yoco webhook registration, secrets configuration, or live payment activation occurred.
