"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const html = fs.readFileSync(path.join(__dirname, "..", "admin-dashboard", "bank-reconciliation.html"), "utf8");
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join("\n");
assert.ok(script.includes("function csv(text)"), "CSV parser must handle quoted fields");
assert.ok(script.includes("function dateValue(v)"), "date parsing must be explicit");
assert.ok(script.includes("function money(v)"), "currency parsing must be explicit");
const dateStart = script.indexOf("function dateValue(v)");
const moneyStart = script.indexOf("function money(v)");
const optionsStart = script.indexOf("function options(");
assert.ok(dateStart >= 0 && moneyStart > dateStart && optionsStart > moneyStart);
const parserContext = {};
vm.runInNewContext(
    script.slice(dateStart, optionsStart) +
    "\nglobalThis.__dateValue = dateValue; globalThis.__money = money;",
    parserContext
);
const dateValue = parserContext.__dateValue;
const money = parserContext.__money;
assert.equal(dateValue("2026-02-28"), "2026-02-28");
assert.equal(dateValue("31/01/2026"), "2026-01-31");
assert.equal(dateValue("02/03/2026"), null, "ambiguous day/month dates must be rejected");
assert.equal(dateValue("2026-02-30"), null, "impossible calendar dates must be rejected");
assert.equal(money("R1,234.56"), 1234.56);
assert.equal(money("1.234,56"), 1234.56);
assert.equal(money("123,45"), 123.45, "comma decimal values must not be multiplied by 100");
assert.equal(money("(R250.00)"), -250);
assert.ok(Number.isNaN(money("12,3")), "ambiguous comma amounts must be rejected");
assert.ok(script.includes("Import blocked: "), "a statement with invalid rows must not be partially imported");

assert.ok(script.includes("Map Date, Description and either Amount or Debit/Credit columns."));
assert.ok(script.includes("file.size>5*1024*1024"), "CSV size must be capped");
assert.ok(script.includes("within.length!==parsed.length"), "rows outside selected period must be rejected");
assert.ok(script.includes("Preview generated locally. No transactions have been saved."));
assert.ok(!/fetch\s*\(/.test(script), "preview-only workflow must not send uploaded statement data to a server");
assert.ok(html.includes('id="mapping"') && html.includes('id="previewPanel"'));
assert.ok(html.includes('accept=".csv,text/csv"'));

const importer = fs.readFileSync(path.join(__dirname, "..", "admin-dashboard", "bank-reconciliation-import.js"), "utf8");
assert.ok(importer.includes("/rest/v1/rpc/import_bank_statement"), "explicit import must use the atomic RPC");
assert.ok(importer.includes("swayphics_admin_access_token"), "imports must use the signed-in admin session");
assert.ok(importer.includes("p_source_file_sha256"), "imports must submit a file fingerprint");
assert.ok(importer.includes("line_fingerprint"), "imports must submit row fingerprints");
assert.ok(importer.includes("Previously imported statements") || html.includes("Previously imported statements"), "saved imports must be listed");
assert.ok(!/delete\s*\(/i.test(importer), "the browser must not delete immutable statement records");
assert.ok(importer.includes("/rest/v1/rpc/review_bank_statement_line"), "manual line decisions must use the guarded review RPC");
assert.ok(importer.includes('provider=is.null'), "Yoco provider/test payments must not be suggested as live bank receipts");
assert.ok(importer.includes('status=eq.posted'), "only posted budget entries may be suggested");
assert.ok(importer.includes("dateDistance(date,line.transaction_date)<=7"), "candidate suggestions must use a seven-day date window");
assert.ok(importer.includes("data-review-import"), "saved statements must expose a manual review action");
assert.ok(importer.includes("data-match-line") && importer.includes("data-ignore-line"), "unmatched lines must support manual match and ignore decisions");
assert.ok(importer.includes("REVIEW_PAGE_SIZE=100"), "statement review must be paginated");
assert.ok(importer.includes("test-environment refunds are excluded") || importer.includes("test-environment"), "test refunds must be excluded from live bank matching");
assert.ok(!/method:\\s*["']PATCH["'][^}]*payments/i.test(importer), "the browser must not mutate payment records");
assert.ok(!/method:\\s*["']PATCH["'][^}]*budget_entries/i.test(importer), "the browser must not mutate budget records");


console.log("Bank statement CSV preview and import contract passed.");
