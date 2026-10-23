"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const modulePath = path.join(__dirname, "..", "admin-dashboard", "admin-table-controls.js");
const moduleSource = fs.readFileSync(modulePath, "utf8");
const workspaceSource = fs.readFileSync(
    path.join(__dirname, "..", "admin-dashboard", "admin-workspace.js"), "utf8"
);
const dashboardHtml = fs.readFileSync(
    path.join(__dirname, "..", "admin-dashboard", "index.html"), "utf8"
);
const controlsScriptIndex = dashboardHtml.indexOf('src="admin-table-controls.js');
const workspaceScriptIndex = dashboardHtml.indexOf('src="admin-workspace.js');
assert.ok(controlsScriptIndex >= 0 && workspaceScriptIndex > controlsScriptIndex,
    "the table controls module must load before the dashboard workspace");
for (const view of ["leads", "followups", "tasks"]) {
    assert.ok(workspaceSource.includes('adminTableControls.renderControls("' + view + '")'),
        view + " view must render the table controls");
    assert.ok(workspaceSource.includes('adminTableControls.items("' + view + '", state.' + view + ")"),
        view + " view must use the shared filter/sort pipeline");
    assert.ok(workspaceSource.includes('adminTableControls.selectionCell("' + view + '"'),
        view + " view must render selection checkboxes");
}
assert.ok(workspaceSource.includes("adminTableControls.bind();"),
    "dashboard view lifecycle must bind the table controls after rendering");

global.window = {};
require(modulePath);
assert.equal(typeof global.window.createSwayphicsAdminTableControls, "function");

const state = {
    tableControls: {
        leads: { search: "", filter: "all", sort: "value_desc" },
        tasks: { search: "", filter: "all", sort: "priority_desc" },
        followups: { search: "", filter: "all", sort: "scheduled_asc" }
    },
    tableSelection: { leads: ["lead-mid"], tasks: [], followups: [] },
    tableFeedback: { leads: "", tasks: "", followups: "" },
    tableBulkActionRunning: false,
    leads: [
        { id: "lead-low", business_name: "Alpha", contact_name: "Sam", email: "sam@example.com", status: "new", estimated_value: 250, next_follow_up: "2026-11-03" },
        { id: "lead-high", business_name: "Zulu", contact_name: "Lee", email: "lee@example.com", status: "won", estimated_value: 2000, next_follow_up: "2026-10-25" },
        { id: "lead-mid", business_name: "Bravo", contact_name: "Ana", email: "ana@example.com", status: "new", estimated_value: 900, next_follow_up: "2026-10-26" }
    ],
    tasks: [
        { id: "task-low", title: "Low priority task", priority: "low", status: "todo", due_date: "2026-11-01" },
        { id: "task-urgent", title: "Urgent task", priority: "urgent", status: "todo", due_date: "2026-11-03" },
        { id: "task-high", title: "High priority task", priority: "high", status: "completed", due_date: "2026-10-25" }
    ],
    followups: [
        { id: "followup-later", lead_id: "lead-low", channel: "Email", status: "pending", scheduled_for: "2026-11-02", note: "call later" },
        { id: "followup-sooner", lead_id: "lead-mid", channel: "WhatsApp", status: "pending", scheduled_for: "2026-10-24" },
        { id: "followup-done", lead_id: "lead-high", channel: "Email", status: "completed", scheduled_for: "2026-10-23" }
    ],
    clients: [],
    admins: []
};

const workspace = {
    querySelector: () => null,
    querySelectorAll: () => []
};
const controls = global.window.createSwayphicsAdminTableControls({
    state,
    workspace,
    esc(value) {
        return String(value === null || typeof value === "undefined" ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    },
    adminName: () => "Admin",
    clientName: id => "Client " + id,
    leadName: id => ({ "lead-low": "Alpha", "lead-mid": "Bravo", "lead-high": "Zulu" }[id] || "Unknown"),
    formatDisplayText: value => String(value).replace(/_/g, " "),
    completeTask: async () => {},
    completeFollowup: async () => {},
    renderView: () => {},
    swayAlert: () => {},
    swayConfirm: async () => true
});

assert.deepEqual(
    controls.items("leads", state.leads).map(item => item.id),
    ["lead-high", "lead-mid", "lead-low"],
    "lead estimated-value sort should order highest value first"
);

state.tableControls.leads.filter = "new";
assert.deepEqual(
    controls.items("leads", state.leads).map(item => item.id),
    ["lead-mid", "lead-low"],
    "lead status filter should retain only matching records"
);

state.tableControls.leads.filter = "all";
assert.match(
    controls.searchText("leads", state.leads[0]),
    /sam@example\.com/,
    "lead search text should include email addresses"
);

assert.deepEqual(
    controls.items("tasks", state.tasks).map(item => item.id),
    ["task-urgent", "task-high", "task-low"],
    "task priority sort should put urgent and high priorities first"
);

state.tableControls.followups.filter = "pending";
assert.deepEqual(
    controls.items("followups", state.followups).map(item => item.id),
    ["followup-sooner", "followup-later"],
    "follow-up status filtering and scheduled-date ordering should work together"
);

assert.match(
    controls.searchText("followups", state.followups[0]),
    /call later/,
    "follow-up search text should read the database's singular note field"
);

const selectedCheckbox = controls.selectionCell("leads", state.leads[2], "A&B");
assert.match(selectedCheckbox, /data-admin-table-select="leads"/);
assert.match(selectedCheckbox, /checked/);
assert.match(selectedCheckbox, /A&amp;B/);

state.tableControls.tasks.filter = "todo";
const pendingFilterMarkup = controls.renderControls("tasks");
assert.match(pendingFilterMarkup, /<option value="todo" selected>todo<\/option>/);
state.tasks = state.tasks.filter(item => item.status !== "todo");
const staleTodoFilterMarkup = controls.renderControls("tasks");
assert.match(staleTodoFilterMarkup, /<option value="todo" selected>todo<\/option>/,
    "the active filter must stay represented when no records currently match it");
assert.deepEqual(controls.items("tasks", state.tasks), [],
    "preserving a stale filter must not silently reset the actual record filter");

const controlsMarkup = controls.renderControls("leads");
assert.match(controlsMarkup, /data-admin-table-search-input="leads"/);
assert.match(controlsMarkup, /data-admin-table-filter="leads"/);
assert.match(controlsMarkup, /data-admin-table-sort="leads"/);
assert.match(controlsMarkup, /Export selected CSV/);
assert.match(moduleSource, /const selectedIds = new Set\(\(state\.tableSelection\[view\] \|\| \[\]\)\.map\(String\)\)/,
    "the UI should re-sync checkbox visuals from the selected-record state");
assert.ok(moduleSource.includes("const formulaLike = /^[\\s\\uFEFF]*[=+\\-@]/.test(raw);"),
    "CSV values that can be interpreted as spreadsheet formulas must be neutralised");

console.log("Admin table controls tests passed.");
