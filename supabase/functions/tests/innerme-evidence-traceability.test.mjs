import assert from "node:assert/strict";
import test from "node:test";
import {
  formatInnerMeKnowledgeEvidence,
  INNERME_EVIDENCE_TRACEABILITY_RULES,
} from "../swayphics-ai/innerme-evidence-traceability.mjs";

function cleanForModel(value, max = 3000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

test("retrieved evidence exposes the exact record ID and available source provenance", () => {
  const output = formatInnerMeKnowledgeEvidence({
    id: "knowledge-123",
    title: "Verified conversion principle",
    evidence_level: "established",
    confidence: "high",
    jurisdiction: "Global",
    source_name: "Conversion Research Source",
    source_publisher: "Example Publisher",
    similarity: 0.87654,
    statement: "The explicit statement.",
    application: "The supported application.",
    constraints: "Only applies under stated conditions.",
    do_not_use_when: "Do not apply outside scope.",
    source_url: "https://example.org/source",
  }, 0, cleanForModel);

  assert.match(output, /1\. Verified conversion principle/);
  assert.match(output, /Knowledge record ID: knowledge-123/);
  assert.match(output, /Evidence level: established/);
  assert.match(output, /Confidence: high/);
  assert.match(output, /Source name: Conversion Research Source/);
  assert.match(output, /Publisher: Example Publisher/);
  assert.match(output, /Source URL on record: https:\/\/example\.org\/source/);
  assert.match(output, /Similarity: 0\.877/);
  assert.match(output, /Constraints: Only applies under stated conditions\./);
  assert.match(output, /Do not use when: Do not apply outside scope\./);
});

test("missing provenance is declared missing instead of being fabricated", () => {
  const output = formatInnerMeKnowledgeEvidence({ title: "Untitled source" }, 0, cleanForModel);

  assert.match(output, /Knowledge record ID: not supplied/);
  assert.match(output, /Source name: not supplied/);
  assert.match(output, /Publisher: not supplied/);
  assert.match(output, /Source URL on record: not supplied/);
  assert.match(output, /Constraints: none stated/);
  assert.match(output, /Do not use when: none stated/);
});

test("traceability instructions separate source, evidence, inference and verification", () => {
  assert.match(INNERME_EVIDENCE_TRACEABILITY_RULES, /full knowledge-record ID/);
  assert.match(INNERME_EVIDENCE_TRACEABILITY_RULES, /SOURCE PATH/);
  assert.match(INNERME_EVIDENCE_TRACEABILITY_RULES, /EVIDENCE:/);
  assert.match(INNERME_EVIDENCE_TRACEABILITY_RULES, /Inference:/);
  assert.match(INNERME_EVIDENCE_TRACEABILITY_RULES, /VERIFICATION:/);
  assert.match(INNERME_EVIDENCE_TRACEABILITY_RULES, /runtime verification not established by the available evidence/);
  assert.match(INNERME_EVIDENCE_TRACEABILITY_RULES, /Never invent source IDs, source paths, test names/);
});

test("record IDs and source URLs obey the caller cleaner's explicit length bounds", () => {
  const output = formatInnerMeKnowledgeEvidence({
    id: "x".repeat(200),
    title: "title",
    source_url: "https://example.org/" + "x".repeat(700),
  }, 0, cleanForModel);
  const idLine = output.split("\n").find((line) => line.startsWith("Knowledge record ID:"));
  const urlLine = output.split("\n").find((line) => line.startsWith("Source URL on record:"));

  assert.equal(idLine.length, "Knowledge record ID: ".length + 80);
  assert.equal(urlLine.length, "Source URL on record: ".length + 500);
});

test("the evidence formatter normalizes fields through the supplied cleaner", () => {
  const output = formatInnerMeKnowledgeEvidence({
    title: "  Evidence\n\t title  ",
    statement: "  Supported\n\t statement  ",
  }, 1, cleanForModel);

  assert.match(output, /^2\. Evidence title$/m);
  assert.match(output, /Statement: Supported statement/);
});
