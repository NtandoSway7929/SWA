"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workspace = fs.readFileSync(path.join(root, "admin-dashboard", "admin-workspace.js"), "utf8");
const html = fs.readFileSync(path.join(root, "admin-dashboard", "index.html"), "utf8");

const insightsStart = workspace.indexOf("function renderInsights() {");
assert.ok(insightsStart >= 0, "Insights renderer must exist.");
const insightsEnd = workspace.indexOf("\n    function ", insightsStart + 20);
const insightsRenderer = workspace.slice(insightsStart, insightsEnd > insightsStart ? insightsEnd : undefined);
const conversionStart = workspace.indexOf("function renderLeadConversionAnalytics()");
const sourceStart = workspace.indexOf("function renderLeadSourceAnalytics()", conversionStart);
assert.ok(conversionStart >= 0, "Insights must define its lead conversion analytics renderer.");
assert.ok(sourceStart > conversionStart, "lead conversion renderer must end before lead source analytics.");
const conversionRenderer = workspace.slice(conversionStart, sourceStart);

assert.ok(insightsRenderer.includes("renderLeadConversionAnalytics()"), "Insights must include the lead conversion analytics panel.");
assert.ok(conversionRenderer.includes("state.leadStageHistory.forEach"), "historical stage movement must use recorded lead-stage history.");
assert.ok(conversionRenderer.includes("stageCounts[entry.to_status].add("), "a lead must be counted once per historical stage it entered.");
assert.ok(conversionRenderer.includes("lead.status === stage"), "current-stage counts must use each lead current status.");
assert.ok(conversionRenderer.includes("businessConversionGauge()"), "the existing won-lead share gauge must be retained.");
assert.match(conversionRenderer, /not a cohort conversion rate/i, "the cohort-measurement caveat must remain visible.");
for (const stage of ["new", "contacted", "follow-up", "interested", "proposal sent", "negotiating", "won", "lost"]) {
  assert.ok(conversionRenderer.includes("\"" + stage + "\""), "pipeline stage must remain: " + stage);
}
assert.ok(html.includes("admin-workspace.js?v=20261110-settings-tab-order-icon-1"), "workspace script must use a fresh cache key.");
console.log("Insights lead conversion analytics contract tests passed.");
