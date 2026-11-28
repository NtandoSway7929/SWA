"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "admin-dashboard", "admin-workspace.js"), "utf8");
const start = source.indexOf("function projectOnboardingSummary(project) {");
const end = source.indexOf("\n    function renderProjects()", start);
assert.ok(start >= 0 && end > start, "Project onboarding summary helper must exist.");

function summary(project, onboarding, assets) {
  const context = { state: { clientOnboarding: onboarding, clientOnboardingAssets: assets } };
  vm.runInNewContext(source.slice(start, end) + "\nthis.projectOnboardingSummary = projectOnboardingSummary;", context);
  return JSON.parse(JSON.stringify(context.projectOnboardingSummary(project)));
}

const project = { id: "project-1", client_id: "client-1" };
assert.deepEqual(summary(project, [], []), { status: "Not started", assetCount: 0 });
assert.deepEqual(summary(project, [{ client_id: "client-1", status: "draft", submitted_at: null }], [
  { client_id: "client-1" }, { client_id: "client-1" }, { client_id: "other-client" }
]), { status: "In progress", assetCount: 2 });
assert.deepEqual(summary(project, [{ client_id: "client-1", status: "submitted", submitted_at: null }], [
  { client_id: "client-1" }
]), { status: "Submitted", assetCount: 1 });
assert.deepEqual(summary(project, [{ client_id: "client-1", status: "draft", submitted_at: "2026-11-28T10:00:00Z" }], []), {
  status: "Submitted", assetCount: 0
});
assert.match(source, /data-project-onboarding=/);
assert.match(source, /openClientOnboarding\(button\.dataset\.projectOnboarding\)/);
assert.match(source, /client_onboarding_assets\?select=\*&order=created_at\.asc/);
process.stdout.write("Project onboarding readiness checks passed.\n");
