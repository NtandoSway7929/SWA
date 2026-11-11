# Yoco client payments: integration QA matrix

Target branch: feature/yoco-client-payments

**Execution status: test cases authored; not executed.** No Supabase database or Edge Function has been changed remotely. No Yoco request, webhook registration, sandbox checkout, production operation or deployment has been performed.

## 1. Automated webhook-signature tests

Test file: supabase/functions/tests/yoco-webhook.test.ts

Run locally with Deno and permission to read and restore the test webhook secret:

    deno test --allow-env=YOCO_WEBHOOK_SECRET supabase/functions/tests/yoco-webhook.test.ts

Cases included:
- Accept a valid HMAC signature when one of multiple v1 candidates is correct.
- Reject a body altered after signing.
- Reject a timestamp outside the 180-second tolerance.
- Reject a signature calculated for a different webhook delivery ID.

The verifier signs the exact raw body and the delivery ID/timestamp tuple. The test imports the isolated verifier module and does not import the Supabase client.

## 2. Edge Function contract matrix

| Area | Scenario | Expected result |
|---|---|---|
| Checkout auth | Missing/short/expired/revoked portal token | 403; no attempt or provider call |
| Checkout ownership | Token for client A submits client B invoice | Database RPC rejects; no checkout |
| Checkout eligibility | Online payments disabled | 409; no provider call |
| Checkout eligibility | Invoice cancelled/fully paid/overdue according to policy | Rejected by authoritative database rules |
| Checkout amount | Non-integer, below floor, above outstanding, unsafe integer | 400 or database rejection |
| Checkout partial | Below deposit floor or partial disabled | Database rejection |
| Checkout config | Missing test key, live key, wrong environment | 503; no Yoco request |
| Checkout response | Amount/currency/mode mismatch | 502; never return redirect |
| Checkout URL | Non-HTTPS or non-Yoco host | 502; never return redirect |
| Checkout idempotency | Same key and same request retried | Reuse one attempt/checkout |
| Checkout idempotency | Same key with different amount/invoice | Reject or manual review; never silently reuse |
| Portal status | Another client's attempt ID | 404 |
| Portal status | Valid attempt pending | Return pending; no payment/receipt |
| Portal status | Settled attempt with payment and receipt | Confirmed only when database state and payment exist |
| Webhook signature | Invalid signature | 401; no event or ledger write |
| Webhook freshness | Stale/future timestamp outside tolerance | 401 |
| Webhook replay | Same provider event delivered twice | One ledger effect; duplicate acknowledged |
| Webhook collision | Same provider event ID with changed body digest | requires_review; no second settlement |
| Webhook settlement | Wrong checkout, amount, currency or mode | No payment; review/reject |
| Webhook settlement | Valid test success | Exactly one Card/Yoco payment and one receipt |
| Webhook ordering | Failure arrives after successful settlement | Conflict routed to review; settled payment not reversed |
| Webhook failure | Valid payment.failed event | Attempt failed; invoice balance unchanged |
| Refund | Valid mapped refund.succeeded | Immutable refund row; invoice net paid reduced |
| Refund | Missing/ambiguous payment mapping | Review; no refund ledger mutation |
| Refund cap | Cumulative refunds exceed original payment | Reject; invoice balance unchanged |
| Refund replay | Duplicate refund event | One refund ledger effect |
| Admin reconcile | No JWT, invalid JWT, non-admin user | 403 |
| Admin reconcile | Valid admin JWT | Read-only test-mode attempts/refunds/open cases |
| Browser | Yoco success redirect without webhook | Remains pending; never shows confirmed |
| Browser | Payment confirmed after return | Refresh balances and show receipt |
| Browser | Cancel/failure return | Invoice remains due; retry/EFT available |
| Browser | Narrow mobile viewport | Amount input and checkout action remain usable |

## 3. Database invariants

- net_paid = SUM(successful payments) - SUM(successful refunds)
- outstanding = GREATEST(invoice total - net_paid, 0)
- Failed, pending and requires-review attempts do not affect invoice balances.
- A single verified successful payment produces one payment row.
- A single verified successful payment produces one receipt.
- A provider event ID cannot settle more than one attempt.
- A provider refund ID cannot be recorded more than once.
- Successful cumulative refunds cannot exceed the original payment amount.
- A successful Yoco refund must be linked to the verified event and matching local payment attempt.
- Settled Yoco payment rows, successful refund rows and issued receipt snapshots cannot be updated or deleted.
- A payment's invoice/client association cannot be changed by a caller.
- A refund never overwrites or deletes the original payment.
- Invoice and project statuses remain consistent after payment/refund changes.
- Client portal JSON and stored invoice balance use the same refund-aware calculation.
- Successful refunds are visible in the private client payment-history payload.

## 4. Read-only migration preflight

Before attempting migrations in a disposable local PostgreSQL/Supabase database, run:

    psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/202611110008_yoco_migration_preflight.sql

The script checks base tables/columns, existing trigger/function dependencies, Supabase roles, pgcrypto digest availability, invoice row count and extension schema. It performs catalog and count SELECTs only. Resolve every `BLOCK` result before applying migrations. This preflight does not parse or execute the Yoco migrations and is not a substitute for applying them to a disposable database.

## 5. Migration test order

Only in a disposable Supabase project, after independent review:

1. Apply 202611110001_yoco_payment_foundation.sql.
2. Apply 202611110002_yoco_refund_aware_invoice_integrity.sql.
3. Apply 202611110003_yoco_atomic_payment_operations.sql.
4. Apply 202611110004_yoco_edge_rpc_boundary.sql.
5. Apply 202611110005_yoco_ledger_immutability.sql.
6. Run schema and function privilege inspection.
7. Run Supabase database advisors.
8. Run the database invariant cases above, including concurrent settlement and refund attempts.

Do not use production to validate these migrations. Do not use a production service-role key.

## 6. Required static and runtime checks

Before a sandbox test deployment:
- deno fmt --check on the four Edge Functions, shared modules and test file.
- deno lint on those same files.
- deno check on all four function entrypoints and the test.
- Run the signature test above.
- Run the read-only migration prerequisite check in section 4.
- Run the complete migration chain on a disposable PostgreSQL/Supabase database.
- Inspect all public SECURITY DEFINER functions for explicit execute grants, fixed search paths and ownership/authorization checks.
- Confirm innerme_private remains unexposed through the Data API.
- Verify no portal token, Yoco secret, service-role key or full provider response is logged or returned.
- Exercise actual signed Yoco test webhooks for success, failure and refund event payloads before trusting their field mappings.
- Verify rate limits, request-size limits, retry behaviour and operational alerting.

## 7. Known gaps to resolve before sandbox deployment

- Confirm the exact provider refund event metadata needed to map a refund to the original payment. Unmapped refunds deliberately require manual review.
- Verify whether all deployed client-portal entry paths share the same origin and whether any www or alternate origin needs a narrowly scoped allowlist.
- Validate the receipt download implementation in Safari and Chrome; current client download is a printable HTML receipt, not a server-generated PDF.
- Add request rate limiting and push/email alert delivery before opening the endpoint to general client use. The current operational queue is admin-only and on-demand.
- Review payment-attempt expiration and recovery when Yoco creates a checkout but the database attachment fails.
- Confirm the deployed portal's existing token storage/rotation behaviour and clear the session token on explicit portal logout.
- Validate all SQL migrations in PostgreSQL. Static source inspection is not a substitute for execution.

## 8. Release boundary

This QA work does not authorise production migrations, test or production deployments, live Yoco credentials, live webhook registration, charging a client or merging into main. Those actions require separate approval.

## 9. Disposable database catalog/privilege regression test

A pgTAP test is provided at:

`supabase/tests/202611110005_yoco_ledger_invariants.test.sql`

Run it only after migrations 001–005 have been applied to a disposable local Supabase database with pgTAP available:

    psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/202611110005_yoco_ledger_invariants.test.sql

The test runs inside a transaction and rolls back. It contains 32 assertions covering operational table presence, RLS flags, browser-role table access, private-schema usage, representative RPC execution privileges, ledger triggers and refund-event uniqueness.

**Scope limitation:** these are catalog and privilege assertions. They do not simulate real invoice fixtures, settlement/refund transactions, concurrent locking, or client-token ownership. Those require a disposable database populated with valid project-specific fixtures and the functional scenarios in sections 2–5. Do not interpret a passing catalog test as end-to-end payment validation.

## 10. Disposable payment/refund transaction test

An isolated transaction-level integration script is provided at:

`supabase/tests/202611110006_yoco_payment_flow.test.sql`

Prerequisites in the disposable database:
- The complete existing Swayphics base schema, including `clients`, `client_projects`, `payments`, and `client_portal_tokens`.
- Existing invoice and business-flow SQL applied in the repository's documented order, including `supabase/swayphics-invoicing.sql` and `supabase/swayphics-business-flow.sql`.
- Yoco migrations 001–005 applied in order.
- PostgreSQL with the project's required extensions.

Run:

    psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/202611110006_yoco_payment_flow.test.sql

The test creates two temporary client fixtures, one invoice, a checkout attempt, a simulated verified payment event, a settlement, a receipt and a refund. It checks duplicate settlement, invoice/client binding, overpayment prevention, refund replay, refund cap/manual-review behaviour, refund-aware invoice balances and immutability. The entire transaction is rolled back.

**Signature boundary:** the script calls the private `record_verified_yoco_webhook` RPC directly. This simulates an event that has already passed the Edge Function's raw-body HMAC verification. It does not test Yoco signature verification, HTTP request handling, or provider payload compatibility.

**Concurrency boundary:** this is a sequential transaction test. It does not prove concurrent settlement/refund safety. A two-session race test and actual disposable PostgreSQL execution remain required. No result should be described as passed until the script has been run against a disposable database.

## 11. Two-session concurrency and recovery protocol

The manual two-session runbook is:

`supabase/yoco-concurrency-test-runbook.md`

Fixture SQL:

`supabase/tests/202611110007_yoco_concurrency_fixture.sql`

Run only against a disposable local database. The protocol covers:
- Two concurrent settlement deliveries for the same attempt/event.
- Two distinct partial refunds racing against the same payment, where their combined amount exceeds the original payment.
- Concurrent checkout-attempt creation using the same idempotency key.
- The provider-timeout/retry boundary for hosted checkout creation, which requires a separate Yoco sandbox exercise.

The runbook specifies expected return values, database row counts and invoice balances. It is a manual protocol, not an automated race test. No concurrency test has been executed. Repeat each database race at least 20 times and retain both session outputs before marking the gate passed.

## 12. Edge Function unit tests and client-portal validation

Deno unit tests:

- `supabase/functions/tests/yoco-webhook.test.ts`
  - Valid HMAC among multiple v1 candidates.
  - Raw-body tampering, stale timestamps, wrong webhook ID.
  - Missing signature, malformed timestamp and malformed Base64 signature.
- `supabase/functions/tests/yoco-checkout-validation.test.ts`
  - Checkout request validation: token, UUID, integer cents, amount bounds and idempotency key.
  - Idempotency header precedence.
  - Return URL allow-list, HTTPS, credential and lookalike-host rejection.
  - Yoco checkout response amount/currency/test-mode/redirect-host validation.
  - Portal token hashing and expiry handling.
  - Origin and no-store response helpers.
- Bounded streamed request-body reader: byte-limit enforcement without buffering an unbounded body, plus strict UTF-8 rejection.
  - UUID and generic error handling.
- `supabase/functions/tests/yoco-webhook-payload.test.ts`
  - Normalises event identity and payload/data envelope.
  - Maps documented checkout metadata and supported checkout/mode aliases.
  - Rejects missing checkout IDs, non-integer/string-encoded amounts and incomplete payment fields.
  - Parses refund identifiers and explicitly leaves refund events without payment-attempt metadata unmapped for manual review.
- `supabase/functions/tests/yoco-operations.test.ts`
  - Classifies old checkout attempts without falsely claiming a provider-side checkout exists.
  - Flags expired pending attempts, requires-review attempts and webhook events.
  - Detects stale received/processing events and retryable webhook failures.
  - Sorts high-severity review items before medium-severity warnings.
  - Confirms processed events and successful attempts are not flagged.
- `supabase/functions/tests/yoco-http-validation.test.ts`
  - Rejects malformed JSON and JSON primitives where an object is required.
  - Applies safe defaults and bounds the reconciliation query limit to 1–100.
  - Reconciliation endpoint now enforces an 8 KiB streamed request-body limit and strict UTF-8 before parsing.

Run on a machine with Deno installed:

    deno test --allow-env supabase/functions/tests

The unit tests import shared pure helpers. The checkout and payment-status HTTP tests invoke their actual exported handlers with injected dependencies and in-memory query stubs; the webhook HTTP test invokes the actual handler with an injected signature verifier and in-memory database stub. These tests do not start a network server, contact Yoco, or validate a live Supabase instance. The reconciliation request parser and limit normalizer are exercised directly; endpoint authentication and Supabase query behaviour still require a local integration harness. The webhook handler now uses the same tested normalizers. These tests validate our accepted payload shapes, not Yoco's live webhook compatibility; signed sandbox deliveries are still required.

### HTTP/application integration tests

- `supabase/functions/tests/yoco-checkout-http.test.ts`
  - Exercises the actual checkout HTTP handler with injected in-memory dependencies and mocked Yoco HTTP responses.
  - Valid checkout, private-token non-disclosure, stable idempotency header and attempt/attachment RPC ordering.
  - Invalid portal token, existing-checkout reuse, provider failure/timeout and provider-created-but-unattached checkout.
  - Disallowed origin, malformed JSON and live-key rejection.
- `supabase/functions/tests/yoco-payment-status-http.test.ts`
  - Exercises the actual payment-status HTTP handler with an in-memory query stub.
  - Confirms attempt lookups are scoped to the portal client's client_id; a foreign client's attempt is not disclosed.
  - Checks invalid portal tokens/IDs, pending response shape, settled payment plus receipt response, and fail-closed database errors.
- `supabase/functions/tests/yoco-operations.test.ts`
  - Exercises pure alert classification only; does not call Supabase or deliver notifications.
- `supabase/functions/tests/yoco-webhook-http.test.ts`
  - Exercises the actual webhook HTTP handler with an injected signature verifier and in-memory database stub.
  - Verified event-recording failure and event-state persistence failure return retryable HTTP 503 responses.
  - Invalid signature is rejected before database access; processed duplicates do not settle again.
  - Valid test-mode success maps to one settlement RPC; unmatched checkout is retained for review.
  - Settlement RPC outage returns a retryable 503; malformed signed JSON is rejected.
  - Valid checkout, private-token non-disclosure, stable idempotency header and attempt/attachment RPC ordering.
  - Invalid portal token, existing-checkout reuse, provider failure/timeout and provider-created-but-unattached checkout.
  - Disallowed origin, malformed JSON and live-key rejection.
  - No Supabase or Yoco network request is made by this test.
- The checkout, payment-status and webhook endpoints export handler factories for isolated tests; each Edge Function still serves that same handler when deployed.

### Operational monitoring and recovery queue

The admin-only, read-only `reconcile-payment` endpoint now includes:
- Latest Yoco test-mode payment attempts, refunds and open reconciliation cases.
- Oldest unresolved attempts and webhook events requiring attention.
- High-severity review items for unresolved attempts and webhook events.
- Medium-severity warnings for stale checkout attachment, expired pending checkout and stale/retryable webhook processing.
- Monitoring thresholds of 15 minutes for unattached created attempts and 5 minutes for webhook events left received/processing.
- A generated timestamp, severity counts and an explicit "latest queried records only" scope indicator.

This is an on-demand administrator monitoring response, not push notifications, scheduled polling, automatic retries or an automated dead-letter processor. It does not mutate payment state or retry provider operations. A checkout-attachment warning does not prove that Yoco created an orphan checkout; verify provider state before recovery.

Pure alert classification tests are in `supabase/functions/tests/yoco-operations.test.ts`. They are authored but not executed.

### Security and failure-recovery audit

Source review and findings are recorded in `supabase/yoco-security-failure-recovery-audit.md`. This stage corrected webhook handling so database lookup failures and event-state write failures are not acknowledged as successful deliveries. The payment-failure branch also routes a failure/success race to manual review. The added tests are authored but remain unexecuted.

### HTTP/application integration cases still requiring a local Supabase + Deno harness

- Checkout endpoint: wrong invoice owner, disabled invoice, invalid amount, actual Supabase RPC behaviour and provider idempotency semantics.
- Payment-status endpoint: actual portal-token hashing/expiry, Supabase RLS/service-role query behaviour and deployed response headers.
- Webhook endpoint: real Yoco HMAC verification in the handler test (the existing signature unit test covers the verifier separately), actual Supabase event-recording/transaction semantics, event-ID collision behaviour and refund processing end-to-end.
- Provider-created checkout with response loss/attachment failure: verify same idempotency key recovers the same Yoco checkout in a sandbox.
- Status endpoint: client A cannot query client B's attempt, missing receipt, pending and confirmed response shapes.
- Webhook endpoint: unsigned/oversized/malformed requests, provider event collision, verified success/failure/refund event mapping, retry after database/RPC outage.
- Portal browser: sessionStorage token survives same-tab return, token never appears in Yoco redirect URL, polling does not imply success before verified settlement, receipt is shown only after settlement.
- Browser tests must use a disposable local Supabase instance and mocked Yoco HTTP responses. Do not configure production secrets or use live credentials.

**Execution status:** Deno is not available in the current implementation environment. These tests have been authored but not executed. No browser automation or local Supabase integration test has been performed. Static inspection is not a substitute for those gates.

A source review also found that checkout and status handlers previously read the entire request body before applying their byte-count check. Both now use a shared bounded stream reader and reject non-object JSON bodies. The unit suite includes oversized streamed-body and invalid UTF-8 cases. This is a source change only until Deno tests are executed.


## 13. Webhook replay-state recovery (Stage 1.41)

The webhook handler now applies an explicit processing-state policy after signature verification and durable event recording:

- `processed`: acknowledge as a duplicate without repeating financial work.
- `requires_review` and `rejected`: acknowledge as terminal states without repeating financial work.
- `received` and `failed_retryable`: persist `processing` before attempting business processing; if that write fails, return HTTP 503.
- `processing`: allow replay after an interrupted delivery. Settlement and refund database operations remain responsible for financial idempotency.
- Any unrecognised or missing state: fail closed with HTTP 503; do not perform financial work.

New handler tests cover replay from `received`, `processing` and `failed_retryable`; terminal-state acknowledgement; unknown-state rejection; and failure to persist the processing transition.

**Concurrency limitation:** this is replay recovery, not an exclusive worker lease. Concurrent deliveries may both enter business processing. The payment settlement and refund database operations must continue to enforce idempotency. A durable claim/lease with expiry and a dedicated retry worker remain future work.

**Execution status:** tests are authored but not executed because Deno is unavailable in the current environment. PostgreSQL and provider sandbox validation remain outstanding.


## 14. Webhook worker lease foundation (Stage 1.43)

Migration `supabase/migrations/202611110006_yoco_webhook_worker_leases.sql` adds a database-backed lease and fencing boundary:

- Each webhook event has a paired nullable lease token and expiry timestamp.
- The atomic claim RPC locks the event row and grants a fresh UUID token only for eligible non-terminal events without an active lease.
- Lease duration is bounded to 30–300 seconds; default is 120 seconds.
- Event-state updates require the current token and an unexpired lease.
- Payment settlement and refund recording have lease-aware transactional wrappers. They lock in the established attempt/payment-then-event order, validate the lease, invoke the existing financial routine in the same transaction, and clear the lease atomically.
- The previous service-role settlement/refund entry points are revoked to prevent bypassing the new lease-aware wrappers.

**Important integration gap:** the Edge Function has not yet been switched to claim leases or pass lease tokens. Its existing direct event/attempt updates are not yet fully fenced. In particular, payment-failure attempt mutation needs a dedicated lease-aware database operation before the Edge Function can safely use the new mechanism. Do not treat the lease migration alone as closing the concurrent-delivery issue.

**Execution status:** migration is authored only. No PostgreSQL parser, migration application, SQL transaction, two-session race, Deno test or Yoco sandbox test has been run. Validate the complete migration chain and function ownership/privileges in a disposable local database before any sandbox deployment.


## 15. Edge Function lease integration (Stage 1.44)

The Yoco webhook handler now:
- Records the verified event, then obtains a database lease before any attempt lookup or financial processing.
- Returns a retryable HTTP 503 when another worker holds an active lease or the claim RPC is unavailable.
- Passes the lease token to payment settlement and refund recording RPCs.
- Uses the token-fenced event-state RPC for review transitions and refund-attempt association.
- Delegates `payment.failed` to a transactional lease-aware RPC that locks the attempt and event, detects a conflicting successful settlement, and clears the lease atomically.
- Acknowledges terminal duplicates without claiming a new lease.
- Retires the pre-lease HTTP test harness; new focused coverage is in `supabase/functions/tests/yoco-webhook-lease-http.test.ts`.

Static test coverage authored: claim-before-processing, active lease rejection, claim outage, lease-token propagation, atomic payment-failure handling, fenced review transition, stale-token rejection, and terminal duplicate handling.

**Validation status:** test source and SQL are authored only. Deno, PostgreSQL, migration-chain and concurrency execution remain NOT RUN. No Yoco sandbox call or deployment has occurred.


## 16. Lease database validation (Stage 1.45)

Added `supabase/tests/202611110009_yoco_webhook_lease.test.sql`, a rollback-based SQL test for:
- exclusive claim while a lease is active;
- stale token rejection;
- expired lease takeover and new fencing token;
- stale worker rejection after takeover;
- terminal transition and lease release;
- atomic `payment.failed` attempt/event transition.

Updated `supabase/yoco-concurrency-test-runbook.md` with the 001–007 migration prerequisite, the transactional test command, and a two-session claim race protocol. The older 001–005 settlement/refund fixture remains useful for its original functions but does not prove the new lease-aware Edge Function behaviour.

**Execution status:** SQL test authored only. No local PostgreSQL/Supabase, Deno or Docker runtime is available in the current environment. No SQL test, two-session race, migration application or sandbox request has been run. Acceptance still requires at least 20 successful repetitions of each relevant race on a disposable database.


## 13. GitHub-hosted disposable QA execution

The mobile-compatible CI workflow is documented in `supabase/yoco-disposable-qa-workflow.md` and implemented in `.github/workflows/yoco-disposable-qa.yml`.

It provisions a fresh local Supabase stack on a GitHub-hosted runner, resets it using the repository migration history, runs the read-only preflight and pgTAP suite, checks and tests the Deno functions, and executes 20 concurrent two-worker webhook lease-claim races. It uses no hosted Supabase project, repository secrets, Yoco credentials, live webhook or deployment.

The concurrency runner is `supabase/tests/yoco-lease-concurrency-ci.sh`. It tests exactly-one-winner lease claiming across two independent PostgreSQL client processes. It does not prove settlement/refund race safety; those additional scenarios remain in `supabase/yoco-concurrency-test-runbook.md`.

**Execution status (GitHub Actions run 13, commit `335c6f1eec8baa51e1c6880d1005ffcb2cc374c1`):** Supabase container startup passed, but `supabase db reset --local` stopped at the first historical migration because `public.leads` is absent from the clean migration history. The preflight, pgTAP suite and concurrency runner were therefore not reached. Deno type-checks and all 40 Deno tests passed. Formatting remains non-blocking and reports 17 of 19 selected files unformatted. No Yoco SQL migration has been applied.


## 14. PostgreSQL grammar validation (Stage 1.47)

Added `supabase/tests/yoco_sql_syntax_check.py` and a separate CI job using `pglast`, independent of the clean-install database job.

**Execution status (GitHub Actions run 13, commit `335c6f1eec8baa51e1c6880d1005ffcb2cc374c1`):** PostgreSQL grammar parser passed for all 12 selected SQL files: seven Yoco migrations and five Yoco SQL test/preflight/fixture files. This confirms top-level PostgreSQL statement grammar only. It does not parse PL/pgSQL function bodies as executable code, resolve schema dependencies, check runtime privileges/RLS, or execute transactional/concurrency behaviour. It is not a substitute for PostgreSQL migration replay and pgTAP.

The disposable database job still fails before Yoco migrations at the existing missing `public.leads` baseline dependency. SQL/pgTAP and concurrency execution remain NOT RUN.


## 15. Latest hosted execution and baseline investigation

GitHub Actions run [42955221896](https://github.com/NtandoSway7929/SWA/actions/runs/42955221896) completed with Deno and PostgreSQL grammar jobs passed. The disposable Supabase job failed during startup/migration initialization; the log reports `public.leads` missing. A transient registry rate-limit response also appeared during container download, but PostgreSQL subsequently became available and the schema dependency error remained.

The standalone core SQL scripts were inspected. They establish interdependent core objects, so adding a placeholder `public.leads` table or blindly concatenating scripts is not an acceptable baseline repair. The schema-only export from the actual project remains required. Migration preflight, pgTAP and concurrency execution were skipped and remain NOT RUN.
