import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ui = require("../admin-dashboard/innerme-intelligent-ui.js");
const css = await readFile(new URL("../admin-dashboard/innerme-intelligent-ui.css", import.meta.url), "utf8");
assert.equal(ui.classifyText("Step 1: Identify the leads. Step 2: Prepare an action plan."), "plan");
assert.equal(ui.classifyText("Net profit = revenue minus expenses."), "calculation");
assert.equal(ui.classifyText("It is not specified in the source."), "evidence");
assert.equal(ui.parseNumericCell("R5,700"), 5700);
assert.equal(ui.parseNumericCell("-R 300"), -300);
assert.equal(ui.parseNumericCell("N/A"), null);
assert.deepEqual(ui.extractTableSeries([["Period","Subtotal"],["Discounted","R1,200"],["Full price","R4,500"],["Total","R5,700"]]), {
  title:"Subtotal", points:[{label:"Discounted",value:1200},{label:"Full price",value:4500},{label:"Total",value:5700}]
});
assert.equal(ui.extractTableSeries([["Name","Status"],["A","draft"],["B","done"]]), null);
assert.equal(ui.parseOptInPayload(JSON.stringify({innerme_ui:{version:1,kind:"metrics",title:"Summary",metrics:[{label:"Revenue",value:"R850"}]}})).kind, "metrics");
assert.equal(ui.parseOptInPayload(JSON.stringify({innerme_ui:{version:99,kind:"metrics"}})), null);
assert.equal(ui.parseOptInPayload(JSON.stringify({innerme_ui:{version:1,kind:"chart",chart:{points:[{label:"x",value:"bad"}]}}})), null);
assert.equal(ui.parseOptInPayload("<img src=x onerror=alert(1)>"), null);
assert.match(css,/prefers-reduced-motion/);
assert.match(css,/:focus-visible/);
assert.match(css,/@media\(max-width:600px\)/);
console.log("PASS: InnerMe Intelligent UI parser, response classification, chart extraction, and safe payload validation.");
