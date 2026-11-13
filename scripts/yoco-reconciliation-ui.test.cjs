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
const concurrencyMigration = read("supabase/migrations/202611110012_yoco_reconciliation_optimistic_concurrency.sql");

test("admin dashboard loads the reconciliation interface", () => {
  assert.match(html, /yoco-reconciliation\.js\?v=20261113-remove-launcher-1/);
  assert.match(ui, /__swayYocoReconciliationLoaded/);
  assert.doesNotMatch(ui, /class="yr-launch"|Payment reconciliation<\\/button>/);
});

test("reconciliation reads use the guarded administrator Edge Function", () => {
  assert.match(ui, /\/functions\/v1\/reconcile-payment/);
  assert.match(edge, /async function authorizeAdmin\(req: Request\)/);
  assert.match(edge, /payment_reconciliation_evidence/);
  assert.match(edge, /payment_reconciliation_actions/);
  assert.match(edge, /evidence: \(evidenceResult\.data \|\| \[\]\)\.slice\(0, historyPageSize\)/);
  assert.match(edge, /case_actions: \(actionsResult\.data \|\| \[\]\)\.slice\(0, historyPageSize\)/);
});

test("evidence and status changes use authenticated administrator RPCs", () => {
  assert.match(ui, /admin_add_payment_reconciliation_evidence/);
  assert.match(ui, /admin_set_payment_reconciliation_status_v2/);
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
  assert.match(edge, /\.range\(evidenceOffset, evidenceOffset \+ historyPageSize\)/);
  assert.match(edge, /\.range\(actionOffset, actionOffset \+ historyPageSize\)/);
  assert.match(edge, /evidence_has_more:/);
  assert.match(edge, /actions_have_more:/);
  assert.match(edge, /\.length > historyPageSize/);
  assert.match(edge, /\.slice\(0, historyPageSize\)/);
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
  const adminGuard = edge.indexOf('if (!await authorize(req))');
  const serviceClient = edge.indexOf("const admin = createAdmin()");
  const firstRead = edge.indexOf('admin.from("payment_attempts")');
  assert.ok(methodGuard >= 0 && methodGuard < adminGuard);
  assert.ok(originGuard >= 0 && originGuard < adminGuard);
  assert.ok(adminGuard >= 0 && adminGuard < serviceClient);
  assert.ok(serviceClient >= 0 && serviceClient < firstRead);
  assert.match(edge, /auth\.getUser\(\s*token\s*,?\s*\)/);
  assert.match(edge, /userClient\.rpc\(\s*"is_swayphics_admin"\s*,?\s*\)/);
});

test("case workflow submits only the guarded evidence and status RPCs", () => {
  assert.match(ui, /admin_add_payment_reconciliation_evidence/);
  assert.match(ui, /admin_set_payment_reconciliation_status_v2/);
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

test("audit timeline identifies the recorded administrator without inventing profile names", () => {
  assert.match(ui, /function actorLabel\(id\)/);
  assert.match(ui, /actorLabel\(a\.actor_user_id\)/);
  assert.match(ui, /actorLabel\(e\.created_by\)/);
  assert.match(ui, /Administrator identity unavailable/);
});

test("investigation history is displayed chronologically with deterministic tie-breaking", () => {
  assert.match(ui, /function chronological\(items\)/);
  assert.match(ui, /new Date\(a\.created_at\)\.getTime\(\) - new Date\(b\.created_at\)\.getTime\(\)/);
  assert.match(ui, /data\.case_actions = chronological\(data\.case_actions\)/);
  assert.match(ui, /data\.evidence = chronological\(data\.evidence\)/);
});

test("history requests prevent duplicate loads and discard stale case responses", () => {
  assert.match(ui, /historyBusy/);
  assert.match(ui, /var requestId = \+\+historyRequestId/);
  assert.match(ui, /requestId !== historyRequestId \|\| caseId !== selectedId/);
  assert.match(ui, /if \(busy\) return/);
});

test("dashboard load validates its own response without undefined history-request variables", () => {
  const load = ui.slice(ui.indexOf("async function load()"), ui.indexOf("async function loadHistory"));
  assert.doesNotMatch(load, /requestId|caseId/);
  assert.match(load, /payload\.ok !== true/);
});

test("case decisions require the exact case version loaded by the administrator", () => {
  assert.match(ui, /admin_set_payment_reconciliation_status_v2/);
  assert.match(ui, /p_expected_updated_at:c\.updated_at/);
  assert.match(concurrencyMigration, /v_case\.updated_at is distinct from p_expected_updated_at/);
  assert.match(concurrencyMigration, /using errcode = '40001'/);
  assert.match(concurrencyMigration, /revoke execute on function public\.admin_set_payment_reconciliation_status\(uuid, text, text, text, uuid, uuid\)/);
});

test("new evidence invalidates previously loaded reconciliation case versions", () => {
  assert.match(concurrencyMigration, /set updated_at = now\(\) where id = p_reconciliation_id/);
  assert.match(concurrencyMigration, /for update/);
  assert.match(concurrencyMigration, /Evidence cannot be added to a closed reconciliation case/);
});

test("stale decision errors instruct the administrator to refresh and review", () => {
  assert.match(ui, /changed after it was loaded/);
  assert.match(ui, /Refresh and review|refresh and review/);
});

test("optimistic concurrency migration has database-level privilege and version regression coverage", () => {
  const sqlTests = read("supabase/tests/202611110011_yoco_reconciliation_admin_workflow.test.sql");
  assert.match(sqlTests, /plan\(43\)/);
  assert.match(sqlTests, /admin_set_payment_reconciliation_status_v2/);
  assert.match(sqlTests, /stale or missing case versions/);
  assert.match(sqlTests, /serialization failure SQLSTATE/);
  assert.match(sqlTests, /cannot bypass version checks through the legacy status RPC/);
  assert.match(concurrencyMigration, /for update/);
  assert.match(concurrencyMigration, /p_expected_updated_at/);
});

test("two-administrator concurrency harness requires isolated database and distinct administrator fixtures", () => {
  const harness = read("supabase/tests/yoco-reconciliation-concurrency-ci.sh");
  assert.match(harness, /LOCAL_DB_URL/);
  assert.match(harness, /YOCO_TEST_CASE_ID/);
  assert.match(harness, /YOCO_ADMIN_A_ID/);
  assert.match(harness, /YOCO_ADMIN_B_ID/);
  assert.match(harness, /Two distinct administrator identities are required/);
  assert.match(harness, /admin_set_payment_reconciliation_status_v2/);
  assert.match(harness, /40001/);
  assert.match(harness, /expected_action_count/);
  assert.match(harness, /run_evidence/);
  assert.match(harness, /run_close/);
  assert.match(harness, /evidence append won the row lock/);
  assert.match(harness, /stale closure was rejected/);
  assert.match(harness, /pg_sleep\(2\)/);
});

test("reconciliation financial-integrity tests forbid direct ledger and invoice mutations", () => {
  const sqlTests = read("supabase/tests/202611110011_yoco_reconciliation_admin_workflow.test.sql");
  const migration = read("supabase/migrations/202611110012_yoco_reconciliation_optimistic_concurrency.sql");
  assert.match(sqlTests, /plan\(43\)/);
  assert.match(sqlTests, /does not update payment ledger rows/);
  assert.match(sqlTests, /cannot insert or delete payment ledger rows/);
  assert.match(sqlTests, /cannot mutate refund ledger rows/);
  assert.match(sqlTests, /cannot change invoice balances/);
  assert.match(sqlTests, /evidence submission cannot modify payment or refund ledger rows/);
  assert.match(migration, /as \$\$\s+declare/);
  assert.match(migration, /return v_evidence_id;\s+end;\s+\$\$;/);
});

test("reconciliation browser workflow uses the guarded HTTP read model and paginated case history", () => {
  const endpoint = read("supabase/functions/reconcile-payment/index.ts");
  assert.match(endpoint, /export function createReconciliationHandler/);
  assert.match(endpoint, /if \(import\.meta\.main\) Deno\.serve/);
  assert.match(endpoint, /environment: "test"/);
  assert.match(endpoint, /mode: "read_only_manual_reconciliation"/);
  assert.match(ui, /functions\/v1\/reconcile-payment/);
  assert.match(ui, /history_case_id:caseId/);
  assert.match(ui, /evidence_offset:evidenceOffset/);
  assert.match(ui, /action_offset:actionOffset/);
});

test("reconciliation browser workflow refreshes after evidence and status mutations", () => {
  assert.match(ui, /admin_add_payment_reconciliation_evidence/);
  assert.match(ui, /await load\(\); status\("Evidence recorded/);
  assert.match(ui, /admin_set_payment_reconciliation_status_v2/);
  assert.match(ui, /p_expected_updated_at:c\.updated_at/);
  assert.match(ui, /await load\(\); status\("Case action recorded/);
});

test("reconciliation HTTP integration suite covers authorization, test scope, history and fail-closed reads", () => {
  const endpointTests = read("supabase/functions/tests/yoco-reconciliation-http.test.ts");
  assert.match(endpointTests, /unsupported methods/);
  assert.match(endpointTests, /disallowed origins and non-admin sessions/);
  assert.match(endpointTests, /test-scoped, read-only/);
  assert.match(endpointTests, /history pagination/);
  assert.match(endpointTests, /fails closed/);
  assert.match(endpointTests, /malformed JSON/);
});
