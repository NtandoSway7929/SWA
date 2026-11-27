"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
    path.join(root, "supabase/migrations/20261128090000_lead_proposal_revision_history.sql"),
    "utf8"
);
const testSql = fs.readFileSync(
    path.join(root, "supabase/tests/lead-proposal-revisions.test.sql"),
    "utf8"
);

for (const contract of [
    "create table if not exists public.lead_proposal_versions",
    "unique (proposal_id, version_number)",
    "enable row level security",
    "public.is_swayphics_admin()",
    "revoke all on table public.lead_proposal_versions",
    "create or replace function public.prepare_lead_proposal_version()",
    "create or replace function public.capture_lead_proposal_version()",
    "create or replace function public.prevent_lead_proposal_version_update()",
    "new.current_version := old.current_version + 1",
    "Create a draft revision before editing an approved or rejected proposal.",
    "Lead proposal revision history is immutable."
]) {
    assert.ok(migration.includes(contract), "migration must include: " + contract);
}

for (const scenario of [
    "proposal creation captures the first immutable snapshot",
    "saving structured proposal sections increments the current version",
    "approval state is captured as its own immutable snapshot",
    "approved proposal content cannot be overwritten without reopening a draft revision",
    "a stored proposal snapshot cannot be updated",
    "a stored proposal snapshot cannot be deleted",
    "saving the reopened draft creates the next immutable revision"
]) {
    assert.ok(testSql.includes(scenario), "database regression coverage must include: " + scenario);
}

console.log("Lead proposal revision migration contract tests passed.");
