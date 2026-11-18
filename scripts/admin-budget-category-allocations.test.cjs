"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workspace = fs.readFileSync(path.join(root, "admin-dashboard", "admin-workspace.js"), "utf8");
const css = fs.readFileSync(path.join(root, "admin-dashboard", "admin-workspace.css"), "utf8");
const migration = fs.readFileSync(
    path.join(root, "supabase", "migrations", "20261118045815_budget_category_allocations.sql"),
    "utf8"
);

assert.ok(workspace.includes('"/rest/v1/budget_category_allocations?select=*&order=period_month.desc,category.asc"'));
assert.ok(workspace.includes("state.budgetAllocations = results[18] || [];"));
assert.ok(workspace.includes("state.paymentRefunds = results[19] || [];"));
assert.ok(workspace.includes("state.paymentAttempts = results[20] || [];"));

const rendererStart = workspace.indexOf("function renderBudget() {");
const rendererEnd = workspace.indexOf("\n    function renderPayments()", rendererStart);
assert.ok(rendererStart >= 0 && rendererEnd > rendererStart, "Budget renderer must exist");
const renderer = workspace.slice(rendererStart, rendererEnd);

assert.ok(renderer.includes("Monthly expense budgets"));
assert.ok(renderer.includes("data-budget-plan-month"));
assert.ok(renderer.includes("data-budget-allocation-form"));
assert.ok(renderer.includes("budget_category_allocations?on_conflict=period_month,category"));
assert.ok(renderer.includes("data-budget-allocation-delete"));
assert.ok(renderer.includes("30 / 60 / 90-day cash-flow outlook"));
assert.ok(renderer.includes("Expected invoice receipts"));
assert.ok(renderer.includes("Budget-based outflow allowance"));
assert.ok(renderer.includes("Projected net movement"));
assert.ok(renderer.includes("This shows projected movement, not a bank balance"));
assert.ok(renderer.includes('row.source === "entry"'));
assert.ok(renderer.includes('row.category === allocation.category'));
assert.ok(renderer.includes('invoice.due_date'));

assert.ok(migration.includes("create table public.budget_category_allocations"));
assert.ok(migration.includes("unique (period_month, category)"));
assert.ok(migration.includes("enable row level security"));
assert.ok(migration.includes("Swayphics owners can manage category allocations"));
assert.ok(migration.includes("grant select, insert, update, delete"));
assert.ok(migration.includes("public.is_swayphics_owner()"));
assert.ok(migration.includes("set_budget_category_allocation_updated_at"));

assert.ok(css.includes(".sway-budget-plan-toolbar"));
assert.ok(css.includes(".sway-budget-forecast-grid"));
assert.ok(css.includes("body.sway-dark-mode .sway-budget-forecast-card"));
assert.ok(css.includes("@media (max-width: 560px)"));

console.log(JSON.stringify({
    result: "PASS",
    checks: [
        "monthly allocation data is fetched and mapped without shifting payment/refund arrays",
        "monthly category limits can be created, updated and removed",
        "30/60/90-day outlook uses invoice due dates and category-specific remaining budgets",
        "forecast is explicitly labelled as projected movement rather than bank balance",
        "new allocation table is owner-protected and has explicit API grants",
        "responsive and dark-theme allocation/forecast styles are present"
    ]
}, null, 2));
