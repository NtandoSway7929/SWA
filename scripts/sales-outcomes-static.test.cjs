"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const workspace = fs.readFileSync(path.join(root, "admin-dashboard", "admin-workspace.js"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase", "swayphics-sales-communication-outcomes.sql"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "supabase", "swayphics-admin-workspace.sql"), "utf8");
const localSchema = fs.readFileSync(path.join(root, "tests", "admin-table-controls-db", "schema.sql"), "utf8");
const browserTest = fs.readFileSync(path.join(root, "scripts", "admin-table-controls-dashboard-smoke.cjs"), "utf8");
const dbTest = fs.readFileSync(path.join(root, "scripts", "admin-table-controls-db-smoke.cjs"), "utf8");

const outcomes = [
  "not_recorded",
  "no_reply_yet",
  "positive_reply",
  "neutral_reply",
  "negative_reply",
  "meeting_agreed",
  "proposal_requested",
  "follow_up_requested",
  "opt_out",
  "opt_in_confirmed",
  "invalid_contact",
  "other"
];

assert.match(migration, /add column if not exists outcome text not null default 'not_recorded'/,
  "Migration must add outcome idempotently and default to an explicit unknown state.");
assert.match(bootstrap, /outcome text not null default 'not_recorded'/,
  "Bootstrap schema must define the communication outcome.");
assert.match(localSchema, /create table public\.communication_logs/,
  "Disposable schema must include communication logs.");
assert.match(localSchema, /alter table public\.communication_logs enable row level security/,
  "Communication logs must retain row-level security in local test schema.");
assert.match(localSchema, /Local test admins can manage communication logs/,
  "Communication outcome table must use the admin-only RLS policy.");

for (const outcome of outcomes) {
  const quoted = new RegExp("'" + outcome + "'");
  assert.match(migration, quoted, "Migration must constrain outcome " + outcome + ".");
  assert.match(bootstrap, quoted, "Bootstrap must constrain outcome " + outcome + ".");
  assert.match(localSchema, quoted, "Disposable schema must constrain outcome " + outcome + ".");
  assert.ok(workspace.includes('value: "' + outcome + '"'), "Communication editor must offer outcome " + outcome + ".");
}

assert.match(workspace, /key: "outcome"/, "Communication editor must capture recorded outcome.");
assert.match(workspace, /function renderSalesOutcomeAnalytics\(/, "Insights must provide sales outreach outcome metrics.");
assert.match(workspace, /30 \* 24 \* 60 \* 60 \* 1000/, "Outreach metrics must use a defined rolling 30-day window.");
assert.match(workspace, /No reply is not treated as rejection/, "Metrics must not infer rejection from silence.");
assert.match(workspace, /function isContactOptedOut\(/, "Opt-out state must be calculated from recorded consent events.");
assert.match(workspace, /isContactOptedOut\("lead", lead\.id\)/, "Opted-out leads must be excluded from the sales work queue.");
assert.match(workspace, /contactOutreachSuppressionReason\(/, "Email composer must check recorded suppression state.");
assert.match(workspace, /This contact is recorded as opted out/, "Suppression must provide an explicit reason.");
assert.match(workspace, /label: "Outcome"/, "Communication table must display each recorded outcome.");
assert.match(browserTest, /Synthetic opt-out fixture/, "Browser test must create a synthetic opt-out record through the UI.");
assert.match(browserTest, /must prevent opening a new email composer/, "Browser test must verify the email suppression safeguard.");
assert.match(dbTest, /explicit opt-out outcome should persist/, "Database test must verify authenticated outcome persistence.");
assert.match(dbTest, /hiddenCommunications/, "Database test must verify communication outcome RLS.");
assert.match(dbTest, /unsupported communication outcomes/, "Database test must reject invalid outcomes.");

console.log("Sales communication outcome static checks passed.");
