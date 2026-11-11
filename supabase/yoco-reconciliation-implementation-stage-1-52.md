# Stage 1.52 — Reconciliation evidence schema and administrator RPCs

**Date:** 2026-11-11  
**Branch:** `feature/yoco-client-payments`  
**Implementation scope:** database migration and pgTAP security/regression test only.

## Implemented

Migration: `supabase/migrations/202611110009_yoco_reconciliation_admin_workflow.sql`

1. Added `payment_reconciliation_evidence` for typed, length-limited evidence notes and optional references, with actor attribution from `auth.uid()`.
2. Added `payment_reconciliation_actions` for append-only status/evidence action history, previous/new status, outcome, reason, related ledger references and actor attribution.
3. Enabled RLS and revoked direct `PUBLIC`, `anon` and `authenticated` table privileges. The service role receives SELECT only for the guarded server-side read model.
4. Added immutable UPDATE/DELETE triggers for evidence and action history.
5. Added `admin_add_payment_reconciliation_evidence`, a SECURITY DEFINER RPC that verifies an authenticated Swayphics administrator, locks the case, rejects closed cases, validates evidence fields, inserts evidence and records the action atomically.
6. Added `admin_set_payment_reconciliation_status`, a SECURITY DEFINER RPC that verifies an authenticated Swayphics administrator, locks the case, enforces permitted transitions, requires a reason and closure outcome, records actor attribution, and writes the status change and action history in one transaction.
7. A financial-correction outcome requires a reference to an already existing Yoco payment or refund. These RPCs do not create or modify payment/refund ledger entries or invoice balances.

Allowed transitions:
- `open → investigating`
- `investigating → open`
- `investigating → resolved`
- `investigating → dismissed`

Resolved and dismissed cases are terminal. Evidence cannot be added to closed cases. Reopening a resolved/dismissed case is deliberately not supported in this first implementation; a later correction should be represented by a new case/action rather than rewriting history.

Regression test: `supabase/tests/202611110011_yoco_reconciliation_admin_workflow.test.sql`

The pgTAP file contains 23 assertions for table/function presence, RLS, direct table access, service-role read access, RPC execute boundaries, SECURITY DEFINER, pinned empty search paths, immutable triggers and rejection of a non-admin authenticated caller.

## Not implemented in this stage

- Admin dashboard reconciliation UI.
- Evidence file uploads or private storage bucket.
- Manual EFT/cash/off-provider payment recording.
- Case creation/automatic discrepancy ingestion.
- Browser/runtime integration tests.
- Runtime pgTAP execution (blocked by the existing migration baseline issue).

## Validation and release boundary

The SQL test is authored, not executed. PostgreSQL grammar parsing can be checked in CI, but that does not compile or execute PL/pgSQL or prove RLS, trigger, row-lock or transaction behavior. Full disposable database validation remains blocked because the repository's historical migration replay references `public.leads` before a migration creates it.

All changes are confined to `feature/yoco-client-payments`. No remote database was queried or modified; no production migration, Yoco secret, webhook, live payment, deployment or merge was performed.
