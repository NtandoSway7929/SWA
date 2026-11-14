# Paystack client payments: test integration setup

**Status: development branch only.** This is a test-mode implementation under review. No Paystack secret has been configured in Supabase, no Paystack webhook has been registered, no Paystack payment has been initiated, and no production payment setting or schema has been changed.

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
- `PAYSTACK_WEBHOOK_SECRET`: optional during initial test-mode setup. If Paystack sends the legacy `x-paystack-signature` header, the handler verifies its HMAC-SHA512 signature over the raw request body with `PAYSTACK_SECRET_KEY`; no separate `whsec_` value is needed for that mode.
- `PAYSTACK_CALLBACK_URL`: `https://swayphics.co.za/client-portal/` (optional; this is the default).

Paystack's current documentation distinguishes the newer timestamped `Paystack-Signature` header from the legacy `x-paystack-signature` header. If a webhook arrives with `Paystack-Signature`, the handler requires `PAYSTACK_WEBHOOK_SECRET` beginning with `whsec_` and rejects the event when that secret is unavailable. Do not attempt to bypass a dashboard access restriction to obtain this optional test credential. Continue with the legacy header only while Paystack is still sending it; before live activation, confirm the signing mode available to the merchant and configure the matching secret securely.

Never place secrets in source control, the client portal, browser storage, or issue/PR descriptions. All Paystack secrets are server-side only.

## Test webhook endpoint

Only after the Paystack webhook Edge Function has been deployed to the isolated Supabase test project, register this URL in Paystack's Test Mode webhook settings:

`https://sqifhribgsqfaxgtobsa.supabase.co/functions/v1/paystack-payment-webhook`

The webhook function verifies the applicable signature, independently verifies the transaction with Paystack, checks the test domain and then settles through the leased database routine. Webhook retries are idempotent. Do not register the endpoint before the function is deployed and reachable.

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
