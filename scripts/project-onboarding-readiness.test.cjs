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
  const context = { state: { clientOnboarding: onboarding, clientOnboardingAssets: assets, tasks: [] } };
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
const taskSummaryStart = source.indexOf("function projectTaskSummary(project) {");
const taskSummaryEnd = source.indexOf("\n    function renderProjects()", taskSummaryStart);
assert.ok(taskSummaryStart >= 0 && taskSummaryEnd > taskSummaryStart, "Project task summary helper must exist.");

function taskSummary(project, tasks, overdueDates) {
  const context = {
    state: { tasks },
    isOverdue: (date) => overdueDates.includes(date)
  };
  vm.runInNewContext(source.slice(taskSummaryStart, taskSummaryEnd) + "\nthis.projectTaskSummary = projectTaskSummary;", context);
  return JSON.parse(JSON.stringify(context.projectTaskSummary(project)));
}

assert.deepEqual(taskSummary({ id: "project-1" }, [], []), {
  total: 0, completed: 0, open: 0, overdue: 0, percent: 0
});
assert.deepEqual(taskSummary({ id: "project-1" }, [
  { project_id: "project-1", status: "completed", due_date: "2026-11-26" },
  { project_id: "project-1", status: "in progress", due_date: "2026-11-27" },
  { project_id: "project-1", status: "todo", due_date: "2026-12-02" },
  { project_id: "other-project", status: "todo", due_date: "2026-11-27" }
], ["2026-11-27"]), {
  total: 3, completed: 1, open: 2, overdue: 1, percent: 33
});
assert.match(source, /Task execution/);
assert.match(source, /taskSummary\.overdue/);
assert.match(source, /data-project-timeline/);
process.stdout.write("Project onboarding and task execution readiness checks passed.\n");
