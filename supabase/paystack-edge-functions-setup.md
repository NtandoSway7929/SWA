# Paystack client payments: test integration setup

**Status: isolated test deployment.** The Paystack migration and three Edge Functions are deployed to the dedicated `Swayphics Payments Test` Supabase project only. Test credentials are configured there. The first hosted test checkout was created and completed in Paystack Test Mode; its webhook has not yet been received. No production payment setting, schema, invoice, payment or receipt has been changed.

## Provider design

Paystack is the single online payment gateway. The client portal uses Paystack-hosted checkout for cards and enabled South African payment methods, including Instant EFT via Ozow and Capitec Pay when Paystack has approved those methods for the merchant.

The implementation uses:

- `POST /transaction/initialize` from the Paystack secret-key protected server function.
- The stable local payment attempt UUID as the Paystack transaction reference.
- A hosted checkout redirect URL validated to `https://checkout.paystack.com`.
- Signed webhook verification using the raw request body.
- Server-side `GET /transaction/verify/:reference` before database settlement.
- Exact reference, amount, ZAR currency and test-domain checks before writing the payment ledger.
- Database idempotency, webhook worker leases and invoice-balance protections.
- The existing payment and immutable receipt ledger, with Paystack identified as provider.

The browser return URL is only a status-check trigger. It is never proof of payment.

## Test secrets

Configure only in a non-production Supabase test project after reviewing and applying the additive Paystack migration:

- `PAYSTACK_SECRET_KEY`: a Paystack test secret key beginning with `sk_test_`.
- `PAYSTACK_ENVIRONMENT`: exactly `test`.
- `PAYSTACK_WEBHOOK_SECRET`: optional for the isolated test while the Paystack test secret key remains active and Paystack sends the legacy `x-paystack-signature` header. When this `whsec_` value is configured, the handler prefers the timestamped `Paystack-Signature` and enforces its five-minute timestamp window.
- `PAYSTACK_CALLBACK_URL`: `https://swayphics.co.za/client-portal/` (optional; this is the default).

Paystack's current documentation states that events may carry both `Paystack-Signature` and the legacy `x-paystack-signature` while the secret key remains active. Before the webhook signing secret is configured, this handler verifies the legacy HMAC-SHA512 signature using `PAYSTACK_SECRET_KEY`; it does not trust an unsigned event. Once `PAYSTACK_WEBHOOK_SECRET` is configured, the handler requires a valid timestamped signature and will not fall back to the legacy header if that modern signature is invalid. Do not attempt to bypass a dashboard access restriction to obtain the signing secret. Before live activation, configure and test the matching `whsec_` value securely and confirm the current signing mode.

Never place secrets in source control, the client portal, browser storage, or issue/PR descriptions. All Paystack secrets are server-side only.

## Test webhook endpoint

The Paystack webhook Edge Function is deployed to the dedicated `Swayphics Payments Test` project. Register this exact URL in **Paystack Test Mode only**:

`https://lcwjtextqhdtqlwogavk.supabase.co/functions/v1/paystack-payment-webhook`

Do not use the production Swayphics Web project URL for this test integration, and do not enter this test URL in Paystack Live Mode.

The webhook function verifies the applicable signature, independently verifies the transaction with Paystack, checks the test domain and then settles through the leased database routine. Webhook retries are idempotent. If a test transaction was completed before the URL was configured, open **Developers → Webhooks** while Test Mode is selected, locate its `charge.success` event, inspect the event details, and use **Retry** after confirming the endpoint URL is now the test URL. Paystack documents that a retry is sent to the URL currently configured for that environment. If no event is listed, do not alter payment or invoice rows manually; investigate via Paystack's transaction verification first.

## Payment channels and merchant enablement

The checkout requests `card`, `eft` and `capitec_pay`. Paystack may show only methods enabled and approved for the specific merchant. In South Africa, Instant EFT via Ozow and Capitec Pay require additional Paystack KYC approval. Their availability must be confirmed in the Paystack dashboard and a real test checkout before the methods are described as active to clients.

## Scope limitations before live rollout

1. The current implementation processes `charge.success` only. Signed events for refunds and other event types are acknowledged but do not change the ledger. Refund initiation, automatic refund webhook handling and Paystack refund reconciliation are not implemented.
2. The payment attempts and webhook event routines are test-only. Live-mode transactions are ignored.
3. The legacy Yoco tables, rows, receipts, functions and reconciliation history are retained. The migration only adds Paystack as an allowed provider in the relevant existing provider constraints and creates Paystack-specific routines.
4. The existing bank-transfer submission and review flow is unchanged.
5. Before enabling live mode, complete Paystack merchant verification, confirm enabled channels and webhook-signing mode, implement and test the live secret and matching signing-secret configuration, review refund handling and reconciliation, execute separate production migration/deployment steps, and obtain explicit approval for production activation.

## Validation gate

Before any Supabase test deployment:

- Run the PostgreSQL grammar check over Yoco, Paystack and bank-transfer migrations/tests.
- Apply the migration only to a disposable local Supabase instance.
- Type-check and format all Paystack Edge Functions.
- Run the transaction validation, webhook signature, replay, invalid signature, live-domain isolation and unmatched-reference tests.
- Run the Paystack database settlement test plus all existing Yoco and bank-transfer invariant tests.
- Confirm a successful test payment produces one ledger row, one receipt, and the correct invoice balance.
- Confirm a duplicate event cannot settle twice or issue a second receipt.
- Confirm no real Paystack credentials are present in source, test output or logs.

Production schema changes, Edge Function deployment, live credentials and customer payments require separate explicit approval.
