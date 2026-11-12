# Yoco reconciliation reference integrity — Stage 1.53

## Scope
This stage hardens the administrator reconciliation status RPC before the dashboard investigation interface is introduced. It is limited to the feature branch and the Yoco test environment.

## Change
Migration `202611110010_yoco_reconciliation_reference_integrity.sql` replaces `admin_set_payment_reconciliation_status` while preserving its administrator authorization, SECURITY DEFINER boundary, empty search path, row lock, status-transition rules, and append-only action history.

Before a case can be closed, the function now:
- Rejects cases that are not `provider='yoco'` and `environment='test'`.
- Derives the invoice anchor from the case's own payment attempt, payment, or refund relationship.
- Rejects a case whose financial anchor cannot be resolved to a Yoco invoice.
- Requires any separately recorded payment reference to belong to that invoice.
- Requires any separately recorded refund reference, through its underlying payment, to belong to that invoice and the Yoco test environment.

The RPC still records a reference to a separately created financial correction; it does not create or alter payments, refunds, invoice balances, or ledger entries.

## Regression coverage
The existing reconciliation admin workflow pgTAP test now includes three additional source-definition assertions and a plan of 26 assertions. The SQL test has not yet been executed because the disposable Supabase migration chain remains blocked by the missing foundational `public.leads` relation documented in Stage 1.50.

## Validation status
- Source review: completed for the changed function and test additions.
- PostgreSQL grammar / Deno / disposable database CI: pending a fresh GitHub Actions run.
- PL/pgSQL compilation and pgTAP runtime: not verified.
- Production migrations, live payments, deployment, and merge: not performed.

## Next
Build the administrator reconciliation interface against the read-only `reconcile-payment` Edge Function and the guarded authenticated RPCs. Keep the UI test-only, and do not enable live payment processing.
