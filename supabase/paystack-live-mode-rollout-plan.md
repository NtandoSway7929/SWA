# Paystack live-mode rollout plan

**Status: planning only.** This document does not authorize live credentials, production schema changes, Edge Function deployment, webhook changes, or a live payment. The current implementation remains test-only.

## Current release gates

- Paystack business activation is currently reported as **Awaiting Review**. Do not use live mode until Paystack changes the account to a live-enabled state (Pre-approved or Approved) and the dashboard exposes Live Mode.
- PR #240 remains open and unmerged.
- The isolated `Swayphics Payments Test` Supabase project is the only project with Paystack test secrets, migrations, and deployed Paystack functions.
- The test implementation requires an `sk_test_` key, `PAYSTACK_ENVIRONMENT=test`, and provider transactions whose domain is `test`.
- No production Supabase object or live payment has been changed or tested.

## Gate 1: merchant activation

Before a live implementation is prepared for deployment:

1. Confirm Paystack's activation status is Pre-approved or Approved and that the dashboard actually offers Live Mode.
2. Confirm payout account details and the account's enabled payment channels in the Paystack dashboard.
3. Resolve any compliance follow-up directly with Paystack. Do not alter the test integration to work around an activation restriction.

## Gate 2: separate live implementation

Live mode must be implemented and reviewed separately. Replacing `sk_test_` with `sk_live_` is not sufficient.

Required engineering work:

- Add explicit live-environment handling for checkout initialization, transaction verification, webhook settlement, and refunds. Test functions must remain strictly test-only.
- Extend the database environment constraints and indexes through a reviewed additive migration so test and live records remain isolated. All idempotency and uniqueness keys must retain the environment dimension.
- Require the live secret key only in production Edge Function secrets. Never place it in source code, browser code, logs, PR text, or the test project.
- Require the live `whsec_` webhook signing secret and verify the timestamped `Paystack-Signature` header against the raw request body. Do not use the test-only legacy signature fallback for live events.
- Register a separate Live Mode webhook URL. Subscribe to `charge.success` and the refund lifecycle events: `refund.pending`, `refund.processing`, `refund.needs-attention`, `refund.failed`, and `refund.processed`.
- Verify the production callback URL and merchant-enabled channels. Do not advertise Instant EFT or Capitec Pay until each is actually enabled for the Swayphics merchant account.
- Test the admin and client-portal journeys against a dedicated QA configuration before deploying them to the production dashboard and portal.

## Gate 3: refund operations

The test backend supports refund initiation and signed refund lifecycle reconciliation, but it is not yet a complete admin refund workflow.

Before Swayphics relies on in-dashboard refund operations:

- Add and test the admin refund interface with payment selection, refundable-balance calculation, explicit confirmation, idempotency, and visible pending/failed/review states.
- Keep uncertain provider outcomes reserved for manual reconciliation. Never automatically repeat an ambiguous refund request.
- Implement a controlled `refund.needs-attention` procedure. Paystack's Retry Refund API requires customer bank-account details; those details must be collected and handled securely, or the case must remain a documented manual process.
- Confirm how refunds affect invoice status, customer communication, receipts, and reconciliation reporting.

No live refund should be initiated as part of an unattended deployment or smoke test.

## Gate 4: controlled live verification

Only after the merchant, code, schema, secrets, and webhook gates have passed:

1. Obtain explicit approval for the production migration and deployment.
2. Apply the reviewed production migration and deploy the live functions in a controlled order.
3. Configure the live webhook URL and signing secret, then verify a signed provider delivery.
4. Use a low-value, user-approved invoice payment for the first live smoke test. Confirm the amount, currency, Paystack transaction, automatic webhook delivery, invoice balance, single payment record, and single receipt.
5. Use signed duplicate-event replay for idempotency checks; do not make duplicate live charges.
6. Test declined and abandoned outcomes in Test Mode, not by creating unnecessary live charges.
7. Do not test a live refund without separate explicit approval for the exact transaction and amount.

## Rollback and safety

- If a live issue occurs, disable new Paystack online payment initiation while preserving the webhook endpoint so late provider events can still be recorded and reconciled.
- Never delete or manually reverse payment, refund, receipt, or webhook ledger rows as a rollback method.
- Keep test and live secrets, webhook registrations, database records, and deployment settings separate.
- Do not merge PR #240 or deploy to the production Supabase project without explicit approval.

## Provider references

- [Paystack Webhooks](https://paystack.com/docs/payments/webhooks/)
- [Paystack Refunds](https://paystack.com/docs/payments/refunds/)
- [Paystack Refund API](https://paystack.com/docs/api/refund/)
