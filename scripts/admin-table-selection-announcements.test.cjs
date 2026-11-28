"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const controls = fs.readFileSync(path.join(root, "admin-dashboard", "admin-table-controls.js"), "utf8");
const css = fs.readFileSync(path.join(root, "admin-dashboard", "admin-workspace.css"), "utf8");
const html = fs.readFileSync(path.join(root, "admin-dashboard", "index.html"), "utf8");

assert.match(controls, /data-admin-table-selection-status=.*role="status" aria-live="polite" aria-atomic="true"/,
  "operational table selection should expose a persistent polite atomic live region");
assert.match(controls, /selected\.length === 1[\s\S]*?record selected\.[\s\S]*?records selected\./,
  "selection announcements should use correct singular and plural wording");
assert.match(controls, /selectionStatus\.textContent !== selectionMessage/,
  "the live region should only be updated when its message changes");
assert.ok(css.includes(".sway-admin-table-selection-status {") &&
  css.includes("clip-path: inset(50%);") && !/\.sway-admin-table-selection-status\s*\{[^}]*display\s*:\s*none/i.test(css),
  "the live region must be visually hidden without display:none");
assert.ok(html.includes("admin-workspace.css?v=20261128-quote-pricing-engine-1"),
  "the updated live-region styling must use a refreshed stylesheet cache key");

console.log("Admin table selection announcement tests passed.");
