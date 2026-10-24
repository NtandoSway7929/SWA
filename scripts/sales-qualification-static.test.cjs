"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const workspace = fs.readFileSync(path.join(root, "admin-dashboard", "admin-workspace.js"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase", "swayphics-sales-qualification.sql"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "supabase", "swayphics-admin-workspace.sql"), "utf8");
const localSchema = fs.readFileSync(path.join(root, "tests", "admin-table-controls-db", "schema.sql"), "utf8");

const qualificationFields = [
  "business_segment",
  "service_fit",
  "website_need",
  "contactability",
  "buying_signal",
  "qualification_priority",
  "qualification_evidence_url",
  "qualification_reviewed_at",
  "qualification_reviewed_by"
];

for (const field of qualificationFields) {
  assert.match(migration, new RegExp("add column if not exists " + field), "Migration must add " + field + " idempotently.");
  assert.match(bootstrap, new RegExp("\\b" + field + "\\b"), "Bootstrap schema must define " + field + ".");
  assert.match(localSchema, new RegExp("\\b" + field + "\\b"), "Disposable database schema must include " + field + ".");
}

assert.match(workspace, /key: "business_segment"/, "Lead editor must capture business segment.");
assert.match(workspace, /key: "service_fit"/, "Lead editor must capture scope and capacity fit explicitly.");
assert.match(workspace, /key: "website_need"/, "Lead editor must capture website need.");
assert.match(workspace, /key: "contactability"/, "Lead editor must capture contactability.");
assert.match(workspace, /key: "buying_signal"/, "Lead editor must capture buying signals.");
assert.match(workspace, /key: "qualification_priority"/, "Lead editor must capture explicit priority.");
assert.match(workspace, /key: "qualification_evidence_url"[\s\S]{0,180}type: "url"/, "Evidence URL must use URL validation.");
assert.match(workspace, /qualification_reviewed_at = now/, "Changes to qualification data must be timestamped.");
assert.match(workspace, /qualification_reviewed_by = state\.currentUser\.id/, "Changes to qualification data must record the reviewing admin.");
assert.match(workspace, /Human-set, not an AI score/, "Priority labels must explain that they are human-set.");
assert.match(workspace, /label: "Lead source \/ channel"/, "Source field must be clarified.");
assert.match(workspace, /This is not a campaign name or a contact attempt/, "Source field help must distinguish source from campaigns and outreach.");
assert.match(migration, /default 'unknown'/, "Existing rows and new records must default to unknown rather than a guessed qualification.");
assert.match(migration, /default 'unassessed'/, "Priority must default to unassessed.");
assert.match(migration, /on delete set null/, "Reviewer deletion must not delete a lead.");

console.log("Sales qualification static checks passed.");
