"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const workspace = fs.readFileSync(
  path.join(root, "admin-dashboard", "admin-workspace.js"),
  "utf8",
);
const workspaceCss = fs.readFileSync(
  path.join(root, "admin-dashboard", "admin-workspace.css"),
  "utf8",
);
const dashboardHtml = fs.readFileSync(
  path.join(root, "admin-dashboard", "index.html"),
  "utf8",
);

assert.ok(
  workspace.includes('type="button" class="sway-notification-item ') &&
  workspace.includes('class="sway-notification-row" role="listitem"'),
  "each notification must be a native open button inside a semantic list item",
);
assert.ok(
  workspace.includes('data-notification-clear="') &&
  workspace.includes('aria-label="Clear notification: '),
  "each notification must have a separate, labelled Clear button",
);
assert.ok(
  workspace.includes('toggle.setAttribute(') &&
  workspace.includes('" unread"'),
  "the notification trigger must announce the unread count",
);
assert.ok(
  workspace.includes("currentButton.focus();") &&
  workspace.includes('event.key !== "Escape"'),
  "Escape must close the notification panel and restore focus to its trigger",
);
assert.ok(
  workspace.includes('clearButton.closest(".sway-notification-row")') &&
  workspace.includes("nextFocus.focus();"),
  "clearing a notification must restore focus to an adjacent remaining item",
);
assert.ok(
  dashboardHtml.includes('role="region"') &&
  dashboardHtml.includes('aria-labelledby="sway-notification-title"') &&
  dashboardHtml.includes('role="list"') &&
  dashboardHtml.includes('aria-label="Workspace notifications"'),
  "the notification panel and list must have accessible semantics and names",
);
assert.ok(
  workspaceCss.includes(".sway-notification-item:focus-visible") &&
  workspaceCss.includes("outline: 2px solid #0152F4") &&
  workspaceCss.includes(".sway-notification-clear:focus-visible"),
  "notification open and clear actions must have visible keyboard focus",
);
assert.ok(
  dashboardHtml.includes("admin-workspace.js?v=20261107-notification-accessibility-1") &&
  dashboardHtml.includes("admin-workspace.css?v=20261107-notification-accessibility-1"),
  "updated dashboard assets must be cache-busted",
);

console.log("Admin notification accessibility contract tests passed.");
