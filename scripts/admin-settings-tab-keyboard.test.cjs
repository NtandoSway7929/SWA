"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "admin-dashboard", "admin-settings-expanded.js"), "utf8");
const start = source.indexOf('root.addEventListener("keydown", function (event)');
const end = source.indexOf("\n        });", start);
assert.ok(start >= 0 && end > start, "Settings root must delegate tab keyboard events");
const handler = source.slice(start, end);

test("Settings tabs support Arrow, Home and End navigation", () => {
  for (const fragment of [
    'event.target.closest("[data-settings-tab]")',
    "root.contains(tab)",
    'event.key === "Home"',
    "next = tabs[0]",
    'event.key === "End"',
    "next = tabs[tabs.length - 1]",
    "selectTab(root, next.getAttribute",
    "next.focus()"
  ]) assert.ok(handler.includes(fragment), "missing keyboard behaviour: " + fragment);
});

test("Settings keyboard handling is delegated for dynamically-added tabs", () => {
  assert.ok(handler.includes('root.querySelectorAll("[data-settings-tab]")'));
});
