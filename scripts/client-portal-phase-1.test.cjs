"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const portal = fs.readFileSync(path.join(root, "client-portal", "index.html"), "utf8");

const helperStart = portal.indexOf("function isClientInvoicePayable(");
const helperEnd = portal.indexOf("\nfunction bindPortalNavigation", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "The next-step resolver must exist as an isolated helper.");
const helperSource = portal.slice(helperStart, helperEnd);
const context = {};
vm.runInNewContext(helperSource + "\nthis.getClientNextStep = getClientNextStep;", context);
const getNextStep = context.getClientNextStep;

test("incomplete onboarding is the first action shown to a client", () => {
  const result = getNextStep({ status: "in_progress" }, [], [], [], []);
  assert.equal(result.target, "onboarding-section");
  assert.equal(result.action, "Continue onboarding");
  assert.equal(result.badge, "Action needed");
});

test("an overdue invoice with a positive balance takes priority", () => {
  const result = getNextStep(
    { status: "submitted" },
    [{ status: "overdue", amount_outstanding: 850 }],
    [{ status: "sent" }],
    [{ status: "in progress" }],
    [{ status: "in progress" }]
  );
  assert.equal(result.target, "finances-section");
  assert.equal(result.badge, "Payment overdue");
});

test("only sent, partially paid and overdue invoices count as payable", () => {
  assert.equal(isClientInvoicePayable({ status: "draft", amount_outstanding: 1200 }), false);
  assert.equal(isClientInvoicePayable({ status: "cancelled", amount_outstanding: 1200 }), false);
  assert.equal(isClientInvoicePayable({ status: "sent", amount_outstanding: 1200 }), true);
  assert.equal(isClientInvoicePayable({ status: "partially paid", amount_outstanding: 300 }), true);
  assert.equal(isClientInvoicePayable({ status: "overdue", amount_outstanding: 300 }), true);
  assert.equal(isClientInvoicePayable({ status: "sent", amount_outstanding: 0 }), false);
});

test("a draft invoice cannot hide a quotation awaiting client review", () => {
  const result = getNextStep(
    { status: "submitted" },
    [{ status: "draft", amount_outstanding: 1200 }],
    [{ status: "sent", quote_number: "Q-101" }],
    [],
    []
  );
  assert.equal(result.action, "Review quotation");
  assert.equal(result.badge, "Awaiting your review");
});

test("a sent quotation is surfaced when there is no outstanding invoice", () => {
  const result = getNextStep(
    { status: "submitted" },
    [{ status: "paid", amount_outstanding: 0 }],
    [{ status: "sent", quote_number: "Q-100" }],
    [],
    []
  );
  assert.equal(result.target, "finances-section");
  assert.equal(result.action, "Review quotation");
});

test("an outstanding invoice is surfaced even when it is not overdue", () => {
  const result = getNextStep(
    { status: "submitted" },
    [{ status: "sent", amount_outstanding: 400 }],
    [],
    [],
    []
  );
  assert.equal(result.target, "finances-section");
  assert.equal(result.badge, "Payment due");
});

test("active projects become the next action after financial and onboarding actions", () => {
  const result = getNextStep(
    { status: "submitted" },
    [],
    [{ status: "accepted" }],
    [{ status: "in progress" }],
    [{ status: "in progress" }]
  );
  assert.equal(result.target, "projects-section");
  assert.equal(result.action, "View my projects");
});

test("completed projects remain accessible without being counted as active actions", () => {
  const result = getNextStep(
    { status: "submitted" },
    [],
    [],
    [],
    [{ status: "completed" }]
  );
  assert.equal(result.target, "projects-section");
  assert.equal(result.badge, "Workspace update");
});

test("a fully up-to-date workspace routes the client to requests", () => {
  const result = getNextStep({ status: "submitted" }, [], [], [], []);
  assert.equal(result.target, "request-section");
  assert.equal(result.badge, "All clear");
});

test("the dashboard has five navigation destinations with matching section IDs", () => {
  const destinations = [
    "overview-section",
    "projects-section",
    "finances-section",
    "onboarding-section",
    "request-section"
  ];
  for (const id of destinations) {
    assert.ok(portal.includes('href="#' + id + '"'), "navigation/action must link to " + id);
    assert.ok(portal.includes('id="' + id + '"'), "the destination section must exist: " + id);
  }
  assert.ok(portal.includes('aria-label="Your workspace"'), "navigation must have an accessible label.");
  assert.ok(portal.includes('aria-current="location"'), "the active navigation item must be exposed to assistive technology.");
});

test("the overview resolver uses current client records instead of fixed onboarding copy", () => {
  const renderStart = portal.indexOf("function render(data,onboarding){");
  const renderEnd = portal.indexOf("\nfunction openProjectModal", renderStart);
  assert.ok(renderStart >= 0 && renderEnd > renderStart, "The portal renderer must exist.");
  const render = portal.slice(renderStart, renderEnd);
  assert.ok(render.includes("getClientNextStep(onboarding,invoices,quotes,active,projects)"), "next-step guidance must be derived from loaded client records.");
  assert.ok(render.includes("invoices.filter(isClientInvoicePayable)"), "draft invoices must not inflate the client-facing outstanding total.");
  assert.ok(render.includes("esc(nextStep.title)") && render.includes("esc(nextStep.description)"), "dynamic next-step copy must be HTML-escaped.");
  assert.ok(render.includes('href="#\'+esc(nextStep.target)'), "the next-step action must route to its matching section.");
  assert.ok(render.includes("bindPortalNavigation()"), "the section navigation must be initialised after rendering.");
});

test("navigation supports active-section tracking and keyboard-visible focus", () => {
  assert.ok(portal.includes("new IntersectionObserver("), "visible section must update the active navigation item.");
  assert.ok(portal.includes('setAttribute("aria-current","location")'), "active section must update aria-current.");
  assert.ok(portal.includes(".portal-section-nav a:focus-visible"), "navigation links must have visible keyboard focus.");
  assert.ok(portal.includes("scroll-margin-top:146px"), "anchored sections must account for sticky navigation.");
});

test("the compact navigation and finance grid adapt to mobile widths", () => {
  assert.ok(portal.includes("@media(max-width:760px)"), "mobile breakpoint must exist.");
  assert.ok(portal.includes(".portal-section-nav{top:62px;width:100%"), "the section navigation must remain visible and usable on mobile.");
  assert.ok(portal.includes(".portal-finance-grid{grid-template-columns:1fr}"), "financial cards must stack on narrow screens.");
  assert.ok(portal.includes("grid-template-columns:repeat(2,minmax(0,1fr))"), "overview stats must use a compact two-column mobile layout.");
});

console.log("Client portal Phase 1 dashboard and navigation contract tests registered.");
