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
const deliveryMigration = fs.readFileSync(path.join(root, "supabase", "migrations", "20261025031000_swayphics_project_delivery_settings.sql"), "utf8");
const baseline = fs.readFileSync(path.join(root, "supabase", "swayphics-business-flow.sql"), "utf8");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "validate-site.yml"), "utf8");

test("new Settings assets are cache-busted and loaded in the dashboard", () => {
  assert.ok(html.includes("admin-settings-expanded.css?v=20261025-business-invoices-3"));
  assert.ok(html.includes("admin-settings-expanded.js?v=20261025-business-invoices-3"));
  assert.ok(html.indexOf("admin-workspace.js") < html.indexOf("admin-settings-expanded.js"));
});

test("selected settings panel is explicitly made visible", () => {
  assert.ok(settings.includes('targetPanel.removeAttribute("hidden")'));
  assert.ok(settings.includes('targetPanel.style.setProperty("display", "grid", "important")'));
  assert.ok(settings.includes("document.getElementById(targetId)"));
});

test("sales controls expose response SLA, stage intervals and an attempt cap", () => {
  for (const field of [
    "new_lead_response_hours", "lead_no_response_days", "stage_days_contacted",
    "stage_days_interested", "stage_days_proposal_sent", "stage_days_negotiating",
    "stage_days_follow_up", "max_followup_attempts"
  ]) {
    assert.ok(settings.includes('field("' + field + '"'), "Settings UI missing " + field);
  }
  assert.ok(settings.includes("followup_stage_days: stageDays"));
  assert.ok(settings.includes('stage_days_contacted: stageDays.contacted == null ? "" : stageDays.contacted'));
  assert.ok(settings.includes("if (value !== null) stageDays[entry[0]] = value"));
  assert.ok(migration.includes("new_lead_response_hours integer not null default 24"));
  assert.ok(migration.includes("followup_stage_days jsonb not null default '{}'::jsonb"));
  assert.ok(migration.includes("max_followup_attempts integer not null default 5"));
  assert.ok(migration.includes("'lead.followup_limit'"));
  assert.ok(migration.includes("'lead.response_overdue'"));
  assert.ok(migration.includes("l.created_at <= now() - make_interval(hours => v_response_hours)"));
  assert.ok(migration.includes("l.last_contacted_at <= now() - make_interval("));
  assert.ok(migration.includes("when coalesce(settings.stage_days, '') ~ '^[0-9]{1,3}$'"),
    "migration must contain the complete stage-interval regex literal");
  assert.ok(baseline.includes("l.last_contacted_at <= now() - make_interval("));
  assert.ok(baseline.includes("when coalesce(settings.stage_days, '') ~ '^[0-9]{1,3}$'"),
    "baseline must contain the complete stage-interval regex literal");
  assert.ok(migration.includes("new.status is distinct from old.status"));
  assert.ok(migration.includes("new.next_follow_up is not distinct from old.next_follow_up"));
});

test("monthly targets are saved and current-month actuals use live leads, quotes and invoices", () => {
  for (const field of [
    "monthly_revenue_target", "monthly_new_leads_target", "monthly_proposals_target",
    "monthly_wins_target", "target_conversion_rate"
  ]) {
    assert.ok(settings.includes('field("' + field + '"'), "Settings UI missing " + field);
    assert.ok(settings.includes(field + ":"), "Settings save payload missing " + field);
  }
  assert.ok(settings.includes('data-performance-actual="revenue"'));
  assert.ok(settings.includes("data-performance-bar="));
  assert.ok(settings.includes('getRows("leads"'));
  assert.ok(settings.includes('getRows("quotes"'));
  assert.ok(settings.includes('getRows("invoices"'));
  assert.ok(settings.includes("archived !== true"));
  assert.ok(settings.includes('timeZone: "Africa/Johannesburg"'));
  assert.ok(settings.includes('new Date(startDate + "T00:00:00+02:00").toISOString()'));
});

test("commercial defaults apply only to new documents without explicit dates", () => {
  assert.ok(settings.includes("quote_validity_days"));
  assert.ok(settings.includes("invoice_payment_terms_days"));
  assert.ok(migration.includes("quote_validity_days integer not null default 14"));
  assert.ok(migration.includes("invoice_payment_terms_days integer not null default 7"));
  assert.ok(migration.includes("create trigger trg_swayphics_invoice_commercial_defaults"));
  assert.ok(migration.includes("before insert on public.invoices"));
  assert.ok(migration.includes("create trigger trg_swayphics_quote_commercial_defaults"));
  assert.ok(migration.includes("before insert on public.quotes"));
  assert.ok(migration.includes("if new.due_date is null then"));
  assert.ok(migration.includes("if new.valid_until is null then"));
  assert.ok(migration.includes("Separate functions keep record"));
});

test("project delivery rules apply only to new projects and create configured task checklists", () => {
  assert.ok(settings.includes('["delivery", "Project delivery"]'));
  assert.ok(settings.includes('field("default_project_duration_days"'));
  assert.ok(settings.includes('field("default_project_task_template"'));
  assert.ok(settings.includes('formCard("delivery"'));
  assert.ok(settings.includes('bindForm(root, "delivery"'));
  assert.ok(settings.includes("default_project_task_template: template"));
  assert.ok(settings.includes("lines.length > 25"));
  assert.ok(settings.includes("due_offset_days: offset"));
  assert.ok(settings.includes("priority: priority"));
  assert.ok(settings.includes("default_project_duration_days,default_project_task_template"));
  assert.ok(deliveryMigration.includes("default_project_duration_days integer not null default 14"));
  assert.ok(deliveryMigration.includes("default_project_task_template jsonb not null default '[]'::jsonb"));
  assert.ok(deliveryMigration.includes("create trigger trg_swayphics_project_due_date_default"));
  assert.ok(deliveryMigration.includes("before insert on public.client_projects"));
  assert.ok(deliveryMigration.includes("create trigger trg_swayphics_project_default_tasks"));
  assert.ok(deliveryMigration.includes("after insert on public.client_projects"));
  assert.ok(deliveryMigration.includes("insert into public.tasks"));
  assert.ok(deliveryMigration.includes("new.due_date is null"));
  assert.ok(deliveryMigration.includes("at time zone 'Africa/Johannesburg'"));
  assert.ok(baseline.includes("trg_swayphics_project_default_tasks"));
  assert.ok(baseline.includes("default_project_task_template"));
});

test("settings audit records changed field names only and is protected by row-level security", () => {
  assert.ok(migration.includes("create table if not exists public.admin_settings_audit_log"));
  assert.ok(migration.includes("alter table public.admin_settings_audit_log enable row level security"));
  assert.ok(migration.includes("actor_id = (select auth.uid())"));
  assert.ok(migration.includes("public.is_swayphics_owner()"));
  assert.ok(migration.includes("create or replace function public.audit_swayphics_settings_change()"));
  assert.ok(migration.includes("jsonb_agg(e.key order by e.key)"));
  assert.ok(migration.includes("actor_id, setting_area, changed_fields"));
  assert.ok(!/old_values|new_values|previous_value|new_value/i.test(migration));
  assert.ok(settings.includes("admin_settings_audit_log"));
  assert.ok(settings.includes("Fields changed"));
});

test("automation-health RPC requires an active admin and limits exposed jobs", () => {
  assert.ok(migration.includes("create or replace function public.get_swayphics_automation_status()"));
  assert.ok(migration.includes("auth.uid() is null or not public.is_swayphics_admin()"));
  for (const job of [
    "swayphics-stale-lead-followups", "swayphics-invoice-status-refresh",
    "swayphics-leads-due-today", "swayphics-quote-expiry-reminders"
  ]) assert.ok(migration.includes("'" + job + "'"), "Allowlisted job missing: " + job);
  assert.ok(migration.includes("revoke all privileges on function public.get_swayphics_automation_status() from public, anon"));
  assert.ok(migration.includes("grant execute on function public.get_swayphics_automation_status() to authenticated"));
  assert.ok(settings.includes("get_swayphics_automation_status"));
  assert.ok(settings.includes("Not run yet"));
  assert.ok(settings.includes("Backup retention and restore-test status are not exposed"));
});

test("the migration and baseline use balanced PL/pgSQL dollar delimiters", () => {
  function delimiterStats(source) {
    const lines = source.split(/\r?\n/);
    return {
      malformedOpen: lines.filter(line => line === "as $" || line === "do $").length,
      malformedClose: lines.filter(line => line === "$;").length,
      opens: lines.filter(line => line === "as $$" || line === "do $$").length,
      closes: lines.filter(line => line === "$$;").length
    };
  }
  for (const [name, source] of [["migration", migration], ["baseline", baseline]]) {
    const stats = delimiterStats(source);
    assert.equal(stats.malformedOpen, 0, name + " contains a malformed opening delimiter");
    assert.equal(stats.malformedClose, 0, name + " contains a malformed closing delimiter");
    assert.equal(stats.opens, stats.closes, name + " must balance its dollar delimiters");
  }
});

test("business-flow baseline includes the new columns and governance controls", () => {
  for (const term of [
    "new_lead_response_hours", "followup_stage_days", "max_followup_attempts",
    "monthly_revenue_target", "quote_validity_days", "invoice_payment_terms_days",
    "admin_settings_audit_log", "get_swayphics_automation_status", "default_project_duration_days", "default_project_task_template"
  ]) assert.ok(baseline.includes(term), "Baseline SQL missing " + term);
  assert.ok(baseline.includes("if to_regclass('public.admin_dashboard_preferences') is not null"));
});

test("the new regression suite is wired into CI and governance styles support narrow screens", () => {
  assert.ok(workflow.includes("node scripts/admin-dashboard-business-controls.test.cjs"));
  assert.ok(css.includes("swe-performance-grid"));
  assert.ok(css.includes("data-governance-audit"));
  assert.ok(css.includes("@media (max-width: 700px)"));
});
