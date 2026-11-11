# Yoco Edge Functions: implementation and test setup

Target branch: `feature/yoco-client-payments`

**Status: implementation preparation only.** No Edge Function has been deployed, no secret has been configured, no webhook has been registered, and no payment has been initiated.

## Functions

| Function | Caller authentication | Responsibility |
|---|---|---|
| `create-payment-checkout` | Hashed private client-portal token; strict origin check | Creates/reuses a test payment attempt, requests Yoco hosted Checkout, and attaches the returned checkout |
| `yoco-payment-webhook` | Yoco HMAC signature over the exact raw request body | Records provider events, settles verified success, records verified refunds, and handles verified payment failures |
| `get-payment-status` | Hashed private client-portal token | Returns the attempt state and confirmed payment/receipt, if present |
| `reconcile-payment` | Valid Supabase user JWT plus `is_swayphics_admin()` | Read-only admin view of attempts, refunds and open reconciliation cases |

The functions use service-role database access only on the server. The service-role key and Yoco secrets must never be exposed to the browser.

## Required test-project secrets

Configure these only in a disposable/test Supabase project after the code and SQL have been reviewed:

- `YOCO_SECRET_KEY`: Yoco test secret key. The checkout function fails closed unless it begins with `sk_test_`.
- `YOCO_ENVIRONMENT`: exactly `test`.
- `YOCO_WEBHOOK_SECRET`: signing secret issued by Yoco for the registered webhook; expected `whsec_` prefix.
- `YOCO_SUCCESS_URL`: HTTPS URL for the deployed client portal route on `swayphics.co.za` or a subdomain (not the general homepage).
- `YOCO_CANCEL_URL`: HTTPS URL for the deployed client portal route on `swayphics.co.za` or a subdomain.
- `YOCO_FAILURE_URL`: HTTPS URL for the deployed client portal route on `swayphics.co.za` or a subdomain.

Supabase injects the project URL and server-side service credentials into Edge Function environments. Never commit any actual secret value or local `.env` file.

## Checkout contract

Request body:

```json
{
  "token": "<private client portal token>",
  "invoice_id": "<invoice UUID>",
  "amount_cents": 150000,
  "idempotency_key": "<unique request key>"
}
```

The amount is an integer number of cents. The database validates client ownership, invoice eligibility, outstanding balance, online-payment enablement, partial-payment rules and the deposit floor. The browser cannot set provider status or mark an invoice paid.

The function sends an idempotency key to Yoco and requires the returned checkout to identify test processing mode, the requested amount, ZAR currency and an HTTPS Yoco-hosted redirect URL before returning it to the client. Success, cancel and failure return URLs include only the payment-attempt identifier; the private portal token is retained in same-tab session storage and is never sent to Yoco.

## Webhook verification

- Uses the exact raw request body; JSON is not parsed until after signature verification.
- Verifies `webhook-id`, `webhook-timestamp`, and `webhook-signature`.
- Rejects timestamps outside the configured 180-second tolerance.
- Removes the `whsec_` prefix, Base64-decodes the signing key, and verifies HMAC-SHA256 over `webhook-id.webhook-timestamp.rawBody`.
- Compares all supplied v1 signatures using a constant-time byte comparison.
- Deduplicates on the provider event ID in the signed body; the delivery header ID is used only for signature verification.
- A success redirect never settles a payment.
- Unmatched, conflicting or incomplete events are retained for manual review rather than guessed.

## Important limitations before test execution

1. The exact current Yoco webhook payload variants for refund events must be confirmed with a real signed test delivery. Refund events without a definitive local attempt mapping are routed to manual review.
2. The Yoco checkout response and webhook event field names must be confirmed in a sandbox run before accepting real customer traffic.
3. The payment status endpoint returns database state only; it does not treat a browser return or provider redirect as confirmation.
4. The reconciliation endpoint is read-only. It does not initiate refunds, edit ledger entries, or reconcile bank payouts. Its admin response includes an on-demand operational queue for stale webhook events, review cases, expired checkouts and attempts without an attached checkout. It is not a push-notification or scheduled monitoring service.
5. Receipt snapshot immutability is enforced in the database. Request rate limiting, push/email alert delivery, scheduled polling and automated retry/dead-letter handling remain separate work. The current admin operational queue is on-demand and read-only. The feature branch now includes the client portal checkout, return-status and downloadable HTML receipt experience.
6. The SQL migrations are drafts and have not been executed. These Edge Functions must not be deployed until the migration sequence has passed PostgreSQL validation and the Yoco payload contract has been tested.

## Supabase function gateway configuration

The four functions have `verify_jwt = false` in `supabase/config.toml` because they accept three different credentials: a private portal token, a signed provider webhook, or an administrator JWT. Each function validates its own credential in application code. This is not permission to skip the checks in the handlers.

## Test gate

Before any test deployment:

- Execute all seven migrations in a disposable Supabase project.
- Run PostgreSQL advisor/security checks.
- Type-check and lint all four Edge Functions.
- Verify test-key refusal when a live key is supplied.
- Verify bad signature, stale timestamp, duplicate event, altered-body replay, amount mismatch, currency mismatch, live-mode event and unknown checkout cases.
- Verify one payment and one receipt are produced for duplicate success deliveries.
- Verify partial and cumulative refunds cannot exceed the original payment.
- Verify a payment failure does not create a payment or reduce the invoice balance.
- Verify client tokens cannot access another client's attempts.
- Verify non-admin users cannot access reconciliation.
- Verify no secret is returned in a response or written to logs.

Only after this gate should a separate test deployment be considered. Production deployment and live payments require a new, explicit authorisation.

## Database migration order and safeguards

Apply only in a disposable test Supabase project, after review, in this exact order:

1. `supabase/migrations/202611110001_yoco_payment_foundation.sql`
2. `supabase/migrations/202611110002_yoco_refund_aware_invoice_integrity.sql`
3. `supabase/migrations/202611110003_yoco_atomic_payment_operations.sql`
4. `supabase/migrations/202611110004_yoco_edge_rpc_boundary.sql`
5. `supabase/migrations/202611110005_yoco_ledger_immutability.sql`
6. `supabase/migrations/202611110006_yoco_webhook_worker_leases.sql`
7. `supabase/migrations/202611110007_yoco_payment_failure_lease.sql`

Migration 005 adds database-level immutability for Yoco payment rows, successful Yoco refund rows and issued receipts. It also requires successful refund ledger inserts to reference a verified refund event associated with the matching test payment attempt. Migration 006 adds exclusive webhook worker leases and fencing; migration 007 makes payment-failure processing atomic under that lease.

Before any test deployment, inspect effective schema/table/function privileges and run the concurrency, replay, refund and client-isolation tests in the QA matrix. No migration has been executed as part of this preparation.
