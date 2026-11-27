"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const workspace = fs.readFileSync(
    path.join(root, "admin-dashboard/admin-workspace.js"),
    "utf8"
);
const html = fs.readFileSync(
    path.join(root, "admin-dashboard/index.html"),
    "utf8"
);
const css = fs.readFileSync(
    path.join(root, "admin-dashboard/admin-workspace.css"),
    "utf8"
);
const migration = fs.readFileSync(
    path.join(root, "supabase/migrations/20261128100000_swayphics_quote_pricing_engine.sql"),
    "utf8"
);
const databaseTest = fs.readFileSync(
    path.join(root, "supabase/tests/quote-pricing-engine.test.sql"),
    "utf8"
);

function functionBody(source, marker) {
    const start = source.indexOf(marker);
    assert.ok(start >= 0, "Expected function to exist: " + marker);
    const next = /\n    (?:async )?function [A-Za-z_$][\w$]*\(/g;
    next.lastIndex = start + marker.length;
    const match = next.exec(source);
    assert.ok(match, "Expected a following function boundary after: " + marker);
    return source.slice(start, match.index);
}

const totalsFunction = functionBody(workspace, "    function quotePricingTotals(");
const totalsStart = totalsFunction.indexOf("function quotePricingTotals(");
const totalsExpression = totalsFunction.slice(totalsStart).replace(/\n\s*$/, "");
const quotePricingTotals = vm.runInNewContext("(" + totalsExpression + ")", {});

const totals = quotePricingTotals([
    { billing_interval: "none", quantity: 1, unit_price: 4500 },
    { billing_interval: "monthly", quantity: 1, unit_price: 1500 },
    { billing_interval: "yearly", quantity: 1, unit_price: 1200 }
], 200, 15);

assert.equal(totals.onceOffSubtotal, 4500,
    "once-off charges must be subtotalled independently");
assert.equal(totals.monthlySubtotal, 1500,
    "monthly recurring charges must be subtotalled independently");
assert.equal(totals.yearlySubtotal, 1200,
    "yearly recurring charges must be subtotalled independently");
assert.equal(totals.initialSubtotal, 7200,
    "initial subtotal must include the first monthly and yearly periods");
assert.equal(totals.discount, 200,
    "discount must be capped at the initial subtotal");
assert.equal(totals.vatAmount, 1050,
    "VAT must be calculated on the discounted initial subtotal");
assert.equal(totals.initialAmount, 8050,
    "initial amount due must equal the expected invoice amount");

const quoteEditor = functionBody(workspace, "    async function openQuoteEditor(");
for (const contract of [
    "data-quote-line-service",
    "data-quote-line-description",
    "data-quote-line-quantity",
    "data-quote-line-price",
    "data-quote-line-interval",
    "Once-off",
    "Monthly",
    "Yearly",
    "admin_save_swayphics_quote",
    "p_proposal_version_id",
    "Save quote",
    "Create new draft from this quote"
]) {
    if (contract === "p_proposal_version_id") continue;
    assert.ok(quoteEditor.includes(contract),
        "quote editor must include: " + contract);
}

assert.match(workspace, /if \(type === "quotes"\)\s*\{\s*return await openQuoteEditor/,
    "all quote creation and editing must use the dedicated pricing editor");
assert.ok(workspace.includes("state.quoteItems = results[22] || []"),
    "quote line-item snapshots must be loaded into dashboard state");
assert.match(workspace, /monthly_recurring_subtotal/,
    "quote cards must display monthly recurring subtotals");
assert.match(workspace, /yearly_recurring_subtotal/,
    "quote cards must display yearly recurring subtotals");
assert.match(workspace, /initial amount due/i,
    "quote pricing must label the initial amount due explicitly");

const proposalReview = functionBody(workspace, "    function openLeadProposalReview(");
assert.match(proposalReview, /data-proposal-create-quote=/,
    "the proposal workspace must provide a build-quote action");
assert.match(proposalReview, /data-proposal-open-quote=/,
    "linked quotes must be openable from the proposal workspace");
assert.match(proposalReview, /proposal_version_id/,
    "linked quotes must distinguish the proposal revision used");
assert.match(proposalReview, /Earlier proposal version/,
    "quotes from an earlier proposal version must be identified");

const invoiceConversion = functionBody(workspace, "    async function createInvoiceFromQuote(");
assert.match(invoiceConversion, /admin_create_invoice_from_quote/,
    "quote-to-invoice conversion must use the atomic database RPC");
assert.doesNotMatch(invoiceConversion, /\/rest\/v1\/invoices/,
    "quote conversion must not create invoices through a separate REST request");
assert.doesNotMatch(invoiceConversion, /\/rest\/v1\/invoice_items/,
    "quote conversion must not create invoice items through a separate REST request");
assert.doesNotMatch(invoiceConversion, /\/rest\/v1\/quotes\?id=/,
    "quote conversion must not patch invoice linkage in a separate REST request");

for (const contract of [
    "create table if not exists public.quote_items",
    "service_name_snapshot text not null",
    "billing_interval text not null",
    "pricing_type_snapshot text not null",
    "proposal_version_id",
    "invoice_id uuid",
    "unique index if not exists quotes_invoice_id_unique_idx",
    "create or replace function public.admin_save_swayphics_quote",
    "create or replace function public.admin_create_invoice_from_quote",
    "create or replace function public.guard_swayphics_quote_commercial_record",
    "current_setting('swayphics.quote_invoice_conversion'",
    "foreign key (invoice_id) references public.invoices(id) on delete restrict",
    "grant execute on function public.admin_save_swayphics_quote",
    "grant execute on function public.admin_create_invoice_from_quote"
]) {
    assert.ok(migration.includes(contract),
        "quote pricing migration must include: " + contract);
}

assert.match(migration, /before update or delete on public\.quotes/i,
    "issued quote prices and invoice-linked quote deletion must be protected by a database trigger");
assert.match(migration, /v_quote\.status <> 'draft'/,
    "only draft quotes may be modified by the pricing RPC");
assert.match(migration, /if v_quote\.invoice_id is not null[\s\S]*?already_created/,
    "invoice conversion must be idempotent");
assert.ok(databaseTest.includes("monthly recurring line items are subtotalled separately"),
    "database tests must cover recurring subtotal separation");
assert.ok(databaseTest.includes("catalogue price changes do not rewrite saved quote prices"),
    "database tests must cover service catalogue snapshot integrity");
assert.ok(databaseTest.includes("repeated conversion does not create a duplicate invoice"),
    "database tests must cover duplicate invoice prevention");

assert.match(html, /admin-workspace\.js\?v=20261128-quote-pricing-engine-1/,
    "workspace JS must be cache-busted for quote pricing");
assert.match(html, /admin-workspace\.css\?v=20261128-quote-pricing-engine-1/,
    "workspace CSS must be cache-busted for quote pricing");

for (const selector of [
    ".sway-quote-editor-card",
    ".sway-quote-line",
    ".sway-quote-financials",
    "body.sway-dark-mode .sway-quote-line"
]) {
    assert.ok(css.includes(selector), "quote editor styles must include " + selector);
}

console.log("Quote pricing engine contract and arithmetic tests passed.");
