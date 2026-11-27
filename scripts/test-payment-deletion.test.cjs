"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
    path.join(root, "supabase/migrations/20261127110000_admin_test_payment_deletion.sql"),
    "utf8"
);
const workspace = fs.readFileSync(
    path.join(root, "admin-dashboard/admin-workspace.js"),
    "utf8"
);
const html = fs.readFileSync(
    path.join(root, "admin-dashboard/index.html"),
    "utf8"
);

assert.match(migration, /add column if not exists is_test boolean not null default false/i);
assert.match(migration, /public\.is_swayphics_owner\(\)/);
assert.match(migration, /v_payment\.provider is not null/i);
assert.match(migration, /v_payment\.is_test is not true/i);
assert.match(migration, /'TEST PAYMENT ' \|\| p_payment_id::text/);
assert.match(migration, /'DELETE TEST PAYMENT ' \|\| p_payment_id::text/);
assert.match(migration, /public\.payment_attempts where payment_id = p_payment_id/);
assert.match(migration, /public\.payment_refunds where payment_id = p_payment_id/);
assert.match(migration, /public\.bank_transfer_submissions where payment_id = p_payment_id/);
assert.match(migration, /public\.payment_reconciliation where payment_id = p_payment_id/);
assert.match(migration, /d\.pdf_storage_path is not null/);
assert.match(migration, /delete from public\.payment_receipts[\s\S]*?delete from public\.payments/i);
assert.match(migration, /admin_mark_payment_as_test/);
assert.match(migration, /admin_permanently_delete_test_payment/);
assert.match(migration, /grant execute on function public\.admin_permanently_delete_test_payment\(uuid,text\) to authenticated/i);
assert.match(migration, /and p\.is_test is false/);
assert.match(migration, /and rp\.is_test is false/);
assert.match(migration, /Payments must be deleted through an authorized test-payment or archived-invoice purge workflow/);

const rendererStart = workspace.indexOf("    function renderPayments()");
const rendererEnd = workspace.indexOf("\n    function ", rendererStart + 10);
assert.ok(rendererStart >= 0 && rendererEnd > rendererStart, "payment renderer exists");
const renderer = workspace.slice(rendererStart, rendererEnd);
assert.match(renderer, /data-mark-test-payment=/);
assert.match(renderer, /data-delete-test-payment=/);
assert.match(renderer, /state\.currentAdmin && state\.currentAdmin\.role === "owner"/);
assert.match(renderer, /item\.provider == null/);
assert.match(renderer, /item\.is_test === true/);
assert.doesNotMatch(renderer, /data-delete="payments"/);

assert.match(workspace, /admin_mark_payment_as_test/);
assert.match(workspace, /admin_permanently_delete_test_payment/);
assert.match(workspace, /payment\.is_test === true/);
assert.match(workspace, /payment\.is_test !== true/);
assert.match(workspace, /type === "payments"[\s\S]*?owner explicitly classifies them as test data/);
assert.match(html, /admin-workspace\.js\?v=20261127-test-payment-deletion-1/);

console.log("Owner-controlled test payment deletion contracts passed.");
