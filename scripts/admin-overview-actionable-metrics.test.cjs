"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const repoRoot = path.join(__dirname, "..");
const tableControlsSource = fs.readFileSync(
    path.join(repoRoot, "admin-dashboard", "admin-table-controls.js"),
    "utf8"
);
const workspaceSource = fs.readFileSync(
    path.join(repoRoot, "admin-dashboard", "admin-workspace.js"),
    "utf8"
);

function createControls(state) {
    const sandbox = { window: {} };
    vm.runInNewContext(tableControlsSource, sandbox, {
        filename: "admin-table-controls.js"
    });

    return sandbox.window.createSwayphicsAdminTableControls({
        state,
        workspace: {
            querySelectorAll: () => [],
            querySelector: () => null
        },
        esc: value => String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;"),
        adminName: () => "Admin",
        clientName: () => "Client",
        leadName: () => "Lead",
        formatDisplayText: value => String(value),
        completeTask: async () => {},
        completeFollowup: async () => {},
        renderView: () => {},
        swayAlert: () => {},
        swayConfirm: async () => true,
        dashboardTodayISO: () => "2026-11-07",
        dateInput: value => String(value || "").slice(0, 10),
        invoiceStatus: item => String(item.status || "").toLowerCase()
    });
}

function baseState() {
    return {
        currentUser: { id: "admin-1" },
        tableControls: {
            tasks: { search: "", filter: "all", sort: "priority_desc" },
            followups: { search: "", filter: "all", sort: "scheduled_asc" },
            leads: { search: "", filter: "all", sort: "value_desc" },
            invoices: { search: "", filter: "all", sort: "invoice_total_desc" }
        },
        tableSelection: {
            tasks: [], followups: [], leads: [], invoices: []
        },
        tableFeedback: {
            tasks: "", followups: "", leads: "", invoices: ""
        },
        tableBulkActionRunning: false,
        tasks: [
            { id: "mine-open", status: "todo", assigned_to: "admin-1", title: "Prepare proposal" },
            { id: "mine-progress", status: "in progress", assigned_to: "admin-1", title: "Review proposal" },
            { id: "mine-done", status: "completed", assigned_to: "admin-1", title: "Send invoice" },
            { id: "other-open", status: "todo", assigned_to: "admin-2", title: "Other admin task" }
        ],
        followups: [
            { id: "today-pending", status: "pending", scheduled_for: "2026-11-07", note: "Due today" },
            { id: "tomorrow-pending", status: "pending", scheduled_for: "2026-11-08", note: "Due tomorrow" },
            { id: "today-completed", status: "completed", scheduled_for: "2026-11-07", note: "Already completed" }
        ],
        leads: [
            { id: "lead-new", status: "new", estimated_value: 1500 },
            { id: "lead-interested", status: "interested", estimated_value: 2500 },
            { id: "lead-negotiating", status: "negotiating", estimated_value: 3500 },
            { id: "lead-followup", status: "follow-up", estimated_value: 500 },
            { id: "lead-won", status: "won", estimated_value: 700 },
            { id: "lead-lost", status: "lost", estimated_value: 900 }
        ],
        invoices: [
            { id: "invoice-draft", status: "draft", total: 650, amount_outstanding: 650, archived: false },
            { id: "invoice-sent", status: "sent", total: 1500, amount_outstanding: 1500, archived: false },
            { id: "invoice-legacy", status: "sent", total: 120, archived: false },
            { id: "invoice-zero", status: "sent", total: 300, amount_outstanding: 0, archived: false },
            { id: "invoice-paid-stale", status: "paid", total: 100, amount_outstanding: 100, archived: false },
            { id: "invoice-cancelled", status: "cancelled", total: 200, amount_outstanding: 200, archived: false },
            { id: "invoice-archived", status: "sent", total: 400, amount_outstanding: 400, archived: true }
        ]
    };
}

test("Overview My open tasks filter uses the signed-in admin and excludes completed tasks", () => {
    const state = baseState();
    state.tableControls.tasks.filter = "overview_my_open";
    const controls = createControls(state);
    assert.deepEqual(
        Array.from(controls.items("tasks", state.tasks), item => item.id),
        ["mine-open", "mine-progress"]
    );
});

test("Overview Follow-ups today filter uses the Johannesburg date and pending status", () => {
    const state = baseState();
    state.tableControls.followups.filter = "overview_due_today";
    const controls = createControls(state);
    assert.deepEqual(
        Array.from(controls.items("followups", state.followups), item => item.id),
        ["today-pending"]
    );
});

test("Overview Open pipeline filter excludes won, lost and follow-up stages", () => {
    const state = baseState();
    state.tableControls.leads.filter = "overview_open_pipeline";
    const controls = createControls(state);
    assert.deepEqual(
        Array.from(controls.items("leads", state.leads), item => item.id),
        ["lead-negotiating", "lead-interested", "lead-new"]
    );
});

test("Overview Outstanding filter excludes archived, paid, cancelled and zero-balance invoices", () => {
    const state = baseState();
    state.tableControls.invoices.filter = "overview_outstanding";
    const controls = createControls(state);
    assert.deepEqual(
        Array.from(controls.items("invoices", state.invoices), item => item.id),
        ["invoice-sent", "invoice-draft", "invoice-legacy"]
    );
});

test("custom Overview filters have explicit readable labels in the shared filter control", () => {
    const state = baseState();
    const controls = createControls(state);
    const cases = [
        ["tasks", "overview_my_open", "My open tasks"],
        ["followups", "overview_due_today", "Due today"],
        ["leads", "overview_open_pipeline", "Active pipeline leads"],
        ["invoices", "overview_outstanding", "Outstanding invoices"]
    ];

    for (const [view, filter, label] of cases) {
        state.tableControls[view].filter = filter;
        const html = controls.renderControls(view, state[view]);
        assert.ok(html.includes('aria-label="Filter records in ' + view + '"'),
            view + " filter should have a useful accessible name");
        assert.ok(html.includes('>' + label + '</option>'),
            view + " should display its custom filter label, not the raw filter key");
        assert.ok(html.includes("<span>Filter</span>"),
            view + " should label the control as a filter, not as a status-only selector");
    }
});

test("Overview metric routing clears stale list state but preserves sorting", () => {
    const helperStart = workspaceSource.indexOf("    function applyOverviewMetricFilter(");
    const helperEnd = workspaceSource.indexOf("\n    function renderOverview()", helperStart);
    assert.ok(helperStart >= 0 && helperEnd > helperStart,
        "the workspace must define its guarded Overview filter helper");

    const helperSource = workspaceSource.slice(helperStart, helperEnd);
    const state = {
        tableControls: {
            tasks: { search: "old task query", filter: "all", sort: "priority_desc" },
            followups: { search: "old follow-up query", filter: "all", sort: "scheduled_asc" },
            leads: { search: "old lead query", filter: "all", sort: "value_desc" },
            invoices: { search: "old invoice query", filter: "all", sort: "invoice_total_desc" }
        },
        tableSelection: {
            tasks: ["task-1"], followups: ["followup-1"], leads: ["lead-1"], invoices: ["invoice-1"]
        },
        tableFeedback: {
            tasks: "old feedback", followups: "old feedback", leads: "old feedback", invoices: "old feedback"
        },
        showArchivedInvoices: true
    };
    const sandbox = { state };
    vm.runInNewContext(
        helperSource + "\nthis.applyFilter = applyOverviewMetricFilter;",
        sandbox
    );

    const cases = [
        ["tasks", "overview_my_open", "priority_desc"],
        ["followups", "overview_due_today", "scheduled_asc"],
        ["leads", "overview_open_pipeline", "value_desc"],
        ["invoices", "overview_outstanding", "invoice_total_desc"]
    ];
    for (const [view, filter, sort] of cases) {
        assert.equal(sandbox.applyFilter(view, filter), true);
        assert.equal(state.tableControls[view].filter, filter);
        assert.equal(state.tableControls[view].search, "");
        assert.equal(state.tableControls[view].sort, sort);
        assert.deepEqual(Array.from(state.tableSelection[view]), []);
        assert.equal(state.tableFeedback[view], "");
    }
    assert.equal(state.showArchivedInvoices, false,
        "Outstanding should return to the active invoice set");

    const beforeInvalid = JSON.stringify(state);
    assert.equal(sandbox.applyFilter("tasks", "overview_outstanding"), false,
        "a filter must not be accepted for the wrong destination");
    assert.equal(JSON.stringify(state), beforeInvalid,
        "unsupported view/filter combinations must not mutate workspace state");
});

test("Overview headline metrics are semantic buttons wired to their matching list filters", () => {
    const overviewStart = workspaceSource.indexOf("    function renderOverview() {");
    const overviewEnd = workspaceSource.indexOf("\n    async function deleteSelectedTableRecords", overviewStart);
    assert.ok(overviewStart >= 0 && overviewEnd > overviewStart,
        "the Overview renderer should remain discoverable");
    const overview = workspaceSource.slice(overviewStart, overviewEnd);
    const cases = [
        ['data-view-target="tasks"', 'data-overview-filter="overview_my_open"'],
        ['data-view-target="followups"', 'data-overview-filter="overview_due_today"'],
        ['data-view-target="leads"', 'data-overview-filter="overview_open_pipeline"'],
        ['data-view-target="invoices"', 'data-overview-filter="overview_outstanding"']
    ];
    for (const [view, filter] of cases) {
        assert.ok(
            overview.includes('<button type="button" class="sway-overview-hero-metric sway-overview-hero-metric-link" ' + view + " " + filter),
            "each Overview metric must be a native keyboard-operable button with its matching filter"
        );
    }
    assert.ok(workspaceSource.includes("dashboardTodayISO: dashboardTodayISO"));
    assert.ok(workspaceSource.includes("dateInput: dateInput"));
});
