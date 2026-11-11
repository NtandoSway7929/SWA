# Stage 1.51 — Controlled payment reconciliation workflow design

**Date:** 2026-11-11  
**Branch:** `feature/yoco-client-payments`  
**Status:** design specification only; no reconciliation actions or financial writes implemented.

## 1. Current state verified in source

The `reconcile-payment` Edge Function currently:

- requires a valid user JWT and an active Swayphics administrator check through `is_swayphics_admin()`;
- uses a service-role client to read Yoco test-mode attempts, refunds, open reconciliation cases and webhook events needing attention;
- returns operational alerts and `actions_taken: []`;
- does not create cases, add evidence, change case status, record manual payments or mutate the payment ledger.

The `payment_reconciliation` table currently stores one optional attempt/payment/refund reference, discrepancy type, status, summary and a free-text resolution. Its statuses are `open`, `investigating`, `resolved` and `dismissed`. It has no structured evidence history or actor-attributed resolution history. Browser roles have no direct table privileges; the service role has table privileges.

## 2. Non-negotiable separation of concerns

A reconciliation case is an investigation record, not a financial transaction.

- Adding evidence must never create, alter or delete a payment/refund.
- Resolving or dismissing a case must never change an invoice balance.
- A verified off-provider payment must be a separate, explicit financial operation, recorded through the existing payment ledger and its integrity rules. It must not be simulated by setting a case to resolved or by changing a Yoco attempt to succeeded.
- A case may be resolved only after the underlying discrepancy is explained and any required financial correction has been recorded through its own controlled transaction.
- A Yoco payment attempt or webhook event in `requires_review` must not be manually promoted to succeeded merely to clear an alert.

## 3. Proposed administrator workflow

### A. Case queue

Add a dedicated reconciliation view in the admin dashboard, loaded only through the authenticated `reconcile-payment` Edge Function. Show:

- case reference, discrepancy type, status and creation/update times;
- linked attempt, payment or refund identifiers (masked where appropriate);
- invoice reference and client business name only where the server has safely joined and authorised the record;
- concise summary and the current resolution state;
- severity/age derived from explicit rules, not guessed financial impact.

Default filter: open and investigating cases. Resolved/dismissed cases remain searchable in a history view.

### B. Investigation

An administrator can:
1. open a case;
2. move `open → investigating`;
3. append evidence with a typed category, concise note and optional external reference;
4. review the chronological evidence and action history;
5. return an investigation to `open` if more work is needed.

Evidence categories should be constrained, for example: `provider_dashboard`, `bank_statement`, `client_confirmation`, `provider_support`, `internal_review`, `other`. Do not store card data, bank login credentials, full account numbers, webhook secrets or raw provider payloads. Attachments, if later supported, must use a private bucket and short-lived authorised access.

### C. Resolution / dismissal

Resolution requires a non-empty reason and an explicit outcome category. Proposed outcomes:

- `provider_state_confirmed`: provider and local records agree; no ledger change.
- `duplicate_or_replay`: duplicate event confirmed; no second ledger entry.
- `financial_correction_recorded`: a separate, independently authorised ledger operation has already been completed; include its immutable payment/refund reference.
- `no_financial_effect`: investigation confirms no payment or refund should be recorded.
- `false_positive`: alert/case was incorrectly raised; evidence and reason required.

Dismissal is for duplicate or invalid investigations, not a shortcut to hide unresolved financial discrepancies. Require a reason and actor attribution.

## 4. Proposed database boundary

Implement the actions as narrowly scoped PostgreSQL RPCs. Do not grant browser roles direct table access.

### Append-only evidence table

Proposed `public.payment_reconciliation_evidence` fields:

- `id` UUID primary key;
- `reconciliation_id` FK to `payment_reconciliation` with delete restricted;
- `evidence_type` constrained to the approved categories;
- `reference` optional, length-limited external reference (not a secret or unrestricted URL);
- `note` required, length-limited plain text;
- `created_by` FK to `auth.users`;
- `created_at` timestamp.

Evidence rows must be immutable after insertion. Revoke direct `PUBLIC`, `anon` and `authenticated` table privileges. Read access is through the admin Edge Function only.

### Append-only action history

Proposed `public.payment_reconciliation_actions` fields:

- `id` UUID primary key;
- `reconciliation_id` FK with delete restricted;
- `action` constrained to `case_opened`, `investigation_started`, `investigation_reopened`, `evidence_added`, `case_resolved`, `case_dismissed`;
- `previous_status` and `new_status`;
- `outcome` and `reason` where applicable;
- `related_payment_id` / `related_refund_id` only when an independently completed ledger operation is being referenced;
- `actor_user_id` from `auth.uid()`;
- `created_at`.

No update/delete RPC should exist for evidence or action history. A trigger should reject UPDATE/DELETE even for ordinary application roles. Administrative corrections should be represented by a new action, not rewriting history.

### RPC privilege model

Proposed RPCs:

- `admin_set_payment_reconciliation_status(...)`: authenticated caller, active `is_swayphics_admin()`, row lock, allowed state transitions, mandatory reason/outcome, actor from `auth.uid()`, atomic status + action-history write.
- `admin_add_payment_reconciliation_evidence(...)`: authenticated caller, active admin check, case row lock/existence check, constrained fields, evidence + action-history write in one transaction.

Both functions should be SECURITY DEFINER with an empty pinned `search_path`, fully qualified object names, explicit revoke from `PUBLIC` and `anon`, and execute grant only to `authenticated`. They must derive actor identity from `auth.uid()`; never accept an arbitrary actor UUID from the browser. Direct authenticated table access remains revoked.

The service-role reconciliation endpoint remains a read model. The Edge Function must verify the JWT/admin identity before serving case details and must never expose service-role credentials.

## 5. Separate manual-payment operation

A manual EFT/cash/off-provider payment is a separate financial transaction and must not be implemented as a reconciliation-case update.

Before designing that RPC, inspect the deployed payment trigger and current payment schema. The eventual operation must:

- require an authenticated active administrator;
- lock the invoice and calculate authoritative outstanding balance inside the same transaction;
- require a positive amount not exceeding the available balance;
- require a supported non-Yoco method and a non-empty bank/reference/evidence record;
- derive client/project linkage from the locked invoice;
- create exactly one payment row using the existing invoice/payment integrity path;
- record who entered and independently verified it, with timestamps and an immutable audit reference;
- be idempotent against a caller-supplied operation key;
- never set a Yoco attempt to succeeded or fabricate a provider transaction ID.

Do not implement this operation until the actual deployed `payments` schema, triggers and invoice balance function have been reconciled with the repository snapshot. The current migration-baseline blocker prevents that runtime verification.

## 6. Required tests before enabling any action

- unauthenticated, invalid JWT, inactive admin and non-admin all rejected;
- authenticated admin can add evidence and perform only permitted state transitions;
- case row lock prevents concurrent conflicting transitions;
- invalid status transition, blank reason, invalid outcome and overlong fields rejected;
- evidence/action rows cannot be updated or deleted;
- actor attribution always equals `auth.uid()`, never a supplied UUID;
- all status and history writes are atomic (no status change without action history);
- resolving/dismissing a case leaves payment rows and invoice balances unchanged;
- adding evidence leaves payment rows and invoice balances unchanged;
- direct REST table access remains denied to `anon` and `authenticated`;
- manual payment tests, if separately implemented, cover invoice ownership/linkage, overpayment, duplicate operation key, audit attribution, trigger integrity and concurrent submissions;
- Edge Function HTTP tests cover request size, origin, auth, input validation, error redaction and response minimisation.

## 7. Release and safety boundary

This design does not authorise production migrations, remote database inspection, secret configuration, Yoco webhook registration, payment execution, deployment or merge. Implementation remains limited to the feature branch and must follow the separate approval already given. No live mode is introduced.

**Exit decision:** workflow and security boundaries specified. Implementation and database runtime validation remain outstanding; do not treat reconciliation as operationally complete.
