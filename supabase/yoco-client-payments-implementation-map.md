# Yoco Client Payments: Database Dependency Map

Branch: `feature/yoco-client-payments`

Status: implementation preparation only. This document does not execute SQL or change production configuration.

## Repository baseline inspected

The following existing SQL files were fetched from this branch before preparing this map:

| File | Blob SHA |
|---|---|
| `supabase/swayphics-payment-integrity-fix.sql` | `b5d8ad80103c572bf1f70aba83c893bdb7b9c299` |
| `supabase/swayphics-business-flow.sql` | `a700515f5dd5f3043f85acd9d59e0c2b117d8118` |
| `supabase/swayphics-dashboard-upgrades.sql` | `e4b6f3ced95652ed74a554b5fb4b0ec20d947667` |
| `supabase/swayphics-invoicing.sql` | `cf34e36cf120eea61d9ce6462e4c8dd2fdc30ae5` |

## Existing payment and invoice trigger chain

### Payment insert/update

1. `trg_enforce_swayphics_payment_invoice_integrity` is a BEFORE INSERT OR UPDATE trigger on `public.payments`.
2. `public.enforce_swayphics_payment_invoice_integrity()` locks the referenced invoice with `FOR UPDATE`, rejects cancelled invoices, prevents reassignment to a different invoice, validates a positive amount, checks the existing paid ledger total against the invoice total, derives client/project IDs from the invoice, and sets the payment row status to `paid`.
3. `trg_sync_swayphics_payment_after_change` is an AFTER INSERT OR UPDATE OR DELETE trigger on `public.payments`.
4. `public.sync_swayphics_payment_after_change()` invokes invoice balance recalculation and project payment-status synchronisation.

### Invoice insert/update

1. `trg_swayphics_invoice_commercial_defaults` is a BEFORE INSERT trigger and invokes `public.apply_swayphics_invoice_payment_defaults()`.
2. `trg_sync_swayphics_invoice_before_change` is a BEFORE INSERT OR UPDATE trigger and invokes `public.sync_swayphics_invoice_after_change()`.
3. The invoice synchronisation function derives amount paid and outstanding from payment rows and derives invoice status from paid amount, due date and existing draft/cancelled status.
4. `trg_sync_swayphics_project_after_invoice_change` is an AFTER INSERT OR UPDATE OR DELETE trigger on invoices and synchronises the related project.

## Existing balance calculation

`public.recalculate_swayphics_invoice_balance(uuid)` currently:

- Sums payment rows whose status is `paid` or `partially paid`.
- Clamps paid amount to the invoice total.
- Calculates outstanding as invoice total minus paid amount.
- Preserves cancelled status and derives paid, draft, overdue, partially paid or sent status.

`public.sync_swayphics_invoice_after_change()` independently performs a similar payment-only calculation. Both functions must be changed together to prevent inconsistent balances.

## Client portal balance path

`public.get_client_portal(text)` validates the private portal token by hashing it and matching an active, unexpired token record. It then builds the client portal JSON response.

The invoice JSON currently calculates outstanding as invoice total minus the sum of payment rows with status `paid`. This calculation is independent of the stored invoice balance and does not include refunds. The portal response must be changed to use the same authoritative net-balance calculation as the invoice and admin workflows.

## Refund-aware calculation requirement

Once successful refund records exist, the authoritative calculation must be:

`net_paid = successful_payments - successful_refunds`

`outstanding = greatest(invoice_total - net_paid, 0)`

This calculation must be applied consistently in:

- `public.recalculate_swayphics_invoice_balance(uuid)`
- `public.sync_swayphics_invoice_after_change()`
- `public.enforce_swayphics_payment_invoice_integrity()`
- `public.get_client_portal(text)`
- Project payment-status synchronisation through the invoice status

A successful refund must not delete or rewrite the original payment. The refund is a separate ledger record. Refunds must be validated against the remaining refundable amount while holding the relevant payment/invoice locks.

## Required coordinated migration sequence

1. Additive schema: provider references, invoice online/partial-payment flags, payment attempts, webhook events, refund ledger, receipt sequence/records, and reconciliation records.
2. Apply least-privilege RLS and grants to new operational tables. Browser roles must not directly read or write provider secrets, webhook payloads, attempts or reconciliation internals.
3. Introduce one authoritative private invoice net-balance calculation.
4. Replace or wrap both existing invoice balance calculations so they use the same source of truth.
5. Update payment integrity validation to subtract successful refunds before accepting a new payment.
6. Update the portal RPC to expose the authoritative outstanding balance and only safe payment/receipt fields.
7. Add atomic settlement and refund-recording operations with row locks and idempotency constraints.
8. Add Edge Functions only after database contracts are reviewed.

## Trigger ordering and transaction cautions

- PostgreSQL executes triggers of the same timing/event in trigger-name order. The invoice BEFORE triggers must be reviewed together when changing their logic; do not rely on an assumed ordering.
- The payment integrity trigger already locks the invoice. The settlement function must use a consistent lock order to avoid deadlocks.
- The AFTER payment trigger already recalculates invoice and project state. The settlement function should use this existing mechanism rather than manually applying a second, conflicting balance update.
- Refund insertion needs its own AFTER trigger or an explicit private recalculation call, chosen deliberately to avoid duplicate recalculation.
- Invoice balance recalculation must not recursively create invoice updates.
- Receipt issuance must be idempotent and tied to a successfully settled payment.
- Do not allow the browser to set payment status, provider transaction IDs, paid timestamps, invoice balance or receipt number.

## Known validation gaps

- No PostgreSQL engine or disposable Supabase database has been used for execution testing.
- No SQL migration has been applied.
- Trigger interactions, row-lock behaviour, RLS policies and idempotency constraints remain untested.
- The exact live database schema must be rechecked immediately before migration preparation and again before any future execution.
- This branch is not authorised for production deployment or live payment processing.

## Next implementation gate

Before writing the executable migration, prepare and review the exact replacement function definitions and the new table definitions against this dependency map. Then validate the migration in a disposable PostgreSQL/Supabase environment. Do not execute it against the production project.


## Stage 1.25: Refund-aware calculation migration drafted

Migration prepared on the feature branch:

- `supabase/migrations/202611110002_yoco_refund_aware_invoice_integrity.sql`

It introduces one private net-paid calculation and replaces the existing invoice balance recalculation, invoice BEFORE-trigger function, payment integrity function, and client portal RPC to use successful payments less successful refunds. It also adds a refund-change trigger so successful refunds recalculate invoice and project payment state.

The migration retains the private portal-token hash validation and does not expose provider credentials or activate online payments. Existing triggers are reused where possible; the refund trigger is new.

## Current migration sequence

1. `202611110001_yoco_payment_foundation.sql`
2. `202611110002_yoco_refund_aware_invoice_integrity.sql`

Both files are under `supabase/migrations/` to follow the repository migration convention.

## Stage 1.25 validation boundary

- Both committed files were fetched back from the feature branch.
- Basic source checks confirmed transaction boundaries, balanced dollar-quote delimiters, and presence of the expected schema objects.
- No PostgreSQL parser, local database, or disposable Supabase project was available for execution testing.
- Trigger execution order, row-lock concurrency, grants, RLS behaviour, and refund edge cases remain unverified.
- Refund amount validation and immutable refund-recording operations are still required before any refund can be safely recorded as succeeded.
- The migration is review-only and must not be run against production.
