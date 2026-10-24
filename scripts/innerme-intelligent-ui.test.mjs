import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  INNERME_INTELLIGENT_UI_FORMAT_RULES,
  isInnerMeIntelligentUiEnvelope,
  normalizeInnerMeAnswer,
} from "../supabase/functions/swayphics-ai/innerme-intelligent-ui-format.mjs";
const require = createRequire(import.meta.url);
const ui = require("../admin-dashboard/innerme-intelligent-ui.js");
const css = await readFile(new URL("../admin-dashboard/innerme-intelligent-ui.css", import.meta.url), "utf8");
assert.equal(ui.classifyText("Step 1: Identify the leads. Step 2: Prepare an action plan."), "plan");
assert.equal(ui.classifyText("Net profit = revenue minus expenses."), "calculation");
assert.equal(ui.classifyText("It is not specified in the source."), "evidence");
assert.equal(ui.parseNumericCell("R5,700"), 5700);
assert.equal(ui.parseNumericCell("-R 300"), -300);
assert.equal(ui.parseNumericCell("N/A"), null);
assert.equal(ui.parseNumericCell("1,500 impressions"), 1500);
assert.equal(ui.parseNumericCell("3.5 percent"), 3.5);
assert.equal(ui.parseNumericCell("92%"), 92);
assert.equal(ui.parseNumericCell("1 500 users"), 1500);
assert.equal(ui.parseNumericCell("-2.5 percentage"), -2.5);
assert.equal(ui.parseNumericCell("approximately 1,500"), null);
assert.deepEqual(ui.extractTableSeries([
  ["Metric", "Illustrative value"],
  ["Marketing reach", "1,500 impressions"],
  ["Conversion rate", "3.5 percent"],
  ["Customer satisfaction", "92 percent"]
]), {
  title: "Illustrative value",
  points: [
    { label: "Marketing reach", value: 1500 },
    { label: "Conversion rate", value: 3.5 },
    { label: "Customer satisfaction", value: 92 }
  ]
});
assert.deepEqual(ui.extractTableSeries([["Period","Subtotal"],["Discounted","R1,200"],["Full price","R4,500"],["Total","R5,700"]]), {
  title:"Subtotal", points:[{label:"Discounted",value:1200},{label:"Full price",value:4500},{label:"Total",value:5700}]
});
assert.equal(ui.extractTableSeries([["Name","Status"],["A","draft"],["B","done"]]), null);
assert.equal(ui.parseOptInPayload(JSON.stringify({innerme_ui:{version:1,kind:"metrics",title:"Summary",metrics:[{label:"Revenue",value:"R850"}]}})).kind, "metrics");
assert.equal(ui.parseOptInPayload(JSON.stringify({innerme_ui:{version:99,kind:"metrics"}})), null);
assert.equal(ui.parseOptInPayload(JSON.stringify({innerme_ui:{version:1,kind:"chart",chart:{points:[{label:"x",value:"bad"}]}}})), null);
assert.equal(ui.parseOptInPayload("<img src=x onerror=alert(1)>"), null);

const structuredEnvelope = JSON.stringify({
  innerme_ui: {
    version: 1,
    kind: "metrics",
    title: "Synthetic metrics",
    summary: "Illustrative only. Next Steps: verify units before use.",
    metrics: [
      { label: "Marketing reach", value: "1,500 impressions" },
      { label: "Conversion rate", value: "3.5 percent" }
    ]
  }
});
assert.equal(isInnerMeIntelligentUiEnvelope(structuredEnvelope), true);
assert.equal(normalizeInnerMeAnswer(structuredEnvelope), structuredEnvelope,
  "Normalization must not insert newlines into JSON strings or otherwise mutate a valid UI envelope");
const fence = String.fromCharCode(96).repeat(3);
const fencedStructuredEnvelope = fence + "json\n" + structuredEnvelope + "\n" + fence;
assert.equal(isInnerMeIntelligentUiEnvelope(fencedStructuredEnvelope), true,
  "A valid fenced structured envelope should be recognized consistently with the frontend parser");
assert.equal(normalizeInnerMeAnswer(fencedStructuredEnvelope), fencedStructuredEnvelope,
  "Normalization must preserve a valid fenced structured envelope verbatim");
assert.equal(isInnerMeIntelligentUiEnvelope(JSON.stringify({
  innerme_ui: { version: 2, kind: "metrics", metrics: [{ label: "x", value: "y" }] }
})), false, "Unsupported structured UI versions must be rejected");
assert.equal(isInnerMeIntelligentUiEnvelope(JSON.stringify({
  innerme_ui: { version: 1, kind: "chart", chart: { points: [{ label: "bad", value: "12" }] } }
})), false, "Chart values must be finite JSON numbers");
assert.equal(normalizeInnerMeAnswer("Line one\r\nLine two   "), "Line one\nLine two",
  "Plain-text normalization must retain its legacy whitespace behavior");
assert.match(INNERME_INTELLIGENT_UI_FORMAT_RULES, /Use the existing concise natural-language format by default/);
assert.match(INNERME_INTELLIGENT_UI_FORMAT_RULES, /Never combine unlike measures/);
assert.match(INNERME_INTELLIGENT_UI_FORMAT_RULES, /inline source\/citation formatting/);

assert.match(css,/prefers-reduced-motion/);
assert.match(css,/:focus-visible/);
assert.match(css,/@media\(max-width:600px\)/);
console.log("PASS: InnerMe Intelligent UI parser, response classification, chart extraction, and safe payload validation.");
