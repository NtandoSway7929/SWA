"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workspacePath = path.join(root, "admin-dashboard", "admin-workspace.js");
const workspaceCssPath = path.join(root, "admin-dashboard", "admin-workspace.css");
const redesignCssPath = path.join(root, "admin-dashboard", "admin-dashboard-redesign.css");
const dashboardHtmlPath = path.join(root, "admin-dashboard", "index.html");
const settingsPath = path.join(root, "admin-dashboard", "admin-settings-expanded.js");

const workspace = fs.readFileSync(workspacePath, "utf8");
const workspaceCss = fs.readFileSync(workspaceCssPath, "utf8");
const redesignCss = fs.readFileSync(redesignCssPath, "utf8");
const dashboardHtml = fs.readFileSync(dashboardHtmlPath, "utf8");
const settings = fs.readFileSync(settingsPath, "utf8");

function extractConstant(source, startMarker, endMarker, label) {
    const start = source.indexOf(startMarker);
    assert.ok(start >= 0, label + " start marker must exist");
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(end > start, label + " end marker must follow its start");
    return source.slice(start, end);
}

const navSource = extractConstant(
    workspace,
    "const navGroups = [",
    "const nav =",
    "navigation group source"
);

const groupMatches = [
    ...navSource.matchAll(
        /\{\s*id:\s*"([^"]+)",\s*label:\s*"([^"]+)",\s*icon:\s*"[^"]+",\s*items:\s*\[([\s\S]*?)\]\s*\}/g
    )
];

const expectedGroups = [
    ["overview", "Overview", ["overview", "insights", "reminders"]],
    ["innerme", "InnerMe", ["swayphics-ai", "innerme-actions", "innerme-revenue", "innerme-intelligence", "innerme-provider-usage"]],
    ["crm", "Clients & Pipeline", ["enquiries", "leads", "clients", "communications", "email", "documents", "followups"]],
    ["delivery", "Work & Portfolio", ["projects", "tasks", "portfolio"]],
    ["billing", "Sales & Billing", ["quotes", "invoices", "payments", "services", "invoice-settings"]],
    ["website", "Website", ["content", "testimonials"]],
    ["settings", "Settings", ["settings"]],
    ["admin", "Administration", ["activity", "portal-requests", "data-export", "team"]]
];

assert.equal(groupMatches.length, expectedGroups.length, "all eight navigation groups must remain");
const actualViewIds = [];

groupMatches.forEach((match, index) => {
    const id = match[1];
    const label = match[2];
    const items = [
        ...match[3].matchAll(/\[\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\]/g)
    ].map(item => item[1]);

    assert.equal(id, expectedGroups[index][0], "group ID must remain stable at position " + index);
    assert.equal(label, expectedGroups[index][1], "group label must remain stable for " + id);
    assert.deepEqual(items, expectedGroups[index][2], "destination IDs must remain stable for " + id);
    actualViewIds.push(...items);
});

assert.equal(actualViewIds.length, 30, "all 30 current destinations must remain available");
assert.equal(new Set(actualViewIds).size, 30, "navigation destination IDs must be unique");

const renderShell = extractConstant(
    workspace,
    "function renderShell() {",
    "\n    function heading(",
    "workspace shell renderer"
);

assert.ok(
    renderShell.includes('<nav class="sway-workspace-sidebar sway-top-nav"'),
    "the workspace navigation must be rendered as a semantic top-level nav landmark"
);
assert.ok(
    renderShell.includes('<div class="sway-workspace-nav-scroll" role="group"'),
    "top-level group triggers must use the dedicated horizontal scrolling row"
);
assert.ok(
    renderShell.includes('class="sway-top-nav-menu-layer"'),
    "dropdown panels must be rendered outside the horizontal trigger scroller"
);
assert.ok(
    renderShell.includes('data-nav-menu="'),
    "each dropdown panel must retain its navigation group identifier"
);
assert.ok(
    renderShell.includes('aria-controls="sway-nav-menu-'),
    "each group trigger must reference its dropdown panel"
);
assert.ok(
    renderShell.includes("openGroups[group.id] === true"),
    "the last open navigation group preference must be restored"
);
assert.ok(
    renderShell.includes("rememberedOpenGroup"),
    "legacy multiple-open group preferences must be normalized to one dropdown"
);
assert.ok(
    !renderShell.includes("setupMobileSidebarInteractions("),
    "the retired off-canvas drawer interaction must not be rebound"
);
assert.ok(
    workspace.includes('button.dataset.view') && workspace.includes("persistWorkspaceView("),
    "existing data-view navigation and selected-view persistence must remain"
);
assert.ok(
    workspace.includes("count = state.leads.filter") &&
    workspace.includes("count = state.followups.filter") &&
    workspace.includes("count = state.enquiries.filter") &&
    workspace.includes("count = state.portalRequests.filter"),
    "existing dynamic navigation counters must remain data-backed"
);
assert.ok(
    workspace.includes('document.addEventListener("pointerdown"') &&
    workspace.includes('document.addEventListener("keydown"') &&
    workspace.includes('event.key !== "Escape"'),
    "top navigation must support outside-click dismissal and Escape"
);

assert.ok(
    settings.includes('var group = workspace.querySelector(\'[data-nav-group="settings"]\')') &&
    settings.includes('group.parentNode.insertBefore(button, group)') &&
    settings.includes("group.remove();"),
    "the Settings module's direct-navigation normalizer must remain available"
);
assert.ok(
    renderShell.includes('data-nav-menu="settings"') &&
    renderShell.includes("sway-settings-nav-source"),
    "the Settings destination must remain discoverable by its existing normalizer"
);

assert.ok(
    dashboardHtml.includes('href="admin-dashboard-redesign.css?v=20261105-top-navigation-1"'),
    "the isolated top-navigation stylesheet must be linked"
);
assert.ok(
    dashboardHtml.indexOf("admin-welcome.css") < dashboardHtml.indexOf("admin-dashboard-redesign.css"),
    "the new visual layer must load after existing dashboard component styles"
);
assert.ok(
    dashboardHtml.includes("family=Montserrat") &&
    dashboardHtml.includes("family=Raleway"),
    "the preferred interface and heading typefaces must be available"
);

assert.ok(
    redesignCss.includes(".sway-top-nav-menu-layer") &&
    redesignCss.includes("overflow-x: auto") &&
    redesignCss.includes("overflow-y: hidden"),
    "horizontal trigger scrolling and separate dropdown layers must be styled"
);
assert.ok(
    redesignCss.includes("@media (max-width: 980px)") &&
    redesignCss.includes("@media (max-width: 520px)"),
    "top navigation must have tablet and narrow-mobile layout rules"
);
assert.ok(
    redesignCss.includes(".admin-mobile-sidebar-toggle") &&
    redesignCss.includes("display: none !important"),
    "the retired sidebar hamburger must not remain visible"
);
assert.ok(
    redesignCss.includes("body.sway-dark-mode"),
    "the navigation must retain a dark-theme presentation"
);
assert.ok(
    workspaceCss.includes(".sway-workspace-nav-button"),
    "the existing destination button component styles must remain in place"
);

console.log(JSON.stringify({
    result: "PASS",
    checks: [
        "eight navigation groups and all 30 destination IDs preserved",
        "semantic top navigation landmark and horizontal trigger row",
        "dropdown panels separated from horizontal scrolling container",
        "existing view identifiers, counters and selected-view persistence preserved",
        "exclusive remembered dropdown state and Escape/outside-click dismissal",
        "Settings direct-navigation compatibility preserved",
        "isolated stylesheet loaded after existing component styles",
        "Montserrat/Raleway font availability",
        "responsive, narrow-mobile and dark-theme navigation rules",
        "existing workspace destination button styles retained"
    ]
}, null, 2));
