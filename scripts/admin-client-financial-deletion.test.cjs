"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const workspace = read("admin-dashboard/admin-workspace.js");
const dashboard = read("admin-dashboard/index.html");
const edge = read("supabase/functions/admin-delete-client/index.ts");
const config = read("supabase/config.toml");
const migration = read("supabase/migrations/202611220001_client_financial_deletion.sql");
const sqlTest = read("supabase/tests/202611220002_client_financial_deletion.test.sql");

const clientDelete = workspace.slice(
  workspace.indexOf("    async function removeRecord(type, id) {"),
  workspace.indexOf("\n    async function completeTask(", workspace.indexOf("    async function removeRecord(type, id) {"))
);

assert.match(clientDelete, /callClientDeletionFunction\(\{[\s\S]*?client_id: id/);
assert.match(clientDelete, /Permanently delete this client and ALL linked financial records/);
assert.doesNotMatch(clientDelete, /clientInvoices|clientPayments|archive the client/i);
assert.match(workspace, /functions\/v1\/admin-delete-client/);
assert.match(workspace, /action: "cleanup_pending"/);
assert.doesNotMatch(workspace, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(dashboard, /admin-workspace\.js\?v=20261122-client-financial-deletion-1/);

assert.match(edge, /auth\.getUser\(token\)/);
assert.match(edge, /rpc\("is_swayphics_admin"\)/);
assert.match(edge, /admin_delete_client_with_financial_records/);
assert.match(edge, /storage\.from\(bucket\)\.remove\(paths\)/);
assert.match(edge, /client_deletion_storage_cleanup/);
assert.match(edge, /attempts: Number\(item\.attempts \|\| 0\) \+ 1/);
assert.match(config, /\[functions\.admin-delete-client\][\s\S]*?verify_jwt = false/);

for (const table of [
  "clients",
  "invoices",
  "invoice_items",
  "payments",
  "payment_attempts",
  "payment_receipts",
  "payment_refunds",
  "payment_webhook_events",
  "payment_reconciliation",
  "payment_reconciliation_actions",
  "payment_reconciliation_evidence",
  "bank_transfer_submissions"
]) {
  assert.ok(migration.includes("public." + table), "migration must account for " + table);
}

for (const contract of [
  "public.is_swayphics_admin()",
  "SECURITY DEFINER",
  "set search_path = ''",
  "innerme_private.client_financial_deletion_context",
  "client_financial_deletion_is_authorized",
  "alter table public.client_deletion_storage_cleanup enable row level security"
]) {
  assert.ok(migration.toLowerCase().includes(contract.toLowerCase()),
    "migration must include security/transaction contract: " + contract);
}
assert.ok(migration.includes("grant select, update, delete on table public.client_deletion_storage_cleanup") && migration.includes("to service_role;"), "only the service role should receive cleanup-queue privileges");
assert.ok(migration.includes("grant execute on function public.admin_delete_client_with_financial_records(uuid)") && migration.includes("to authenticated;"), "only authenticated users should receive RPC execution permission");

const deletionOrder = [
  "delete from public.bank_transfer_submissions",
  "delete from public.payment_webhook_events",
  "delete from public.payment_reconciliation_evidence",
  "delete from public.payment_reconciliation_actions",
  "delete from public.payment_reconciliation r",
  "delete from public.payment_refunds",
  "delete from public.payment_attempts",
  "delete from public.payment_receipts",
  "delete from public.payments",
  "delete from public.invoices",
  "delete from public.clients"
].map((statement) => migration.indexOf(statement));

assert.ok(deletionOrder.every((position) => position >= 0),
  "all restrictive financial dependencies must have explicit deletion steps");
assert.ok(deletionOrder.every((position, index) =>
  index === 0 || deletionOrder[index - 1] < position
), "financial records must be deleted in foreign-key-safe order");

assert.match(migration, /on conflict \(bucket_id, object_path\) do nothing/i);
assert.match(migration, /payment_proof_files_queued_for_deletion/);
assert.match(sqlTest, /unauthorised deletion attempt leaves its client untouched/);
assert.match(sqlTest, /bank-transfer proof object is queued for secure Storage API deletion/);
assert.match(sqlTest, /unrelated client and invoice records remain untouched/);

console.log("Permanent client financial deletion contract tests passed.");
