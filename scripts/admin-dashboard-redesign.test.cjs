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
    ["website", "Website", ["content", "testimonials", "cookie-analytics"]],
    ["admin", "Administration", ["activity", "portal-requests", "data-export", "team"]],
    ["settings", "Settings", ["settings"]]
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

assert.equal(actualViewIds.length, 31, "all 31 current destinations must remain available");
assert.ok(
    navSource.match(/\{\s*id:\s*"settings",\s*label:\s*"Settings",\s*icon:\s*"settings"/),
    "the final Settings destination must declare its settings icon"
);
assert.ok(
    navSource.match(/\{\s*id:\s*"admin",\s*label:\s*"Administration",\s*icon:\s*"shield"/),
    "Administration must retain a distinct shield icon"
);
const navGroupIconRenderer = extractConstant(
    workspace,
    "function navGroupIcon(name) {",
    "\n    function token()",
    "navigation icon renderer"
);
assert.ok(
    navGroupIconRenderer.includes("shield:") &&
    navGroupIconRenderer.includes("settings:"),
    "both the Administration shield and Settings gear icons must resolve"
);
const settingsButtonRenderer = extractConstant(
    workspace,
    "function navButton(item) {",
    "\n    function setStandaloneManagerVisibility(",
    "Settings direct-navigation button renderer"
);
assert.ok(
    settingsButtonRenderer.includes('view === "settings"') &&
    settingsButtonRenderer.includes('navGroupIcon("settings")') &&
    settingsButtonRenderer.includes('class="sway-settings-direct-label"'),
    "the standalone Settings tab must render its gear icon before its label"
);
assert.equal(new Set(actualViewIds).size, 31, "navigation destination IDs must be unique");

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

const navClickHandler = extractConstant(
    workspace,
    '.querySelectorAll("[data-view]")',
    "\n    function heading(",
    "workspace navigation click handler"
);
assert.ok(
    navClickHandler.includes("openNavigationGroup.classList.remove(\"open\")") &&
    navClickHandler.includes("if (openMenu) openMenu.hidden = true") &&
    navClickHandler.includes('localStorage.setItem(\n                                    "swayphics_admin_nav_groups",\n                                    JSON.stringify({})'),
    "selecting a destination must dismiss its open dropdown before rendering the selected view"
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
    dashboardHtml.includes('href="admin-dashboard-redesign.css?v=20261105-top-navigation-'),
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

const overviewSource = extractConstant(
    workspace,
    "function renderOverview() {",
    "\n    const adminTableControls",
    "Overview renderer"
);

assert.ok(
    overviewSource.includes('class="sway-overview-hero"') &&
    overviewSource.includes('aria-labelledby="sway-overview-hero-title"'),
    "Overview must render an accessible hybrid hero"
);
assert.ok(
    overviewSource.includes("esc(currentUserName())"),
    "hero greeting must use the authenticated workspace user's configured name"
);
assert.ok(
    overviewSource.includes("myOpenTasks.length") &&
    overviewSource.includes("followupsToday") &&
    overviewSource.includes("money(pipeline)") &&
    overviewSource.includes("money(outstanding)"),
    "hero metrics must use existing live workspace calculations"
);

assert.ok(
    overviewSource.includes('return !["won", "lost", "follow-up"].includes(item.status);') &&
    overviewSource.includes('return !["won", "lost"].includes(item.status);'),
    "pipeline valuation and active-lead count must retain their distinct pre-redesign definitions"
);
assert.ok(
    overviewSource.includes('data-quick="task"') &&
    overviewSource.includes('data-quick="lead"'),
    "hero quick actions must reuse existing task and lead handlers"
);
assert.ok(
    overviewSource.includes("renderInsightsOverview()") &&
    overviewSource.includes("renderNeedsAttention()") &&
    overviewSource.includes("renderFollowupAutomation()") &&
    overviewSource.includes('"My work"') &&
    overviewSource.includes('"Recent activity"'),
    "existing Overview panels must remain below the hero"
);
assert.equal(
    overviewSource.split("Good day, ").length - 1,
    1,
    "the previous inline greeting must be consolidated into one hero greeting"
);

assert.ok(
    !overviewSource.includes("heading(") &&
    !overviewSource.includes("sway-heading-action"),
    "the Overview hero must replace the previous heading and avoid duplicate quick actions"
);
assert.ok(
    overviewSource.includes("sway-overview-accent-dot") &&
    !overviewSource.includes("sway-overview-live-dot"),
    "the decorative hero accent must not imply a verified live connection"
);
assert.ok(
    redesignCss.includes(".sway-overview-hero") &&
    redesignCss.includes("@media (max-width: 760px)") &&
    redesignCss.includes("body.sway-dark-mode #sway-admin-workspace .sway-overview-hero"),
    "the hero must have responsive and dark-theme styles"
);


assert.ok(
    !workspaceCss.includes(".sway-lead-assessment-status::before"),
    "lead assessment status pills must not render an inner circle"
);
const liveBadgeRule = workspaceCss.match(/\.sway-live-badge\s*\{[^}]*\}/)?.[0] || "";
assert.ok(
    workspaceCss.includes(".sway-live-badge i {\n    display: none;") &&
    liveBadgeRule.includes("gap: 0;"),
    "live status pills must hide the indicator circle and remove its reserved gap"
);
assert.ok(
    !dashboardHtml.includes(".sway-chip::before") &&
    !dashboardHtml.includes(".testimonial-admin-status::before") &&
    !dashboardHtml.includes(".portfolio-admin-status::before"),
    "shared status chips, testimonial statuses and portfolio statuses must remain text-only"
);
assert.ok(
    !dashboardHtml.includes("admin-status-dot"),
    "the authenticated-state pill must not render an inner circle"
);
assert.ok(
    dashboardHtml.includes(".sway-chip.success") &&
    dashboardHtml.includes(".sway-chip.warning") &&
    dashboardHtml.includes(".sway-chip.danger"),
    "status colour variants must be retained after removing the decorative circles"
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
