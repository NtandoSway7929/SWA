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


const atomicImportPath = path.join(__dirname, "..", "supabase", "migrations", "20261118061550_bank_statement_atomic_import.sql");
const atomicSql = fs.readFileSync(atomicImportPath, "utf8");
assert.ok(atomicSql.includes("create or replace function public.import_bank_statement("));
assert.ok(atomicSql.includes("security invoker"), "the import RPC must respect caller privileges and RLS");
assert.ok(atomicSql.includes("public.is_swayphics_owner()"), "only the Swayphics owner may import statements");
assert.ok(atomicSql.includes("jsonb_array_length(p_rows) > 10000"), "the RPC must cap import size");
assert.ok(atomicSql.includes("unique_violation"), "duplicate statement files must return a controlled error");
assert.ok(atomicSql.includes("grant execute on function public.import_bank_statement"), "authenticated sessions must be able to invoke the RPC");
assert.ok(atomicSql.includes("insert into public.bank_statement_lines"), "the import RPC must persist the rows");
assert.ok(!/security\s+definer/i.test(atomicSql), "the import RPC must not bypass RLS");


const reviewPath = path.join(__dirname, "..", "supabase", "migrations", "20261118062000_bank_statement_line_review.sql");
const reviewSql = fs.readFileSync(reviewPath, "utf8");
assert.ok(reviewSql.includes("create or replace function public.review_bank_statement_line("));
assert.ok(reviewSql.includes("p_decision is distinct from 'matched'"), "null or unknown decisions must be rejected");
assert.ok(reviewSql.includes("security invoker"), "line review must respect caller permissions and RLS");
assert.ok(reviewSql.includes("public.is_swayphics_owner()"), "only the owner may review statement lines");
assert.ok(reviewSql.includes("for update"), "review must lock the target statement line");
assert.ok(reviewSql.includes("pg_advisory_xact_lock"), "a source record must not be matched concurrently to multiple lines");
assert.ok(reviewSql.includes("bank_statement_lines_matched_source_idx"), "matched-source lookups must be indexed");
assert.ok(reviewSql.includes("abs(v_source_date - v_line.transaction_date) > 7"), "server-side matching must enforce the same seven-day date window");
assert.ok(reviewSql.includes("v_method is null") && reviewSql.includes("v_source_date is null"), "null payment methods and transaction dates must never pass match validation");
assert.ok(reviewSql.includes("provider is null"), "test/provider payment records must not be reconciled as bank receipts");
assert.ok(reviewSql.includes("v_method is distinct from 'EFT'"), "only manual EFT payment records may be matched, including when method is null");
assert.ok(reviewSql.includes("v_method not in ('EFT', 'Card', 'Debit order')"), "cash and other budget entries must not be matched to bank activity");
assert.ok(reviewSql.includes("v_status is distinct from 'paid'"), "only paid payment records may be matched, including when status is null");
assert.ok(reviewSql.includes("v_status is distinct from 'posted'"), "only posted budget entries may be matched, including when status is null");
assert.ok(reviewSql.includes("v_entry_type is distinct from 'income'") && reviewSql.includes("v_entry_type is distinct from 'expense'"), "income and expense directions must match the bank line sign, including when type is null");
assert.ok(reviewSql.toLowerCase().includes("test-environment refunds are excluded"), "test-mode refunds must not be matched to live bank lines");
assert.ok(reviewSql.includes("grant execute on function public.review_bank_statement_line"), "authenticated owner sessions must be able to review lines");
assert.ok(!/insert\s+into\s+public\.(payments|payment_refunds|budget_entries|invoices)/i.test(reviewSql), "matching must not create financial ledger records");
assert.ok(!/update\s+public\.(payments|payment_refunds|budget_entries|invoices)/i.test(reviewSql), "matching must not mutate financial ledger records");

console.log("Bank statement reconciliation migration contracts passed.");
