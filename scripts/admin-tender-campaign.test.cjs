"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "admin-dashboard", "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "admin-dashboard", "tender-corporate-groups.js"), "utf8");
const workspaceScript = fs.readFileSync(path.join(root, "admin-dashboard", "admin-workspace.js"), "utf8");
const css = fs.readFileSync(path.join(root, "admin-dashboard", "tender-corporate-groups.css"), "utf8");
const migration = fs.readFileSync(
  path.join(root, "supabase", "migrations", "20261125110000_tender_corporate_groups_campaign.sql"),
  "utf8"
);
const evidenceMigration = fs.readFileSync(
  path.join(root, "supabase", "migrations", "20261126153000_preserve_tender_workbook_detail.sql"),
  "utf8"
);

assert.doesNotThrow(() => new vm.Script(script), "campaign module must be valid JavaScript");

assert.match(html, /tender-corporate-groups\.css\?v=20261126-email-action-1/);
assert.match(html, /tender-corporate-groups\.js\?v=20261126-branded-composer-1/);
assert.match(html, /tender-mail=20261126-branded-composer-1/);
assert.ok(
  html.indexOf("free-homepage-preview-campaign.js") < html.indexOf("tender-corporate-groups.js"),
  "campaign workspace should load after the existing CRM and campaign controllers"
);

for (const contract of [
  'const ROOT_SELECTOR = "#sway-workspace-main"',
  'const CAMPAIGN_KEY = "tender-corporate-groups-2026"',
  'data-sway-tender-mode="standard"',
  'data-sway-tender-mode="campaign"',
  'lead_campaigns',
  'lead_campaign_prospects',
  'lead_campaign_tender_evidence',
  'original_score',
  'original_priority',
  'contact_person',
  'website_audit_problem',
  'commercial_intelligence_assessment',
  'renderTenderEvidence',
  'data-sway-tender-open',
  'data-sway-tender-email',
  'function openProspectEmailComposer(id)',
  'window.swayphicsOpenCampaignEmailComposer',
  'function emailActionState(item)',
  'data-sway-tender-save-workflow',
  'data-sway-tender-consent-request',
  'data-sway-tender-consent-granted',
  'data-sway-tender-promote',
  'data-sway-tender-do-not-contact',
  'Swayphics_Tender_Corporate_Groups_Prospects.csv'
]) {
  assert.ok(script.includes(contract), "campaign workspace must preserve " + contract);
}

assert.match(script, /email_consent_status !== "granted" \|\| item\.do_not_contact/);
assert.match(script, /stage: "do_not_contact"/);
assert.match(script, /email_consent_status: "revoked"/);
assert.match(script, /qualification_status !== "qualified" \|\| dnc/);
assert.match(script, /No email will be sent/);
assert.match(script, /No email has been sent from this workspace/);
assert.doesNotMatch(script, /mailto:/i, "campaign email actions must not open a third-party mail application");
assert.match(script, /consent === "declined"/);
assert.match(script, /Swayphics Mail with a one-time permission request/);
assert.match(workspaceScript, /window\.swayphicsOpenCampaignEmailComposer = function/);
assert.match(workspaceScript, /contactType === "campaign-prospect"/);
assert.match(workspaceScript, /\/functions\/v1\/send-email/);
assert.match(workspaceScript, /campaignOptions\.onSent/);
assert.match(workspaceScript, /Your greeting, Swayphics branding and signature are handled automatically/);
assert.match(script, /This is a one-time permission request only/);
assert.match(script, /consent === "requested"/);
assert.match(script, /email_consent_requested_at: sentAt/);
assert.match(script, /last_outreach_at: sentAt/);
assert.match(script, /item\.do_not_contact \|\| item\.stage === "do_not_contact"/);
assert.match(script, /business_name: item\.business_name/);
assert.match(script, /source: "Tender & Corporate Groups"/);
assert.match(script, /lead_id/);

assert.match(migration, /create table if not exists public\.lead_campaigns/i);
assert.match(migration, /create table if not exists public\.lead_campaign_prospects/i);
assert.match(migration, /alter table public\.lead_campaigns enable row level security/i);
assert.match(migration, /alter table public\.lead_campaign_prospects enable row level security/i);
assert.match(migration, /public\.is_swayphics_admin\(\)/i);
assert.match(migration, /references public\.leads\(id\) on delete set null/i);
assert.match(migration, /unique \(campaign_id, source_prospect_id\)/i);
assert.match(evidenceMigration, /alter table public\.lead_campaign_prospects/i);
assert.match(evidenceMigration, /add column if not exists contact_person/i);
assert.match(evidenceMigration, /add column if not exists website_audit_problem/i);
assert.match(evidenceMigration, /create table if not exists public\.lead_campaign_tender_evidence/i);
assert.match(evidenceMigration, /alter table public\.lead_campaign_tender_evidence enable row level security/i);
assert.match(evidenceMigration, /public\.is_swayphics_admin\(\)/i);
assert.match(script, /Original workbook qualification score/);
assert.match(script, /lead_campaign_tender_evidence/);

for (const selector of [
  ".sway-tender-tabs",
  ".sway-tender-panel",
  ".sway-tender-table-wrap",
  ".sway-tender-row-actions",
  ".sway-tender-email",
  ".sway-tender-detail-grid",
  ".sway-tender-detail-summary",
  ".sway-tender-evidence-section",
  ".sway-tender-evidence-record",
  "body.sway-dark-mode",
  "@media(max-width:680px)",
  "prefers-reduced-motion"
]) {
  assert.ok(css.includes(selector), "campaign styles must include " + selector);
}

console.log("Tender & Corporate Groups campaign contract tests passed.");
