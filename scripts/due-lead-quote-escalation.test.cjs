"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migrationPath = path.join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20261107223000_escalate_due_leads_and_quote_expiry.sql"
);
const migration = fs.readFileSync(migrationPath, "utf8");

function worker(name) {
  const start = migration.indexOf("create or replace function innerme_private." + name + "()");
  assert.ok(start >= 0, name + " must be replaced by the migration");
  const next = migration.indexOf("create or replace function ", start + 1);
  return migration.slice(start, next < 0 ? migration.length : next);
}

test("due lead reminders preserve SLA and overdue alerts while escalating inactive assignees", () => {
  const sql = worker("generate_swayphics_due_lead_notifications_internal");
  assert.match(sql, /where l\.status not in \('won', 'lost', 'not interested'\)/);
  assert.match(sql, /l\.next_follow_up <= v_today/);
  assert.match(sql, /l\.status = 'new'[\s\S]*?l\.created_at <= now\(\) - make_interval\(hours => v_response_hours\)/);
  assert.match(sql, /v_event_type := 'lead\.response_overdue'/);
  assert.match(sql, /v_event_type := 'lead\.overdue'/);
  assert.match(sql, /v_event_type := 'lead\.due_today'/);
  assert.match(sql, /r\.next_follow_up < v_today/);
  assert.match(sql, /where au\.user_id = l\.assigned_to\s+and au\.active = true/i);
  assert.match(sql, /if r\.assignee_active then[\s\S]*?create_admin_notification\([\s\S]*?else[\s\S]*?notify_admins\([\s\S]*?false\s*\)/i);
  assert.match(sql, /swayphics-lead-schedule:' \|\|\s*r\.id::text \|\| ':' \|\| v_today::text/);
  assert.doesNotMatch(sql, /swayphics-lead-due-today:/);
  assert.match(sql, /No active assignee; administrator attention required\./);
});

test("quote expiry reminders route inactive or missing linked assignees to active admins", () => {
  const sql = worker("generate_swayphics_quote_expiry_notifications_internal");
  assert.match(sql, /q\.status = 'sent'/);
  assert.match(sql, /q\.valid_until <= v_today/);
  assert.match(sql, /coalesce\(l\.assigned_to, c\.assigned_to\) as assigned_to/);
  assert.match(sql, /where au\.user_id = coalesce\(l\.assigned_to, c\.assigned_to\)\s+and au\.active = true/i);
  assert.match(sql, /if r\.assignee_active then[\s\S]*?create_admin_notification\([\s\S]*?else[\s\S]*?notify_admins\([\s\S]*?false\s*\)/i);
  assert.match(sql, /swayphics-quote-validity:' \|\|\s*r\.id::text/);
  assert.match(sql, /case when r\.valid_until = v_today then 'due' else 'expired' end/);
  assert.match(sql, /No active assignee; administrator attention required\./);
});

test("the migration changes routing only and does not add a scheduler or outbound messaging", () => {
  assert.doesNotMatch(migration, /cron\.schedule\s*\(/i);
  assert.doesNotMatch(migration, /net\.http_|send_?email|send_?whatsapp|functions\/v1/i);
  assert.match(migration, /revoke all privileges[\s\S]*?from public, anon, authenticated, service_role/i);
  assert.match(migration, /notify pgrst, 'reload schema'/i);
});
