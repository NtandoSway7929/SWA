"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const workspace = fs.readFileSync(path.join(root, "admin-dashboard", "admin-workspace.js"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase", "swayphics-sales-campaign-attribution.sql"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "supabase", "swayphics-admin-workspace.sql"), "utf8");
const localSchema = fs.readFileSync(path.join(root, "tests", "admin-table-controls-db", "schema.sql"), "utf8");
const browserTest = fs.readFileSync(path.join(root, "scripts", "admin-table-controls-dashboard-smoke.cjs"), "utf8");
const dbTest = fs.readFileSync(path.join(root, "scripts", "admin-table-controls-db-smoke.cjs"), "utf8");
const realtimeSetup = fs.readFileSync(path.join(root, "supabase", "swayphics-admin-workspace-realtime.sql"), "utf8");

for (const table of ["sales_campaigns", "sales_campaign_leads", "sales_campaign_spend"]) {
  assert.match(migration, new RegExp("create table if not exists public\\." + table), "Migration must create " + table + ".");
  assert.match(bootstrap, new RegExp("create table if not exists public\\." + table), "Bootstrap schema must include " + table + ".");
  assert.match(localSchema, new RegExp("create table(?: if not exists)? public\\." + table), "Disposable schema must include " + table + ".");
  assert.match(migration, new RegExp("alter table public\\." + table + " enable row level security"), table + " must enable RLS in migration.");
  assert.match(localSchema, new RegExp("alter table public\\." + table + " enable row level security"), table + " must enable RLS in disposable schema.");
}

assert.match(migration, /sales_campaign_leads_primary_unique_idx[\s\S]{0,220}where attribution_type = 'primary'/,
  "A lead must have at most one primary acquisition campaign.");
assert.match(migration, /unique \(campaign_id, lead_id\)/,
  "Duplicate links from the same campaign to the same lead must be rejected.");
assert.match(migration, /amount numeric\(12,2\) not null check \(amount > 0\)/,
  "Campaign spend must be positive.");
assert.match(migration, /budget_amount numeric\(12,2\) check \(budget_amount is null or budget_amount >= 0\)/,
  "Budget must be optional or non-negative.");
assert.match(migration, /currency in \('ZAR','USD','EUR','GBP'\)/,
  "Campaign and spend currencies must use supported explicit currency codes.");
assert.match(migration, /Swayphics admins can manage sales campaign lead links/,
  "Campaign lead links must be protected by an admin-only RLS policy.");
assert.match(migration, /must not be summed across currencies/,
  "Schema commentary must prevent misleading mixed-currency totals.");

assert.match(migration, /alter publication supabase_realtime add table public\\.%I/,
  "Campaign migration must enable Realtime publication for new campaign tables when available.");
const realtimeTableBlock = workspace.match(/const tables = \\[\\s+"admin_users"[\\s\\S]*?\\];/);
assert.ok(realtimeTableBlock, "The workspace must retain an explicit Realtime subscription table list.");
for (const table of ["sales_campaigns", "sales_campaign_leads", "sales_campaign_spend"]) {
  assert.ok(realtimeTableBlock[0].includes('"' + table + '"'),
    "Workspace Realtime subscription must include " + table + ".");
  assert.ok(realtimeSetup.split("'" + table + "'").length >= 3,
    "Realtime setup SQL must add and verify " + table + ".");
}

assert.match(workspace, /\["sales-campaigns", "Campaign Tracking"\]/,
  "The dashboard navigation must expose Campaign Tracking.");
assert.match(workspace, /function renderSalesCampaigns\(/,
  "Campaign Tracking must render its own page.");
assert.match(workspace, /optionalApi\("\/rest\/v1\/sales_campaigns\?select=\*&order=start_date\.desc", \[\]\)/,
  "Campaign API reads must remain optional until the forward-only migration is deployed.");
for (const key of ["salesCampaigns", "salesCampaignLeads", "salesCampaignSpend"]) {
  assert.ok(workspace.includes(key + ": {"), "Generic form config must exist for " + key + ".");
}
assert.match(workspace, /Primary acquisition only when the campaign originated the lead/i,
  "UI must distinguish acquisition attribution from assisted attribution.");
assert.match(workspace, /not proof that a campaign caused a sale/i,
  "UI must not misrepresent current status as causal campaign conversion.");
assert.match(workspace, /actual amount spent/i,
  "Spend UI must separate actual spend from planned budget.");
assert.ok(workspace.includes("/^\\d{4}-\\d{2}-\\d{2}$/"),
  "Form validation must validate dates before submission.");
assert.match(workspace, /payload\.amount <= 0/,
  "Form validation must reject zero or negative spend.");
assert.match(workspace, /new URL\(payload\.evidence_url\)/,
  "Evidence URLs must be parsed and validated.");
assert.match(browserTest, /Synthetic Website Outreach/,
  "Actual UI test must create a campaign using the test-only mock.");
assert.match(browserTest, /primary acquisition source/,
  "Actual UI test must add a campaign-to-lead attribution.");
assert.match(browserTest, /Synthetic paid-ad spend fixture/,
  "Actual UI test must save a campaign spend entry.");
assert.match(browserTest, /campaign caused a sale/i,
  "Actual UI test must verify the campaign attribution caveat is visible.");
assert.match(dbTest, /a lead cannot have two primary acquisition campaigns/,
  "Database smoke test must reject a second primary attribution.");
assert.match(dbTest, /database constraint must reject negative campaign spend/,
  "Database smoke test must reject negative spend.");
assert.match(dbTest, /non-admin must not read /,
  "Database smoke test must cover campaign table RLS.");

console.log("Sales campaign attribution static checks passed.");
