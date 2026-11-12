# Yoco client payments — Stage 1.46 implementation audit

**Branch:** `feature/yoco-client-payments`  
**Audit date:** 2026-11-11  
**Scope:** source-level review of the seven migrations, four Edge Functions, shared validation/signature modules, client portal integration, SQL/Deno test assets and setup/QA documentation.

## Audit conclusion

**Not ready for merge, deployment or customer use.** The branch has a coherent test-only architecture, but there are release-blocking implementation-completeness gaps and unexecuted validation gates. This audit is source review only; it is not a PostgreSQL, Deno, browser or Yoco sandbox test.

## Positive findings from source review

1. Checkout creation is server-side, requires a hashed private portal token, checks invoice ownership in the database, and refuses to run unless the configured key is `sk_test_` and environment is exactly `test`.
2. Checkout amount, currency, processing mode and hosted redirect URL are validated before the portal receives the redirect.
3. The portal token is retained in same-tab session storage and is not appended to Yoco return URLs.
4. Webhooks verify the raw request body and signature before parsing JSON or calling the database. Stale timestamps are rejected.
5. Event identity and payload digest are persisted; conflicting reuse of an event ID is routed to review.
6. Webhook workers now claim an expiring lease and pass its fencing token into settlement, refund and failure operations. Direct event-table writes are not used by the webhook handler.
7. Settlement and refund operations use row locks, idempotency constraints, separate payment/refund ledger records and receipt snapshots. The lease-aware functions keep lease validation and financial mutation in one database transaction.
8. The portal status endpoint scopes attempts to the client resolved from the private token. Reconciliation requires a valid user JWT and `is_swayphics_admin()`.
9. The setup guide has been corrected to list all seven migrations in execution order.

## Release-blocking gaps

### A. No administrator workflow to enable online payment per invoice

The portal only renders checkout when `online_payment_enabled` is true. New invoices default to false. The reviewed branch does not provide an admin dashboard control for enabling online payment, setting the deposit amount, or enabling partial payments. Therefore an administrator cannot safely configure the intended customer-facing feature through the product UI.

**Required before release:** add an authenticated admin workflow for invoice-level online payment settings, with validation and an audit trail. Keep all controls disabled by default. Do not expose direct browser writes to the operational payment tables.

### B. Reconciliation endpoint is read-only, with no usable resolution workflow

The admin Edge Function returns attempts, refunds, open cases and operational alerts, but it cannot create/update reconciliation cases, record manual evidence, mark a case resolved, or record a verified off-provider/manual payment. No corresponding admin UI was found in the reviewed changed files.

**Required before release:** define and implement a controlled admin reconciliation workflow, with role checks, immutable financial ledger rules, evidence/reference capture and a clear separation between resolving an investigation and recording a financial transaction. Until then, the existing endpoint is monitoring data, not a complete manual reconciliation process.

### C. Provider contract remains unverified

The refund normalizer depends on `payload.metadata.paymentAttemptId` to map a refund to a local payment attempt. The setup guide correctly says actual Yoco refund payload variants have not yet been confirmed. Missing mappings are sent to manual review, which is fail-closed, but successful automated refund recording is not yet demonstrated.

**Required before release:** capture and inspect real signed Yoco test deliveries for payment success, payment failure, refund success and refund failure. Confirm exact event fields and amount units. Update parsers and fixtures only from verified payloads.

### D. Checkout idempotency recovery is not yet proven

The same idempotency key is sent to Yoco and reused locally, which is the intended recovery mechanism. However, the timeout-after-provider-acceptance scenario has not been exercised against Yoco sandbox. A lost response between provider creation and local checkout attachment could leave an attempt without a checkout ID.

**Required before release:** execute the documented timeout/retry scenario in sandbox and prove Yoco returns the original checkout for the same idempotency key. If not, retain manual review rather than creating a second checkout automatically.

## Technical review items still requiring runtime validation

- Apply migrations 001–007 in order to a disposable local database; verify function owners, effective schema/table/function/sequence grants, RLS and trigger attachment.
- Execute migration preflight, pgTAP invariant tests, payment/refund transaction tests and the new lease SQL test.
- Run the two-session claim, lease takeover, stale-token, duplicate settlement, competing refund and checkout idempotency races at least 20 times each.
- Type-check and run all Deno tests. The current environment did not have Deno, PostgreSQL/psql, pgTAP, Supabase CLI or Docker available.
- Exercise portal checkout, same-tab return, pending/success/failure states and receipt download in a browser.
- Confirm webhook payload field names, signature handling and provider idempotency in Yoco sandbox.
- Review the full migration effects on existing invoice/payment triggers and historical invoice balances before applying to any shared environment.

## Scope and safety status

- All reviewed work remains on `feature/yoco-client-payments`.
- The branch comparison at audit start was 158 commits ahead and 2 behind `main`, with 40 changed files. It is diverged; do not merge or rebase automatically.
- No production migration, remote database query, secret configuration, Yoco webhook registration, payment, deployment or merge was performed.
- No live mode is implemented as an enabled path; checkout code explicitly requires test credentials and test processing mode.

## Stage 1.46 exit decision

**Source audit: completed. Release readiness: blocked.**

The next stage should close the administrator invoice-settings workflow and define the reconciliation actions before running the full local validation suite. Sandbox contract verification follows runtime validation. Merge/deployment remain separate approval gates.
