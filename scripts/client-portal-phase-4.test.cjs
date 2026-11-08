"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const portal = fs.readFileSync(path.join(root, "client-portal", "index.html"), "utf8");

const helperStart = portal.indexOf("function financialMoney(");
const helperEnd = portal.indexOf("\nfunction getClientNextStep", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "Financial calculation helpers must be isolated for testing.");

const context = {
  esc: value => String(value == null ? "" : value),
  date: value => value ? String(value).slice(0, 10) : "—",
  projectTodayDate: () => "2026-11-08"
};

vm.runInNewContext(
  portal.slice(helperStart, helperEnd) +
    "\nthis.invoiceFinancialBreakdown=invoiceFinancialBreakdown;" +
    "\nthis.invoiceDueState=invoiceDueState;" +
    "\nthis.isClientInvoicePayable=isClientInvoicePayable;" +
    "\nthis.filterPortalInvoices=filterPortalInvoices;" +
    "\nthis.formatFinancialTotal=formatFinancialTotal;" +
    "\nthis.buildFinancialSummary=buildFinancialSummary;",
  context
);

test("invoice breakdown separates total, paid-to-date and remaining balance without negative figures", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.invoiceFinancialBreakdown({
      total: 1500,
      amount_outstanding: 450,
      currency: "ZAR"
    }))),
    { total: 1500, paid: 1050, outstanding: 450, currency: "ZAR" }
  );

  const overpaid = context.invoiceFinancialBreakdown({
    total: 500,
    amount_outstanding: -25,
    currency: "ZAR"
  });
  assert.equal(overpaid.paid, 500);
  assert.equal(overpaid.outstanding, 0);
});

test("invoice due guidance detects overdue, due today, upcoming and settled balances", () => {
  const today = "2026-11-08";
  assert.equal(context.invoiceDueState({ status: "sent", total: 100, amount_outstanding: 100, due_date: "2026-11-07" }, today).state, "overdue");
  assert.equal(context.invoiceDueState({ status: "sent", total: 100, amount_outstanding: 100, due_date: today }, today).state, "today");
  assert.equal(context.invoiceDueState({ status: "partially paid", total: 100, amount_outstanding: 50, due_date: "2026-11-10" }, today).state, "soon");
  assert.equal(context.invoiceDueState({ status: "paid", total: 100, amount_outstanding: 0, due_date: "2026-11-01" }, today).state, "settled");
  assert.equal(context.invoiceDueState({ status: "sent", total: 100, amount_outstanding: 100 }, today).state, "unscheduled");
});

test("invoice filters separate open and paid records and never expose draft or cancelled invoices", () => {
  const invoices = [
    { id: "open", status: "sent", total: 100, amount_outstanding: 100 },
    { id: "partial", status: "partially paid", total: 100, amount_outstanding: 20 },
    { id: "paid", status: "paid", total: 100, amount_outstanding: 0 },
    { id: "zero-balance", status: "sent", total: 100, amount_outstanding: 0 },
    { id: "draft", status: "draft", total: 400, amount_outstanding: 400 },
    { id: "cancelled", status: "cancelled", total: 500, amount_outstanding: 500 }
  ];
  assert.deepEqual(context.filterPortalInvoices(invoices, "all").map(item => item.id), ["open", "partial", "paid", "zero-balance"]);
  assert.deepEqual(context.filterPortalInvoices(invoices, "outstanding").map(item => item.id), ["open", "partial"]);
  assert.deepEqual(context.filterPortalInvoices(invoices, "paid").map(item => item.id), ["paid", "zero-balance"]);
});

test("financial summary groups invoice balances by currency and excludes unissued drafts", () => {
  const invoices = [
    { status: "sent", currency: "ZAR", total: 1200, amount_outstanding: 300, due_date: "2026-11-07" },
    { status: "paid", currency: "ZAR", total: 800, amount_outstanding: 0 },
    { status: "sent", currency: "USD", total: 100, amount_outstanding: 50, due_date: "2026-11-20" },
    { status: "draft", currency: "ZAR", total: 9000, amount_outstanding: 9000 }
  ];
  const summary = context.buildFinancialSummary(invoices, [{ id: "p1" }, { id: "p2" }], "2026-11-08");
  assert.equal(summary.openCount, 2);
  assert.equal(summary.overdueCount, 1);
  assert.equal(summary.invoiceCount, 3);
  assert.equal(summary.paymentCount, 2);
  assert.match(summary.outstanding, /ZAR/);
  assert.match(summary.outstanding, /USD/);
  assert.match(summary.invoiced, /ZAR/);
  assert.match(summary.invoiced, /USD/);
});

test("financial centre exposes detail actions and does not advertise an unconfigured online checkout", () => {
  assert.match(portal, /data-invoice-filter="outstanding"/);
  assert.match(portal, /data-financial-type="invoice"/);
  assert.match(portal, /Request payment instructions/);
  assert.match(portal, /Online payment is not available through this portal/);
  assert.doesNotMatch(portal, /Pay now/i);
  assert.match(portal, /data-financial-type="payment"/);
});
