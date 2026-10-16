import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const baselinePath = new URL(
  "../supabase/functions/innerme-retrieval-smoke-test/regression-baseline.json",
  import.meta.url,
);
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));

const expectedFixturePolicies = {
  invoice: { status: "active", verification_status: "verified", review_window: "future" },
  appointment: { status: "active", verification_status: "verified", review_window: "future" },
  dispatch: { status: "active", verification_status: "verified", review_window: "future" },
  stale: { status: "active", verification_status: "stale", review_window: "future" },
  unverified: { status: "active", verification_status: "unverified", review_window: "future" },
  expired_review: { status: "active", verification_status: "verified", review_window: "expired" },
};

const expectedTests = {
  semantic_invoice_match: ["retrieval_positive", "invoice", true],
  semantic_appointment_match: ["retrieval_positive", "appointment", true],
  semantic_dispatch_match: ["retrieval_positive", "dispatch", true],
  semantic_irrelevant_query_excluded: ["retrieval_negative", "invoice", false],
  semantic_stale_knowledge_excluded: ["eligibility_exclusion", "stale", false],
  semantic_unverified_knowledge_excluded: ["eligibility_exclusion", "unverified", false],
  semantic_expired_review_excluded: ["eligibility_exclusion", "expired_review", false],
  normal_chat_invoice_grounding: ["chat_grounding", "invoice", true],
  normal_chat_appointment_grounding: ["chat_grounding", "appointment", true],
  normal_chat_dispatch_grounding: ["chat_grounding", "dispatch", true],
};

test("regression baseline pins its suite version, model contract, threshold and case count", () => {
  assert.equal(baseline.suite_id, "innerme_semantic_retrieval_regression");
  assert.equal(baseline.baseline_version, "1.0.0");
  assert.equal(baseline.embedding_model, "gte-small");
  assert.equal(baseline.embedding_dimensions, 384);
  assert.equal(baseline.retrieval_similarity_threshold, 0.45);
  assert.equal(baseline.fixtures.length, 6);
  assert.equal(baseline.tests.length, 10);
});

test("fixtures isolate the exact metadata dimension each eligibility regression checks", () => {
  const fixtureKeys = baseline.fixtures.map((item) => item.key);
  assert.deepEqual([...fixtureKeys].sort(), Object.keys(expectedFixturePolicies).sort());
  assert.equal(new Set(fixtureKeys).size, fixtureKeys.length);

  for (const fixture of baseline.fixtures) {
    assert.deepEqual(
      {
        status: fixture.status,
        verification_status: fixture.verification_status,
        review_window: fixture.review_window,
      },
      expectedFixturePolicies[fixture.key],
      "unexpected eligibility metadata for " + fixture.key,
    );
    assert.equal(fixture.knowledge_type, "definition");
    assert.ok(fixture.domain.startsWith("semantic-regression-"));
    assert.ok(fixture.title.startsWith("Synthetic "));
    assert.ok(fixture.statement.includes(fixture.canary_phrase));
    assert.ok(fixture.statement.includes("isolated regression test"));
  }
});

test("every case ID pins its type, fixture and expected outcome", () => {
  const actualIds = baseline.tests.map((item) => item.id);
  assert.deepEqual([...actualIds].sort(), Object.keys(expectedTests).sort());
  assert.equal(new Set(actualIds).size, actualIds.length);

  for (const item of baseline.tests) {
    const expected = expectedTests[item.id];
    assert.deepEqual(
      [item.type, item.fixture_key, item.expected_match],
      expected,
      "expectation contract changed for " + item.id,
    );
    assert.ok(typeof item.query === "string" && item.query.trim().length > 20);
  }
});

test("positive retrieval and grounding coverage includes three distinct topics", () => {
  for (const fixtureKey of ["invoice", "appointment", "dispatch"]) {
    assert.ok(baseline.tests.some((item) =>
      item.type === "retrieval_positive" && item.fixture_key === fixtureKey && item.expected_match === true
    ));
    assert.ok(baseline.tests.some((item) =>
      item.type === "chat_grounding" && item.fixture_key === fixtureKey && item.expected_match === true
    ));
    const fixture = baseline.fixtures.find((item) => item.key === fixtureKey);
    assert.ok(fixture.canary_phrase.trim().length > 5);
  }
});

test("negative cases cover irrelevant queries and all three eligibility exclusions", () => {
  const irrelevant = baseline.tests.find((item) => item.id === "semantic_irrelevant_query_excluded");
  assert.match(irrelevant.query, /Kepler-452b/);
  assert.equal(irrelevant.expected_match, false);

  for (const id of [
    "semantic_stale_knowledge_excluded",
    "semantic_unverified_knowledge_excluded",
    "semantic_expired_review_excluded",
  ]) {
    assert.equal(baseline.tests.find((item) => item.id === id).expected_match, false);
  }
});
