"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const dashboardPath = path.join(__dirname, "..", "admin-dashboard", "index.html");
const html = fs.readFileSync(dashboardPath, "utf8");
const start = html.indexOf("function createDialog(options)");
const end = html.indexOf("function escapeDialogHtml", start);
assert.ok(start >= 0 && end > start, "the shared Swayphics dialog implementation must be present");
const dialog = html.slice(start, end);

test("branded dialogs expose a programmatic title and description", () => {
  assert.match(dialog, /setAttribute\("role", "dialog"\)/);
  assert.match(dialog, /setAttribute\("aria-modal", "true"\)/);
  assert.match(dialog, /setAttribute\("aria-labelledby", dialogId \+ "-title"\)/);
  assert.match(dialog, /setAttribute\("aria-describedby", dialogId \+ "-message"\)/);
  assert.match(dialog, /id="' \+ dialogId \+ '-title"/);
  assert.match(dialog, /id="' \+ dialogId \+ '-message"/);
});

test("branded dialogs trap Tab and Shift+Tab within visible enabled controls", () => {
  assert.match(dialog, /if \(event\.key !== "Tab"\) return/);
  assert.match(dialog, /const focusableElements = Array\.from\(dialog\.querySelectorAll/);
  assert.match(dialog, /!element\.disabled/);
  assert.match(dialog, /!element\.hidden/);
  assert.match(dialog, /focusIsOutside = !dialog\.contains\(document\.activeElement\)/);
  assert.match(dialog, /event\.shiftKey[\s\S]*?last\.focus\(\)/);
  assert.match(dialog, /!event\.shiftKey[\s\S]*?first\.focus\(\)/);
});

test("Escape cancels safely and Enter is left to the focused native button", () => {
  assert.match(dialog, /if \(event\.key === "Escape"\)[\s\S]*?event\.stopPropagation\(\)[\s\S]*?finish\(/);
  assert.doesNotMatch(dialog, /event\.key === "Enter"/,
    "a document-level Enter handler must not turn Cancel into Confirm");
  assert.match(dialog, /cancelButton\.addEventListener\("click"/);
  assert.match(dialog, /confirmButton\.addEventListener\("click"/);
});

test("closing a dialog restores focus when its opener remains in the document", () => {
  assert.match(dialog, /const previousFocus = document\.activeElement/);
  assert.match(dialog, /previousFocus && previousFocus\.isConnected[\s\S]*?previousFocus\.focus\(\)/);
});
