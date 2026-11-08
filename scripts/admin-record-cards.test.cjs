"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workspace = fs.readFileSync(path.join(root, "admin-dashboard", "admin-workspace.js"), "utf8");
const html = fs.readFileSync(path.join(root, "admin-dashboard", "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "admin-dashboard", "admin-record-cards.css"), "utf8");

function section(source, startMarker, label) {
    const start = source.indexOf(startMarker);
    assert.ok(start >= 0, label + " start must exist");
    const nextFunction = /\n    (?:async )?function [A-Za-z_$][\w$]*\(/g;
    nextFunction.lastIndex = start + startMarker.length;
    const match = nextFunction.exec(source);
    assert.ok(match, label + " end must follow its start");
    return source.slice(start, match.index);
}

const cards = {
    tasks: [
        "data-admin-table-row=\"tasks\"", "data-admin-table-select=\"tasks\"",
        "data-complete-task=", "data-client-portal=", 'data-delete=\"tasks\"',
        'data-edit=\"tasks\"'
    ],
    followups: [
        "data-admin-table-row=\"followups\"", "data-admin-table-select=\"followups\"",
        "data-complete-followup=", 'data-delete=\"followups\"', 'data-edit=\"followups\"'
    ],
    clients: [
        "data-client360=", "data-client-portal=", "data-archive-client=",
        "data-restore-client=", "data-new-project-client=", "data-new-invoice-client=",
        'data-delete=\"clients\"'
    ],
    projects: [
        'data-edit=\"projects\"', "data-project-timeline=", "data-request-review=",
        'data-delete=\"projects\"'
    ],
    quotes: [
        'data-edit=\"quotes\"', "data-create-invoice-from-quote=", 'data-delete=\"quotes\"'
    ],
    invoices: [
        "data-admin-table-row=\"invoices\"", "data-invoice-action=\"pdf\"",
        'data-invoice-action=\"send\"', 'data-invoice-action=\"archive\"',
        'data-invoice-action=\"restore\"'
    ],
    services: ['data-edit=\"services\"', 'data-delete=\"services\"'],
    payments: ['data-edit=\"payments\"', 'data-delete=\"payments\"'],
    enquiries: ["data-enquiry-status=", 'data-status-next=\"contacted\"', 'data-status-next=\"closed\"'],
    communications: [
        "data-admin-table-row=\"communications\"", "data-admin-table-select=\"communications\"",
        'data-edit=\"communications\"', 'data-delete=\"communications\"'
    ],
    documents: ["data-download-document=", "data-delete-document="],
    portalRequests: ["data-portal-request-view=", "data-portal-request-status="],
    activity: ["sway-record-card-title", "adminName(item.actor_id)"],
    team: ["data-toggle-admin=", 'data-edit=\"team\"'],
    content: ['data-edit=\"announcements\"', 'data-delete=\"announcements\"']
};

const rendererNames = {
    tasks: "renderTasks",
    followups: "renderFollowups",
    clients: "renderClients",
    projects: "renderProjects",
    quotes: "renderQuotes",
    invoices: "renderInvoices",
    services: "renderServices",
    payments: "renderPayments",
    enquiries: "renderEnquiries",
    communications: "renderCommunications",
    documents: "renderDocuments",
    portalRequests: "renderPortalRequests",
    activity: "renderActivity",
    team: "renderTeam",
    content: "renderContent"
};
const names = Object.values(rendererNames);
for (const [key, name] of Object.entries(rendererNames)) {
    const renderer = section(workspace, "    function " + name + "(", name);
    assert.match(renderer, /sway-record-card/,
        name + " should render responsive record cards instead of table rows");
    assert.doesNotMatch(renderer, /<tr\b|<table\b/,
        name + " should not fall back to a table layout");
    for (const contract of cards[key]) {
        assert.ok(renderer.includes(contract), name + " must preserve " + contract);
    }
}

const selectionBar = section(
    workspace,
    "    function renderRecordCardSelectionBar(",
    "shared card selection toolbar"
);
assert.match(selectionBar, /data-admin-table-select-all=/,
    "the shared card-selection toolbar must expose select-all-visible");

for (const view of ["tasks", "followups", "communications"]) {
    const renderer = section(
        workspace,
        "    function " + rendererNames[view] + "(",
        view + " card renderer"
    );
    assert.ok(renderer.includes('adminTableControls.items("' + view + '", state.' + view + ")"),
        view + " must retain sorting and status/date/assignee filtering");
    assert.ok(renderer.includes('adminTableControls.renderControls("' + view + '")'),
        view + " must retain the shared control and bulk-action toolbar");
    assert.ok(renderer.includes('renderRecordCardSelectionBar("' + view + '"'),
        view + " must retain select-all-visible through the shared card toolbar");
    assert.ok(renderer.includes("data-admin-table-no-results=\"" + view + "\""),
        view + " must retain its filtered-empty state");
}
const invoiceRenderer = section(
    workspace, "    function renderInvoices(", "invoice card renderer"
);
assert.ok(invoiceRenderer.includes('adminTableControls.items("invoices", visibleInvoices)'));
assert.ok(invoiceRenderer.includes('adminTableControls.renderControls("invoices", visibleInvoices)'));
assert.ok(invoiceRenderer.includes('data-admin-table-no-results="invoices"'));

assert.match(html, /admin-record-cards\.css\?v=20261108-record-cards-1/,
    "the shared card stylesheet should be loaded with a versioned URL");
assert.ok(
    html.indexOf("admin-lead-cards.css") < html.indexOf("admin-record-cards.css"),
    "shared record cards should load after the base and lead-card styles"
);
for (const selector of [
    ".sway-record-card-grid", ".sway-record-card-open:focus-visible",
    ".sway-record-card-selection-bar", ".sway-record-card-detail-wide"
]) {
    assert.ok(css.includes(selector), "card stylesheet should include " + selector);
}
assert.match(css, /body\.sway-dark-mode[\s\S]*?sway-record-card/);
assert.match(css, /@media \(max-width: 620px\)/);
assert.match(css, /prefers-reduced-motion/);

console.log("Admin record-card contract tests passed for 15 dashboard views.");
