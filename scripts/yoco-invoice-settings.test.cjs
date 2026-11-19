"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const panel = fs.readFileSync(path.join(root, "admin-dashboard", "yoco-invoice-settings.js"), "utf8");
const html = fs.readFileSync(path.join(root, "admin-dashboard", "index.html"), "utf8");
const workspace = fs.readFileSync(path.join(root, "admin-dashboard", "admin-workspace.js"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase", "migrations", "20261119190000_paystack_all_invoices_default.sql"), "utf8");
const paymentMigration = fs.readFileSync(path.join(root, "supabase", "migrations", "202611110003_yoco_atomic_payment_operations.sql"), "utf8");
const paymentFlowTest = fs.readFileSync(path.join(root, "supabase", "tests", "202611110006_yoco_payment_flow.test.sql"), "utf8");

test("partial-payment settings panel is loaded with a refreshed cache key", () => {
  assert.match(html, /yoco-invoice-settings\.js\?v=20261119-paystack-all-invoices-1/);
  assert.ok(html.indexOf("yoco-invoice-settings.js") < html.indexOf("</body>"));
});

test("panel verifies the active administrator before loading invoice records", () => {
  assert.match(panel, /async function verifyAdmin\(\)/);
  assert.match(panel, /\/auth\/v1\/user/);
  assert.match(panel, /\/rest\/v1\/admin_users/);
  assert.match(panel, /await verifyAdmin\(\);[\s\S]*?invoices = await api/);
});

test("Paystack Live availability is automatic and cannot be toggled or assigned per invoice", () => {
  assert.match(panel, /Paystack Live is enabled automatically/);
  assert.match(panel, /automatically enabled for every issued ZAR invoice/);
  assert.doesNotMatch(panel, /data-provider/);
  assert.doesNotMatch(panel, /data-online/);
  assert.doesNotMatch(panel, /Yoco · Test only/);
  assert.match(panel, /p_online_payment_enabled: true/);
  assert.match(panel, /p_provider: "paystack"/);
  assert.match(workspace, /\["invoice-settings", "Partial payments"\]/);
  assert.match(workspace, /Paystack is available automatically on every issued ZAR invoice/);
});

test("invoice selector contains only issued invoices with an outstanding balance", () => {
  assert.match(panel, /\["draft", "cancelled", "paid"\]/);
  assert.match(panel, /Number\(item\.amount_outstanding != null \? item\.amount_outstanding : item\.total\) > 0/);
});

test("partial payments remain an optional invoice-level setting", () => {
  assert.match(panel, /invoice\.partial_payment_enabled \? "checked" : ""/);
  assert.match(panel, /deposit\.disabled = !partial\.checked/);
  assert.doesNotMatch(panel, /partial\.disabled = !online/);
});

test("deposit input is available only for partial payments and is capped at outstanding balance", () => {
  assert.match(panel, /deposit\.disabled = !partial\.checked/);
  assert.match(panel, /deposit > outstanding/);
  assert.match(panel, /A minimum deposit requires partial payments/);
});

test("settings save uses the guarded server RPC and fixes Paystack flags regardless of legacy form inputs", () => {
  assert.match(panel, /\/rest\/v1\/rpc\/admin_set_invoice_payment_settings/);
  assert.match(panel, /p_online_payment_enabled: true/);
  assert.match(panel, /p_provider: "paystack"/);
  assert.doesNotMatch(panel, /p_provider: provider/);
  assert.doesNotMatch(panel, /p_online_payment_enabled: online/);
  assert.doesNotMatch(panel, /method:\s*"PATCH"/);
});

test("invoice identifiers and displayed fields are HTML escaped", () => {
  assert.match(panel, /function escapeHtml\(value\)/);
  assert.match(panel, /escapeHtml\(invoice\.invoice_number/);
  assert.match(panel, /escapeHtml\(item\.id\)/);
});

test("server RPC requires an authenticated Swayphics administrator", () => {
  assert.match(migration, /auth\.uid\(\)\s+is\s+null\s+or\s+not\s+coalesce\(public\.is_swayphics_admin\(\)\s*,\s*false\)/i);
  assert.match(migration, /using\s+errcode\s*=\s*'42501'/i);
  assert.match(migration, /grant execute on function public\.admin_set_invoice_payment_settings[\s\S]*to authenticated/i);
});

test("database defaults and existing invoice records are moved to Paystack with online payment enabled", () => {
  assert.match(migration, /ALTER TABLE public\.invoices ALTER COLUMN online_payment_enabled SET DEFAULT true/i);
  assert.match(migration, /ALTER TABLE public\.invoices ALTER COLUMN online_payment_provider SET DEFAULT 'paystack'/i);
  assert.match(migration, /UPDATE public\.invoices[\s\S]*online_payment_enabled = true[\s\S]*online_payment_provider = 'paystack'/i);
});

test("legacy RPC parameters cannot disable online payment or choose Yoco", () => {
  assert.match(migration, /v_online boolean\s*:=\s*true/i);
  assert.match(migration, /v_provider text\s*:=\s*'paystack'/i);
  assert.match(migration, /online_payment_enabled\s*=\s*true[\s\S]*online_payment_provider\s*=\s*'paystack'/i);
  assert.match(migration, /'online_payment_enabled', true/i);
  assert.match(migration, /'online_payment_provider', 'paystack'/i);
});

test("server RPC locks eligible invoices and keeps partial-payment and deposit validation", () => {
  assert.match(migration, /where id\s*=\s*p_invoice_id\s+for update/i);
  assert.match(migration, /v_invoice\.status\s+in\s*\('draft',\s*'cancelled',\s*'paid'\)/i);
  assert.match(migration, /amount_outstanding\s*,\s*v_invoice\.total\s*,\s*0\)\s*<=\s*0/i);
  assert.match(migration, /if v_partial and upper\(coalesce\(v_invoice\.currency,\s*''\)\) <> 'ZAR' then/i);
  assert.match(migration, /if v_deposit is not null then/i);
  assert.match(migration, /v_deposit\s*>\s*coalesce\(v_invoice\.amount_outstanding\s*,\s*v_invoice\.total\s*,\s*0\)/i);
  assert.match(migration, /deposit_amount\s*=\s*case\s+when\s+v_partial\s+then\s+v_deposit\s+else\s+null\s+end/i);
});

test("deposit remains required only on the first invoice payment and competing checkouts cannot overpay", () => {
  assert.match(paymentMigration, /not exists\s*\(\s*select 1\s*from public\.payments p\s*where p\.invoice_id = v_invoice\.id\s*and p\.status in \('paid', 'partially paid'\)/);
  assert.match(paymentFlowTest, /subsequent instalment may be below the initial deposit threshold/);
  assert.match(paymentMigration, /v_attempt\.amount_cents > v_available_cents/);
  assert.match(paymentFlowTest, /a competing successful checkout is routed to manual review/);
});

test("partial-payment settings retain the Sales & Billing navigation destination", () => {
  assert.match(panel, /data-view="invoice-settings"/);
  assert.match(panel, /async function openSettings\(\)/);
  assert.match(panel, /stopImmediatePropagation\(\)/);
  assert.match(panel, /\.syi-launch\{display:none;/);
});

console.log("Paystack default invoice-settings regression tests passed.");
