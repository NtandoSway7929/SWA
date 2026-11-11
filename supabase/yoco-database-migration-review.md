# Yoco client payments: database migration review

Target: feature/yoco-client-payments
Review date: 2026-11-11
Scope: static source review of migrations 001–004 and their existing Swayphics dependencies.

**Status: NOT approved for execution yet.** This is a source-level review only. No PostgreSQL parser, disposable Supabase database, migration execution or production database was available/performed.

## Review result

Follow-up changes committed after the initial review:
- Settlement duplicate handling now validates checkout, amount, currency and test mode before returning an idempotent result.
- A new migration adds Yoco payment/refund/receipt immutability and a unique provider-event-to-refund index.
- Refund insertion is bound to a signature-verified refund event and the matching test payment attempt. The webhook now associates the event before invoking the refund RPC.
- Successful refunds are included in the private client portal payment-history payload.

These are source changes only; none have been executed or runtime-validated.

The migration chain is ordered coherently at a high level:

1. Additive provider/payment operational tables and invoice flags.
2. Refund-aware invoice calculations and portal payload.
3. Private atomic payment/receipt/refund operations.
4. Service-role-only RPC wrappers for Edge Functions.

All five public RPC wrappers in migration 004 use SECURITY DEFINER, an empty search_path, and explicit execute grants to service_role while revoking PUBLIC, anon and authenticated. The private functions in migration 003 also use SECURITY DEFINER and an empty search_path, with execution restricted to service_role. Operational tables have RLS enabled and browser-role table privileges revoked in migration 001.

These are positive static findings, not proof of effective privileges after application. The exact migration owner, default privileges and deployed Supabase role configuration still need to be checked in a disposable database.

## Correction made during this review

### Duplicate settlement validation order

The original settlement function returned an idempotent success for an already-settled attempt before checking the incoming event's checkout ID, amount, currency and test processing mode. A second, distinct signed success event with inconsistent payment details could therefore be treated as a harmless duplicate.

The branch was reordered so the incoming provider values are validated first. The idempotent return now follows those checks. A conflicting event is marked for review without changing an already-settled attempt's status. A succeeded attempt missing its payment ledger reference is rejected rather than creating another payment.

This correction is committed to the feature branch. It has not been executed in PostgreSQL.

## Blocking items before disposable-database execution

### 1. Refund event-to-payment binding

**Source-level remediation added in migration 005.** Runtime verification is still required.

The webhook handler currently uses payload metadata.paymentAttemptId to locate an attempt, then passes its payment_id to the refund RPC. If the event has no unambiguous mapping, it is held for review, which is the correct fail-closed behaviour.

However, the refund RPC itself does not prove that the supplied payment belongs to the attempt referenced by the webhook event, nor does the refund ledger enforce one provider event ID per refund record. Before test execution, add database-level linkage/uniqueness so a signed event cannot be associated with a different local payment by a future handler regression. Confirm the exact Yoco refund event payload in sandbox before choosing the provider mapping field.

### 2. Financial ledger immutability

**Source-level remediation added in migration 005.** Runtime verification is still required.

The design treats payments, successful refunds and receipt snapshots as immutable financial records, but the migrations do not yet add database triggers preventing later mutation of:
- settled Yoco payment amount, invoice, client, provider identity or provider transaction identifiers;
- succeeded refund amount, payment association, provider refund ID or currency;
- issued receipt number, payment association, issue timestamp or snapshot.

RLS and service-role-only access reduce exposure but do not make records immutable against a privileged server-side code defect. Add explicit database-level immutability rules, with a narrow and audited exception only if a legitimate correction workflow is designed.

### 3. Refund-aware portal history

**Source-level remediation added to migration 002.** Verify portal rendering and client isolation in browser tests.

The portal invoice balance is calculated net of successful refunds, but the payment history currently exposes the original payment and receipt without a corresponding refund entry. This can make the displayed invoice balance differ from the visible payment history. Add a client-scoped refund history representation before calling the experience financially transparent.

### 4. Invoice backfill needs operational sizing

Migration 002 recalculates every invoice in one transaction. This is logically straightforward, but on a populated production database it could create substantial row locks, WAL and transaction duration. Measure invoice volume and lock impact in a disposable copy; if necessary, split reconciliation into a separately controlled, resumable operation rather than an unconditional all-invoices loop.

### 5. Existing trigger interactions require runtime verification

The review identified the intended paths:
- payment insert/update -> existing payment integrity guard -> payment sync -> invoice/project recalculation;
- refund insert/update/delete -> refund sync -> invoice recalculation -> existing invoice/project sync;
- invoice update -> existing BEFORE trigger derives net paid and outstanding.

PostgreSQL must verify trigger ordering, recursion behaviour, lock ordering and concurrent payment/refund transactions. In particular, exercise simultaneous settlement attempts against one invoice, and simultaneous refunds against one payment.

## Other checks required

- Confirm the actual migration owner has the necessary privileges and is the owner of SECURITY DEFINER functions.
- Confirm service_role has schema USAGE on innerme_private, while anon/authenticated/PUBLIC do not.
- Inspect effective function EXECUTE grants after all four migrations.
- Confirm innerme_private is not in exposed PostgREST schemas.
- Confirm no unintended default grants on the five operational tables or receipt sequence.
- Verify existing get_client_portal grants and the replacement's compatibility with current callers.
- Test historical invoices, zero/negative/rounding boundaries, cancelled/draft invoices, and refunds that fully or partially reverse payments.
- Confirm invoice/project statuses and client portal JSON agree after each event.
- Validate migration replay/idempotency expectations. CREATE TABLE IF NOT EXISTS and ADD COLUMN IF NOT EXISTS do not make all later ALTER/constraint/function operations safe to re-run.
- Review and test receipt numbering expectations; the sequence is globally monotonic, not reset each calendar year.
- Review payment-attempt expiry and orphaned provider checkout recovery.

## Required disposable database tests

Do not point these tests at production.

1. Apply migrations 001–005 in order to a disposable Supabase/PostgreSQL database.
2. Inspect roles, schemas, RLS, table privileges, sequence privileges, function owners and EXECUTE ACLs.
3. Seed disposable clients, invoices, payment attempts and test-mode events.
4. Verify payment settlement, duplicate settlement, conflicting duplicate event, overpayment rejection and invoice balance.
5. Verify partial/full refunds, refund replay, refund cap and event/payment binding.
6. Run concurrent settlement and refund transactions to check serialization/deadlocks.
7. Verify cross-client access is denied and administrator reconciliation remains read-only.
8. Roll back by discarding the disposable database, not by improvising reverse production SQL.

## Release decision

**Not ready for sandbox deployment.** Resolve the blocking ledger/event-binding items, then pass PostgreSQL migration and concurrency tests. This review does not authorise test deployment, production migration, merge to main, webhook registration, live credentials or live charges.
