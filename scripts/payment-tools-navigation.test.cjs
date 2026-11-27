"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manual = fs.readFileSync(path.join(root, "admin-dashboard", "admin-manual-payments.js"), "utf8");
const receipts = fs.readFileSync(path.join(root, "admin-dashboard", "payment-receipts.js"), "utf8");
const dashboard = fs.readFileSync(path.join(root, "admin-dashboard", "index.html"), "utf8");

test("manual payment recording is launched from Sales & Billing, not a floating shortcut", () => {
  assert.match(manual, /data-nav-menu="billing"/);
  assert.match(manual, /button\.dataset\.view = "manual-payment-record"/);
  assert.match(manual, /textContent = "Record payment"/);
  assert.match(manual, /stopImmediatePropagation\(\)/);
  assert.match(manual, /\.mp-launch\{display:none;/);
  assert.match(manual, /navObserver\.observe\(document\.body/);
});

test("payment receipt management is launched from Sales & Billing, not a floating shortcut", () => {
  assert.match(receipts, /data-nav-menu="billing"/);
  assert.match(receipts, /receiptsButton.dataset.view = "payment-receipts"/);
  assert.match(receipts, /textContent = "Payment receipts"/);
  assert.match(receipts, /stopImmediatePropagation\(\)/);
  assert.match(receipts, /\.pr-launch\{display:none;/);
  assert.match(receipts, /navObserver\.observe\(document\.body/);
  assert.match(receipts, /data-view="yoco-test-payment-cleanup"/);
  assert.match(receipts, /textContent = "Test payment cleanup"/);
  assert.match(receipts, /admin_list_yoco_test_payment_cleanup_candidates/);
});

test("dashboard refreshes both payment module scripts after navigation changes", () => {
  assert.match(dashboard, /payment-receipts\.js\?v=20261127-yoco-test-cleanup-1/);
  assert.match(dashboard, /admin-manual-payments\.js\?v=20261127-sales-billing-nav-1/);
});
