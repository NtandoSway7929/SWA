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
  semantic_irrelevant_cooking_excluded: ["retrieval_negative", "invoice", false],
  semantic_irrelevant_algorithm_excluded: ["retrieval_negative", "invoice", false],
  semantic_stale_knowledge_excluded: ["eligibility_exclusion", "stale", false],
  semantic_unverified_knowledge_excluded: ["eligibility_exclusion", "unverified", false],
  semantic_expired_review_excluded: ["eligibility_exclusion", "expired_review", false],
  normal_chat_invoice_grounding: ["chat_grounding", "invoice", true],
  normal_chat_appointment_grounding: ["chat_grounding", "appointment", true],
  normal_chat_dispatch_grounding: ["chat_grounding", "dispatch", true],
  normal_chat_irrelevant_invoice_exclusion: ["chat_exclusion", "invoice", false],
  corpus_invoice_paraphrase_1: ["corpus_retrieval_positive", "invoice", true, "corpus", ["invoice"]],
  corpus_invoice_paraphrase_2: ["corpus_retrieval_positive", "invoice", true, "corpus", ["invoice"]],
  corpus_invoice_paraphrase_3: ["corpus_retrieval_positive", "invoice", true, "corpus", ["invoice"]],
  corpus_appointment_paraphrase_1: ["corpus_retrieval_positive", "appointment", true, "corpus", ["appointment"]],
  corpus_appointment_paraphrase_2: ["corpus_retrieval_positive", "appointment", true, "corpus", ["appointment"]],
  corpus_appointment_paraphrase_3: ["corpus_retrieval_positive", "appointment", true, "corpus", ["appointment"]],
  corpus_dispatch_paraphrase_1: ["corpus_retrieval_positive", "dispatch", true, "corpus", ["dispatch"]],
  corpus_dispatch_paraphrase_2: ["corpus_retrieval_positive", "dispatch", true, "corpus", ["dispatch"]],
  corpus_dispatch_paraphrase_3: ["corpus_retrieval_positive", "dispatch", true, "corpus", ["dispatch"]],
  corpus_irrelevant_lunar_phases: ["corpus_retrieval_negative", "invoice", false, "corpus", []],
  corpus_irrelevant_guitar_tuning: ["corpus_retrieval_negative", "invoice", false, "corpus", []],
  corpus_irrelevant_tomato_soil: ["corpus_retrieval_negative", "invoice", false, "corpus", []],
  corpus_irrelevant_ocean_tides: ["corpus_retrieval_negative", "invoice", false, "corpus", []],
  corpus_irrelevant_mountain_pressure: ["corpus_retrieval_negative", "invoice", false, "corpus", []],
  corpus_irrelevant_chess_opening: ["corpus_retrieval_negative", "invoice", false, "corpus", []],
};

test("regression baseline pins its suite version, model contract, threshold and case count", () => {
  assert.equal(baseline.suite_id, "innerme_semantic_retrieval_regression");
  assert.equal(baseline.baseline_version, "1.2.0");
  assert.equal(baseline.embedding_model, "gte-small");
  assert.equal(baseline.embedding_dimensions, 384);
  assert.equal(baseline.retrieval_similarity_threshold, 0.8);
  assert.equal(baseline.threshold_calibration.chosen_threshold, 0.8);
  assert.ok(baseline.threshold_calibration.observed_similarity < baseline.retrieval_similarity_threshold);
  assert.ok(baseline.threshold_calibration.lowest_positive_similarity > baseline.retrieval_similarity_threshold);
  assert.equal(baseline.fixtures.length, 6);
  assert.equal(baseline.tests.length, 28);
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
    assert.match(fixture.title, /synthetic/i);
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
      expected.slice(0, 3),
      "expectation contract changed for " + item.id,
    );
    assert.equal(item.retrieval_scope || "fixture", expected[3] || "fixture");
    if (expected[3] === "corpus") {
      assert.deepEqual(item.expected_fixture_keys, expected[4]);
    } else {
      assert.equal(item.expected_fixture_keys, undefined);
    }
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
  assert.match(baseline.tests.find((item) => item.id === "semantic_irrelevant_cooking_excluded").query, /sourdough/i);
  assert.match(baseline.tests.find((item) => item.id === "semantic_irrelevant_algorithm_excluded").query, /Dijkstra/i);
  assert.equal(irrelevant.expected_match, false);

  for (const id of [
    "semantic_irrelevant_cooking_excluded",
    "semantic_irrelevant_algorithm_excluded",
    "semantic_stale_knowledge_excluded",
    "semantic_unverified_knowledge_excluded",
    "semantic_expired_review_excluded",
    "normal_chat_irrelevant_invoice_exclusion",
  ]) {
    assert.equal(baseline.tests.find((item) => item.id === id).expected_match, false);
  }
});

test("corpus-wide evaluation pins paraphrase recall, fixture precision and unrelated-query rejection", () => {
  const corpus = baseline.tests.filter((item) => item.retrieval_scope === "corpus");
  const positives = corpus.filter((item) => item.type === "corpus_retrieval_positive");
  const negatives = corpus.filter((item) => item.type === "corpus_retrieval_negative");
  assert.equal(corpus.length, 15);
  assert.equal(positives.length, 9);
  assert.equal(negatives.length, 6);

  for (const key of ["invoice", "appointment", "dispatch"]) {
    const topicCases = positives.filter((item) => item.fixture_key === key);
    assert.equal(topicCases.length, 3, "expected three paraphrase queries for " + key);
    for (const item of topicCases) {
      assert.deepEqual(item.expected_fixture_keys, [key]);
      assert.equal(item.expected_match, true);
    }
  }

  for (const item of negatives) {
    assert.deepEqual(item.expected_fixture_keys, []);
    assert.equal(item.expected_match, false);
  }
});
