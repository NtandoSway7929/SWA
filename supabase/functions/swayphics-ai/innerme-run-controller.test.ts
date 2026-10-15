import {
  buildInnerMeCompletionEvidence,
  buildInnerMeRunCheckpoint,
  selectInnerMeActionReadySteps,
  validateInnerMeCompletionEvidence,
  validateInnerMeRunCheckpoint,
} from "./innerme-run-controller.mjs";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function exampleSteps() {
  return [
    { step_order: 1, status: "completed", success_signal: "Record verified", verification_method: "Re-read the record" },
    { step_order: 2, status: "approved", depends_on_step_order: 1, success_signal: "Draft ready", verification_method: "Review the draft" },
    { step_order: 3, status: "approved", depends_on_step_order: 2, success_signal: "Outcome recorded", verification_method: "Re-read activity" },
    { step_order: 4, status: "approved", depends_on_step_order: 1, success_signal: "", verification_method: "" },
    { step_order: 5, status: "completed", depends_on_step_order: 2, success_signal: "Done", verification_method: "Check result" },
    { step_order: 6, status: "blocked", success_signal: "Done", verification_method: "Check result" },
  ];
}

Deno.test("action readiness waits for dependencies to be explicitly completed", () => {
  const result = selectInnerMeActionReadySteps(exampleSteps());
  assert(result.ready.length === 1, "only step 2 should be ready while step 3 waits for step 2");
  assert(result.ready[0].step_order === 2, "step 2 has a completed prerequisite");
  assert(result.skipped_dependency_steps.some((item) => item.step_order === 3 && item.depends_on_step_order === 2), "dependent step should report its unmet prerequisite");
});

Deno.test("missing dependency rows fail closed rather than being ignored", () => {
  const result = selectInnerMeActionReadySteps([
    { step_order: 2, status: "approved", depends_on_step_order: 1, success_signal: "Done", verification_method: "Check" },
  ]);
  assert(result.ready.length === 0, "missing prerequisite must not allow proposal generation");
  assert(result.skipped_dependency_steps[0].dependency_status === "missing", "missing prerequisite should be explicit");
});

Deno.test("unverifiable and non-actionable steps are reported separately", () => {
  const result = selectInnerMeActionReadySteps(exampleSteps());
  assert(result.skipped_unverified_step_orders.includes(4), "missing success/verification contract must be listed");
  assert(result.skipped_not_actionable_step_orders.includes(1), "completed steps must not receive new action proposals");
  assert(result.skipped_not_actionable_step_orders.includes(6), "blocked steps must not receive new action proposals");
});

Deno.test("checkpoint builder constrains operator progress to compact structured fields", () => {
  const checkpoint = buildInnerMeRunCheckpoint("Confirmed recipient and message are ready for review.", {
    phase: "pre_send_review",
    unresolvedItems: ["Waiting for admin approval."],
    nextAction: "Present the draft for approval.",
  });
  assert(checkpoint.phase === "pre_send_review", "checkpoint phase should be preserved");
  assert(checkpoint.progress_summary.includes("Confirmed recipient"), "checkpoint summary should be preserved");
  assert(checkpoint.verified_artifact_refs.length === 0, "checkpoint must not invent artifact references");
  assert(validateInnerMeRunCheckpoint(checkpoint.progress_summary, checkpoint).valid, "built checkpoint should pass validation");
});

Deno.test("checkpoint validation rejects free-form payload keys and oversized input", () => {
  const malicious = {
    phase: "checkpoint",
    progress_summary: "Reviewed current progress safely.",
    prompt: "do not store model prompts",
    verified_artifact_refs: [],
    unresolved_items: [],
  };
  const result = validateInnerMeRunCheckpoint(malicious.progress_summary, malicious);
  assert(!result.valid && result.errors.some((code) => code.startsWith("checkpoint_key_not_allowed:")), "unknown free-form prompt fields must be rejected");
  let rejected = false;
  try {
    buildInnerMeRunCheckpoint("too short");
  } catch {
    rejected = true;
  }
  assert(rejected, "short summaries must be rejected");
});

Deno.test("completion evidence requires explicit human verification and a reference", () => {
  const step = { success_signal: "The correct record is updated", verification_method: "Re-read the saved record" };
  const evidence = buildInnerMeCompletionEvidence({
    summary: "I re-read the saved record and confirmed its status, related ID, and next action match the approved step.",
    evidenceReference: "workspace record ID 3d5b...",
    verificationMethod: step.verification_method,
  });
  const result = validateInnerMeCompletionEvidence(evidence.summary, step, evidence);
  assert(result.valid, "well-formed admin-verification evidence should pass: " + result.errors.join(","));
  assert(evidence.verified_by_human === true, "completion must explicitly record human verification");
  assert(evidence.evidence_refs.length === 1, "completion must cite an evidence reference");
});

Deno.test("completion evidence fails when the step has no success contract or evidence", () => {
  const result = validateInnerMeCompletionEvidence(
    "This step was completed and checked but there is no reliable recorded evidence.",
    { success_signal: "", verification_method: "" },
    { verified_by_human: false, verification_method: "", summary: "", evidence_refs: [] },
  );
  const errors = new Set(result.errors);
  assert(!result.valid, "missing success contract should fail");
  assert(errors.has("step_success_signal_missing"), "missing success signal should be explicit");
  assert(errors.has("step_verification_method_missing"), "missing verification method should be explicit");
  assert(errors.has("human_verification_required"), "human verification should be required");
  assert(errors.has("evidence_refs_invalid"), "completion must have an evidence reference");
});
