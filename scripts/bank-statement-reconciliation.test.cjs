"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationPath = path.join(
    __dirname,
    "..",
    "supabase",
    "migrations",
    "20261118060043_bank_statement_reconciliation.sql"
);
const sql = fs.readFileSync(migrationPath, "utf8");

assert.ok(sql.includes("create table public.bank_statement_imports"));
assert.ok(sql.includes("create table public.bank_statement_lines"));
assert.ok(sql.includes("source_file_sha256"));
assert.ok(sql.includes("unique (account_label, source_file_sha256)"),
    "the same statement file must not be imported twice for one account");
assert.ok(sql.includes("unique (import_id, row_number)"),
    "each statement row must have a stable position within its import");
assert.ok(sql.includes("line_fingerprint"),
    "normalized rows must carry a fingerprint for duplicate review");
assert.ok(sql.includes("match_status in ('unmatched', 'matched', 'ignored')"));
assert.ok(sql.includes("matched_source_type in ('payment', 'refund', 'budget_entry')"));
assert.ok(sql.includes("alter table public.bank_statement_imports enable row level security"));
assert.ok(sql.includes("alter table public.bank_statement_lines enable row level security"));
assert.ok(sql.includes("public.is_swayphics_owner()"),
    "all statement access must be restricted to Swayphics owners");
assert.ok(sql.includes("grant select, insert on table public.bank_statement_imports to authenticated"));
assert.ok(sql.includes("grant select, insert, update on table public.bank_statement_lines to authenticated"));
assert.ok(sql.includes("from public, anon, authenticated"),
    "public and anonymous access must be revoked");
assert.ok(sql.includes("Imported bank statement source data is immutable."),
    "source statement values must not be editable after import");
assert.ok(sql.includes("A reviewed bank statement line cannot be changed again."),
    "a completed match or ignore decision must be immutable");
assert.ok(sql.includes("Bank statement import records cannot be changed or deleted."),
    "import audit records must be immutable");
assert.ok(!/grant\s+[^;]*\bdelete\b[^;]*bank_statement_/is.test(sql),
    "browser roles must not be granted delete access to statement records");

console.log("Bank statement reconciliation migration contract passed.");
