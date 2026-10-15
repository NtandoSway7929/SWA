/**
 * Deterministic contracts for InnerMe's governed execution-plan lifecycle.
 * This module is pure: it performs no provider, database, or workspace calls.
 */
export const INNERME_EXECUTION_CONTRACT_VERSION = "innerme-execution-contract-v1";

const REQUIRED_PLAN_TEXT_FIELDS = ["title", "objective", "success_metric", "expected_outcome"];
const REQUIRED_STEP_TEXT_FIELDS = [
  "title",
  "action",
  "purpose",
  "owner_role",
  "success_signal",
  "verification_method",
];

function nonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validBoundedInteger(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

/**
 * Build the prompt contract deterministically from an already-approved decision.
 * No extra model call is used to construct the contract.
 */
export function buildInnerMeExecutionContract(decision) {
  const title = nonEmptyText(decision?.title) ? decision.title.trim() : "";
  const decisionText = nonEmptyText(decision?.decision) ? decision.decision.trim() : "";
  const goal = decisionText || title;

  return {
    version: INNERME_EXECUTION_CONTRACT_VERSION,
    goal,
    constraints: [
      "This stage only prepares a draft plan; it must not perform or claim a workspace or external action.",
      "Ground workspace claims in supplied records and exact record IDs. Knowledge may interpret records but cannot create workspace facts.",
      "Never invent identities, recipient addresses, amounts, dates, customer intent, causes, or outcomes.",
      "Treat missing prerequisites or unverifiable evidence as blockers. Do not silently guess or convert unknowns into facts.",
      "Workspace mutations and client-facing communications must remain behind the existing proposal, policy, explicit approval, and confirmation controls.",
      "Use relative timing only; dates and durations must remain within the stated integer bounds.",
    ],
    output_format: {
      type: "application/json",
      root_keys: ["plan", "steps"],
      minimum_steps: 3,
      maximum_steps: 8,
      required_plan_fields: [
        "title",
        "objective",
        "success_metric",
        "completion_criteria",
        "expected_outcome",
        "duration_days",
        "evidence",
      ],
      required_step_fields: [
        "step_order",
        "title",
        "action",
        "purpose",
        "owner_role",
        "due_offset_days",
        "depends_on_step_order",
        "success_signal",
        "verification_method",
        "risk_level",
      ],
    },
    failure_conditions: [
      "The goal is empty or the plan objective does not explain the intended outcome.",
      "The plan lacks a measurable success metric or at least one explicit completion criterion.",
      "The plan has fewer than three or more than eight steps.",
      "Any step lacks an action, purpose, observable success signal, or verification method.",
      "A date offset or duration is not an integer from zero through 365.",
      "A dependency points to the same step, a future step, or a missing step.",
      "The decision cannot be traced to the plan's supplied evidence.",
    ],
  };
}

/**
 * Validate the normalized plan before any draft is saved.
 * Returned issues contain field names/codes only, never generated prompt content.
 */
export function validateInnerMeExecutionContract(plan, steps, options = {}) {
  const issues = [];
  const add = (code, field, stepOrder = null) => {
    issues.push({ code, field, step_order: stepOrder });
  };

  for (const field of REQUIRED_PLAN_TEXT_FIELDS) {
    if (!nonEmptyText(plan?.[field])) add("required_field_missing", field);
  }

  if (!Array.isArray(plan?.completion_criteria)) {
    add("completion_criteria_invalid", "completion_criteria");
  } else {
    const criteria = plan.completion_criteria.filter(nonEmptyText);
    if (criteria.length === 0) add("completion_criteria_missing", "completion_criteria");
    if (criteria.length > 8) add("completion_criteria_too_many", "completion_criteria");
  }

  if (!validBoundedInteger(plan?.duration_days, 0, 365)) {
    add("duration_out_of_range", "duration_days");
  }

  if (!Array.isArray(plan?.evidence) || plan.evidence.length === 0) {
    add("evidence_missing", "evidence");
  } else if (options.decisionId) {
    const hasDecisionEvidence = plan.evidence.some((item) =>
      item?.source === "workspace" &&
      item?.type === "decision" &&
      String(item?.id ?? "") === String(options.decisionId)
    );
    if (!hasDecisionEvidence) add("decision_evidence_missing", "evidence");
  }

  if (!Array.isArray(steps)) {
    add("steps_invalid", "steps");
    return { valid: false, issues };
  }

  if (steps.length < 3) add("too_few_steps", "steps");
  if (steps.length > 8) add("too_many_steps", "steps");

  const availableOrders = new Set(
    steps.map((step) => step?.step_order).filter((order) => Number.isInteger(order)),
  );

  steps.forEach((step, index) => {
    const order = step?.step_order;
    const labelOrder = Number.isInteger(order) ? order : index + 1;

    if (order !== index + 1) add("step_order_not_sequential", "step_order", labelOrder);

    for (const field of REQUIRED_STEP_TEXT_FIELDS) {
      if (!nonEmptyText(step?.[field])) add("required_step_field_missing", field, labelOrder);
    }

    if (!validBoundedInteger(step?.due_offset_days, 0, 365)) {
      add("step_due_offset_out_of_range", "due_offset_days", labelOrder);
    }

    if (!["low", "medium", "high"].includes(step?.risk_level)) {
      add("step_risk_level_invalid", "risk_level", labelOrder);
    }

    if (step?.depends_on_step_order !== null && step?.depends_on_step_order !== undefined) {
      const dependency = step.depends_on_step_order;
      if (
        !Number.isInteger(dependency) ||
        dependency < 1 ||
        dependency >= labelOrder ||
        !availableOrders.has(dependency)
      ) {
        add("step_dependency_invalid", "depends_on_step_order", labelOrder);
      }
    }
  });

  return { valid: issues.length === 0, issues };
}

/**
 * A step is eligible for action proposal generation only if its completion can
 * be observed and independently verified. Legacy incomplete steps are skipped.
 */
export function isInnerMeExecutionStepContractComplete(step) {
  return nonEmptyText(step?.title) &&
    nonEmptyText(step?.action) &&
    nonEmptyText(step?.success_signal) &&
    nonEmptyText(step?.verification_method);
}
