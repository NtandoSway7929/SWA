/**
 * Provider-free golden contract evaluation for InnerMe Intelligent UI v1.
 *
 * These fixtures verify the format contract and UI parser using known synthetic
 * outputs. They do NOT call an AI provider and do NOT measure a model's ability
 * to choose the expected format. Live answer-quality testing remains separate.
 */
import assert from "node:assert/strict";
import {
  isInnerMeIntelligentUiEnvelope,
  normalizeInnerMeAnswer,
} from "../supabase/functions/swayphics-ai/innerme-intelligent-ui-format.mjs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ui = require("../admin-dashboard/innerme-intelligent-ui.js");

const makeEnvelope = (payload) => JSON.stringify({ innerme_ui: { version: 1, ...payload } });

const cases = [
  {
    id: "plain-simple-answer",
    purpose: "Keep a simple factual calculation in plain text.",
    prompt: "What is 5% of R100?",
    expectedMode: "plain_text",
    response: "5% of R100 is R5.",
    verify(answer) {
      assert.equal(answer, "5% of R100 is R5.");
      assert.equal(isInnerMeIntelligentUiEnvelope(answer), false);
      assert.equal(ui.parseOptInPayload(answer), null);
    }
  },
  {
    id: "structured-multi-metric-summary",
    purpose: "Use metric cards for unlike measures while preserving each unit.",
    prompt: "Summarize these illustrative sample metrics: reach 1,500 impressions, conversion rate 3.5 percent, satisfaction 92 percent.",
    expectedMode: "structured",
    response: makeEnvelope({
      kind: "metrics",
      title: "Illustrative campaign metrics",
      summary: "These sample measures use different units, so they should be compared as separate metrics.",
      metrics: [
        { label: "Marketing reach", value: "1,500 impressions" },
        { label: "Conversion rate", value: "3.5 percent" },
        { label: "Customer satisfaction", value: "92 percent" }
      ]
    }),
    verify(answer) {
      const payload = ui.parseOptInPayload(answer);
      assert.ok(payload, "Expected a valid frontend-recognized envelope");
      assert.equal(payload.kind, "metrics");
      assert.equal(payload.metrics.length, 3);
      assert.deepEqual(payload.metrics.map(item => item.label), [
        "Marketing reach", "Conversion rate", "Customer satisfaction"
      ]);
      assert.deepEqual(payload.metrics.map(item => item.value), [
        "1,500 impressions", "3.5 percent", "92 percent"
      ]);
      assert.equal(payload.chart, undefined,
        "Unlike measures should not be bundled into one chart");
      assert.equal(normalizeInnerMeAnswer(answer), answer,
        "Structured JSON must survive answer normalization unchanged");
    }
  },
  {
    id: "structured-action-checklist",
    purpose: "Render a concrete plan as a checklist.",
    prompt: "Turn these synthetic steps into an actionable checklist: confirm the audience; prepare one offer; measure qualified enquiries.",
    expectedMode: "structured",
    response: makeEnvelope({
      kind: "checklist",
      title: "Three-step outreach experiment",
      summary: "Illustrative plan; confirm the audience and offer before launch.",
      items: [
        "Confirm the target audience and qualification criteria.",
        "Prepare one clear offer with a single next step.",
        "Track qualified enquiries and review the result after the test period."
      ]
    }),
    verify(answer) {
      const payload = ui.parseOptInPayload(answer);
      assert.ok(payload);
      assert.equal(payload.kind, "checklist");
      assert.equal(payload.items.length, 3);
      assert.ok(payload.items.every(item =>
        typeof item === "string" || (item && typeof item.label === "string")
      ));
    }
  },
  {
    id: "structured-comparable-series-chart",
    purpose: "Allow a chart for comparable values in one unit and scale.",
    prompt: "Chart these illustrative website visits by month: January 120 visits, February 150 visits, March 135 visits.",
    expectedMode: "structured",
    response: makeEnvelope({
      kind: "chart",
      title: "Illustrative monthly website visits",
      summary: "All three values are visits, measured on the same scale.",
      chart: {
        title: "Website visits (visits)",
        points: [
          { label: "January", value: 120 },
          { label: "February", value: 150 },
          { label: "March", value: 135 }
        ]
      }
    }),
    verify(answer) {
      const payload = ui.parseOptInPayload(answer);
      assert.ok(payload);
      assert.equal(payload.kind, "chart");
      assert.match(payload.chart.title, /\bvisits\b/i);
      assert.equal(payload.chart.points.length, 3);
      assert.deepEqual(payload.chart.points.map(point => point.label), [
        "January", "February", "March"
      ]);
      assert.ok(payload.chart.points.every(point =>
        Number.isFinite(point.value) && typeof point.value === "number"
      ));
      assert.ok(payload.chart.points.some(point => point.value === 150));
    }
  },
  {
    id: "citation-sensitive-answer",
    purpose: "Preserve inline evidence citations in the existing plain-text contract.",
    prompt: "Answer from the supplied, reviewed source and retain citation [1]. Do not invent additional support.",
    expectedMode: "plain_text",
    response: "The supplied reviewed source states that its sample filing deadline is 30 April [1]. I have not independently verified anything beyond that source.",
    verify(answer) {
      assert.match(answer, /sample filing deadline is 30 April \[1\]/);
      assert.match(normalizeInnerMeAnswer(answer), /\[1\]/,
        "The source citation must remain intact after normalization");
      assert.equal(isInnerMeIntelligentUiEnvelope(answer), false);
      assert.equal(ui.parseOptInPayload(answer), null,
        "Citation-sensitive answers must not be forced into structured JSON");
    }
  }
];

const results = [];
for (const testCase of cases) {
  try {
    testCase.verify(testCase.response);
    results.push({ id: testCase.id, status: "PASS", expected_mode: testCase.expectedMode });
  } catch (error) {
    results.push({
      id: testCase.id,
      status: "FAIL",
      expected_mode: testCase.expectedMode,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

const failed = results.filter(result => result.status !== "PASS");
const report = {
  evaluation: "innerme_structured_answer_contract_v1",
  evaluation_type: "synthetic_golden_fixture_contract_check",
  cases_total: cases.length,
  cases_passed: results.length - failed.length,
  cases_failed: failed.length,
  provider_requests: 0,
  live_model_behavior_verified: false,
  results
};

console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exitCode = 1;
