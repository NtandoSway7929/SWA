"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "admin-dashboard/admin-quick-create-accessibility.js"), "utf8");
const css = fs.readFileSync(path.join(root, "admin-dashboard/admin-quick-create-accessibility.css"), "utf8");
const html = fs.readFileSync(path.join(root, "admin-dashboard/index.html"), "utf8");

const workspaceScript = html.indexOf('src="admin-workspace.js');
const accessibilityScript = html.indexOf('src="admin-quick-create-accessibility.js');
assert.ok(workspaceScript >= 0 && accessibilityScript > workspaceScript,
    "accessibility enhancement must load after the workspace controller");
assert.ok(html.includes('href="admin-quick-create-accessibility.css?v=20261126-remove-global-new-1"'),
    "the retired launcher stylesheet must be loaded with a fresh cache key");
assert.ok(/#sway-admin-workspace\\s+\\.sway-quick-create\\s*\\{\\s*display:\\s*none\\s*!important;/s.test(css),
    "the persistent global + New launcher and its menu must be removed from the visible dashboard");

assert.ok(script.includes('toggle.setAttribute("aria-label", "Quick-create actions")'),
    "toggle must have an accessible name");
assert.ok(script.includes('parts.menu.setAttribute("role", "group")') &&
    script.includes('parts.menu.setAttribute("aria-labelledby", parts.heading.id)'),
    "menu must be a named group");
assert.ok(script.includes("event.detail !== 0") && script.includes("firstAction.focus()"),
    "keyboard activation must move focus into the action list");
assert.ok(script.includes('event.key !== "Escape"') && script.includes("parts.toggle.focus()"),
    "Escape must restore focus to the toggle");
assert.ok(script.includes('document.addEventListener("focusout"') && script.includes("closeMenu(wrapper)"),
    "focus leaving the disclosure must close it without focus theft");
assert.ok(css.includes(".sway-quick-create-toggle:focus-visible") &&
    css.includes(".sway-quick-create-item:focus-visible") &&
    css.includes("outline: 3px solid #0152F4"),
    "toggle and actions must have visible focus indicators");
assert.ok(css.includes("body.sway-dark-mode") && css.includes("#77C1FC"),
    "focus indicators must work in dark mode");
assert.ok(css.includes("@media (prefers-reduced-motion: reduce)") && css.includes("transition: none !important"),
    "focus styling must respect reduced-motion preferences");

console.log("Quick-create accessibility contract tests passed.");
