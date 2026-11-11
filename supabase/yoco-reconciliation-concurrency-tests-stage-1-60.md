# Reconciliation concurrency regression harness — Stage 1.60

## Added coverage

### pgTAP schema and security assertions
The existing reconciliation workflow test now has 36 assertions. Nine additional assertions verify:
- The version-checked status RPC exists with the expected timestamp argument.
- SECURITY DEFINER and pinned empty search_path are retained.
- Authenticated administrators can execute the new RPC, while anon cannot.
- Authenticated users cannot bypass version checks through the legacy status RPC.
- A stale or missing version is rejected with SQLSTATE 40001.
- Evidence submission advances the parent case version.

### Two-session database race harness
Added `supabase/tests/yoco-reconciliation-concurrency-ci.sh`. It exercises two competing scenarios against a disposable database fixture:

1. **Two administrator decisions:** two distinct administrator identities submit the same open-case version concurrently. The harness expects one decision to commit and the other to fail with SQLSTATE 40001. It then verifies the case is investigating and exactly one new action was recorded.
2. **Evidence versus closure:** while one administrator appends evidence and holds the row lock, a second administrator attempts to close the case using the pre-evidence version. The harness expects the stale closure to fail with SQLSTATE 40001, and verifies the case remains investigating with exactly one new evidence record and one new action.

The harness uses the guarded RPCs as the authenticated role. It does not write payments, refunds or invoice balances.

## Required disposable fixtures
The shell harness requires:
- `LOCAL_DB_URL` pointing to a disposable local Supabase database.
- `YOCO_TEST_CASE_ID` identifying an open Yoco test reconciliation case with valid financial anchors.
- `YOCO_ADMIN_A_ID` and `YOCO_ADMIN_B_ID` identifying two distinct active administrator users in that disposable database.

The supplied case is changed by the test: it ends in investigating status and receives one evidence record. Use a dedicated throwaway fixture, never a production case.

## Verification status
- Node regression test source parses successfully.
- pgTAP assertions have been authored and are included in the existing disposable database suite.
- The two-session harness has been authored but has **not** been executed because no disposable database and seeded two-administrator fixture are currently available.
- The full repository disposable Supabase reset remains blocked by the pre-existing historical migration dependency on missing `public.leads`.
- No claim is made that the concurrency race has passed at runtime.

## Safety
All changes are on `feature/yoco-client-payments`. No production database, production migration, merge, deployment, webhook registration, secrets configuration or live payment activation occurred.
