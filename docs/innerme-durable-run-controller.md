# InnerMe Durable Execution-Step Run Controller

## Purpose

This is an incremental controller for the existing Phase 9/10 execution-plan lifecycle. It does not add a roadmap phase, call an AI provider, perform a workspace mutation, or bypass Phase 30.

## Step lifecycle

- **Start:** an administrator starts an approved step. The server checks that the plan is approved/active, the step has a success signal and verification method, and any prerequisite step is explicitly completed. The server moves the step to `in_progress`, increments its attempt count, and records a start event.
- **Checkpoint:** an administrator records a short progress summary plus optional unresolved items or verified artifact references. The payload is bounded and has an allowlisted schema. Prompt text, hidden reasoning, full conversation history, and secrets are not supported fields.
- **Complete:** an administrator must provide a verification summary, a concrete evidence reference, and the step's stated verification method. The server records who verified it and when, changes the step to `completed`, and writes a completion event. This records an administrator's verification, not an independently proven business outcome.
- **Block:** an administrator records why an approved or in-progress step cannot proceed. Blocking a step is not an action cancellation or a recovery operation.
- **Resume:** a blocked step can resume only after its prerequisite is completed. The server refuses to resume, complete, or block the step while a related controlled action proposal is still `executing` or its execution log remains `started`. Reconcile uncertain task/email side effects through the existing Phase 30 recovery workflow first.

A step with an incomplete success contract cannot start, resume, or complete. It can be blocked so the missing condition is documented.

## Dependency and proposal gates

The Edge Function reads all steps for the approved plan before proposing actions. It only submits a step for action proposal generation when:

1. Its status is `in_progress`.
2. A durable `started_at` timestamp exists.
3. It has a success signal and verification method.
4. Its declared prerequisite step exists and has status `completed`.

Unstarted, blocked, completed, unverifiable, missing-prerequisite and dependency-incomplete steps do not enter the model prompt for action proposal generation. The response includes reason-specific skipped step lists. The dashboard exposes Start/Resume, Save checkpoint, Mark verified complete, and Block controls, alongside the step event history.

The action-execution route checks the step state again after it claims a proposal and before creating a task or sending an email. This closes the race where an administrator might otherwise complete or block a step between the initial read and the side effect. The existing explicit approval, safety gate and execution recovery logic remain in force.

## Audit model

`innerme_execution_step_events` is an append-only transition ledger from the application path. Authenticated admins can read it; direct authenticated insert/update/delete privileges are not granted. The RPC checks the active admin identity, locks the affected step and plan, validates allowed transitions, updates the step and inserts the event in the same database transaction.

Events contain the transition, from/to statuses, attempt count, short admin note and bounded checkpoint/verification payload. They do not accept model prompts, reasoning traces or full chat histories.

## Legacy state and rollout order

The migration adds step attempt/checkpoint/completion fields and the audit ledger. Pre-existing `in_progress` steps get a start timestamp and at least one attempt so already-active work does not become impossible to reconcile; the migration does not create historical event entries for these records.

**Rollout order:**
1. Apply `supabase/migrations/20261015060000_innerme_execution_step_run_controller.sql` to the isolated Swayphics InnerMe Test project.
2. Confirm the transition RPC, audit-ledger RLS and schema columns are present in that isolated project.
3. Deploy the Edge Function and dashboard code to the isolated test environment.
4. Test a synthetic three-step plan: start step 1, verify completion using an evidence reference, confirm step 2 can then start, and confirm step 3 remains blocked until step 2 is completed. Also test that a started execution log blocks resume/complete until Phase 30 reconciliation is finished.
5. Only after those checks pass should production deployment be considered, with the same migration-before-code order.

No migration was applied and no Edge Function was deployed as part of this change.

## Limits

- Marking a step complete is a human verification event; it does not automatically mark the whole plan or the business outcome successful.
- This is a durable, manual step controller, not yet a general autonomous worker queue. It persists progress and enforces safe transitions but does not wake itself up or run steps in the background.
- A checkpoint is an operator summary and reference list. It is not a hidden model-reasoning store or a substitute for the execution audit logs.
- Provider calls, task/email mutations and retries are not initiated by the controller itself.
