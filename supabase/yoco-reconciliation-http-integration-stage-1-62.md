# Reconciliation HTTP integration coverage — Stage 1.62

## Objective

Make the reconciliation Edge Function importable by Deno tests and exercise its HTTP contract through the same request handler used by the deployed entrypoint. Keep production dependencies and authorization defaults unchanged.

## Implementation

### Injectable handler boundary
`supabase/functions/reconcile-payment/index.ts` now exports `createReconciliationHandler`. The default handler still uses the production administrator authorization routine, service-role admin client and system clock. Tests can inject an authorization decision, a disposable query-builder fixture and a deterministic clock.

Server startup is guarded by `import.meta.main`, so importing the handler in tests does not start a second HTTP server.

### New Deno HTTP integration suite
Added `supabase/functions/tests/yoco-reconciliation-http.test.ts` with six request-level tests:

1. Unsupported HTTP methods are rejected before authorization or database access.
2. Disallowed origins and non-admin sessions are rejected before database access.
3. Queue responses preserve the Yoco test-only scope, read-only mode and deterministic timestamp.
4. History pagination applies the requested offsets and rejects case IDs outside the current open/investigating Yoco test queue.
5. Queue and history database failures return fail-closed 503 responses.
6. Malformed JSON is rejected before database access.

The tests use an in-memory Supabase query-builder fixture. They do not contact Supabase, Yoco, production, or any remote environment.

### Browser workflow regression coverage
Expanded `scripts/yoco-reconciliation-ui.test.cjs` to verify:
- The dashboard reads through the guarded reconciliation Edge Function.
- Case history requests include independent evidence and action offsets.
- Evidence and status mutations call their guarded RPCs.
- Status decisions carry the exact loaded `updated_at` version.
- The UI refreshes after a successful mutation.

These are source-level regression assertions, not browser automation.

## Verification status

- New Deno tests are included in the existing Yoco Deno test glob in `.github/workflows/yoco-disposable-qa.yml`.
- Node test source and Deno tests require GitHub Actions execution for runtime confirmation.
- The full disposable Supabase suite still has the previously documented historical migration dependency on missing `public.leads`; this stage does not fabricate that schema baseline.
- No live browser session, real administrator JWT, database RPC mutation, Yoco sandbox call or financial ledger mutation was performed.

## Scope and safety

All changes are confined to `feature/yoco-client-payments`. No production schema or data was touched, no production migration was executed, and no merge, deployment, webhook registration, secrets configuration or live payment activation occurred.
