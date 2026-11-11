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

test("reconciliation history is scoped to one queued case and paginated", () => {
  assert.match(edge, /history_case_id/);
  assert.match(edge, /caseIds\.includes\(historyCaseId\)/);
  assert.match(edge, /\.range\(evidenceOffset, evidenceOffset \+ historyPageSize - 1\)/);
  assert.match(edge, /\.range\(actionOffset, actionOffset \+ historyPageSize - 1\)/);
  assert.match(edge, /evidence_has_more:/);
  assert.match(edge, /actions_have_more:/);
  assert.match(edge, /\.order\("id", \{ ascending: false \}\)/);
});

test("administrator UI can load older evidence and action pages", () => {
  assert.match(ui, /async function loadHistory\(caseId, kind\)/);
  assert.match(ui, /data-load-evidence/);
  assert.match(ui, /data-load-actions/);
  assert.match(ui, /evidence_offset:evidenceOffset/);
  assert.match(ui, /action_offset:actionOffset/);
  assert.match(ui, /history_page\.case_id !== caseId/);
});

test("browser rejects incomplete read-model payloads and malformed financial UUIDs", () => {
  assert.match(ui, /requiredCollections\.every/);
  assert.match(ui, /Array\.isArray\(payload\[key\]\)/);
  assert.match(ui, /uuidPattern/);
  assert.match(ui, /valid UUID/);
});

test("reconciliation Edge Function enforces method, origin and administrator checks before service-role reads", () => {
  const methodGuard = edge.indexOf('if (req.method !== "POST")');
  const originGuard = edge.indexOf('origin !== "https://swayphics.co.za"');
  const adminGuard = edge.indexOf('if (!await authorizeAdmin(req))');
  const serviceClient = edge.indexOf("const admin = getAdminClient()");
  const firstRead = edge.indexOf('admin.from("payment_attempts")');
  assert.ok(methodGuard >= 0 && methodGuard < adminGuard);
  assert.ok(originGuard >= 0 && originGuard < adminGuard);
  assert.ok(adminGuard >= 0 && adminGuard < serviceClient);
  assert.ok(serviceClient >= 0 && serviceClient < firstRead);
  assert.match(edge, /auth\.getUser\(token\)/);
  assert.match(edge, /userClient\.rpc\("is_swayphics_admin"\)/);
});

test("case workflow submits only the guarded evidence and status RPCs", () => {
  assert.match(ui, /admin_add_payment_reconciliation_evidence/);
  assert.match(ui, /admin_set_payment_reconciliation_status/);
  assert.match(ui, /p_reconciliation_id:c\.id/);
  assert.match(ui, /p_new_status:next/);
  assert.doesNotMatch(ui, /from\(["']payment_reconciliation_(evidence|actions)["']\)\s*\.insert/);
});

test("status migration enforces allowed transitions and terminal closed states", () => {
  assert.match(statusMigration, /v_case\.status = 'open' and p_new_status = 'investigating'/);
  assert.match(statusMigration, /v_case\.status = 'investigating'/);
  assert.match(statusMigration, /p_new_status in \('resolved','dismissed'\)/);
  assert.match(statusMigration, /v_case\.status in \('resolved','dismissed'\)/);
});
