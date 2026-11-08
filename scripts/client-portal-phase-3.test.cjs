"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const portal = fs.readFileSync(path.join(root, "client-portal", "index.html"), "utf8");

const helperStart = portal.indexOf("function projectStage(");
const helperEnd = portal.indexOf("\nfunction activeProjects", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "Project delivery helpers must be isolated for testing.");

const context = {};
vm.runInNewContext(
  'function date(value){return value ? String(value).slice(0,10) : "—";}\n' +
    portal.slice(helperStart, helperEnd) +
    "\nthis.projectStage=projectStage;" +
    "\nthis.projectMilestoneSummary=projectMilestoneSummary;" +
    "\nthis.projectDeadline=projectDeadline;" +
    "\nthis.projectProgress=projectProgress;",
  context
);

test("project status maps to the correct current milestone and next milestone", () => {
  const expected = [
    ["planning", "Planning", "In progress", 0],
    ["in progress", "In progress", "Review", 1],
    ["review", "Review", "Completed", 2],
    ["completed", "Completed", null, 3]
  ];

  for (const [status, current, next, index] of expected) {
    const result = context.projectMilestoneSummary({ status });
    assert.equal(result.current.title, current);
    assert.equal(result.next && result.next.title, next);
    assert.equal(result.currentIndex, index);
    assert.equal(result.progressText, "Stage " + (index + 1) + " of 4: " + current);
  }
});

test("paused and cancelled projects do not appear to be progressing through active milestones", () => {
  for (const status of ["paused", "cancelled"]) {
    const result = context.projectMilestoneSummary({ status });
    assert.equal(result.currentIndex, -1);
    assert.equal(result.current, null);
    assert.equal(result.next, null);
    assert.match(result.statusLabel, /paused|closed/i);
  }
});

test("project progress exposes an accessible stage value, not a fabricated completion percentage", () => {
  const progress = context.projectProgress("review");
  assert.match(progress, /role="progressbar"/);
  assert.match(progress, /aria-valuemin="0"/);
  assert.match(progress, /aria-valuemax="4"/);
  assert.match(progress, /aria-valuenow="3"/);
  assert.match(progress, /Stage 3 of 4: Review/);
  assert.equal(context.projectStage("cancelled"), -1);
});

test("project target-date guidance distinguishes past, today, near and later dates", () => {
  const today = "2026-11-08";
  assert.equal(context.projectDeadline({ status: "in progress", due_date: "2026-11-07" }, today).state, "passed");
  assert.equal(context.projectDeadline({ status: "planning", due_date: today }, today).state, "today");
  assert.equal(context.projectDeadline({ status: "review", due_date: "2026-11-09" }, today).state, "soon");
  assert.equal(context.projectDeadline({ status: "planning", due_date: "2026-11-15" }, today).state, "soon");
  assert.equal(context.projectDeadline({ status: "planning", due_date: "2026-11-20" }, today).state, "scheduled");
});

test("completed, paused and cancelled statuses take precedence over the stored target date", () => {
  const overdueDate = "2026-11-01";
  assert.equal(context.projectDeadline({ status: "completed", due_date: overdueDate }, "2026-11-08").state, "complete");
  assert.equal(context.projectDeadline({ status: "paused", due_date: overdueDate }, "2026-11-08").state, "paused");
  assert.equal(context.projectDeadline({ status: "cancelled", due_date: overdueDate }, "2026-11-08").state, "cancelled");
});

test("missing or invalid dates are not presented as overdue", () => {
  assert.equal(context.projectDeadline({ status: "planning" }, "2026-11-08").state, "unset");
  assert.equal(context.projectDeadline({ status: "planning", due_date: "2026-02-31" }, "2026-11-08").state, "unset");
});

test("the project details modal presents milestone descriptions, schedule context and the next milestone", () => {
  assert.ok(portal.includes('id="portal-project-milestones"'));
  assert.ok(portal.includes('class="project-milestone-list" role="list"'));
  assert.ok(portal.includes("NEXT MILESTONE"));
  assert.ok(portal.includes("PROJECT SCHEDULE"));
  assert.ok(portal.includes("Project overview"));
  assert.ok(portal.includes('aria-current="step"'));
  assert.ok(portal.includes("View milestones"));
});

console.log("Client portal Phase 3 project milestone tests passed.");
