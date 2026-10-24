"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const settings = fs.readFileSync(path.join(root, "admin-dashboard", "admin-settings-expanded.js"), "utf8");
const css = fs.readFileSync(path.join(root, "admin-dashboard", "admin-settings-expanded.css"), "utf8");
const html = fs.readFileSync(path.join(root, "admin-dashboard", "index.html"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase", "migrations", "20261025020000_admin_dashboard_business_controls.sql"), "utf8");
const baseline = fs.readFileSync(path.join(root, "supabase", "swayphics-business-flow.sql"), "utf8");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "validate-site.yml"), "utf8");

test("new Settings assets are cache-busted and loaded in the dashboard", () => {
  assert.match(html, /admin-settings-expanded\\.css\\?v=20261025-business-controls-1/);
  assert.match(html, /admin-settings-expanded\\.js\\?v=20261025-business-controls-1/);
  assert.ok(html.indexOf("admin-workspace.js") < html.indexOf("admin-settings-expanded.js"));
});

test("sales controls expose response SLA, stage intervals and an attempt cap", () => {
  for (const field of [
    "new_lead_response_hours", "lead_no_response_days", "stage_days_contacted",
    "stage_days_interested", "stage_days_proposal_sent", "stage_days_negotiating",
    "stage_days_follow_up", "max_followup_attempts"
  ]) {
    assert.ok(settings.includes('field("' + field + '"'), "Settings UI missing " + field);
  }
  assert.match(settings, /followup_stage_days: stageDays/);
  assert.match(migration, /new_lead_response_hours integer not null default 24/);
  assert.match(migration, /followup_stage_days jsonb not null default '\{\}'::jsonb/);
  assert.match(migration, /max_followup_attempts integer not null default 5/);
  assert.match(migration, /lead\.followup_limit/);
  assert.match(migration, /lead\.response_overdue/);
  assert.match(migration, /l\.created_at <= now\(\) - make_interval\(hours => v_response_hours\)/);
});

test("monthly targets are saved and current-month actuals use live leads, quotes and invoices", () => {
  for (const field of [
    "monthly_revenue_target", "monthly_new_leads_target", "monthly_proposals_target",
    "monthly_wins_target", "target_conversion_rate"
  ]) {
    assert.ok(settings.includes('field("' + field + '"'), "Settings UI missing " + field);
    assert.ok(settings.includes(field + ":"), "Settings save payload missing " + field);
  }
  assert.match(settings, /data-performance-actual="revenue"/);
  assert.match(settings, /data-performance-bar=/);
  assert.match(settings, /getRows\("leads"/);
  assert.match(settings, /getRows\("quotes"/);
  assert.match(settings, /getRows\("invoices"/);
  assert.match(settings, /archived !== true/);
});

test("commercial defaults apply only to new documents without explicit dates", () => {
  assert.match(settings, /quote_validity_days/);
  assert.match(settings, /invoice_payment_terms_days/);
  assert.match(migration, /quote_validity_days integer not null default 14/);
  assert.match(migration, /invoice_payment_terms_days integer not null default 7/);
  assert.match(migration, /create trigger trg_swayphics_invoice_commercial_defaults/i);
  assert.match(migration, /before insert on public\\.invoices/i);
  assert.match(migration, /create trigger trg_swayphics_quote_commercial_defaults/i);
  assert.match(migration, /before insert on public\\.quotes/i);
  assert.match(migration, /if new\.due_date is null then/);
  assert.match(migration, /if new\.valid_until is null then/);
  assert.match(migration, /Separate functions keep record/);
});

test("settings audit records changed field names only and is protected by row-level security", () => {
  assert.match(migration, /create table if not exists public\.admin_settings_audit_log/);
  assert.match(migration, /alter table public\.admin_settings_audit_log enable row level security/);
  assert.match(migration, /actor_id = \(select auth\.uid\(\)\)[\s\S]*?public\.is_swayphics_owner\(\)/);
  assert.match(migration, /create or replace function public\.audit_swayphics_settings_change\(\)/);
  assert.match(migration, /jsonb_agg\(e\.key order by e\.key\)/);
  assert.match(migration, /insert into public\.admin_settings_audit_log\s*\(\s*actor_id, setting_area, changed_fields/i);
  assert.doesNotMatch(migration, /old_values|new_values|previous_value|new_value/i);
  assert.match(settings, /admin_settings_audit_log/);
  assert.match(settings, /Fields changed/);
});

test("automation-health RPC requires an active admin and limits exposed jobs", () => {
  assert.match(migration, /create or replace function public\.get_swayphics_automation_status\(\)/);
  assert.match(migration, /auth\.uid\(\) is null or not public\.is_swayphics_admin\(\)/);
  assert.match(migration, /'swayphics-stale-lead-followups'/);
  assert.match(migration, /'swayphics-invoice-status-refresh'/);
  assert.match(migration, /'swayphics-leads-due-today'/);
  assert.match(migration, /'swayphics-quote-expiry-reminders'/);
  assert.match(migration, /revoke all privileges on function public\.get_swayphics_automation_status\(\) from public, anon/);
  assert.match(migration, /grant execute on function public\.get_swayphics_automation_status\(\) to authenticated/);
  assert.match(settings, /get_swayphics_automation_status/);
  assert.match(settings, /Not run yet/);
  assert.match(settings, /backup retention and restore-test status are not exposed/i);
});

test("business-flow baseline includes the new columns and governance controls", () => {
  for (const term of [
    "new_lead_response_hours", "followup_stage_days", "max_followup_attempts",
    "monthly_revenue_target", "quote_validity_days", "invoice_payment_terms_days",
    "admin_settings_audit_log", "get_swayphics_automation_status"
  ]) assert.ok(baseline.includes(term), "Baseline SQL missing " + term);
  assert.match(baseline, /if to_regclass\('public\.admin_dashboard_preferences'\) is not null/i);
});

test("the new regression suite is wired into CI and governance styles support narrow screens", () => {
  assert.match(workflow, /node scripts\/admin-dashboard-business-controls\.test\.cjs/);
  assert.match(css, /swe-performance-grid/);
  assert.match(css, /data-governance-audit/);
  assert.match(css, /@media \(max-width: 700px\)/);
});
