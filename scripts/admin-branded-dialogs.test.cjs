"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const html = fs.readFileSync(
  path.join(__dirname, "..", "admin-dashboard", "index.html"),
  "utf8"
);
const start = html.indexOf("function createDialog(options)");
const end = html.indexOf("function escapeDialogHtml", start);
assert.ok(start >= 0 && end > start, "shared Swayphics dialog implementation must exist");
const dialog = html.slice(start, end);

test("branded dialogs expose an accessible name and description", () => {
  assert.match(dialog, /setAttribute\("role", "dialog"\)/);
  assert.match(dialog, /setAttribute\("aria-modal", "true"\)/);
  assert.match(dialog, /setAttribute\("aria-labelledby", dialogId \+ "-title"\)/);
  assert.match(dialog, /setAttribute\("aria-describedby", dialogId \+ "-message"\)/);
  assert.match(dialog, /id="\' \+ dialogId \+ \'-title/);
  assert.match(dialog, /id="\' \+ dialogId \+ \'-message/);
});

test("dialog traps Tab focus and supports Escape dismissal", () => {
  assert.match(dialog, /event\.key !== "Tab"/);
  assert.match(dialog, /event\.shiftKey/);
  assert.match(dialog, /focusIsOutside/);
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(dialog, /event\.stopPropagation\(\)/);
});

test("dialog restores focus and leaves native Enter activation intact", () => {
  assert.match(dialog, /const previousFocus = document\.activeElement/);
  assert.match(dialog, /previousFocus\.focus\(\)/);
  assert.doesNotMatch(dialog, /event\.key === "Enter"/);
});
