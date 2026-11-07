"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const workspacePath = path.join(
  __dirname,
  "..",
  "admin-dashboard",
  "admin-workspace.js"
);
const source = fs.readFileSync(workspacePath, "utf8");

function loadOutstandingInvoiceHelpers(invoices) {
  const start = source.indexOf("function invoiceOutstandingBalance(invoice)");
  const end = source.indexOf("function renderOverview()", start);
  assert.ok(start >= 0 && end > start,
    "shared outstanding-invoice helpers must appear before the Overview renderer");

  const helperSource = source.slice(start, end);
  const sandbox = { state: { invoices } };

  vm.runInNewContext(
    helperSource +
      "\nthis.invoiceOutstandingBalance = invoiceOutstandingBalance;" +
      "\nthis.activeOutstandingInvoices = activeOutstandingInvoices;",
    sandbox,
    { filename: "admin-workspace-outstanding-invoice-helpers.js" }
  );

  return sandbox;
}

test("active outstanding invoices exclude archived, paid, cancelled and zero-balance records", () => {
  const fixtures = [
    { id: "active-draft", status: "draft", total: 650, amount_outstanding: 650, archived: false },
    { id: "active-sent", status: "sent", total: 1500, amount_outstanding: 1500, archived: false },
    { id: "archived-unpaid", status: "sent", total: 400, amount_outstanding: 400, archived: true },
    { id: "paid-with-stale-balance", status: "paid", total: 100, amount_outstanding: 100, archived: false },
    { id: "cancelled-with-stale-balance", status: "cancelled", total: 200, amount_outstanding: 200, archived: false },
    { id: "zero-balance", status: "sent", total: 300, amount_outstanding: 0, archived: false },
    { id: "archived-paid", status: "paid", total: 500, amount_outstanding: 0, archived: true }
  ];

  const helpers = loadOutstandingInvoiceHelpers(fixtures);
  const active = Array.from(helpers.activeOutstandingInvoices());

  assert.deepEqual(
    active.map(invoice => invoice.id),
    ["active-draft", "active-sent"]
  );
  assert.equal(
    active.reduce((sum, invoice) => sum + helpers.invoiceOutstandingBalance(invoice), 0),
    2150
  );
});

test("legacy invoices without an outstanding amount use total, while invalid balances are ignored", () => {
  const fixtures = [
    { id: "legacy-total-fallback", status: "sent", total: 120, archived: false },
    { id: "null-balance-fallback", status: "sent", total: 80, amount_outstanding: null, archived: false },
    { id: "invalid-balance", status: "sent", total: 999, amount_outstanding: "not-a-number", archived: false }
  ];

  const helpers = loadOutstandingInvoiceHelpers(fixtures);
  const active = Array.from(helpers.activeOutstandingInvoices());

  assert.deepEqual(
    active.map(invoice => invoice.id),
    ["legacy-total-fallback", "null-balance-fallback"]
  );
  assert.equal(
    active.reduce((sum, invoice) => sum + helpers.invoiceOutstandingBalance(invoice), 0),
    200
  );
  assert.equal(helpers.invoiceOutstandingBalance(null), 0);
});

test("Overview and Cash Flow use one shared active outstanding-invoice definition", () => {
  const overviewStart = source.indexOf("function renderOverview()");
  const cashFlowStart = source.indexOf("function renderCashFlow()");
  const insightsStart = source.indexOf("function renderInsights()", cashFlowStart);

  assert.ok(overviewStart >= 0 && cashFlowStart > overviewStart && insightsStart > cashFlowStart,
    "Overview, Cash Flow and Insights renderers must remain discoverable");

  const overview = source.slice(overviewStart, overviewStart + 5000);
  const cashFlow = source.slice(cashFlowStart, insightsStart);

  assert.match(overview, /const outstanding\s*=\s*activeOutstandingInvoices\(\)\.reduce/);
  assert.match(overview, /money\(outstanding\)/);
  assert.match(cashFlow, /const outstandingInvoices\s*=\s*activeOutstandingInvoices\(\)/);
  assert.match(cashFlow, /invoiceOutstandingBalance\(invoice\)/);
});
