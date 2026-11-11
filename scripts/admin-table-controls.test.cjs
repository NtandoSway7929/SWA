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
assert.match(dashboardHtml, /admin-workspace\.css\?v=20261110-text-only-status-pills-1/,
    "the updated table toolbar styles must use a refreshed workspace stylesheet cache key");
for (const view of ["leads", "followups", "tasks", "communications"]) {
    assert.ok(workspaceSource.includes('adminTableControls.renderControls("' + view + '")'),
        view + " view must render the table controls");
    assert.ok(workspaceSource.includes('adminTableControls.items("' + view + '", state.' + view + ")"),
        view + " view must use the shared filter/sort pipeline");
    if (view === "leads") {
        assert.match(workspaceSource, /data-admin-table-select="leads"/,
            "lead cards must render the shared selection checkbox contract");
    } else {
        assert.ok(workspaceSource.includes('data-admin-table-select="' + view + '"'),
            view + " card view must render the shared selection checkbox contract");
    }
}
assert.ok(workspaceSource.includes("adminTableControls.bind();"),
    "dashboard view lifecycle must bind the table controls after rendering");
assert.ok(moduleSource.includes("state.admins"),
    "assignee options must use the administrator data already loaded in dashboard state");
assert.ok(moduleSource.includes("state.currentUser && state.currentUser.id"),
    "Assigned to me must use the authenticated user ID in dashboard state");
assert.match(workspaceSource, /data-toggle-lead-contacted=/,
    "each eligible lead row should expose the contacted toggle in its Actions dropdown");
const bulkDeleteHandlerIndex = workspaceSource.indexOf("async function deleteSelectedTableRecords(view, ids)");
assert.ok(bulkDeleteHandlerIndex >= 0,
    "the dashboard must define the authenticated generic bulk-delete handler");
const bulkDeleteHandlerSource = workspaceSource.slice(bulkDeleteHandlerIndex, bulkDeleteHandlerIndex + 3600);
assert.match(bulkDeleteHandlerSource, /method: "DELETE"/,
    "bulk deletion must use the authenticated Supabase API helper");
assert.match(bulkDeleteHandlerSource, /return=representation/,
    "bulk deletion must verify each requested row was actually deleted");
assert.match(bulkDeleteHandlerSource, /logActivity\("Deleted " \+ target\.label, target\.table, id\)/,
    "each successful deletion must be written to the activity log");
assert.match(workspaceSource, /deleteLeads: function \(ids\)[\s\S]*?deleteRecords: deleteSelectedTableRecords/,
    "leads and the other eligible lists must use the shared safe deletion helper");
assert.match(workspaceSource, /communications: \{ table: "communication_logs"/,
    "communication log bulk deletion must target communication_logs");
assert.match(workspaceSource, /data-email-bulk-delete/,
    "the Email inbox must expose a separate selected-conversation delete action");
assert.match(workspaceSource, /functions\/v1\/delete-email-messages/,
    "the Email inbox must use its identity-checked server-side deletion function");
assert.match(workspaceSource, /Incoming messages will also be removed from the connected HOSTAFRICA mailbox/,
    "the inbox confirmation must disclose deletion from the connected mailbox");
assert.match(workspaceSource, /contactStatus\.source === "communication"[\s\S]*?data-toggle-lead-contacted=/,
    "leads with outbound communication records should be distinguished from manual contact marks");
assert.match(workspaceSource, /contactStatus\.contacted \? "Undo contacted mark" : "Mark as contacted"/,
    "the lead contact action should offer the correct mark or undo label");

const leadServiceFieldIndex = workspaceSource.indexOf('key: "service_interest"');
const leadStatusFieldIndex = workspaceSource.indexOf('key: "status"', leadServiceFieldIndex);
assert.ok(leadServiceFieldIndex >= 0 && leadStatusFieldIndex > leadServiceFieldIndex,
    "the lead editor must expose an explicit status selector");
const leadStatusEditorSource = workspaceSource.slice(leadStatusFieldIndex, leadStatusFieldIndex + 900);
assert.match(leadStatusEditorSource, /"follow-up"/,
    "the lead status selector must preserve the existing follow-up status instead of defaulting to new");
const followupCompletionSource = workspaceSource.slice(
    workspaceSource.indexOf("async function completeFollowup"),
    workspaceSource.indexOf("async function markLeadNotInterested")
);
assert.ok(followupCompletionSource.includes("last_contacted_at"),
    "completing a lead follow-up must record when contact happened");
assert.match(followupCompletionSource, /next_follow_up:[\s\S]{0,80}null/,
    "completing a scheduled follow-up should clear its now-completed lead-level due date");
assert.doesNotMatch(followupCompletionSource, /status:\s*"contacted"/,
    "completing a follow-up task must not overwrite the lead's sales status");
assert.match(workspaceSource, /querySelectorAll\("\[data-toggle-lead-contacted\]"\)/,
    "the existing lead-contact click handler should bind the restored action");

assert.ok(
    workspaceSource.includes('(item.client_id ? clientHealthChip(item.client_id) : "—")'),
    "task Client health should use the linked client's ID and stay neutral when no client is linked"
);

global.window = {};
require(modulePath);
assert.equal(typeof global.window.createSwayphicsAdminTableControls, "function");

const state = {
    tableControls: {
        leads: { search: "", filter: "all", sort: "value_desc", assigneeFilter: "all" },
        tasks: { search: "", filter: "all", sort: "priority_desc", assigneeFilter: "all" },
        followups: { search: "", filter: "all", sort: "scheduled_asc", assigneeFilter: "all" },
        communications: { search: "", filter: "all", sort: "contacted_desc" },
        invoices: { search: "", filter: "all", sort: "invoice_due_asc" }
    },
    tableSelection: { leads: ["lead-mid"], tasks: [], followups: [], communications: [], invoices: [] },
    tableFeedback: { leads: "", tasks: "", followups: "", communications: "", invoices: "" },
    tableBulkActionRunning: false,
    leads: [
        { id: "lead-low", business_name: "Alpha", contact_name: "Sam", email: "sam@example.com", status: "new", estimated_value: 250, next_follow_up: "2026-11-03", assigned_to: "admin-me" },
        { id: "lead-high", business_name: "Zulu", contact_name: "Lee", email: "lee@example.com", status: "won", estimated_value: 2000, next_follow_up: "2026-10-25", assigned_to: null },
        { id: "lead-mid", business_name: "Bravo", contact_name: "Ana", email: "ana@example.com", status: "new", estimated_value: 900, next_follow_up: "2026-10-26", assigned_to: "admin-other" }
    ],
    tasks: [
        { id: "task-low", title: "Low priority task", priority: "low", status: "todo", due_date: "2026-11-01", assigned_to: "admin-other" },
        { id: "task-urgent", title: "Urgent task", priority: "urgent", status: "todo", due_date: "2026-11-03", assigned_to: "admin-me" },
        { id: "task-high", title: "High priority task", priority: "high", status: "completed", due_date: "2026-10-25", assigned_to: null }
    ],
    followups: [
        { id: "followup-later", lead_id: "lead-low", channel: "Email", status: "pending", scheduled_for: "2026-11-02", note: "call later", assigned_to: "admin-other" },
        { id: "followup-sooner", lead_id: "lead-mid", channel: "WhatsApp", status: "pending", scheduled_for: "2026-10-24", assigned_to: "admin-me" },
        { id: "followup-done", lead_id: "lead-high", channel: "Email", status: "completed", scheduled_for: "2026-10-23", assigned_to: null }
    ],
    communications: [
        { id: "communication-latest", lead_id: "lead-low", channel: "WhatsApp", direction: "outbound", subject: "Re: website", message: "Follow-up message", contacted_at: "2026-11-05T09:00:00Z" },
        { id: "communication-earlier", lead_id: "lead-mid", channel: "Email", direction: "inbound", subject: "Enquiry", message: "Interested", contacted_at: "2026-11-01T09:00:00Z" }
    ],
    invoices: [
        { id: "inv-sent", invoice_number: "INV-100", client_id: "client-zulu", status: "sent", display_status: "sent", total: 1500, amount_paid: 0, amount_outstanding: 1500, due_date: "2026-11-10", issue_date: "2026-10-10", created_at: "2026-10-10T12:00:00Z", archived: false, email: "finance@zulu.example", email_status: "sent" },
        { id: "inv-paid", invoice_number: "INV-101", client_id: "client-alpha", status: "paid", display_status: "paid", total: 900, amount_paid: 900, amount_outstanding: 0, due_date: "2026-10-30", issue_date: "2026-10-05", created_at: "2026-10-05T12:00:00Z", archived: false, email: "billing@alpha.example", email_status: "sent" },
        { id: "inv-archived", invoice_number: "INV-ARCH", client_id: "client-alpha", status: "paid", display_status: "paid", total: 650, amount_paid: 650, amount_outstanding: 0, due_date: "2026-10-01", issue_date: "2026-09-15", created_at: "2026-09-15T12:00:00Z", archived: true, email: "billing@alpha.example", email_status: "sent" },
        { id: "inv-overdue", invoice_number: "INV-099", client_id: "client-bravo", status: "sent", display_status: "overdue", total: 2100, amount_paid: 0, amount_outstanding: 2100, due_date: "2026-10-10", issue_date: "2026-09-10", created_at: "2026-09-10T12:00:00Z", archived: false, email: "accounts@bravo.example", email_status: "sent" }
    ],
    clients: [],
    currentUser: { id: "admin-me" },
    admins: [
        { user_id: "admin-me", full_name: "Current Admin", email: "me@example.test", active: true },
        { user_id: "admin-other", full_name: "Other Admin", email: "other@example.test", active: true },
        { user_id: "admin-inactive", full_name: "Inactive Admin", email: "inactive@example.test", active: false }
    ]
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
    swayConfirm: async () => true,
    invoiceStatus: item => item.archived ? item.status : (item.display_status || item.status),
    today: () => "2026-11-07"
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
state.tableControls.leads.assigneeFilter = "me";
assert.deepEqual(controls.items("leads", state.leads).map(item => item.id), ["lead-low"],
    "Assigned to me should return only leads assigned to the current admin");
state.tableControls.leads.assigneeFilter = "unassigned";
assert.deepEqual(controls.items("leads", state.leads).map(item => item.id), ["lead-high"],
    "Unassigned should return leads without an assigned administrator");
state.tableControls.leads.assigneeFilter = "user:admin-other";
assert.deepEqual(controls.items("leads", state.leads).map(item => item.id), ["lead-mid"],
    "an individual team-member filter should return that member's leads");
state.tableControls.leads.assigneeFilter = "all";
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
state.tableControls.tasks.assigneeFilter = "me";
assert.deepEqual(controls.items("tasks", state.tasks).map(item => item.id), ["task-urgent"],
    "the Tasks view should filter to work assigned to the current admin");
state.tableControls.tasks.assigneeFilter = "unassigned";
assert.deepEqual(controls.items("tasks", state.tasks).map(item => item.id), ["task-high"],
    "the Tasks view should identify unassigned work");
state.tableControls.tasks.assigneeFilter = "user:admin-other";
assert.deepEqual(controls.items("tasks", state.tasks).map(item => item.id), ["task-low"],
    "the Tasks view should filter to a selected team member");
state.tableControls.tasks.assigneeFilter = "all";

const dateFilterTasks = [
    { id: "task-overdue", status: "todo", priority: "urgent", due_date: "2026-11-06" },
    { id: "task-today", status: "todo", priority: "high", due_date: "2026-11-07" },
    { id: "task-upcoming", status: "todo", priority: "low", due_date: "2026-11-08" },
    { id: "task-undated", status: "todo", priority: "low", due_date: null },
    { id: "task-completed-overdue", status: "completed", priority: "urgent", due_date: "2026-11-06" },
    { id: "task-cancelled-upcoming", status: "cancelled", priority: "low", due_date: "2026-11-08" }
];
state.tableControls.tasks.filter = "all";
state.tableControls.tasks.dateFilter = "overdue";
assert.deepEqual(
    controls.items("tasks", dateFilterTasks).map(item => item.id),
    ["task-overdue"],
    "overdue task filtering should exclude completed and cancelled tasks"
);
state.tableControls.tasks.dateFilter = "today";
assert.deepEqual(
    controls.items("tasks", dateFilterTasks).map(item => item.id),
    ["task-today"],
    "today task filtering should use the configured South African date"
);
state.tableControls.tasks.dateFilter = "upcoming";
assert.deepEqual(
    controls.items("tasks", dateFilterTasks).map(item => item.id),
    ["task-upcoming"],
    "upcoming task filtering should return only future active tasks"
);
state.tableControls.tasks.dateFilter = "undated";
assert.deepEqual(
    controls.items("tasks", dateFilterTasks).map(item => item.id),
    ["task-undated"],
    "the no-date task filter should return records with no valid due date"
);
state.tableControls.tasks.dateFilter = "overdue";
state.tableControls.tasks.filter = "completed";
assert.deepEqual(
    controls.items("tasks", dateFilterTasks),
    [],
    "date filters must combine with the selected status filter"
);
state.tableControls.tasks.filter = "all";
state.tableControls.tasks.dateFilter = "all";

const dateFilterFollowups = [
    { id: "followup-overdue", status: "pending", scheduled_for: "2026-11-06" },
    { id: "followup-today", status: "pending", scheduled_for: "2026-11-07" },
    { id: "followup-upcoming", status: "pending", scheduled_for: "2026-11-08" },
    { id: "followup-undated", status: "pending", scheduled_for: null },
    { id: "followup-completed-overdue", status: "completed", scheduled_for: "2026-11-06" }
];
state.tableControls.followups.filter = "all";
state.tableControls.followups.dateFilter = "overdue";
assert.deepEqual(
    controls.items("followups", dateFilterFollowups).map(item => item.id),
    ["followup-overdue"],
    "overdue follow-up filtering should exclude completed follow-ups"
);
state.tableControls.followups.dateFilter = "today";
assert.deepEqual(
    controls.items("followups", dateFilterFollowups).map(item => item.id),
    ["followup-today"],
    "today filtering should use scheduled_for for follow-ups"
);
state.tableControls.followups.dateFilter = "upcoming";
assert.deepEqual(
    controls.items("followups", dateFilterFollowups).map(item => item.id),
    ["followup-upcoming"],
    "upcoming follow-up filtering should return future scheduled records"
);
state.tableControls.followups.dateFilter = "undated";
assert.deepEqual(
    controls.items("followups", dateFilterFollowups).map(item => item.id),
    ["followup-undated"],
    "the no-date follow-up filter should return records with no valid scheduled date"
);
state.tableControls.followups.dateFilter = "all";

state.tableControls.followups.filter = "pending";
assert.deepEqual(
    controls.items("followups", state.followups).map(item => item.id),
    ["followup-sooner", "followup-later"],
    "follow-up status filtering and scheduled-date ordering should work together"
);
state.tableControls.followups.assigneeFilter = "me";
assert.deepEqual(controls.items("followups", state.followups).map(item => item.id), ["followup-sooner"],
    "the Follow-ups view should filter to the current admin's queue");
state.tableControls.followups.assigneeFilter = "unassigned";
assert.deepEqual(controls.items("followups", state.followups).filter(item => item.status === "pending"), [],
    "the Follow-ups view should identify unassigned pending records");
state.tableControls.followups.filter = "all";
assert.deepEqual(controls.items("followups", state.followups).map(item => item.id), ["followup-done"],
    "the Follow-ups view should identify unassigned records across statuses");
state.tableControls.followups.assigneeFilter = "all";

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

const activeResetMarkup = controls.renderControls("tasks");
assert.match(activeResetMarkup, /data-admin-table-reset-filters="tasks"/,
    "eligible list controls should expose a dedicated clear-filters action");
assert.match(activeResetMarkup, /aria-label="Clear search, status, date and assignee filters for tasks; keep sort order"/,
    "the reset action should explain exactly what it changes and preserves");
assert.match(activeResetMarkup, /data-admin-table-date-filter="tasks"/,
    "Tasks should expose a due-date filter");
assert.match(activeResetMarkup, /<option value="overdue">Overdue<\/option>/,
    "the date filter should expose its overdue bucket");
assert.match(controls.renderControls("followups"), /data-admin-table-date-filter="followups"/,
    "Follow-ups should expose a scheduled-date filter");
assert.match(controls.renderControls("followups"), /Scheduled date/,
    "the Follow-ups date filter should identify its scheduled-date field");
assert.doesNotMatch(controls.renderControls("leads"), /data-admin-table-date-filter=/,
    "the date filter should remain scoped to Tasks and Follow-ups");
assert.doesNotMatch(activeResetMarkup, /data-admin-table-reset-filters="tasks"[^>]* disabled/,
    "the reset action should be enabled while a status filter is active");
state.tableControls.tasks.filter = "all";
state.tableControls.tasks.search = "";
state.tableControls.tasks.dateFilter = "upcoming";
const dateOnlyResetMarkup = controls.renderControls("tasks");
assert.doesNotMatch(dateOnlyResetMarkup, /data-admin-table-reset-filters="tasks"[^>]* disabled/,
    "a date-only filter should enable Clear filters");
state.tableControls.tasks.dateFilter = "all";
state.tableControls.tasks.assigneeFilter = "user:admin-other";
const assigneeOnlyResetMarkup = controls.renderControls("tasks");
assert.doesNotMatch(assigneeOnlyResetMarkup, /data-admin-table-reset-filters="tasks"[^>]* disabled/,
    "an assignee-only filter should enable Clear filters");
state.tableControls.tasks.assigneeFilter = "all";
const idleResetMarkup = controls.renderControls("tasks");
assert.match(idleResetMarkup, /data-admin-table-reset-filters="tasks"[^>]* disabled>Clear filters/,
    "the reset action should be disabled when no search or status filter is active");
state.tableControls.tasks.filter = "todo";

const controlsMarkup = controls.renderControls("leads");
assert.match(controlsMarkup, /data-admin-table-search-input="leads"/);
assert.match(controlsMarkup, /data-admin-table-filter="leads"/);
assert.match(controlsMarkup, /data-admin-table-sort="leads"/);
assert.match(controlsMarkup, /data-admin-table-assignee-filter="leads"/);
assert.match(controlsMarkup, /Assigned to me/);
assert.match(controlsMarkup, /Other Admin/);
assert.doesNotMatch(controlsMarkup, /Inactive Admin/,
    "inactive administrators should not appear in the assignee selector");
assert.match(controlsMarkup, /Clear search, status and assignee filters for leads/);
assert.match(controlsMarkup, /Export selected CSV/);
assert.match(controlsMarkup, /data-admin-table-bulk-action="delete"/,
    "the Leads bulk toolbar should expose a delete-selected action");
assert.match(controlsMarkup, /Delete selected leads/,
    "the destructive action should clearly identify the selected lead records");
for (const view of ["tasks", "followups", "communications"]) {
    assert.match(controls.renderControls(view), /data-admin-table-bulk-action="delete"/,
        view + " bulk toolbar should expose a delete-selected action");
}
assert.match(controls.renderControls("tasks"), /data-admin-table-assignee-filter="tasks"/);
assert.match(controls.renderControls("followups"), /data-admin-table-assignee-filter="followups"/);
assert.doesNotMatch(controls.renderControls("communications"), /data-admin-table-assignee-filter=/,
    "Communication Log should not expose an assignee filter");
assert.match(controls.renderControls("tasks"), /Complete selected/,
    "task bulk completion should remain available alongside bulk deletion");
assert.match(controls.renderControls("followups"), /Complete selected/,
    "follow-up bulk completion should remain available alongside bulk deletion");
assert.doesNotMatch(controls.renderControls("invoices"), /data-admin-table-bulk-action="delete"/,
    "financial invoice records should not inherit generic bulk deletion");

state.tableControls.invoices.sort = "invoice_due_asc";
assert.deepEqual(
    controls.items("invoices", state.invoices).map(item => item.id),
    ["inv-archived", "inv-overdue", "inv-paid", "inv-sent"],
    "invoice due-date sorting should put earliest due dates first"
);

state.tableControls.invoices.sort = "invoice_total_desc";
assert.deepEqual(
    controls.items("invoices", state.invoices).map(item => item.id),
    ["inv-overdue", "inv-sent", "inv-paid", "inv-archived"],
    "invoice total sorting should be highest to lowest"
);

state.tableControls.invoices.sort = "invoice_client_asc";
assert.deepEqual(
    controls.items("invoices", state.invoices).map(item => item.id),
    ["inv-paid", "inv-archived", "inv-overdue", "inv-sent"],
    "invoice client sorting should be alphabetical with an invoice-number tie-breaker"
);

state.tableControls.invoices.sort = "invoice_issued_desc";
assert.deepEqual(
    controls.items("invoices", state.invoices).map(item => item.id),
    ["inv-sent", "inv-paid", "inv-archived", "inv-overdue"],
    "invoice issue-date sorting should put the newest invoice first"
);

assert.match(controls.searchText("invoices", state.invoices[0]), /inv-100/i);
assert.match(controls.searchText("invoices", state.invoices[0]), /client client-zulu/i);
assert.match(controls.searchText("invoices", state.invoices[2]), /archived/);
assert.match(controls.searchText("communications", state.communications[0]), /follow-up message/);
state.tableControls.communications.sort = "contacted_desc";
assert.deepEqual(controls.items("communications", state.communications).map(item => item.id),
    ["communication-latest", "communication-earlier"]);
state.tableControls.communications.filter = "inbound";
assert.deepEqual(controls.items("communications", state.communications).map(item => item.id),
    ["communication-earlier"], "communication direction should be filterable");

state.tableControls.invoices.filter = "overdue";
assert.deepEqual(
    controls.items("invoices", state.invoices).map(item => item.id),
    ["inv-overdue"],
    "invoice status filtering should support the displayed overdue status"
);

const activeInvoices = state.invoices.filter(item => item.archived !== true);
state.tableControls.invoices.filter = "all";
const invoiceControlsMarkup = controls.renderControls("invoices", activeInvoices);
assert.match(invoiceControlsMarkup, /data-admin-table-search-input="invoices"/);
assert.match(invoiceControlsMarkup, /data-admin-table-filter="invoices"/);
assert.match(invoiceControlsMarkup, /data-admin-table-sort="invoices"/);
assert.doesNotMatch(invoiceControlsMarkup, /data-admin-table-select-all="invoices"/);
assert.doesNotMatch(invoiceControlsMarkup, /data-admin-table-bulk-action/);
assert.doesNotMatch(invoiceControlsMarkup, /value="archived"/,
    "active invoice status options should not leak archived records into the active mode");

const archivedInvoices = state.invoices.filter(item => item.archived === true);
const archivedControlsMarkup = controls.renderControls("invoices", archivedInvoices);
assert.match(archivedControlsMarkup, /value="paid"/,
    "archived mode should filter by the underlying invoice status");
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
assert.match(workspaceSource, /let pendingInvoiceDataSignature = null;/,
    "the invoice modal should retain the signature of data already saved");
assert.match(invoiceSaveSource, /if \(pendingInvoiceDataSignature !== invoiceDataSignature\)/,
    "a retry with unchanged invoice data must skip duplicate invoice and item writes");
assert.match(invoiceSaveSource, /pendingInvoiceDataSignature = invoiceDataSignature;/,
    "the persisted data signature must update only after invoice and item writes succeed");
assert.match(workspaceSource, /function lockInvoiceAfterSuccessfulSend\(\)/,
    "a successfully sent invoice must keep its retry form from being edited");
assert.match(invoiceSaveSource, /pendingInvoiceSent = true;\s*lockInvoiceAfterSuccessfulSend\(\);/,
    "the invoice form must lock immediately after the send endpoint succeeds");
assert.match(invoiceSaveSource, /saveButton\.disabled = pendingInvoiceSent;/,
    "after a successful send, retries should be limited to the send action rather than re-saving or re-sending invoice data");
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

assert.ok(moduleSource.includes('["leads", "tasks", "followups", "communications", "invoices"].forEach(function (view)'),
    "invoice search should be reapplied after control-driven rerenders and archive-mode changes");


function verifyFilterResetBehavior() {
    const testState = {
        tableControls: {
            tasks: { search: "Confirm scope", filter: "todo", sort: "priority_desc", dateFilter: "overdue" }
        },
        tableSelection: { tasks: ["task-urgent"] },
        tableFeedback: { tasks: "" },
        tableBulkActionRunning: false,
        tasks: [{ id: "task-urgent", title: "Confirm scope", status: "todo", priority: "urgent" }]
    };
    const listeners = {};
    let renderCount = 0;
    let focusCount = 0;
    const searchInput = {
        value: "Confirm scope",
        getAttribute: name => name === "data-admin-table-search-input" ? "tasks" : null,
        addEventListener: (name, handler) => { listeners["search:" + name] = handler; }
    };
    const statusFilter = {
        value: "todo",
        getAttribute: name => name === "data-admin-table-filter" ? "tasks" : null,
        addEventListener: (name, handler) => { listeners["filter:" + name] = handler; }
    };
    const sortControl = {
        value: "priority_desc",
        getAttribute: name => name === "data-admin-table-sort" ? "tasks" : null,
        addEventListener: (name, handler) => { listeners["sort:" + name] = handler; }
    };
    let dateFocusCount = 0;
    const dateFilterSelect = {
        value: "overdue",
        getAttribute: name => name === "data-admin-table-date-filter" ? "tasks" : null,
        addEventListener: (name, handler) => { listeners["date:" + name] = handler; },
        focus: () => { dateFocusCount += 1; }
    };
    const resetButton = {
        disabled: false,
        getAttribute: name => name === "data-admin-table-reset-filters" ? "tasks" : null,
        addEventListener: (name, handler) => { listeners["reset:" + name] = handler; },
        focus: () => { focusCount += 1; }
    };
    const countNode = { textContent: "" };
    const testWorkspace = {
        querySelector(selector) {
            if (selector === '[data-admin-table-tools="tasks"]') return {};
            if (selector === '[data-admin-table-count="tasks"]') return countNode;
            if (selector === '[data-admin-table-date-filter="tasks"]') return dateFilterSelect;
            if (selector === '[data-admin-table-reset-filters="tasks"]') return resetButton;
            return null;
        },
        querySelectorAll(selector) {
            if (selector === "[data-admin-table-search-input]") return [searchInput];
            if (selector === "[data-admin-table-filter]") return [statusFilter];
            if (selector === "[data-admin-table-sort]") return [sortControl];
            if (selector === "[data-admin-table-date-filter]") return [dateFilterSelect];
            if (selector === "[data-admin-table-reset-filters]") return [resetButton];
            return [];
        }
    };
    const instance = global.window.createSwayphicsAdminTableControls({
        state: testState,
        workspace: testWorkspace,
        esc: value => String(value == null ? "" : value),
        adminName: () => "Admin",
        clientName: id => String(id),
        leadName: id => String(id),
        formatDisplayText: value => String(value),
        completeTask: async () => {},
        completeFollowup: async () => {},
        renderView: () => {
            renderCount += 1;
            // Mirror the control values and disabled state rebuilt by the real renderer.
            searchInput.value = testState.tableControls.tasks.search;
            statusFilter.value = testState.tableControls.tasks.filter;
            dateFilterSelect.value = testState.tableControls.tasks.dateFilter;
            resetButton.disabled = !testState.tableControls.tasks.search &&
                testState.tableControls.tasks.filter === "all" &&
                testState.tableControls.tasks.dateFilter === "all";
        },
        swayAlert: message => { throw new Error(message); },
        swayConfirm: async () => true
    });

    instance.bind();
    assert.equal(resetButton.disabled, false,
        "active table filters should enable the reset action");
    assert.equal(typeof listeners["date:change"], "function",
        "the date filter should have a change handler");
    dateFilterSelect.value = "today";
    listeners["date:change"]();
    assert.equal(testState.tableControls.tasks.dateFilter, "today",
        "changing the date selector should update the stored date filter");
    assert.equal(renderCount, 1,
        "changing the date filter should rerender the current view once");
    assert.equal(dateFocusCount, 1,
        "focus should return to the date selector after its rerender");
    assert.equal(resetButton.disabled, false,
        "a date-only filter should enable the reset action");

    assert.equal(typeof listeners["reset:click"], "function",
        "the reset action should have a click handler");
    listeners["reset:click"]();

    assert.equal(testState.tableControls.tasks.search, "",
        "reset should clear the current text search");
    assert.equal(testState.tableControls.tasks.filter, "all",
        "reset should restore the All statuses filter");
    assert.equal(testState.tableControls.tasks.dateFilter, "all",
        "reset should restore All dates");
    assert.equal(dateFilterSelect.value, "all",
        "the rendered date selector should be reset");
    assert.equal(searchInput.value, "",
        "the rendered search control should be reset");
    assert.equal(statusFilter.value, "all",
        "the rendered status selector should be reset");
    assert.equal(testState.tableControls.tasks.sort, "priority_desc",
        "reset should preserve the current sort order");
    assert.deepEqual(testState.tableSelection.tasks, ["task-urgent"],
        "reset should preserve the user's selected records");
    assert.equal(renderCount, 2,
        "reset should rerender the current view once after the date change");
    assert.equal(focusCount, 1,
        "focus should return to the reset action after its rerender");
    assert.equal(resetButton.disabled, true,
        "reset should become disabled once search, status and date filters are cleared");
    assert.equal(dateFocusCount, 1,
        "reset should not steal focus back to the date selector");
}

async function verifyBulkLeadDeletion() {
    const testState = {
        tableControls: { leads: { search: "", filter: "all", sort: "value_desc" } },
        tableSelection: { leads: ["lead-mid", "lead-low"], tasks: [], followups: [], invoices: [] },
        tableFeedback: { leads: "", tasks: [], followups: [], invoices: [] },
        tableBulkActionRunning: false,
        leads: state.leads.slice()
    };
    const toolbar = { hidden: false };
    const selectedCount = { textContent: "" };
    const feedback = { hidden: true, textContent: "" };
    let focusedTarget = "";
    const remainingSelectedCheckbox = { focus() { focusedTarget = "remaining-selected-checkbox"; } };
    const searchInput = { focus() { focusedTarget = "search-input"; } };
    const handlers = {};
    let confirmResult = false;
    let confirmationText = "";
    let deletionCalls = [];
    let renderCount = 0;

    const bulkButton = {
        disabled: false,
        addEventListener(name, callback) { handlers[name] = callback; },
        getAttribute(name) {
            return name === "data-admin-table-bulk-action" ? "delete" : null;
        },
        closest() {
            return { getAttribute: name => name === "data-admin-table-tools" ? "leads" : null };
        }
    };
    const testWorkspace = {
        querySelector(selector) {
            if (selector === '[data-admin-table-bulk-toolbar="leads"]') return toolbar;
            if (selector === '[data-admin-table-selected-count="leads"]') return selectedCount;
            if (selector === '[data-admin-table-feedback="leads"]') return feedback;
            if (selector === '[data-admin-table-row="leads"]:not([hidden]) [data-admin-table-select="leads"]:checked') {
                return remainingSelectedCheckbox;
            }
            if (selector === '[data-admin-table-search-input="leads"]') return searchInput;
            return null;
        },
        querySelectorAll(selector) {
            if (selector.includes("[data-admin-table-bulk-action]")) return [bulkButton];
            return [];
        }
    };

    const deleteControls = global.window.createSwayphicsAdminTableControls({
        state: testState,
        workspace: testWorkspace,
        esc: value => String(value == null ? "" : value),
        adminName: () => "Admin",
        clientName: id => "Client " + id,
        leadName: id => "Lead " + id,
        formatDisplayText: value => String(value),
        completeTask: async () => {},
        completeFollowup: async () => {},
        deleteLeads: async ids => {
            deletionCalls.push(ids.slice());
            return {
                deletedIds: ["lead-mid"],
                failedIds: ["lead-low"],
                activityLogFailures: [],
                refreshFailed: false
            };
        },
        renderView: () => { renderCount += 1; bulkButton.disabled = testState.tableBulkActionRunning; },
        swayAlert: message => { throw new Error(message); },
        swayConfirm: async message => {
            confirmationText = message;
            return confirmResult;
        }
    });

    deleteControls.bind();
    assert.match(deleteControls.renderControls("leads"), /Delete selected leads/,
        "the Leads toolbar should keep the permanent-delete control available");

    // Cancelling the confirmation must not call the delete callback or clear selection.
    await handlers.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.match(confirmationText, /Permanently delete 2 selected leads\? This cannot be undone\./);
    assert.equal(deletionCalls.length, 0,
        "cancelling bulk deletion must not send any delete requests");
    assert.deepEqual(testState.tableSelection.leads, ["lead-mid", "lead-low"],
        "cancelled bulk deletion must preserve the entire selection");
    assert.equal(renderCount, 0,
        "cancelled bulk deletion must not trigger an unnecessary rerender");

    // Confirming deletes only the rows reported as deleted; failed rows remain selected.
    confirmResult = true;
    await handlers.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(deletionCalls.length, 1,
        "confirming bulk deletion should call the authenticated workspace delete callback once");
    assert.deepEqual(new Set(deletionCalls[0]), new Set(["lead-mid", "lead-low"]));
    assert.deepEqual(testState.tableSelection.leads, ["lead-low"],
        "a partially failed deletion must retain only the failed lead in the selection");
    assert.match(feedback.textContent, /Deleted 1 of 2 selected leads/);
    assert.match(feedback.textContent, /remain selected for review/);
    assert.equal(testState.tableBulkActionRunning, false,
        "bulk-action state must be released after the delete callback settles");
    assert.equal(bulkButton.disabled, false,
        "bulk toolbar controls must be re-enabled after the delete callback settles");
    assert.equal(renderCount, 1,
        "the Leads view should rerender once after the bulk delete attempt");
    assert.equal(focusedTarget, "remaining-selected-checkbox",
        "a partially failed bulk deletion should return focus to a visible record that remains selected");
}


async function verifyBulkDeletionForOtherViews() {
    for (const view of ["tasks", "followups", "communications"]) {
        const selectedIds = [view + "-one", view + "-two"];
        const testState = {
            tableControls: { [view]: { search: "", filter: "all", sort: "created_desc" } },
            tableSelection: { [view]: selectedIds.slice() },
            tableFeedback: { [view]: "" },
            tableBulkActionRunning: false,
            [view]: selectedIds.map(id => ({ id, status: "pending" }))
        };
        const handlers = {};
        const calls = [];
        const button = {
            disabled: false,
            addEventListener(name, callback) { handlers[name] = callback; },
            getAttribute(name) { return name === "data-admin-table-bulk-action" ? "delete" : null; },
            closest() { return { getAttribute: name => name === "data-admin-table-tools" ? view : null }; }
        };
        let confirmText = "";
        let renders = 0;
        const fakeWorkspace = {
            querySelector() { return null; },
            querySelectorAll(selector) {
                return selector.includes("[data-admin-table-bulk-action]") ? [button] : [];
            }
        };
        const instance = global.window.createSwayphicsAdminTableControls({
            state: testState,
            workspace: fakeWorkspace,
            esc: value => String(value == null ? "" : value),
            adminName: () => "Admin",
            clientName: id => String(id),
            leadName: id => String(id),
            formatDisplayText: value => String(value),
            completeTask: async () => {},
            completeFollowup: async () => {},
            deleteRecords: async (receivedView, ids) => {
                calls.push({ view: receivedView, ids: ids.slice() });
                return {
                    deletedIds: [ids[0]],
                    failedIds: [ids[1]],
                    activityLogFailures: [],
                    refreshFailed: false
                };
            },
            renderView: () => { renders += 1; },
            swayAlert: message => { throw new Error(message); },
            swayConfirm: async message => { confirmText = message; return true; }
        });
        instance.bind();
        await handlers.click();
        await new Promise(resolve => setImmediate(resolve));

        const plural = view === "tasks" ? "tasks" : view === "followups" ? "follow-ups" : "communication log entries";
        assert.equal(confirmText, "Permanently delete 2 selected " + plural + "? This cannot be undone.");
        assert.equal(calls.length, 1, view + " should call the authenticated generic delete handler once");
        assert.equal(calls[0].view, view, "the exact list type must be passed to the delete handler");
        assert.deepEqual(new Set(calls[0].ids), new Set(selectedIds));
        assert.deepEqual(testState.tableSelection[view], [selectedIds[1]],
            "a failed " + view + " row must remain selected for review");
        assert.match(testState.tableFeedback[view], /remain selected for review/);
        assert.equal(testState.tableBulkActionRunning, false);
        assert.equal(renders, 1);
    }
}

Promise.resolve().then(verifyFilterResetBehavior).then(verifyBulkLeadDeletion)
    .then(verifyBulkDeletionForOtherViews).then(function () {
    console.log("Admin table controls tests passed.");
}).catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
