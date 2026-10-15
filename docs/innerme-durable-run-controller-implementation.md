# InnerMe Durable Execution-Step Run Controller: Implementation Notes

## Scope

This is an incremental controller for the existing Phase 9/10 execution-plan lifecycle, not a new roadmap phase. It persists manual run state and verified step outcomes without calling an AI provider or performing a workspace mutation itself.

## Step lifecycle and checks

- **Start:** An administrator starts an approved step. The server verifies the plan is approved/active, the step has an observable success signal and verification method, and any prerequisite is completed. It moves the step to `in_progress`, increments its attempt count, timestamps the start, and writes an audit event.
- **Checkpoint:** An administrator saves a compact progress summary, unresolved items and/or verified artifact references. The payload is allowlisted and bounded. Prompts, hidden model reasoning, full conversation history and secrets are not allowed fields.
- **Complete:** An administrator supplies a verification summary, the step's defined verification method, and at least one evidence reference. The RPC records the administrator and verification timestamp, then sets the step to `completed`. This records admin verification, not proof that the whole business outcome succeeded.
- **Block:** The administrator records why an approved/in-progress step cannot proceed. This does not cancel a client-facing action.
- **Resume:** A blocked step can resume only after required dependencies are completed and the admin reviews the blocking condition.

The server refuses to resume, complete, or block a step while a related controlled action proposal remains `proposed`, `approved`, or `executing`, or an associated execution log remains `started`. Open proposals must be reviewed/rejected, and uncertain task/email side effects must be reconciled through the existing Phase 30 recovery workflow first.

## Proposal and execution readiness

The Phase 10 proposal route reads all steps in the plan, but sends only eligible steps to the model. A candidate step must have:

1. `in_progress` status.
2. A persisted `started_at` timestamp.
3. Both a success signal and a verification method.
4. A declared prerequisite that exists and is explicitly `completed`, if the step has a dependency.

Skipped steps and dependency reasons are returned to the caller. After an approved proposal is claimed as `executing`, the Edge Function re-reads the step and verifies it remains started/in-progress immediately before task creation or email delivery. Existing policy gates, explicit approval/confirmation and execution logs remain unchanged.

## Persistence and database enforcement

The migration adds attempt, start, checkpoint, completion-evidence, completion time, verifier, block-reason and error-code fields to `innerme_execution_steps`. It backfills only missing start timestamps for legacy `in_progress` rows and ensures those rows have at least one attempt. It does not fabricate historical event records.

The append-only `innerme_execution_step_events` ledger records transition type, from/to status, actor, attempt count, bounded note and structured payload. Authenticated admins can read it, but direct authenticated writes are denied.

A database trigger guards run-controller fields and prevents direct table updates from bypassing governed status transitions. It permits the existing plan-review RPC's planned-to-approved/cancelled transition under a transaction-local mode, and the dedicated transition RPC's allowed changes under its own transaction-local mode.

## Rollout order

1. Apply `supabase/migrations/20261015060000_innerme_execution_step_run_controller.sql` to the isolated **Swayphics InnerMe Test** project.
2. Confirm the step columns, transition RPC, trigger, RLS and event ledger exist in that isolated project.
3. Deploy the Edge Function and dashboard changes to the isolated test environment.
4. Run a synthetic three-step test: start and verify step 1, confirm step 2 can then start, and confirm step 3 remains blocked until step 2 is explicitly completed.
5. Test checkpoint persistence, blocked-step resume, missing evidence rejection, and refusal to resume/complete while an action proposal or execution log remains unresolved.
6. Only after all isolated tests pass should production rollout be considered, using the same migration-before-code order.

No migration was applied and no Edge Function was deployed as part of this PR.

## Limits

- This is a durable **manual step controller**, not yet an autonomous worker queue. It persists progress and enforces transitions but does not wake itself up or run tasks in the background.
- Completion of all steps does not automatically complete the overall plan or prove a business outcome. Plan-level success metrics must be verified separately.
- A checkpoint is an operator summary and artifact reference list, not a hidden reasoning store or substitute for action execution logs.
