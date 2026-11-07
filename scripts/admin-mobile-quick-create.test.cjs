"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const helper = fs.readFileSync(
    path.join(root, "admin-dashboard", "admin-mobile-quick-create.js"),
    "utf8"
);
const workspace = fs.readFileSync(
    path.join(root, "admin-dashboard", "admin-workspace.js"),
    "utf8"
);
const redesignCss = fs.readFileSync(
    path.join(root, "admin-dashboard", "admin-dashboard-redesign.css"),
    "utf8"
);
const dashboardHtml = fs.readFileSync(
    path.join(root, "admin-dashboard", "index.html"),
    "utf8"
);

assert.ok(
    helper.includes('querySelector(".sway-workspace-heading-actions")') &&
    helper.includes('querySelector("[data-add]")'),
    "mobile docking must require an existing page-level create action"
);
assert.ok(
    helper.includes("window.innerWidth <= MOBILE_DOCK_BREAKPOINT") &&
    helper.includes("MOBILE_DOCK_BREAKPOINT = 520"),
    "docking must be limited to narrow mobile widths"
);
assert.ok(
    helper.includes("new MutationObserver(syncQuickCreatePlacement)") &&
    helper.includes('window.addEventListener("resize", syncQuickCreatePlacement'),
    "placement must be recalculated after view renders and viewport changes"
);
assert.ok(
    helper.includes('main.insertAdjacentElement("afterend", quickCreate)') &&
    helper.includes("quickCreate.classList.remove(DOCKED_CLASS)"),
    "the existing quick-create control must return to its shell position outside narrow mobile views"
);
assert.ok(
    redesignCss.includes(".sway-workspace-heading-actions.sway-quick-create-docked-actions") &&
    redesignCss.includes(".sway-quick-create.sway-quick-create-docked") &&
    redesignCss.includes("top: calc(100% + 8px)"),
    "docked quick-create must use a non-fixed heading layout and a correctly anchored menu"
);
assert.ok(
    dashboardHtml.includes("admin-dashboard-redesign.css?v=20261107-mobile-quick-create-dock-1"),
    "the updated responsive stylesheet must be cache-busted"
);
assert.ok(
    dashboardHtml.indexOf("admin-workspace.js") <
    dashboardHtml.indexOf("admin-mobile-quick-create.js"),
    "the placement helper must load after the core workspace and its existing event handlers"
);
const globalQuickActions = workspace.match(/data-global-quick="/g) || [];
assert.equal(
    globalQuickActions.length,
    9,
    "all nine existing global quick-create actions must remain in the workspace"
);
console.log("Admin mobile quick-create placement tests passed.");
