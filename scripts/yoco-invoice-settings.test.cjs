"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const panel = fs.readFileSync(path.join(root, "admin-dashboard", "yoco-invoice-settings.js"), "utf8");
const html = fs.readFileSync(path.join(root, "admin-dashboard", "index.html"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase", "migrations", "202611110008_yoco_admin_invoice_settings.sql"), "utf8");
const paymentMigration = fs.readFileSync(path.join(root, "supabase", "migrations", "202611110003_yoco_atomic_payment_operations.sql"), "utf8");
const paymentFlowTest = fs.readFileSync(path.join(root, "supabase", "tests", "202611110006_yoco_payment_flow.test.sql"), "utf8");

test("invoice payment settings panel is loaded by the admin dashboard", () => {
  assert.match(html, /yoco-invoice-settings\.js\?v=20261111-stage-1-48/);
  assert.ok(html.indexOf("yoco-invoice-settings.js") < html.indexOf("</body>"));
});

test("panel verifies the active administrator before loading invoice records", () => {
  assert.match(panel, /async function verifyAdmin\(\)/);
  assert.match(panel, /\/auth\/v1\/user/);
  assert.match(panel, /\/rest\/v1\/admin_users/);
  assert.match(panel, /await verifyAdmin\(\);[\s\S]*?invoices = await api/);
});

test("invoice selector excludes draft, cancelled, paid and zero-balance invoices", () => {
  assert.match(panel, /\["draft", "cancelled", "paid"\]/);
  assert.match(panel, /Number\(item\.amount_outstanding != null \? item\.amount_outstanding : item\.total\) > 0/);
});

test("online payments are opt-in and partial payments require online payments", () => {
  assert.match(panel, /invoice\.online_payment_enabled \? "checked" : ""/);
  assert.match(panel, /if \(partial && !online\)/);
  assert.match(panel, /partial\.disabled = !online\.checked/);
});

test("deposit input is enabled only for online partial payments", () => {
  assert.match(panel, /deposit\.disabled = !online\.checked \|\| !partial\.checked/);
  assert.match(panel, /deposit > outstanding/);
  assert.match(panel, /A minimum deposit requires partial payments/);
});

test("save uses the guarded server RPC rather than direct invoice table updates", () => {
  assert.match(panel, /\/rest\/v1\/rpc\/admin_set_invoice_yoco_settings/);
  assert.doesNotMatch(panel, /method:\s*"PATCH"/);
  assert.doesNotMatch(panel, /\/rest\/v1\/invoices\?[^\n]*method/);
});

test("invoice identifiers and displayed fields are HTML escaped", () => {
  assert.match(panel, /function escapeHtml\(value\)/);
  assert.match(panel, /escapeHtml\(invoice\.invoice_number/);
  assert.match(panel, /escapeHtml\(item\.id\)/);
});

test("server RPC requires an authenticated Swayphics administrator", () => {
  assert.match(migration, /auth\.uid\(\) is null or not coalesce\(public\.is_swayphics_admin\(\), false\)/);
  assert.match(migration, /using errcode = '42501'/);
  assert.match(migration, /grant execute on function public\.admin_set_invoice_yoco_settings[\s\S]*to authenticated/);
});

test("server RPC locks the invoice and rejects ineligible invoice states", () => {
  assert.match(migration, /where i\.id = p_invoice_id\s+for update/);
  assert.match(migration, /v_invoice\.status in \('draft', 'cancelled', 'paid'\)/);
  assert.match(migration, /amount_outstanding, v_invoice\.total, 0\) <= 0/);
});

test("server RPC enforces partial-payment and deposit constraints", () => {
  assert.match(migration, /if v_partial and not v_online then/);
  assert.match(migration, /if v_deposit is not null then/);
  assert.match(migration, /v_deposit > coalesce\(v_invoice\.amount_outstanding, v_invoice\.total, 0\)/);
  assert.match(migration, /deposit_amount = case when v_online and v_partial then v_deposit else null end/);
});

test("settings panel does not contain Yoco private credentials or activate live mode", () => {
  assert.doesNotMatch(panel, /sk_live_|sk_test_|webhook_secret/i);
  assert.match(panel, /Live payments are not enabled by this control/);
});

test("deposit is required only on the first invoice payment", () => {
  assert.match(paymentMigration, /not exists\s*\(\s*select 1\s*from public\.payments p\s*where p\.invoice_id = v_invoice\.id\s*and p\.status in \('paid', 'partially paid'\)/);
  assert.match(paymentFlowTest, /subsequent instalment may be below the initial deposit threshold/);
});

test("competing successful checkouts cannot overpay an invoice or retry indefinitely", () => {
  assert.match(paymentMigration, /v_attempt\.amount_cents > v_available_cents/);
  assert.match(paymentMigration, /failure_code = 'invoice_balance_changed'/);
  assert.match(paymentMigration, /processing_status = 'requires_review'/);
  assert.match(paymentFlowTest, /a competing successful checkout is routed to manual review/);
  assert.match(paymentFlowTest, /competing checkout is not inserted as an overpayment/);
});

test("invoice payment settings opens from its Sales & Billing navigation destination", () => {
  assert.match(panel, /data-view="invoice-settings"/);
  assert.match(panel, /async function openSettings\(\)/);
  assert.match(panel, /stopImmediatePropagation\(\)/);
  assert.match(panel, /\.syi-launch\{display:none;/);
});
