import assert from "node:assert/strict";
import test from "node:test";
import { selectRelevantKnowledgeMatches } from "../supabase/functions/swayphics-ai/innerme-retrieval-ranking.mjs";

// Scores recorded from isolated semantic retrieval regression run 38841956023, attempts 2 and 3.
const observedQueryCandidates = [
  { id: "corpus_invoice_paraphrase_1", expected: "invoice", candidates: [["invoice", 0.847644899855709], ["appointment", 0.80577642883203]] },
  { id: "corpus_invoice_paraphrase_1_attempt_3", expected: "invoice", candidates: [["invoice", 0.848529467074308], ["appointment", 0.809362005629421]] },
  { id: "corpus_invoice_paraphrase_2", expected: "invoice", candidates: [["invoice", 0.854035717730013], ["appointment", 0.812533570456529], ["dispatch", 0.803760671727686]] },
  { id: "corpus_invoice_paraphrase_3", expected: "invoice", candidates: [["invoice", 0.887446787579262], ["appointment", 0.816403150558472], ["dispatch", 0.81233270094796]] },
  { id: "corpus_appointment_paraphrase_1", expected: "appointment", candidates: [["appointment", 0.871258847192459], ["invoice", 0.808766735383875]] },
  { id: "corpus_appointment_paraphrase_2", expected: "appointment", candidates: [["appointment", 0.86424536322085]] },
  { id: "corpus_appointment_paraphrase_3", expected: "appointment", candidates: [["appointment", 0.851176977157593]] },
  { id: "corpus_dispatch_paraphrase_1", expected: "dispatch", candidates: [["dispatch", 0.882583975791937], ["invoice", 0.83833749637045], ["appointment", 0.814727116508909]] },
  { id: "corpus_dispatch_paraphrase_2", expected: "dispatch", candidates: [["dispatch", 0.891250795647456], ["invoice", 0.820511842385288], ["appointment", 0.801311612129211]] },
  { id: "corpus_dispatch_paraphrase_3", expected: "dispatch", candidates: [["dispatch", 0.882790684700018], ["invoice", 0.834343150348349], ["appointment", 0.831007351339303]] },
];

test("the 0.035 relative score gap removes observed cross-topic false positives", () => {
  for (const item of observedQueryCandidates) {
    const candidates = item.candidates.map(([fixture_key, similarity]) => ({ fixture_key, similarity }));
    const selected = selectRelevantKnowledgeMatches(candidates, 0.035, 6);
    assert.deepEqual(
      selected.map((match) => match.fixture_key),
      [item.expected],
      "ranking contract failed for " + item.id,
    );
  }
});

test("records inside the score gap remain available as multi-record evidence", () => {
  const matches = [
    { fixture_key: "primary", similarity: 0.91 },
    { fixture_key: "supporting", similarity: 0.889 },
    { fixture_key: "weak_tail", similarity: 0.869 },
  ];
  assert.deepEqual(
    selectRelevantKnowledgeMatches(matches, 0.035, 10).map((match) => match.fixture_key),
    ["primary", "supporting"],
  );
});

test("ties preserve input order and result limits are enforced", () => {
  const matches = Array.from({ length: 12 }, (_, index) => ({
    fixture_key: "fixture-" + index,
    similarity: 0.9,
  }));
  assert.deepEqual(
    selectRelevantKnowledgeMatches(matches, 0.035, 3).map((match) => match.fixture_key),
    ["fixture-0", "fixture-1", "fixture-2"],
  );
});

test("invalid scores and invalid inputs cannot enter the evidence set", () => {
  assert.deepEqual(
    selectRelevantKnowledgeMatches([
      { fixture_key: "bad", similarity: "not-a-number" },
      { fixture_key: "too-high", similarity: 1.1 },
      { fixture_key: "too-low", similarity: -0.1 },
      { fixture_key: "valid", similarity: 0.86 },
    ]).map((match) => match.fixture_key),
    ["valid"],
  );
  assert.deepEqual(selectRelevantKnowledgeMatches(null), []);
  assert.deepEqual(selectRelevantKnowledgeMatches([]), []);
});
