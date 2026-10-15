import {
  INNERME_EXECUTION_CONTRACT_VERSION,
  buildInnerMeExecutionContract,
  isInnerMeExecutionStepContractComplete,
  validateInnerMeExecutionContract,
} from "./innerme-execution-contracts.mjs";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function validPlanAndSteps(): { plan: any; steps: any[] } {
  return {
    plan: {
      title: "Follow up on a qualified lead",
      objective: "Confirm whether the prospect wants to proceed with a website proposal.",
      success_metric: "A documented reply or a verified no-response outcome.",
      completion_criteria: ["The follow-up outcome is recorded against the correct lead."],
      expected_outcome: "A verified next step is recorded.",
      duration_days: 7,
      evidence: [{
        source: "workspace",
        type: "decision",
        id: "decision-123",
        why: "The plan implements the selected decision.",
      }],
    },
    steps: [
      {
        step_order: 1, title: "Verify contact record", action: "Read the selected lead record",
        purpose: "Confirm the intended recipient", owner_role: "Swayphics admin",
        due_offset_days: 0, depends_on_step_order: null, success_signal: "Lead ID and email match the decision",
        verification_method: "Re-read the lead by its exact ID", risk_level: "low",
      },
      {
        step_order: 2, title: "Prepare follow-up", action: "Draft the message for review",
        purpose: "Prepare accurate outreach", owner_role: "Swayphics admin",
        due_offset_days: 1, depends_on_step_order: 1, success_signal: "Draft includes no unverified claims",
        verification_method: "Check recipient and message against the lead record", risk_level: "medium",
      },
      {
        step_order: 3, title: "Record outcome", action: "Record the approved follow-up result",
        purpose: "Keep the lead history current", owner_role: "Swayphics admin",
        due_offset_days: 2, depends_on_step_order: 2, success_signal: "A result is visible on the correct lead",
        verification_method: "Re-read the saved activity record", risk_level: "low",
      },
    ],
  };
}

Deno.test("execution contract exposes the four required prompt-contract components", () => {
  const contract = buildInnerMeExecutionContract({
    title: "Follow-up strategy",
    decision: "Prioritise verified follow-up on qualified leads.",
  });

  assert(contract.version === INNERME_EXECUTION_CONTRACT_VERSION, "contract version must be explicit");
  assert(contract.goal === "Prioritise verified follow-up on qualified leads.", "approved decision should anchor the goal");
  assert(contract.constraints.length >= 4, "contract must include operational constraints");
  assert(contract.output_format.minimum_steps === 3 && contract.output_format.maximum_steps === 8, "contract must bound the plan size");
  assert(contract.failure_conditions.some((item) => item.includes("verification method")), "missing verification must be a defined failure condition");
});

Deno.test("valid plan with evidence, completion criteria, and verifiable steps passes", () => {
  const { plan, steps } = validPlanAndSteps();
  const result = validateInnerMeExecutionContract(plan, steps, { decisionId: "decision-123" });
  assert(result.valid, "valid execution plan should pass: " + JSON.stringify(result.issues));
  assert(result.issues.length === 0, "passing plans should return no issues");
});

Deno.test("plan fails closed when success metric, completion criteria, duration, or decision evidence is missing", () => {
  const { plan, steps } = validPlanAndSteps();
  plan.success_metric = "";
  plan.completion_criteria = [];
  plan.duration_days = null;
  plan.evidence = [];
  const result = validateInnerMeExecutionContract(plan, steps, { decisionId: "decision-123" });
  const codes = new Set(result.issues.map((issue) => issue.code));
  assert(!result.valid, "incomplete plan must fail");
  assert(codes.has("required_field_missing"), "missing metric must fail");
  assert(codes.has("completion_criteria_missing"), "missing completion criteria must fail");
  assert(codes.has("duration_out_of_range"), "missing duration must fail");
  assert(codes.has("evidence_missing"), "missing evidence must fail");
});

Deno.test("steps fail closed when the observable success signal or verification method is missing", () => {
  const { plan, steps } = validPlanAndSteps();
  steps[1].success_signal = "";
  steps[2].verification_method = "";
  const result = validateInnerMeExecutionContract(plan, steps, { decisionId: "decision-123" });
  const missing = result.issues.filter((issue) => issue.code === "required_step_field_missing");
  assert(!result.valid, "unverifiable steps must fail");
  assert(missing.some((issue) => issue.field === "success_signal" && issue.step_order === 2), "missing success signal should identify its step");
  assert(missing.some((issue) => issue.field === "verification_method" && issue.step_order === 3), "missing verification should identify its step");
});

Deno.test("invalid ordering, dependency, timing, and risk cannot be silently accepted", () => {
  const { plan, steps } = validPlanAndSteps();
  steps[0].due_offset_days = 366;
  steps[1].depends_on_step_order = 3;
  steps[2].risk_level = "unknown";
  steps[2].step_order = 4;
  const result = validateInnerMeExecutionContract(plan, steps, { decisionId: "decision-123" });
  const codes = new Set(result.issues.map((issue) => issue.code));
  assert(!result.valid, "invalid step contract must fail");
  assert(codes.has("step_due_offset_out_of_range"), "out-of-range timing should fail");
  assert(codes.has("step_dependency_invalid"), "future-step dependency should fail");
  assert(codes.has("step_risk_level_invalid"), "unsupported risk level should fail");
  assert(codes.has("step_order_not_sequential"), "nonsequential order should fail");
});

Deno.test("decision evidence must match the active decision ID", () => {
  const { plan, steps } = validPlanAndSteps();
  const result = validateInnerMeExecutionContract(plan, steps, { decisionId: "another-decision" });
  assert(!result.valid, "evidence for a different decision should fail");
  assert(result.issues.some((issue) => issue.code === "decision_evidence_missing"), "missing decision traceability should be explicit");
});

Deno.test("action proposal eligibility requires an observable signal and verification method", () => {
  const { steps } = validPlanAndSteps();
  assert(isInnerMeExecutionStepContractComplete(steps[0]), "fully specified step should be eligible");
  assert(!isInnerMeExecutionStepContractComplete({ ...steps[0], success_signal: "" }), "step without success signal should be ineligible");
  assert(!isInnerMeExecutionStepContractComplete({ ...steps[0], verification_method: null }), "step without verification should be ineligible");
});
