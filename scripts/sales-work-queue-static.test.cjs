"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workspacePath = path.join(__dirname, "..", "admin-dashboard", "admin-workspace.js");
const source = fs.readFileSync(workspacePath, "utf8");

assert.match(source, /\["sales-work-queue",\s*"Sales Work Queue"\]/, "Sales Work Queue must be discoverable in admin navigation.");
assert.match(source, /function renderSalesWorkQueue\(\)/, "Sales queue renderer must exist.");
assert.match(source, /state\.currentView === "sales-work-queue"[\s\S]{0,100}renderSalesWorkQueue\(\)/, "Sales queue view must be routed.");
assert.match(source, /followup\.status !== "pending"/, "Completed/skipped follow-ups must not enter the due queue.");
assert.match(source, /\["won", "lost", "not interested"\]/, "Closed/disqualified leads must be excluded from routine lead actions.");
assert.match(source, /quote\.status !== "sent"/, "Only sent quotes should appear as awaiting a response.");
assert.match(source, /data-edit="leads"/, "Lead queue actions must link back to existing lead edit flows.");
assert.match(source, /data-view-target="followups"/, "Client follow-up actions must link to the existing follow-up view.");
assert.match(source, /does not send messages or change records/i, "The queue must explicitly remain read-only.");
assert.doesNotMatch(
  source.slice(source.indexOf("function renderSalesWorkQueue()"), source.indexOf("function renderLeads()")),
  /\.insert\(|\.update\(|\.delete\(|fetch\(/,
  "Rendering the sales queue must not write to the database or call external endpoints."
);

console.log("Sales work queue static checks passed.");
