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

  const legacyRecord = context.invoiceFinancialBreakdown({
    status: "sent",
    amount_outstanding: 75
  });
  assert.equal(legacyRecord.outstanding, 75);
  assert.equal(legacyRecord.paid, 0);
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
  const ids = filter => JSON.parse(JSON.stringify(context.filterPortalInvoices(invoices, filter).map(item => item.id)));
  assert.deepEqual(ids("all"), ["open", "partial", "paid", "zero-balance"]);
  assert.deepEqual(ids("outstanding"), ["open", "partial"]);
  assert.deepEqual(ids("paid"), ["paid", "zero-balance"]);
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

test("financial centre exposes provider-aware online checkout only when enabled and verifies payment before updating", () => {
  assert.match(portal, /data-invoice-filter="outstanding"/);
  assert.match(portal, /data-financial-type="invoice"/);
  assert.match(portal, /Request payment instructions/);
  assert.match(portal, /item\.online_payment_enabled&&modal\.dataset\.invoiceProvider/);
  assert.match(portal, /Pay online with Paystack/);
  assert.match(portal, /const provider=String\(item&&item\.online_payment_provider\|\|""\)\.trim\(\)\.toLowerCase\(\)/);
  assert.match(portal, /Yoco · Test checkout/);
  assert.match(portal, /create-payment-checkout/);
  assert.match(portal, /create-paystack-payment-checkout/);
  assert.match(portal, /get-payment-status/);
  assert.match(portal, /get-paystack-payment-status/);
  assert.match(portal, /latest\.confirmed/);
  assert.match(portal, /Your invoice is updated only after Swayphics receives verified payment confirmation/);
  assert.doesNotMatch(portal, /Pay now/i);
  assert.match(portal, /data-financial-type="payment"/);
});

function loadPortalPaymentFunctions(options = {}) {
  const start = portal.indexOf("async function startOnlineCheckout(");
  const end = portal.indexOf("async function bankTransferPortalApi(", start);
  assert.ok(start >= 0 && end > start, "Portal online checkout and return handlers must exist.");

  const calls = [];
  let redirectedTo = "";
  let cleanedUrl = "";
  let reloadCount = 0;
  const hero = { appendChild(node) { this.status = node; } };
  const window = options.window || {
    crypto: { randomUUID: () => "portal-idempotency-key-0001" },
    location: {
      href: "https://swayphics.co.za/client-portal/",
      assign: value => { redirectedTo = value; },
      reload: () => { reloadCount += 1; }
    },
    history: {
      replaceState: (_state, _title, url) => { cleanedUrl = String(url); }
    },
    setTimeout: callback => callback()
  };
  const document = options.document || {
    title: "Swayphics Client Portal",
    querySelector: selector => selector === ".portal-hero" ? hero : null,
    createElement: () => ({
      setAttribute() {},
      className: "",
      textContent: ""
    })
  };
  const context = {
    window,
    document,
    URL,
    URLSearchParams,
    Promise,
    yocoPortalApi: options.yocoPortalApi || (async (functionName, payload) => {
      calls.push({ functionName, payload });
      return { checkout_url: "https://checkout.example.test/session" };
    })
  };
  vm.runInNewContext(
    portal.slice(start, end) +
      "\nthis.startOnlineCheckout=startOnlineCheckout;" +
      "\nthis.checkPaymentReturn=checkPaymentReturn;",
    context
  );
  return {
    context,
    calls,
    hero,
    get redirectedTo() { return redirectedTo; },
    get cleanedUrl() { return cleanedUrl; },
    get reloadCount() { return reloadCount; }
  };
}

test("outstanding invoices show separated, prominent online and bank-transfer payment choices", () => {
  const start = portal.indexOf("function invoicePaymentProvider(");
  const end = portal.indexOf("\nfunction renderQuote(", start);
  assert.ok(start >= 0 && end > start, "Invoice rendering helpers must be isolated for testing.");

  const context = {
    esc: value => String(value == null ? "" : value),
    date: value => value ? String(value).slice(0, 10) : "—",
    financialMoney: (value, currency) => String(currency || "ZAR") + " " + Number(value || 0).toFixed(2),
    chip: value => "<span>" + String(value || "") + "</span>",
    invoiceFinancialBreakdown: item => {
      const total = Number(item.total || item.amount_outstanding || 0);
      const outstanding = Math.max(0, Number(item.amount_outstanding || 0));
      return { total, paid: Math.max(0, total - outstanding), outstanding, currency: String(item.currency || "ZAR").toUpperCase() };
    },
    invoiceDueState: () => ({ state: "scheduled", label: "Due soon" }),
    isClientInvoicePayable: item => ["sent", "partially paid", "overdue"].includes(String(item.status || "").toLowerCase()) && Number(item.amount_outstanding || 0) > 0
  };
  vm.runInNewContext(
    portal.slice(start, end) + "\nthis.renderInvoice = renderInvoice;",
    context
  );

  const invoice = {
    id: "invoice-1",
    invoice_number: "SWY-TEST-001",
    status: "sent",
    total: 1500,
    amount_outstanding: 1500,
    currency: "ZAR",
    online_payment_enabled: true,
    online_payment_provider: "paystack"
  };
  const html = context.renderInvoice(invoice);
  assert.match(html, /class="finance-payment-choices"/);
  assert.match(html, /Pay online with Paystack/);
  assert.match(html, /Secure, hosted checkout/);
  assert.match(html, /Pay by bank transfer/);
  assert.match(html, /EFT · Submit proof of payment/);
  assert.doesNotMatch(html, /Online payment unavailable/);
  assert.match(html, /role="group" aria-label="Choose a payment method"/);
  assert.ok(portal.includes(".financial-item-actions{display:grid;"));
  assert.ok(portal.includes(".finance-payment-choice{") && portal.includes("min-height:78px"));

  const bankOnlyHtml = context.renderInvoice({ ...invoice, online_payment_enabled: false });
  assert.doesNotMatch(bankOnlyHtml, /Pay online with Paystack/);
  assert.match(bankOnlyHtml, /Pay by bank transfer/);

  const unsupportedOnlineHtml = context.renderInvoice({ ...invoice, currency: "USD" });
  assert.match(unsupportedOnlineHtml, /Online payment unavailable/);

  const providerMissingHtml = context.renderInvoice({ ...invoice, online_payment_provider: undefined });
  assert.match(providerMissingHtml, /Online payment unavailable/);
  assert.doesNotMatch(providerMissingHtml, /Yoco · Test checkout/);
  assert.doesNotMatch(unsupportedOnlineHtml, /Pay online with Paystack/);
});

test("client portal routes Paystack Live and Yoco Test invoices to their matching checkout functions", async () => {
  for (const [provider, expectedFunction] of [
    ["paystack", "create-paystack-payment-checkout"],
    ["yoco", "create-payment-checkout"]
  ]) {
    const harness = loadPortalPaymentFunctions();
    const modal = { dataset: { invoiceId: "11111111-1111-4111-8111-111111111111", invoiceProvider: provider } };
    const amountInput = { value: "25.00", min: "2.00", max: "100.00" };
    const button = { disabled: false, textContent: "Continue to checkout" };
    const statusBox = { hidden: true, className: "", textContent: "" };

    await harness.context.startOnlineCheckout(modal, amountInput, button, statusBox);

    assert.equal(harness.calls.length, 1);
    assert.equal(harness.calls[0].functionName, expectedFunction);
    assert.equal(harness.calls[0].payload.amount_cents, 2500);
    assert.equal(harness.calls[0].payload.idempotency_key, "portal-idempotency-key-0001");
    assert.match(statusBox.textContent, new RegExp(provider === "paystack" ? "Paystack" : "Yoco Test"));
    assert.equal(harness.redirectedTo, "https://checkout.example.test/session");
  }
});

test("client portal verifies a Paystack return using the Paystack status function and clears callback parameters after confirmation", async () => {
  const window = {
    crypto: { randomUUID: () => "unused" },
    location: {
      href: "https://swayphics.co.za/client-portal/?payment_attempt=22222222-2222-4222-8222-222222222222&payment_provider=paystack",
      search: "?payment_attempt=22222222-2222-4222-8222-222222222222&payment_provider=paystack",
      assign() {},
      reload() { this.reloaded = true; }
    },
    history: { replaceState(_state, _title, url) { this.cleanedUrl = String(url); } },
    setTimeout(callback) { callback(); }
  };
  const harness = loadPortalPaymentFunctions({
    window,
    yocoPortalApi: async (functionName, payload) => {
      harnessCalls.push({ functionName, payload });
      return { confirmed: true, attempt: { status: "succeeded" } };
    }
  });
  const harnessCalls = [];

  await harness.context.checkPaymentReturn();

  assert.equal(harnessCalls.length, 1);
  assert.equal(harnessCalls[0].functionName, "get-paystack-payment-status");
  assert.equal(harnessCalls[0].payload.attempt_id, "22222222-2222-4222-8222-222222222222");
  assert.match(harness.hero.status.textContent, /Payment confirmed/);
  const cleaned = new URL(window.history.cleanedUrl);
  assert.equal(cleaned.searchParams.has("payment_attempt"), false);
  assert.equal(cleaned.searchParams.has("payment_provider"), false);
  assert.equal(window.location.reloaded, true);
});
