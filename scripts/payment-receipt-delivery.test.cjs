const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/202611210001_payment_receipt_email_delivery.sql");
const delivery = read("supabase/functions/deliver-payment-receipt/index.ts");
const eft = read("supabase/functions/bank-transfer/index.ts");
const paystack = read("supabase/functions/paystack-payment-webhook/index.ts");
const dashboard = read("admin-dashboard/payment-receipts.js");
const html = read("admin-dashboard/index.html");
const config = read("supabase/config.toml");

assert.match(migration, /create table if not exists public\.payment_receipt_deliveries/);
assert.match(migration, /create table if not exists public\.payment_receipt_delivery_attempts/);
assert.match(migration, /alter table public\.payment_receipt_deliveries enable row level security/);
assert.match(migration, /alter table public\.payment_receipt_delivery_attempts enable row level security/);
assert.match(migration, /values \('swayphics-payment-receipts'.*false/s);
assert.match(migration, /after insert on public\.payment_receipts/);
assert.match(migration, /insert into public\.payment_receipt_deliveries[\s\S]*?on conflict \(receipt_id\) do nothing/);

assert.match(delivery, /admin_users/);
assert.match(delivery, /payment\.status !== "paid"/);
assert.match(delivery, /from\("payment_receipts"\)/);
assert.match(delivery, /from\("payment_receipt_deliveries"\)/);
assert.match(delivery, /from\("payment_receipt_delivery_attempts"\)/);
assert.match(delivery, /application\/pdf/);
assert.match(delivery, /attachments: \[\{ filename:/);
assert.match(delivery, /https:\/\/api\.resend\.com\/emails/);
assert.match(delivery, /Idempotency-Key/);
assert.match(delivery, /status: "sending"/);
assert.match(delivery, /status: "sent"/);
assert.match(delivery, /status: "failed"/);
assert.match(delivery, /serviceKey && apiKey === serviceKey/);
assert.match(delivery, /escapeHtml\(greeting\)/);

assert.match(eft, /dispatchPaymentReceipt\(paymentId, deps\.logError\)/);
assert.match(paystack, /dispatchPaymentReceipt\(settledPaymentId, deps\.logError\)/);
assert.match(dashboard, /deliver-payment-receipt/);
assert.match(dashboard, /Retry email/);
assert.match(html, /payment-receipts\.js/);
assert.match(config, /\[functions\.deliver-payment-receipt\][\s\S]*?verify_jwt = false/);

console.log("Payment receipt delivery source checks passed.");
