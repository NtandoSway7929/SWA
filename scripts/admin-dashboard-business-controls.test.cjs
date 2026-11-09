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
const followupSequenceMigration = fs.readFileSync(path.join(root, "supabase", "migrations", "20261109190000_swayphics_two_stage_business_day_followups.sql"), "utf8");
const contactClock = fs.readFileSync(path.join(root, "supabase", "swayphics-lead-followup-clock.sql"), "utf8");
const dueWorkMigration = fs.readFileSync(path.join(root, "supabase", "migrations", "20261107210000_escalate_unassigned_due_work.sql"), "utf8");
const notificationBaseline = fs.readFileSync(path.join(root, "supabase", "swayphics-admin-notifications.sql"), "utf8");
const deliveryMigration = fs.readFileSync(path.join(root, "supabase", "migrations", "20261025031000_swayphics_project_delivery_settings.sql"), "utf8");
const baseline = fs.readFileSync(path.join(root, "supabase", "swayphics-business-flow.sql"), "utf8");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "validate-site.yml"), "utf8");

test("new Settings assets are cache-busted and loaded in the dashboard", () => {
  assert.ok(html.includes("admin-settings-expanded.css?v=20261025-business-invoices-3"));
  assert.ok(html.includes("admin-settings-expanded.js?v=20261109-two-stage-followups-1"));
  assert.ok(html.indexOf("admin-workspace.js") < html.indexOf("admin-settings-expanded.js"));
});

test("project checklist textarea attributes are closed so later settings panels remain parseable", () => {
  assert.ok(
    settings.includes('maxlength="4000"'),
    "the Project Delivery checklist textarea must close maxlength before Business & invoices markup"
  );
  assert.ok(
    settings.includes('data-wide rows="8" maxlength="4000"'),
    "the complete textarea attribute string must have balanced quotes"
  );
});

test("selected settings panel is explicitly made visible", () => {
  assert.ok(settings.includes('targetPanel.removeAttribute("hidden")'));
  assert.ok(settings.includes('targetPanel.style.setProperty("display", "grid", "important")'));
  assert.ok(settings.includes("document.getElementById(targetId)"));
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


test("lead follow-ups use a fixed two-stage business-day sequence", () => {
  assert.ok(followupSequenceMigration.includes("public.swayphics_add_business_days"));
  assert.ok(followupSequenceMigration.includes("extract(isodow from v_date) between 1 and 5"));
  assert.ok(followupSequenceMigration.includes("automation_sequence"));
  assert.ok(followupSequenceMigration.includes("follow_ups_lead_automation_sequence_uidx"));
  assert.ok(followupSequenceMigration.includes("v_next_sequence>2"));
  assert.ok(followupSequenceMigration.includes("elsif new.automation_sequence=2"));
  assert.ok(followupSequenceMigration.includes("status='lost'"));
  assert.ok(followupSequenceMigration.includes("where coalesce(note,'') like 'Automatic first-contact task:%'"));
  assert.ok(followupSequenceMigration.includes("new.automation_sequence=1"));
  assert.ok(followupSequenceMigration.includes("v_first_completed_at at time zone"));

  const workerStart = followupSequenceMigration.indexOf("create or replace function innerme_private.process_swayphics_stale_leads_internal()");
  const worker = followupSequenceMigration.slice(workerStart);
  assert.ok(workerStart >= 0);
  assert.match(worker, /l\.status in \('contacted','interested','proposal sent','negotiating','follow-up'\)/i);
  assert.doesNotMatch(worker, /l\.status\s*=\s*'new'/i);
  assert.match(worker, /automation_sequence=1[\s\S]*?automation_sequence=2/i);
  assert.match(worker, /v_due_date>v_today[\s\S]*?continue/i);
  assert.match(worker, /on conflict do nothing/i);

  assert.ok(settings.includes("Created two business days after the recorded contact date."));
  assert.ok(settings.includes("Created two business days after follow-up 1 is marked completed."));
  assert.ok(settings.includes("the lead is moved to Lost"));
  assert.ok(settings.includes("Public holidays are not currently excluded."));
  assert.doesNotMatch(settings, /field\("new_lead_response_hours"/);
  assert.doesNotMatch(settings, /field\("max_followup_attempts"/);
  assert.doesNotMatch(settings, /bindForm\(root, "sales"/);
  assert.ok(html.includes("admin-settings-expanded.js?v=20261109-two-stage-followups-1"));

  assert.ok(contactClock.includes("public.swayphics_add_business_days"));
  assert.ok(contactClock.includes("new.last_contacted_at is null"));
  assert.ok(baseline.includes("public.swayphics_add_business_days"));
  assert.ok(baseline.includes("follow_ups_lead_automation_sequence_uidx"));
  assert.ok(baseline.includes("Automatic follow-up 2 of 2"));
  assert.doesNotMatch(baseline, /create or replace function innerme_private\.complete_swayphics_first_contact_followups_on_status_change/);
});

test("due tasks and follow-ups escalate when assignees are missing or inactive", () => {
  const workerStart = dueWorkMigration.indexOf("create or replace function innerme_private.generate_admin_due_notifications_internal()");
  const worker = dueWorkMigration.slice(workerStart);

  assert.ok(workerStart >= 0, "the private due-notification worker must be replaced");
  assert.match(worker, /from public\.tasks t[\s\S]*?where t\.status <> 'completed'[\s\S]*?t\.due_date <= current_date/i);
  assert.match(worker, /from public\.follow_ups f[\s\S]*?where f\.status = 'pending'[\s\S]*?f\.scheduled_for <= current_date/i);
  assert.equal((worker.match(/where au\.user_id = [tf]\.assigned_to\s+and au\.active = true/gi) || []).length, 2,
    "both task and follow-up assignees must be checked against active administrators");
  assert.equal((worker.match(/if r\.assignee_active then/gi) || []).length, 2);
  assert.equal((worker.match(/perform public\.notify_admins\(/gi) || []).length, 3,
    "unassigned/inactive task and follow-up work should escalate to all active admins; invoice routing remains shared");
  assert.match(worker, /No active assignee; administrator attention required\./);
  assert.match(worker, /task-due:' \|\| r\.id::text \|\| ':' \|\| r\.due_date::text/);
  assert.match(worker, /followup-due:' \|\| r\.id::text \|\| ':' \|\| r\.scheduled_for::text/);
  assert.match(worker, /where coalesce\(i\.status, ''\) not in \('paid', 'cancelled'\)/,
    "invoice due reminders must remain unchanged");
  assert.ok(dueWorkMigration.includes("revoke all privileges"));
  assert.ok(notificationBaseline.includes("No active assignee; administrator attention required."));
  assert.ok(notificationBaseline.includes("where au.user_id = t.assigned_to and au.active = true"));
  assert.ok(notificationBaseline.includes("where au.user_id = f.assigned_to and au.active = true"));
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
  for (const [name, source] of [["migration", migration], ["follow-up sequence migration", followupSequenceMigration], ["baseline", baseline]]) {
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
