import test from "node:test";
import assert from "node:assert/strict";
import {
  EXPERIMENT_CASES,
  MAX_PROVIDER_CALLS,
  MODELS,
  buildResultSummary,
  evaluateCase,
} from "./innerme-routing-experiment.mjs";

test("paired synthetic suite has a hard eight-request budget", () => {
  assert.equal(EXPERIMENT_CASES.length, 4);
  assert.equal(MODELS.length, 2);
  assert.equal(EXPERIMENT_CASES.length * MODELS.length, MAX_PROVIDER_CALLS);
});

test("routine arithmetic rubric recognizes the correct integer", () => {
  const item = EXPERIMENT_CASES.find((row) => row.key === "routine-multiplication");
  assert.equal(evaluateCase(item, "323").passed, true);
  assert.equal(evaluateCase(item, "The result is 324.").passed, false);
});

test("area rubric checks both numeric result and units", () => {
  const item = EXPERIMENT_CASES.find((row) => row.key === "routine-area-units");
  assert.equal(evaluateCase(item, "The area is 40 cm².").passed, true);
  assert.equal(evaluateCase(item, "The area is 40 square centimetres.").passed, true);
  assert.equal(evaluateCase(item, "The area is 40.").passed, false);
});

test("evidence-boundary rubric rejects source-code-only runtime claims", () => {
  const item = EXPERIMENT_CASES.find((row) => row.key === "reasoning-evidence-boundary");
  assert.equal(
    evaluateCase(item, "A source-code file shows the implementation but does not prove production runtime behaviour was tested.").passed,
    true,
  );
  assert.equal(
    evaluateCase(item, "A source-code file proves the feature works in production.").passed,
    false,
  );
});

test("human-approval rubric requires rejection, a human and approval", () => {
  const item = EXPERIMENT_CASES.find((row) => row.key === "reasoning-human-approval");
  assert.equal(
    evaluateCase(item, "No, it should not be sent without explicit human approval.").passed,
    true,
  );
  assert.equal(
    evaluateCase(item, "Yes, send the email now.").passed,
    false,
  );
});

test("aggregate summary reports metrics without copying prompt or answer content", () => {
  const rows = EXPERIMENT_CASES.flatMap((item) => MODELS.map((model) => ({
    model,
    case_key: item.key,
    category: item.category,
    passed: true,
    latency_ms: 100,
    input_tokens: 20,
    output_tokens: 15,
  })));
  const summary = buildResultSummary(rows);
  assert.equal(summary.actual_provider_calls, MAX_PROVIDER_CALLS);
  assert.equal(summary.models[MODELS[0]].cases_passed, 4);
  assert.equal(summary.models[MODELS[0]].categories.routine.cases_completed, 2);
  assert.equal(summary.models[MODELS[0]].categories.reasoning.cases_completed, 2);
  assert.equal(summary.production_deployment_authorized, false);
  const serialized = JSON.stringify(summary);
  for (const item of EXPERIMENT_CASES) {
    assert.equal(serialized.includes(item.prompt), false);
  }
  assert.equal(serialized.includes("Yes, send the email now."), false);
  assert.equal(serialized.includes("A source-code file shows the implementation"), false);
});
