"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(
    path.join(root, "admin-dashboard", "admin-row-action-accessibility.js"),
    "utf8"
);
const html = fs.readFileSync(
    path.join(root, "admin-dashboard", "index.html"),
    "utf8"
);
const dashboardSmoke = fs.readFileSync(
    path.join(root, "scripts", "admin-table-controls-dashboard-smoke.cjs"),
    "utf8"
);

const workspaceScript = html.indexOf('src="admin-workspace.js');
const accessibilityScript = html.indexOf('src="admin-row-action-accessibility.js');
assert.ok(workspaceScript >= 0 && accessibilityScript > workspaceScript,
    "row-action accessible names must be enhanced after the workspace creates its rows");
assert.ok(
    html.includes('src="admin-row-action-accessibility.js?v=20261107-row-action-accessible-names-1"'),
    "the row-action accessibility module must use a cache-busted script URL"
);

assert.ok(script.includes('cell.classList.contains("sway-admin-table-select-cell")'),
    "selection controls must not be mistaken for a record identifier");
assert.ok(script.includes('cell.querySelector(".sway-row-actions, .sway-lead-row-actions")'),
    "the action column must be excluded when deriving the record label");
assert.ok(script.includes('cell.querySelector("strong")') &&
    script.includes('"Actions for " + recordLabel'),
    "each disclosure must be named from the record's primary visible value");
assert.ok(script.includes('summary.hasAttribute("aria-label") && !generated'),
    "an explicitly authored accessible name must not be overwritten");
assert.ok(script.includes("new MutationObserver"),
    "newly rendered rows must receive accessible names after workspace navigation");
assert.ok(script.includes('mutation.target.closest("tr")'),
    "the accessible name must refresh when a record's primary cell is updated in place");

assert.ok(dashboardSmoke.includes('.sway-lead-actions-menu > summary'),
    "the actual-dashboard smoke must assert a lead row action name");
assert.ok(dashboardSmoke.includes('.sway-actions-menu > summary'),
    "the actual-dashboard smoke must assert a standard row action name");

console.log("Admin row-action accessibility contract tests passed.");
