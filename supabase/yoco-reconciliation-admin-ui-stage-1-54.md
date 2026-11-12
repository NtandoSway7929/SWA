# Yoco administrator reconciliation interface — Stage 1.54

## Delivered on the feature branch
- Added `admin-dashboard/yoco-reconciliation.js` and loaded it from the administrator dashboard.
- Added a responsive reconciliation panel with an open/investigating queue, search, case selection, financial-anchor details, evidence log, and action-history timeline.
- Added evidence capture using `admin_add_payment_reconciliation_evidence`.
- Added controlled investigation transitions and resolution/dismissal using `admin_set_payment_reconciliation_status`.
- Resolution UI requires a reason and outcome. The financial-correction outcome additionally requires an existing payment or refund UUID; the database RPC validates that it belongs to the case invoice.
- Read operations continue through the administrator-authenticated `reconcile-payment` Edge Function. That read model now returns evidence and action history using the service-role client after administrator authorization.
- The browser UI does not query reconciliation-history tables directly and does not write payments, refunds, or invoice balances.
- The evidence RPC is now explicitly restricted to Yoco test cases by migration `202611110011_yoco_reconciliation_evidence_scope.sql`.
- Added Node regression coverage and included the UI checks in the GitHub Actions workflow.

## Security and workflow constraints
- Only Yoco test-environment cases are exposed by the reconciliation read model.
- Evidence and action history remain append-only.
- Mutations use authenticated RPCs with database-side administrator checks.
- The UI labels the workflow as test-environment only.
- No Yoco private keys, live-payment controls, production deployment, or direct ledger mutation were added.

## Validation status
- GitHub source commits completed.
- CI is configured to run Node syntax/regression checks, Deno type checks/tests, PostgreSQL grammar checks, and the disposable Supabase workflow.
- This stage has not been runtime-verified in a browser.
- SQL migrations and pgTAP have not been runtime-executed. The known repository baseline failure involving the missing foundational `public.leads` relation remains unresolved.
- No production migration, merge, deployment, webhook registration, or live payment activation has occurred.

## Next
Inspect CI results and address any static failures. Then test the panel in an isolated administrator session against a disposable Supabase database before any production planning.
