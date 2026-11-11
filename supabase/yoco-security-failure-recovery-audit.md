# Yoco client payments: security and failure-recovery audit

Target branch: `feature/yoco-client-payments`

**Scope:** source-level review of checkout creation/attachment, portal payment-status access, webhook signature verification, event idempotency, settlement, refunds, receipt retrieval and retry behaviour.

**Execution boundary:** this is a static source audit. No Deno tests, PostgreSQL migrations, Supabase requests, Yoco requests, webhook registration, sandbox checkout or deployment were executed.

## 1. Findings addressed in this stage

### Webhook database lookup errors must be retryable

Previously, payment-success and payment-failure checkout lookups treated a Supabase query error the same as a genuine unmatched checkout. That could mark an event as `requires_review` and return HTTP 200 even though the database lookup had failed.

The webhook handler now distinguishes:
- Query error: return HTTP 503 so the provider can retry.
- Successful query with no matching attempt: persist `requires_review` and acknowledge only after the state write succeeds.

The refund attempt lookup follows the same distinction.

### Event-state writes must be durable before acknowledgement

Previously, several event-state updates ignored Supabase errors and returned HTTP 200. This could acknowledge an event without durably recording why it was held for review or that it had been processed.

The handler now routes those writes through `updateWebhookEvent`. If a write fails, it returns HTTP 503 rather than acknowledging a state transition that was not persisted. This applies to incomplete payloads, unmatched checkout/failure events, conflicting failure events, refund mapping cases and retained non-success events.

The payment-failure branch also checks the result of the attempt update and final event-state update. If a success event wins a concurrent attempt-state race, the failure event is persisted as `requires_review` instead of being silently marked processed.

### Retry and event-recording tests added

`supabase/functions/tests/yoco-webhook-http.test.ts` now additionally covers:
- Verified event-recording RPC failure: no further processing; HTTP 503.
- Failure to persist a review state: HTTP 503, not a false acknowledgement.

The existing tests still use injected signature verification and in-memory database stubs.

## 2. Controls confirmed by source inspection

| Control | Source-level result |
|---|---|
| Raw-body signature | HMAC-SHA256 signs delivery ID, timestamp and exact raw body |
| Timestamp freshness | 180-second tolerance |
| Signature candidates | Accepts any valid v1 candidate; byte comparison is constant-time for equal-length values |
| Event identity | Unique provider/environment/event ID and SHA-256 body digest |
| Event collision | Same event ID with changed event type/body digest is routed to `requires_review` |
| Payment settlement | Attempt row lock and succeeded-state check prevent a second payment row for the same attempt |
| Payment amount | Provider amount, currency and test mode must match the attempt |
| Checkout recovery | Provider request reuses the client idempotency key; the database rejects reuse of that key for a different invoice/amount |
| Checkout attachment | A different checkout ID cannot replace one already attached to the attempt |
| Portal attempt lookup | Query is constrained by attempt ID, authenticated portal client ID, Yoco provider and test environment |
| Payment lookup | Payment query is additionally constrained by the portal client ID |
| Receipt lookup | Receipt is fetched only using the payment ID obtained from the client-scoped attempt; receipt ID is never accepted from the browser |
| Refund mapping | Refund event must bind to a Yoco test attempt whose payment ID matches the payment being refunded |
| Refund limit | Successful refunds are locked and cumulatively capped at the original payment amount |
| Financial records | Yoco settled payments, successful refunds and issued receipt snapshots have database immutability guards |

These are source-level observations, not proof of database enforcement until migrations and tests have been executed against PostgreSQL.

## 3. Failure and replay semantics

- A verified event is durably recorded before business processing begins.
- If event recording fails, the handler returns HTTP 503.
- If settlement fails, the handler returns HTTP 503. The event remains retryable unless the database transaction itself records a review outcome.
- If a payment-success event is replayed after processing, the database settlement function returns the existing payment/receipt rather than inserting another payment.
- If a duplicate event ID arrives with different content, the database marks the event for review; it must not trigger a second settlement.
- If the provider creates a checkout but the local attachment call fails, the endpoint does not return the checkout URL. Retrying with the same idempotency key is intended to retrieve the same provider checkout and attach it. This recovery still needs a real Yoco sandbox timeout/response-loss test.
- A successful browser return URL is not payment proof. Portal confirmation depends on the server-side attempt and payment record.

## 4. Remaining release blockers

1. **Run the full Deno suite.** Deno is not available in the current implementation environment; authored tests remain unexecuted.
2. **Run migrations 001–005 in a disposable Supabase/PostgreSQL database.** Validate transaction semantics, trigger ordering, RLS, grants, SECURITY DEFINER ownership and lock behaviour.
3. **Exercise true webhook replay and collision cases against PostgreSQL.** In-memory mocks do not prove the unique index, row locks or transaction rollback behaviour.
4. **Exercise Yoco sandbox checkout response loss.** Simulate provider success followed by a client/network timeout and failed database attachment; retry with the same idempotency key and confirm only one checkout is created.
5. **Exercise real signed Yoco success, failure and refund events.** Confirm live provider payload mapping before trusting event fields.
6. **Add operational alerting and rate limiting.** These are not implemented by this stage. Alert on repeated 5xx deliveries, `requires_review`, event collisions, unmatched checkouts and unlinked provider sessions.
7. **Review portal receipt rendering in real browsers.** Verify receipt snapshot integrity and display in Safari/Chrome on mobile and desktop.

## 5. Explicit non-claims

- No tests in this stage have been executed.
- No SQL migration has been run or parsed by PostgreSQL.
- No Yoco endpoint has been called.
- No live or sandbox payment has been initiated.
- No production credentials, webhook secrets, webhook registration or deployment have been configured.
- This audit does not authorise merge to `main` or any production change.
