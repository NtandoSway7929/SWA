# Administrator reconciliation security regression coverage — Stage 1.56

## Regression checks added
The Node test suite now checks:
- The reconciliation Edge Function rejects non-POST methods.
- The production-site origin restriction is evaluated before privileged data access.
- Administrator JWT validation and the `is_swayphics_admin` RPC are present.
- The administrator authorization gate occurs before service-role client creation and the first database read.
- The browser submits evidence and status changes through the guarded RPCs rather than direct evidence/action table inserts.
- The status migration permits only the intended open/investigating transitions and prevents transitions from terminal resolved/dismissed cases.
- Existing coverage continues to check test-environment scoping, invoice-bound financial references, UUID syntax, bounded history reads and the response contract.

## Verification performed
- The updated Node test file parses as valid JavaScript.
- Source inspection confirms the authorization gate precedes service-role client creation and privileged reads.
- The migration source contains the expected transition rules.

## Not yet verified
- The Node test suite has not been executed.
- Deno tests and SQL/pgTAP runtime tests have not been executed for this stage.
- Authenticated browser/RPC interaction has not been tested.
- Disposable Supabase migration execution remains blocked by the previously identified missing foundational `public.leads` relation.
- No live Yoco sandbox webhook or checkout has been exercised.

## Safety boundary
All changes are on `feature/yoco-client-payments`. No production database operations, merge, deployment, webhook registration, secrets configuration or live payment activation occurred.
