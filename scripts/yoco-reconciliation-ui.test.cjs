const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const ui = read("admin-dashboard/yoco-reconciliation.js");
const edge = read("supabase/functions/reconcile-payment/index.ts");
const html = read("admin-dashboard/index.html");
const evidenceMigration = read("supabase/migrations/202611110011_yoco_reconciliation_evidence_scope.sql");
const statusMigration = read("supabase/migrations/202611110010_yoco_reconciliation_reference_integrity.sql");

test("admin dashboard loads the reconciliation interface", () => {
  assert.match(html, /yoco-reconciliation\.js\?v=20261111-stage-1-54/);
  assert.match(ui, /__swayYocoReconciliationLoaded/);
});

test("reconciliation reads use the guarded administrator Edge Function", () => {
  assert.match(ui, /\/functions\/v1\/reconcile-payment/);
  assert.match(edge, /authorizeAdmin\(req\)/);
  assert.match(edge, /payment_reconciliation_evidence/);
  assert.match(edge, /payment_reconciliation_actions/);
  assert.match(edge, /evidence: evidenceResult\.data/);
  assert.match(edge, /case_actions: actionsResult\.data/);
});

test("evidence and status changes use authenticated administrator RPCs", () => {
  assert.match(ui, /admin_add_payment_reconciliation_evidence/);
  assert.match(ui, /admin_set_payment_reconciliation_status/);
  assert.match(evidenceMigration, /v_case\.provider <> 'yoco' or v_case\.environment <> 'test'/);
  assert.match(evidenceMigration, /public\.is_swayphics_admin\(\)/);
});

test("case close-out requires existing financial references bound to the case invoice", () => {
  assert.match(statusMigration, /p\.invoice_id = v_case_invoice_id/);
  assert.match(statusMigration, /r\.environment = 'test'/);
  assert.match(statusMigration, /public\.is_swayphics_admin\(\)/);
});

test("UI safely escapes data and does not write payment or invoice ledger records", () => {
  assert.match(ui, /function esc\(v\)/);
  assert.match(ui, /replace/);
  assert.doesNotMatch(ui, /\/rest\/v1\/(payments|payment_refunds|invoices)(\?|\s|")/);
  assert.doesNotMatch(ui, /sk_(live|test)_/);
});
