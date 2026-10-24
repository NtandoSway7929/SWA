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
  /cron\.schedule\(\s*'swayphics-stale-lead-followups'\s*,\s*'20 6 \* \* \*'/i,
  "the stale-lead automation must run on a background schedule"
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

console.log(JSON.stringify({
  result: "PASS",
  checks: 12,
  verified: [
    "cron uses a private, no-user-auth worker",
    "dashboard RPC remains admin-authenticated",
    "follow-up leads remain in the repeat cycle",
    "pending follow-ups are deduplicated",
    "automatic channels do not assume WhatsApp",
    "completed follow-ups receive a next due date",
    "scheduler is defined in migration and baseline SQL",
    "dashboard smoke test models scalar RPC results and asserts startup invocation"
  ]
}, null, 2));
