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

assert.ok(
    workspaceSource.includes('(item.client_id ? clientHealthChip(item.client_id) : "—")'),
    "task Client health should use the linked client's ID and stay neutral when no client is linked"
);

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
assert.match(moduleSource, /announceFeedback\(view, "Completing " \+ eligible\.length/,
    "bulk actions should announce their in-progress state through the existing live feedback region");
assert.match(moduleSource, /The next update failed\. Remaining records stay selected/,
    "partial failures should retain a safe retry path and explain what happened");
assert.doesNotMatch(moduleSource, /error && error\.message \? error\.message/,
    "raw backend/provider error details must not be surfaced directly in the dashboard UI");

const invoiceSaveStart = workspaceSource.indexOf("async function saveInvoice(");
const invoiceSaveEnd = workspaceSource.indexOf("\n    function base64ToBytes", invoiceSaveStart);
assert.ok(invoiceSaveStart >= 0 && invoiceSaveEnd > invoiceSaveStart,
    "invoice save handler should remain available for regression checks");
const invoiceSaveSource = workspaceSource.slice(invoiceSaveStart, invoiceSaveEnd);
assert.match(invoiceSaveSource, /saveButton\.setAttribute\("aria-busy", "true"\)/,
    "invoice actions should expose an accessible busy state while saving");
assert.match(invoiceSaveSource, /Saving & sending…/,
    "the send action should clearly announce its in-progress state");
assert.match(invoiceSaveSource, /finally \{[\s\S]*saveButton\.removeAttribute\("aria-busy"\)/,
    "invoice action buttons must always have their busy state cleared");
assert.match(invoiceSaveSource, /The form is still open[\s\S]*check its status before retrying/,
    "invoice failures should preserve the form and warn users to verify send status before retrying");
assert.doesNotMatch(invoiceSaveSource, /swayAlert\(\s*error\.message/,
    "invoice save errors should not expose raw backend exception text");
assert.match(workspaceSource, /let pendingInvoiceId = invoice && invoice\.id \? invoice\.id : null;/,
    "the invoice modal should retain the invoice ID across retry attempts");
assert.match(invoiceSaveSource, /let savedId = pendingInvoiceId;/,
    "retrying a partially completed invoice save should update the existing invoice");
assert.match(invoiceSaveSource, /pendingInvoiceId = savedId;/,
    "a newly created invoice ID should be retained before subsequent steps can fail");
assert.ok(
    invoiceSaveSource.indexOf("await refreshData();") < invoiceSaveSource.indexOf("closeModal();"),
    "the invoice form should remain open until refresh completes successfully"
);


assert.match(workspaceSource, /let pendingInvoiceSent = false;/,
    "the invoice modal should remember when the send endpoint has already succeeded");
assert.match(invoiceSaveSource, /if \(shouldSend && !pendingInvoiceSent\)/,
    "retrying a post-send failure must not dispatch the invoice send action again");
assert.match(invoiceSaveSource, /await invokeInvoiceFunction\(savedId, "send"\);\s*pendingInvoiceSent = true;/,
    "the sent flag must be set immediately after the send endpoint succeeds, before later logging or refresh work");
assert.match(workspaceSource, /let pendingInvoiceActivityLogged = false;/,
    "invoice activity logging should have independent retry state");
assert.match(workspaceSource, /let pendingInvoiceChangeActivityLogged = false;/,
    "invoice create/update activity logging should retain retry state");
assert.match(invoiceSaveSource, /if \(!pendingInvoiceChangeActivityLogged\) \{\s*await logActivity\([\s\S]*?pendingInvoiceChangeActivityLogged = true;/,
    "a successful create/update activity entry must not be duplicated when a later step fails");
assert.match(invoiceSaveSource, /if \(shouldSend && pendingInvoiceSent && !pendingInvoiceActivityLogged\)/,
    "a retry after activity logging fails must log the activity without resending the invoice");
assert.match(invoiceSaveSource, /await logActivity\([\s\S]*?\);\s*pendingInvoiceActivityLogged = true;/,
    "the activity-logged flag must only be set after the log operation succeeds");
assert.ok(
    invoiceSaveSource.indexOf("pendingInvoiceSent = true;") <
    invoiceSaveSource.indexOf("if (shouldSend && pendingInvoiceSent && !pendingInvoiceActivityLogged)"),
    "delivery state must be recorded before the independently retryable activity log"
);
assert.match(invoiceSaveSource, /if \(!selectedClient \|\| !selectedClient\.email\)/,
    "the direct send path must still validate that the selected client has an email address");

console.log("Admin table controls tests passed.");
