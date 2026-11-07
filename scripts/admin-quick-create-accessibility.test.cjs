"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(
    path.join(root, "admin-dashboard", "admin-quick-create-accessibility.js"),
    "utf8"
);
const css = fs.readFileSync(
    path.join(root, "admin-dashboard", "admin-quick-create-accessibility.css"),
    "utf8"
);
const html = fs.readFileSync(
    path.join(root, "admin-dashboard", "index.html"),
    "utf8"
);

const workspaceScript = html.indexOf('src="admin-workspace.js');
const accessibilityScript = html.indexOf('src="admin-quick-create-accessibility.js');
assert.ok(workspaceScript >= 0 && accessibilityScript > workspaceScript,
    "quick-create accessibility enhancement must load after the workspace controller");

assert.ok(
    html.includes('href="admin-quick-create-accessibility.css?v=20261107-quick-create-accessibility-1"'),
    "the dedicated quick-create focus stylesheet must be cache-busted and loaded"
);

assert.ok(script.includes('toggle.setAttribute("aria-label", "Quick-create actions")'),
    "the compact New toggle must have a useful accessible name");
assert.ok(script.includes('parts.menu.setAttribute("aria-labelledby", parts.heading.id)'),
    "the action panel must be named by its visible heading");
assert.ok(script.includes('parts.grid.setAttribute("role", "group")') &&
    script.includes('parts.grid.setAttribute("aria-label", "Create a new workspace record")'),
    "the action buttons must be exposed as one named group");
assert.ok(script.includes("event.detail !== 0") &&
    script.includes('firstAction.focus()'),
    "keyboard activation must move focus into the opened action list");
assert.ok(script.includes('event.key !== "Escape"') &&
    script.includes("parts.toggle.focus()"),
    "Escape must restore focus to the disclosure toggle before the menu closes");
assert.ok(script.includes('document.addEventListener("focusout"') &&
    script.includes("closeMenu(wrapper)"),
    "tabbing out of the open quick-create control must close the disclosure");

assert.ok(css.includes(".sway-quick-create-toggle:focus-visible") &&
    css.includes(".sway-quick-create-item:focus-visible") &&
    css.includes("outline: 3px solid #0152F4"),
    "the toggle and each action must have a clear visible keyboard focus indicator");
assert.ok(css.includes("body.sway-dark-mode") && css.includes("#77C1FC"),
    "focus indicators must remain visible in dark mode");
assert.ok(css.includes("@media (prefers-reduced-motion: reduce)") &&
    css.includes("transition: none !important"),
    "focus styling must respect reduced-motion preferences");

console.log("Quick-create accessibility contract tests passed.");
