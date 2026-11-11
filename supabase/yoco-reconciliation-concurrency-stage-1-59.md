# Optimistic concurrency for reconciliation decisions — Stage 1.59

## Changes
- Added `admin_set_payment_reconciliation_status_v2`, retaining the administrator check, Yoco test-environment restriction, invoice-bound financial reference validation, row lock, allowed transitions and append-only action history.
- The new RPC requires the exact `updated_at` timestamp observed by the administrator's dashboard when the case was loaded.
- After acquiring the case row lock, the RPC compares the expected timestamp with the current database timestamp. A mismatch or missing version token raises SQLSTATE `40001` with a refresh-and-review message; the stale decision is not applied.
- The dashboard now calls the version-checked RPC and supplies `c.updated_at`.
- The old status RPC's execute permission is revoked from `authenticated` so the dashboard cannot bypass the concurrency check using the previous signature.
- Adding evidence now advances the parent case's `updated_at` while holding the case row lock. This ensures a decision based on a pre-evidence snapshot is rejected.
- Corrected a pre-existing Stage 1.58 regression in the main dashboard `load()` function: it incorrectly referenced history-request variables that are only defined in `loadHistory()`. The stale-response guard remains in the history loader, where those variables exist.
- Bumped the reconciliation script cache version to Stage 1.59.

## Verification performed
- Dashboard JavaScript parses successfully.
- Node regression-test JavaScript parses successfully.
- Source inspection confirms the new RPC retains SECURITY DEFINER, pinned empty search_path, administrator authorization, Yoco/test restriction and row locking.
- Source inspection confirms expected-version comparison, old RPC permission revocation and evidence-driven version increments.
- Regression suite expanded to 18 test cases.

## Not verified
- The Node regression suite has not been executed in a Node runtime.
- The migration has not been applied to a disposable database; the existing baseline blocker remains the missing `public.leads` relation in an earlier historical migration.
- No authenticated two-administrator concurrency test has been run.
- No browser/RPC runtime test or GitHub Actions pass is claimed.

## Safety
Changes are on `feature/yoco-client-payments` only. No production SQL, production merge, deployment, provider webhook registration, credential configuration or live payment activation occurred.
