"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "..", "admin-dashboard", "admin-workspace.js"),
  "utf8"
);
const start = source.indexOf("    function showModal(title, fields, onSubmit) {");
const end = source.indexOf("\n    async function createOrEdit", start);
assert.ok(start >= 0 && end > start, "the dynamic form modal must remain isolated in showModal()");
const modal = source.slice(start, end);

test("dynamic form modal exposes an accessible dialog name", () => {
  assert.match(modal, /role="dialog" aria-modal="true" aria-labelledby="sway-dynamic-form-title" tabindex="-1"/);
  assert.match(modal, /<h3 id="sway-dynamic-form-title">/);
});

test("dynamic form modal traps Tab and Shift+Tab within visible controls", () => {
  assert.match(modal, /event\.key !== "Tab"/);
  assert.match(modal, /dialog\.querySelectorAll\(/);
  assert.match(modal, /event\.shiftKey && \(active === first \|\| !dialog\.contains\(active\)\)/);
  assert.match(modal, /!event\.shiftKey && \(active === last \|\| !dialog\.contains\(active\)\)/);
  assert.match(modal, /last\.focus\(\)/);
  assert.match(modal, /first\.focus\(\)/);
});

test("Escape closes the modal and restores focus to its opener", () => {
  assert.match(modal, /event\.key === "Escape"[\s\S]*?close\(\)/);
  assert.match(modal, /const trigger = document\.activeElement/);
  assert.match(modal, /trigger\.isConnected[\s\S]*?trigger\.focus\(/);
  assert.match(modal, /initialFocus[\s\S]*?\.focus\(\{ preventScroll: true \}\)/);
});

test("successful saves restore focus after the refreshed view renders", () => {
  const closeIndex = modal.indexOf('close({ restoreFocus: false })');
  const renderIndex = modal.indexOf("renderView();", closeIndex);
  const restoreIndex = modal.indexOf("restoreTriggerFocus();", renderIndex);
  assert.ok(closeIndex >= 0 && renderIndex > closeIndex && restoreIndex > renderIndex,
    "successful saves must restore focus after the refreshed dashboard view renders");
});
