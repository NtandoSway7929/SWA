const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

const migration = read("supabase/migrations/20261127140000_standard_lead_email_consent.sql");
const consentUi = read("admin-dashboard/standard-lead-email-consent.js");
const workspace = read("admin-dashboard/admin-workspace.js");
const sendEmail = read("supabase/functions/send-email/index.ts");
const dashboard = read("admin-dashboard/index.html");

test("only the 30 audited Standard Lead records enter the consent-required cohort", () => {
  const update = migration.match(/update public\.leads[\s\S]*?where id in \(([\s\S]*?)\);/i);
  assert.ok(update, "migration must explicitly target audited lead IDs");
  const ids = update[1].match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [];
  assert.equal(ids.length, 30);
  assert.equal(new Set(ids.map(id => id.toLowerCase())).size, 30);
  assert.match(update[0], /email_consent_required\s*=\s*true/i);
  assert.match(update[0], /email_consent_status\s*=\s*'not_requested'/i);
});

test("consent evidence is auditable and cannot be directly edited through ordinary lead updates", () => {
  assert.match(migration, /create table if not exists public\.lead_email_consent_events/i);
  assert.match(migration, /create or replace function public\.record_swayphics_lead_email_consent/i);
  assert.match(migration, /create or replace function public\.guard_lead_email_consent_fields/i);
  assert.match(migration, /Use the Swayphics email-consent workflow/i);
  assert.match(migration, /for select to authenticated[\s\S]*public\.is_swayphics_admin\(\)/i);
});

test("the Standard Leads UI requests consent once, blocks pending/declined leads, and supports response recording", () => {
  assert.match(consentUi, /emailConsentAction:\s*"permission_request"/);
  assert.match(consentUi, /emailConsentAction:\s*"marketing"/);
  assert.match(consentUi, /email_consent_status/);
  assert.match(consentUi, /record_swayphics_lead_email_consent/);
  assert.match(consentUi, /Record response/);
  assert.match(consentUi, /Withdraw consent/);
  assert.match(consentUi, /awaiting response/i);
  assert.match(consentUi, /email marketing/i);
});

test("the branded email composer passes the consent action through to the send function", () => {
  assert.match(workspace, /email_consent_action:\s*thread\.email_consent_action/);
  assert.match(workspace, /campaignOptions\.emailConsentAction/);
  assert.match(dashboard, /standard-lead-email-consent\.js\?v=20261127-standard-lead-email-consent-1/);
});

test("the send-email Edge Function enforces consent on the server and records a successful permission request", () => {
  assert.match(sendEmail, /email_consent_action\?:\s*"permission_request"\s*\|\s*"marketing"/);
  assert.match(sendEmail, /email_consent_required/);
  assert.match(sendEmail, /email_consent_status !== "granted"/);
  assert.match(sendEmail, /email_consent_status !== "not_requested"/);
  assert.match(sendEmail, /email_consent_recorded/);
  assert.match(sendEmail, /lead_email_consent_events/);
});
