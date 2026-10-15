# InnerMe Execution Contracts and Completion Verification

## Scope

This is the first implementation slice for the execution-reliability improvements described in the InnerMe architecture review. It adds a deterministic contract to the existing Phase 9/10 path; it does not create a new roadmap phase or deploy the Edge Function.

## What the contract contains

For a plan derived from an active, previously approved InnerMe decision, the server constructs a four-part contract:

- **Goal:** the approved decision text (falling back to its title).
- **Constraints:** evidence must be traceable to current records; unknown facts must not be guessed; planning must not claim or perform mutations; existing proposal, policy, approval, and confirmation gates remain mandatory.
- **Output format:** JSON with three to eight ordered steps, a success metric, completion criteria, explicit step-level success signals, and verification methods.
- **Failure conditions:** missing measurable completion criteria, missing or unsupported evidence, invalid step ordering/dependencies, missing verification, unsupported risk labels, or timing outside the defined bounds.

The contract is built in code and sent with the plan prompt. The resulting plan is then validated deterministically before the database RPC saves a draft. A failed validation returns field-level issue codes and does not save the new draft. The validator does not echo generated text into errors.

## Phase 10 action proposal gate

The action-proposal route now receives only approved/in-progress steps that include an observable success signal and a verification method. If all eligible steps are missing either field, the route returns HTTP 409 and makes no proposal-generation provider call. If some steps are incomplete, those step numbers are explicitly reported as skipped. This is a compatibility guard for older plans; administrators may need to complete those criteria before those steps can create action proposals.

Existing Phase 30 policy checks, explicit admin approval and execution confirmation remain in place. This contract does not grant permission to execute anything.

## Persistence schema

Migration `supabase/migrations/20261015043000_innerme_execution_contract_snapshots.sql` adds two nullable/backward-compatible plan fields:

- `execution_contract_version`
- `execution_contract_snapshot`

Legacy plans retain a null version and an empty object snapshot. New plan creation stores the precise contract snapshot that passed application-level validation. The canonical SQL artifact is updated in `supabase/innerme-execution-intelligence.sql`.

**Deployment order:** apply the migration to the isolated test Supabase project first, run the contract and action-path tests there, and only after review consider production. Do not deploy the changed Edge Function before the schema migration if persisted contract snapshots are required. No migration or Edge Function deployment was run by this change.

## Validation

The Deno test file `supabase/functions/swayphics-ai/innerme-execution-contracts.test.ts` covers the four-part contract, valid plans, missing success/completion fields, incorrect decision evidence, invalid risk/timing/dependency/order, and action-step eligibility. The existing Edge Function validation workflow runs this test without Gemini provider calls.

## What this does not establish

A structurally valid plan is not proof that a task completed or that its business outcome succeeded. Live runtime testing is still required for the migration and plan/action paths. Progressive workspace manifest loading, the general-purpose run controller, independent specialist review, expanded scoped-memory governance, per-run token/call budgets, and offline video-to-SOP ingestion remain separate workstreams.
