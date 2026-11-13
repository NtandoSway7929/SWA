const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const portal = read("client-portal/index.html");
const adminHtml = read("admin-dashboard/index.html");
const adminUi = read("admin-dashboard/bank-transfer-review.js");
const edge = read("supabase/functions/bank-transfer/index.ts");
const migration = read("supabase/migrations/20261112190855_bank_transfer_submissions.sql");
const dbTest = read("supabase/tests/202611120002_bank_transfer_submissions.test.sql");
const config = read("supabase/config.toml");

test("client portal offers EFT only for invoices with a remaining balance", () => {
  assert.match(portal, /data-bank-transfer-invoice/);
  assert.match(portal, /amounts\.outstanding>0/);
  assert.match(portal, /String\(item\.currency\|\|"ZAR"\)\.toUpperCase\(\)==="ZAR"/);
  assert.match(portal, /Use the invoice number as your EFT payment reference/);
  assert.match(portal, /bank-transfer-amount/);
  assert.match(portal, /bank-transfer-reference/);
  assert.match(portal, /bank-transfer-proof/);
});

test("client uploads use a portal token and do not write to the payments ledger", () => {
  assert.match(portal, /functions\/v1\/bank-transfer/);
  assert.match(portal, /formData\.append\("token",token\)/);
  assert.match(edge, /resolvePortalToken/);
  assert.match(edge, /admin\.from\("bank_transfer_submissions"\)[\s\S]*?\.insert\(/);
  assert.doesNotMatch(edge, /admin\.from\("payments"\)\.insert/);
  assert.match(edge, /Your invoice will remain outstanding until Swayphics verifies the deposit/);
  assert.match(edge, /String\(data\.currency \|\| "ZAR"\)\.toUpperCase\(\) !== "ZAR"/);
});

test("proof uploads are size limited, type checked and stored in a private bucket", () => {
  assert.match(edge, /readLimitedMultipart/);
  assert.match(edge, /MAX_PROOF_BYTES = 5 \* 1024 \* 1024/);
  assert.match(edge, /bankTransferProofMatchesMime/);
  assert.match(edge, /storage\.from\(BUCKET\)\.upload/);
  assert.match(edge, /createSignedUrl\(data\.proof_storage_path, 300\)/);
  assert.match(migration, /'swayphics-payment-proofs',[\s\S]*?false/);
  assert.match(migration, /alter table public\.bank_transfer_submissions enable row level security/);
  assert.match(migration, /revoke all on table public\.bank_transfer_submissions from public, anon, authenticated/);
});

test("only active administrators can access review actions and proof links", () => {
  assert.match(edge, /authorizeAdmin/);
  assert.match(edge, /userClient\.rpc\(\s*"is_swayphics_admin",?\s*\)/);
  assert.match(edge, /if \(!authorization\.ok\)[\s\S]*?authorization\.message[\s\S]*?authorization\.status/);
  assert.match(edge, /status: 401,/);
  assert.match(edge, /status: 403,/);
  assert.match(edge, /status: 503,/);
  assert.match(edge, /Administrator session expired or invalid\. Sign in again\./);
  assert.match(adminUi, /Confirm deposit &amp; record/);
  assert.match(adminUi, /Only approve after confirming the deposit has cleared/);
  assert.match(adminHtml, /bank-transfer-review\.js/);
  assert.match(config, /\[functions\.bank-transfer\][\s\S]*?verify_jwt = false/);
});

test("approval is atomic, invoice-locked, balance-aware and issues one receipt", () => {
  assert.match(migration, /select \* into v_submission[\s\S]*?for update/);
  assert.match(migration, /select \* into v_invoice[\s\S]*?for update/);
  assert.match(migration, /swayphics_invoice_net_paid\(v_invoice\.id\)/);
  assert.match(migration, /v_submission\.amount > v_outstanding/);
  assert.match(migration, /upper\(coalesce\(v_invoice\.currency, 'ZAR'\)\) <> 'ZAR'/);
  assert.match(migration, /'EFT'/);
  assert.match(migration, /insert into public\.payment_receipts/);
  assert.match(migration, /status = 'approved'[\s\S]*?payment_id = v_payment\.id/);
  assert.match(dbTest, /repeated approval does not duplicate the payment or receipt/);
  assert.match(dbTest, /overpayment is rejected after locking and rechecking the invoice/);
});

test("rejection requires an audit reason and never creates a payment", () => {
  assert.match(migration, /p_reason text/);
  assert.match(migration, /status = 'rejected'[\s\S]*?rejection_reason = btrim\(p_reason\)/);
  assert.match(dbTest, /rejection does not alter the invoice balance/);
  assert.match(dbTest, /rejection does not create a payment ledger transaction/);
});

test("admin dashboard loads the bank transfer queue only after the review panel opens", () => {
  const mount = adminUi.slice(adminUi.indexOf("function mount()"));
  assert.match(mount, /if \(!accessToken\(\)\) return/);
  assert.match(mount, /if\(open\)load\(\)/);
  assert.doesNotMatch(mount, /appendChild\(root\);\s*load\(\);/);
});;;

test("review widget sends financial mutations only through the guarded Edge Function", () => {
  assert.match(adminUi, /functions\/v1\/bank-transfer/);
  assert.match(adminUi, /request\("approve"/);
  assert.match(adminUi, /request\("reject"/);
  assert.doesNotMatch(adminUi, /\/rest\/v1\/(payments|invoices|bank_transfer_submissions)/);
  assert.doesNotMatch(adminUi, /sk_(live|test)_/);
});

test("approval and rejection RPCs are service-role only", () => {
  assert.match(migration, /revoke all on function public\.admin_approve_bank_transfer_submission\(uuid, uuid\)[\s\S]*?from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.admin_approve_bank_transfer_submission\(uuid, uuid\)[\s\S]*?to service_role/);
  assert.match(migration, /revoke all on function public\.admin_reject_bank_transfer_submission\(uuid, uuid, text\)[\s\S]*?from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.admin_reject_bank_transfer_submission\(uuid, uuid, text\)[\s\S]*?to service_role/);
});
