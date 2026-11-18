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


const atomicImportPath = path.join(__dirname, "..", "supabase", "migrations", "20261118080000_bank_statement_atomic_import.sql");
const atomicSql = fs.readFileSync(atomicImportPath, "utf8");
assert.ok(atomicSql.includes("create or replace function public.import_bank_statement("));
assert.ok(atomicSql.includes("security invoker"), "the import RPC must respect caller privileges and RLS");
assert.ok(atomicSql.includes("public.is_swayphics_owner()"), "only the Swayphics owner may import statements");
assert.ok(atomicSql.includes("jsonb_array_length(p_rows) > 10000"), "the RPC must cap import size");
assert.ok(atomicSql.includes("unique_violation"), "duplicate statement files must return a controlled error");
assert.ok(atomicSql.includes("grant execute on function public.import_bank_statement"), "authenticated sessions must be able to invoke the RPC");
assert.ok(atomicSql.includes("insert into public.bank_statement_lines"), "the import RPC must persist the rows");
assert.ok(!/security\s+definer/i.test(atomicSql), "the import RPC must not bypass RLS");

console.log("Bank statement reconciliation migration contracts passed.");
