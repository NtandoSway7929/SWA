"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "admin-dashboard", "admin-budget-receipts.js"), "utf8");
const html = fs.readFileSync(path.join(root, "admin-dashboard", "index.html"), "utf8");
const migration = fs.readFileSync(
    path.join(root, "supabase", "migrations", "20261118090000_budget_entry_receipts.sql"),
    "utf8"
);

assert.ok(script.includes('var BUCKET = "swayphics-budget-receipts"'));
assert.ok(script.includes('"/rest/v1/budget_entries?select=id,description,category,amount,transaction_date,status,entry_type&entry_type=eq.expense'));
assert.ok(script.includes("/rest/v1/budget_entry_receipts?select="));
assert.ok(script.includes("/storage/v1/object/sign/"));
assert.ok(script.includes("/storage/v1/object/"));
assert.ok(script.includes("expiresIn: 120"));
assert.ok(script.includes("MAX_BYTES = 10 * 1024 * 1024"));
assert.ok(script.includes('["application/pdf", "image/jpeg", "image/png", "image/webp"]'));
assert.ok(script.includes("data-receipt-upload"));
assert.ok(script.includes("data-receipt-open"));
assert.ok(script.includes("data-receipt-delete"));
assert.ok(script.includes("data-receipt-filter"));
assert.ok(script.includes('filter === "missing"'));
assert.ok(script.includes('resolved.origin !== base.origin'));
assert.ok(script.includes('resolved.pathname.indexOf("/storage/v1/object/sign/" + BUCKET + "/") !== 0'));
assert.ok(script.includes("var uploadedCount = 0;"));
assert.ok(script.includes("failures.join(\" \" )") || script.includes('failures.join(" ")'));
assert.ok(script.includes('title.textContent.trim().toLowerCase() === "transaction ledger"'));
assert.ok(script.includes("new MutationObserver"));
assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(script), "new receipt-management code must not contain emoji characters");

assert.ok(html.includes('admin-budget-receipts.js?v=20261118-budget-receipts-1'));

assert.ok(migration.includes("create table if not exists public.budget_entry_receipts"));
assert.ok(migration.includes("alter table public.budget_entry_receipts enable row level security"));
assert.ok(migration.includes("public.is_swayphics_owner()"));
assert.ok(migration.includes("public.budget_entries"));
assert.ok(migration.includes("create policy \"Swayphics owners can read budget receipt files\""));
assert.ok(migration.includes("public = false"));
assert.ok(migration.includes("10485760"));
assert.ok(migration.includes("application/pdf"));
assert.ok(migration.includes("budget_entry_receipts_uploaded_by_idx"));

console.log("Budget receipt storage, owner access, upload restrictions and dashboard integration contracts passed.");
