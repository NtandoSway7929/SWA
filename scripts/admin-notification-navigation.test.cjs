"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const workspace = fs.readFileSync(
  path.join(root, "admin-dashboard", "admin-workspace.js"),
  "utf8"
);
const workspaceCss = fs.readFileSync(
  path.join(root, "admin-dashboard", "admin-workspace.css"),
  "utf8"
);
const dashboardHtml = fs.readFileSync(
  path.join(root, "admin-dashboard", "index.html"),
  "utf8"
);

function section(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, label + " start marker must exist");
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, label + " end marker must follow its start");
  return source.slice(start, end);
}

const targetContract = section(
  workspace,
  "const notificationEntityViewMap = {",
  "function getRequestedNotificationTarget()",
  "notification target normalizer"
);
const testContext = {
  nav: [
    ["leads"], ["tasks"], ["followups"], ["quotes"], ["payments"],
    ["clients"], ["projects"], ["invoices"], ["email"], ["enquiries"],
    ["portal-requests"], ["innerme"], ["overview"]
  ]
};
vm.createContext(testContext);
vm.runInContext(
  targetContract + "\nglobalThis.normalizeNotificationTarget = normalizeNotificationTarget;",
  testContext
);
const normalizeNotificationTarget = testContext.normalizeNotificationTarget;

test("notification target normalization allowlists views and derives known entity destinations", () => {
  const leadId = "123e4567-e89b-42d3-a456-426614174000";
  assert.deepEqual(
    JSON.parse(JSON.stringify(normalizeNotificationTarget({
      view: "overview",
      entityType: "lead",
      entityId: leadId
    }))),
    { view: "leads", entityType: "lead", entityId: leadId }
  );

  assert.equal(normalizeNotificationTarget({
    view: "not-a-dashboard-view",
    entityType: "unknown_entity",
    entityId: leadId
  }), null);

  assert.equal(normalizeNotificationTarget({
    view: "javascript:alert(1)",
    entityType: "",
    entityId: ""
  }), null);
});

test("malformed record IDs cannot reach record-opening selectors", () => {
  const target = normalizeNotificationTarget({
    view: "leads",
    entityType: "lead",
    entityId: '"] [data-edit="tasks'
  });
  assert.ok(target);
  assert.equal(target.entityId, "");

  const valid = normalizeNotificationTarget({
    view: "leads",
    entityType: "lead",
    entityId: "123e4567-e89b-42d3-a456-426614174000"
  });
  assert.equal(valid.entityId, "123e4567-e89b-42d3-a456-426614174000");
});

test("in-app notification rows are keyboard-operable buttons with record metadata", () => {
  const renderer = section(
    workspace,
    "function renderNotificationPanel() {",
    "function updateNotificationCenter()",
    "notification panel renderer"
  );

  assert.match(renderer, /class="sway-notification-open"/);
  assert.match(renderer, /data-notification-open/);
  assert.match(renderer, /data-notification-entity-type/);
  assert.match(renderer, /data-notification-entity-id/);
  assert.match(renderer, /aria-label="Open notification:/);
  assert.match(renderer, /data-notification-clear=/);
  assert.match(renderer, /<button type="button" class="sway-notification-clear"/);
});

test("in-app notification clicks mark only that item read and reuse the shared record router", () => {
  const setup = section(
    workspace,
    "function setupNotificationCenter() {",
    "const MOBILE_SIDEBAR_BREAKPOINT",
    "notification event bindings"
  );

  assert.match(setup, /list\.onclick = async function/);
  assert.match(setup, /event\.target\.closest\(\s*"\[data-notification-clear\]"/);
  assert.match(setup, /event\.target\.closest\(\s*"\[data-notification-open\]"/);
  assert.match(setup, /await markNotificationRead\(key\)/);
  assert.match(setup, /await openRequestedNotificationTarget\(target\)/);
  assert.match(setup, /closeNotificationCenter\(\)/);
  assert.ok(
    setup.indexOf("[data-notification-clear]") < setup.indexOf("[data-notification-open]"),
    "Clear must be handled separately before the notification open action"
  );
});

test("record routing uses fixed selectors and exact DOM attribute comparisons", () => {
  const finder = section(
    workspace,
    "function findNotificationRecordAction(",
    "function findNotificationRecordRow(",
    "notification record action finder"
  );
  assert.match(finder, /'\[data-edit="leads"\]\[data-id\]'/);
  assert.match(finder, /'\[data-edit="tasks"\]\[data-id\]'/);
  assert.match(finder, /'\[data-edit="followups"\]\[data-id\]'/);
  assert.match(finder, /'\[data-edit="quotes"\]\[data-id\]'/);
  assert.match(finder, /'\[data-invoice-action="edit"\]\[data-id\]'/);
  assert.match(finder, /getAttribute\(definition\.attribute\) === entityId/);
  assert.doesNotMatch(finder, /querySelector\([^)]*entityId/);
});

test("browser-push deep links and in-app clicks share the validated record resolver", () => {
  const routeReader = section(
    workspace,
    "function getRequestedNotificationTarget() {",
    "function findNotificationRecordAction(",
    "push route reader"
  );
  const routeOpener = section(
    workspace,
    "async function openRequestedNotificationTarget(",
    "function getRequestedWorkspaceView()",
    "notification target opener"
  );

  assert.match(routeReader, /normalizeNotificationTarget\(/);
  assert.match(routeOpener, /normalizeNotificationTarget\(target\)/);
  assert.match(routeOpener, /entityType === "email"/);
  assert.match(routeOpener, /findNotificationRecordAction\(entityType, entityId\)/);
  assert.match(routeOpener, /findNotificationRecordRow\(view, entityId\)/);
});

test("fallback notifications retain exact task, follow-up, enquiry and invoice targets", () => {
  const fallback = section(
    workspace,
    "function fallbackWorkspaceNotifications() {",
    "function workspaceNotifications()",
    "fallback notification builder"
  );
  assert.match(fallback, /entityType: "enquiry"[\s\S]*?entityId: item\.id/);
  assert.match(fallback, /entityType: "task"[\s\S]*?entityId: item\.id/);
  assert.match(fallback, /entityType: "follow_up"[\s\S]*?entityId: item\.id/);
  assert.match(fallback, /entityType: "invoice"[\s\S]*?entityId: invoice\.id/);
});

test("notification controls retain visible keyboard focus in light and dark themes", () => {
  assert.match(workspaceCss, /\.sway-notification-open:focus-visible/);
  assert.match(workspaceCss, /\.sway-notification-item:focus-within/);
  assert.match(dashboardHtml, /body\.sway-dark-mode \.sway-notification-open:focus-visible/);
  assert.match(dashboardHtml, /admin-workspace\.js\?v=20261108-client-document-sharing-1/);
});

console.log("Admin notification navigation regression checks passed.");
