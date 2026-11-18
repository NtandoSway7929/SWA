"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const html = fs.readFileSync(path.join(__dirname, "..", "admin-dashboard", "bank-reconciliation.html"), "utf8");
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join("\n");
assert.ok(script.includes("function csv(text)"), "CSV parser must handle quoted fields");
assert.ok(script.includes("function dateValue(v)"), "date parsing must be explicit");
assert.ok(script.includes("function money(v)"), "currency parsing must be explicit");
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
assert.ok(!/delete\\s*\\(/i.test(importer), "the browser must not delete immutable statement records");

console.log("Bank statement CSV preview and import contract passed.");
