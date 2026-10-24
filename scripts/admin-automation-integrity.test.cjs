"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261024211500_dashboard_automation_reliability.sql"),
  "utf8"
);
const baseline = fs.readFileSync(
  path.join(root, "supabase/swayphics-business-flow.sql"),
  "utf8"
);
const smoke = fs.readFileSync(
  path.join(root, "scripts/admin-table-controls-dashboard-smoke.cjs"),
  "utf8"
);
const invoiceMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261024213000_invoice_project_automation_integrity.sql"),
  "utf8"
);
const workspaceSchema = fs.readFileSync(
  path.join(root, "supabase/swayphics-admin-workspace.sql"),
  "utf8"
);

const dueTodayMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261024214500_swayphics_due_today_lead_notifications.sql"),
  "utf8"
);


function mustMatch(source, pattern, message) {
  assert.match(source, pattern, message);
}

mustMatch(
  migration,
  /create or replace function innerme_private\.process_swayphics_stale_leads_internal\(\)/i,
  "scheduled work must use the private worker rather than the admin-authenticated RPC"
);
mustMatch(
  migration,
  /auth\.uid\(\) is null or not public\.is_swayphics_admin\(\)/i,
  "the dashboard RPC must continue to enforce active admin authentication"
);
mustMatch(
  migration,
  /'negotiating'\s*,\s*'follow-up'/i,
  "completed follow-ups must remain eligible for the next no-response cycle"
);
mustMatch(
  migration,
  /and not exists\s*\(\s*select 1\s+from public\.follow_ups f\s+where f\.lead_id = l\.id\s+and f\.status = 'pending'/i,
  "the worker must skip leads that already have a pending follow-up"
);
mustMatch(
  migration,
  /create unique index if not exists follow_ups_one_pending_per_lead_idx/i,
  "concurrent browser/cron runs must not create duplicate pending follow-ups"
);
mustMatch(
  migration,
  /coalesce\(\s*v_lead\.assigned_to,\s*\(\s*select au\.user_id[\s\S]*?au\.active = true[\s\S]*?au\.role = 'owner'/i,
  "unassigned lead follow-ups must be assigned to an active owner/admin so notifications have a recipient"
);
mustMatch(
  migration,
  /when nullif\(trim\(v_lead\.email\), ''\) is not null then 'Email'\s+when nullif\(trim\(v_lead\.phone\), ''\) is not null then 'Phone'\s+else 'Other'/i,
  "the channel selection must use stored contact details rather than assuming WhatsApp"
);
const insertBlock = migration.split("insert into public.follow_ups")[1]?.split("on conflict")[0] || "";
assert.ok(insertBlock, "follow-up insert block should exist");
assert.doesNotMatch(
  insertBlock,
  /'WhatsApp'/i,
  "automated tasks must not assume a phone number is on WhatsApp"
);
mustMatch(
  migration,
  /create trigger trg_z_ensure_swayphics_next_followup_date\s+before insert or update on public\.leads/i,
  "clearing next_follow_up while recording contact must recalculate the next due date"
);
mustMatch(
  migration,
  /cron\.schedule\(\s*'swayphics-stale-lead-followups'\s*,\s*'\*\/15 \* \* \* \*'/i,
  "the stale-lead automation must run every 15 minutes in the background"
);
mustMatch(
  baseline,
  /innerme_private\.process_swayphics_stale_leads_internal/i,
  "the documented baseline business-flow SQL must contain the private worker"
);
mustMatch(
  baseline,
  /swayphics-stale-lead-followups/i,
  "the baseline business-flow SQL must define the scheduler"
);
mustMatch(
  smoke,
  /jsonResponse\(0\)/,
  "the dashboard smoke test must mock the integer-returning RPC with 0, not an empty array"
);
mustMatch(
  smoke,
  /dashboard startup must invoke the stale-lead automation/i,
  "the browser smoke test must assert that startup invokes the automation"
);

mustMatch(
  invoiceMigration,
  /create trigger trg_sync_swayphics_project_after_invoice_change\s+after insert or update or delete on public\.invoices/i,
  "invoice changes must synchronize the linked project's payment status"
);
mustMatch(
  invoiceMigration,
  /when exists \([\s\S]*?i\.status = 'sent'\s*\) then 'invoice sent'\s*when exists \([\s\S]*?i\.status = 'draft'\s*\) then 'invoice drafted'/i,
  "draft invoices must not be mislabeled as sent"
);
mustMatch(
  invoiceMigration,
  /cron\.schedule\(\s*'swayphics-invoice-status-refresh'\s*,\s*'5 0 \* \* \*'/i,
  "invoice due dates must be swept by a daily background job"
);
mustMatch(
  invoiceMigration,
  /where i\.archived = false[\s\S]{0,250}i\.due_date < v_today/i,
  "the overdue sweep must only transition active, unpaid invoices past their local due date"
);
mustMatch(
  baseline,
  /alter table public\.client_projects[\s\S]*?add constraint client_projects_payment_status_check[\s\S]*?'invoice drafted'/i,
  "the baseline flow SQL must support the draft invoice project status"
);
mustMatch(
  baseline,
  /create trigger trg_sync_swayphics_project_after_invoice_change/i,
  "the baseline flow SQL must include invoice-to-project synchronization"
);
mustMatch(
  baseline,
  /swayphics-invoice-status-refresh/i,
  "the baseline flow SQL must include the overdue status scheduler"
);
mustMatch(
  dueTodayMigration,
  /'lead\.due_today'/i,
  "due-today reminders must use the standard sales event prefix so notification preferences apply"
);
mustMatch(
  dueTodayMigration,
  /l\.next_follow_up = v_today/i,
  "scheduled first-contact and follow-up reminders must include items due today"
);
mustMatch(
  dueTodayMigration,
  /r\.status = 'new'[\s\S]*?First contact due today/i,
  "new leads due today must be labeled as first-contact reminders"
);
mustMatch(
  dueTodayMigration,
  /swayphics-leads-due-today[\s\S]*?'\*\/15 \* \* \* \*'/i,
  "due-today lead notifications must run on a recurring schedule"
);
mustMatch(
  dueTodayMigration,
  /swayphics-lead-due-today:/i,
  "due-today notifications must have a stable per-lead daily deduplication key"
);
mustMatch(
  baseline,
  /generate_swayphics_due_lead_notifications_internal/i,
  "the baseline flow SQL must include the due-today notification routine"
);
mustMatch(
  workspaceSchema,
  /'invoice drafted'/i,
  "the base admin schema must accept the invoice drafted state"
);

console.log(JSON.stringify({
  result: "PASS",
  checks: 29,
  verified: [
    "cron uses a private, no-user-auth worker",
    "dashboard RPC remains admin-authenticated",
    "follow-up leads remain in the repeat cycle",
    "pending follow-ups are deduplicated",
    "automatic channels do not assume WhatsApp",
    "unassigned follow-ups receive an active admin owner",
    "completed follow-ups receive a next due date",
    "scheduler is defined in migration and baseline SQL",
    "project status tracks invoice creation, edits, re-association and deletion",
    "draft invoices are not mislabeled as sent",
    "daily local-date overdue sweep is defined in migration and baseline SQL",
    "base and follow-on schemas accept invoice drafted status",
    "due-today first-contact reminders are scheduled, deduplicated and respect sales notification preferences",
    "dashboard smoke test models scalar RPC results and asserts startup invocation"
  ]
}, null, 2));
