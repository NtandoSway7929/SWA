"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261108090000_admin_automation_run_history.sql"),
  "utf8"
);
const baseline = fs.readFileSync(
  path.join(root, "supabase/swayphics-business-flow.sql"),
  "utf8"
);
const settings = fs.readFileSync(
  path.join(root, "admin-dashboard/admin-settings-expanded.js"),
  "utf8"
);
const html = fs.readFileSync(
  path.join(root, "admin-dashboard/index.html"),
  "utf8"
);
const workflow = fs.readFileSync(
  path.join(root, ".github/workflows/validate-site.yml"),
  "utf8"
);

function functionSql(source) {
  const start = source.indexOf("create or replace function public.get_swayphics_automation_run_history");
  assert.ok(start >= 0, "automation run history RPC must be present");
  const end = source.indexOf("$$;", start);
  assert.ok(end > start, "automation run history RPC must have a complete PL/pgSQL body");
  return source.slice(start, end + 3);
}

test("run history RPC is authenticated, bounded and restricted to known Swayphics jobs", () => {
  const sql = functionSql(migration);
  assert.match(sql, /p_limit integer default 10/i);
  assert.match(sql, /returns table\s*\([\s\S]*?run_id bigint[\s\S]*?job_name text[\s\S]*?started_at timestamptz[\s\S]*?finished_at timestamptz[\s\S]*?duration_ms bigint[\s\S]*?run_status text[\s\S]*?result_summary text/i);
  assert.match(sql, /security definer[\s\S]*?set search_path = ''/i);
  assert.match(sql, /auth\.uid\(\) is null or not public\.is_swayphics_admin\(\)/i);
  assert.match(sql, /v_limit < 1 or v_limit > 20/i);
  assert.match(sql, /from cron\.job_run_details d\s+join cron\.job j on j\.jobid = d\.jobid/i);
  assert.match(sql, /partition by j\.jobid[\s\S]*?order by d\.start_time desc, d\.runid desc[\s\S]*?where r\.job_run_rank <= v_limit/i);
  for (const job of [
    "swayphics-stale-lead-followups",
    "swayphics-invoice-status-refresh",
    "swayphics-leads-due-today",
    "swayphics-quote-expiry-reminders"
  ]) assert.ok(sql.includes("'" + job + "'"), "Missing allowlisted job: " + job);
  assert.match(sql, /round\(extract\(epoch from \(d\.end_time - d\.start_time\)\) \* 1000\)::bigint/i);
  assert.match(sql, /when 'succeeded' then 'Completed successfully\.'/i);
  assert.match(sql, /when 'failed' then 'Failed\. Review Supabase job logs for details\.'/i);
  assert.match(sql, /when 'running' then 'Currently running\.'/i);
  assert.doesNotMatch(sql, /return_message|d\.command/i, "raw cron output and SQL command text must not be exposed");
  assert.match(migration, /revoke all privileges on function public\.get_swayphics_automation_run_history\(integer\)[\s\S]*?from public, anon, service_role/i);
  assert.match(migration, /grant execute on function public\.get_swayphics_automation_run_history\(integer\)[\s\S]*?to authenticated/i);
});

test("business-flow baseline contains the same protected run-history capability", () => {
  const sql = functionSql(baseline);
  assert.match(sql, /auth\.uid\(\) is null or not public\.is_swayphics_admin\(\)/i);
  assert.match(sql, /limit v_limit/i);
  assert.doesNotMatch(sql, /return_message|d\.command/i);
});

test("Governance renders recent run status, SAST start times, durations and safe summaries", () => {
  assert.match(settings, /Recent automation runs/);
  assert.match(settings, /data-governance-runs/);
  assert.match(settings, /data-governance-runs-status/);
  assert.match(settings, /get_swayphics_automation_run_history/);
  assert.match(settings, /p_limit: 10/);
  assert.match(settings, /row\.started_at/);
  assert.match(settings, /row\.finished_at/);
  assert.match(settings, /row\.duration_ms/);
  assert.match(settings, /row\.run_status/);
  assert.match(settings, /row\.result_summary/);
  assert.match(settings, /timeZone: "Africa\/Johannesburg"/);
  assert.match(settings, /Recent automation run history is unavailable/);
  assert.match(html, /admin-settings-expanded\.js\?v=20261108-automation-run-history-1/);
  assert.doesNotMatch(html, /20261107-first-contact-automation-1/);
});

test("the new contract test runs in the standard site-validation workflow", () => {
  assert.match(workflow, /node scripts\/admin-automation-run-history\.test\.cjs/);
});
