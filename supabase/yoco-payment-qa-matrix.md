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
- A payment's invoice/client association cannot be changed by a caller.
- A refund never overwrites or deletes the original payment.
- Invoice and project statuses remain consistent after payment/refund changes.
- Client portal JSON and stored invoice balance use the same refund-aware calculation.

## 4. Migration test order

Only in a disposable Supabase project, after independent review:

1. Apply 202611110001_yoco_payment_foundation.sql.
2. Apply 202611110002_yoco_refund_aware_invoice_integrity.sql.
3. Apply 202611110003_yoco_atomic_payment_operations.sql.
4. Apply 202611110004_yoco_edge_rpc_boundary.sql.
5. Run schema and function privilege inspection.
6. Run Supabase database advisors.
7. Run the database invariant cases above, including concurrent settlement and refund attempts.

Do not use production to validate these migrations. Do not use a production service-role key.

## 5. Required static and runtime checks

Before a sandbox test deployment:
- deno fmt --check on the four Edge Functions, shared modules and test file.
- deno lint on those same files.
- deno check on all four function entrypoints and the test.
- Run the signature test above.
- Run the complete migration chain on a disposable PostgreSQL/Supabase database.
- Inspect all public SECURITY DEFINER functions for explicit execute grants, fixed search paths and ownership/authorization checks.
- Confirm innerme_private remains unexposed through the Data API.
- Verify no portal token, Yoco secret, service-role key or full provider response is logged or returned.
- Exercise actual signed Yoco test webhooks for success, failure and refund event payloads before trusting their field mappings.
- Verify rate limits, request-size limits, retry behaviour and operational alerting.

## 6. Known gaps to resolve before sandbox deployment

- Confirm the exact provider refund event metadata needed to map a refund to the original payment. Unmapped refunds deliberately require manual review.
- Verify whether all deployed client-portal entry paths share the same origin and whether any www or alternate origin needs a narrowly scoped allowlist.
- Validate the receipt download implementation in Safari and Chrome; current client download is a printable HTML receipt, not a server-generated PDF.
- Add rate limiting and alerting before opening the endpoint to general client use.
- Review payment-attempt expiration and recovery when Yoco creates a checkout but the database attachment fails.
- Confirm the deployed portal's existing token storage/rotation behaviour and clear the session token on explicit portal logout.
- Validate all SQL migrations in PostgreSQL. Static source inspection is not a substitute for execution.

## 7. Release boundary

This QA work does not authorise production migrations, test or production deployments, live Yoco credentials, live webhook registration, charging a client or merging into main. Those actions require separate approval.
