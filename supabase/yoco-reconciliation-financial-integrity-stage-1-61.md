# Reconciliation financial-integrity regression protection — Stage 1.61

## Scope

This stage strengthens the boundary between reconciliation administration and the financial ledger. A reconciliation case records investigation state and references existing financial records; it must not itself create, update, or delete payments, refunds, receipts, or invoice balances.

## Migration correction

While reviewing the Stage 1.59 migration, the evidence RPC body was found to use a single-dollar delimiter around its PL/pgSQL body. It has been corrected to a matching `$$` opening and closing delimiter. A Node regression assertion now protects both delimiters against accidental regression.

## Database assertions

The reconciliation pgTAP test plan is now 42 assertions (previously 36). Six additional catalog/source assertions verify:

1. The version-checked status RPC does not update payment rows.
2. It does not insert or delete payment rows.
3. It does not mutate refund rows.
4. Neither status decisions nor evidence submission update invoices.
5. Evidence submission does not modify payment or refund rows.
6. Status changes update reconciliation state and append an action-history record.

These checks inspect installed function definitions and are database-level regression assertions. They do not replace transaction-level tests.

## Existing financial protections reviewed

The existing disposable payment-flow test already exercises payment settlement, duplicate settlement, refund balance recalculation, over-refund rejection, and attempts to mutate payment, refund and receipt records. The ledger-invariants test checks that the Yoco immutability and refund-binding triggers exist.

Stage 1.61 does not weaken or replace those existing protections.

## Verification status

- Migration delimiter correction committed.
- Node regression test source syntax checked separately.
- SQL pgTAP tests authored; not executed because the disposable Supabase migration chain remains blocked by the pre-existing missing `public.leads` schema dependency.
- No claim is made that the new pgTAP assertions passed at runtime.
- No payment/refund/invoice mutation test has been executed against a live or remote database.

## Safety

All changes are on `feature/yoco-client-payments`. No production database access, production migration execution, merge, deployment, webhook registration, secret configuration, or live payment activation occurred.
