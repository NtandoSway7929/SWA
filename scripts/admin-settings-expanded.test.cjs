"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const dashboardHtml = fs.readFileSync(path.join(root, "admin-dashboard", "index.html"), "utf8");
const settingsScript = fs.readFileSync(path.join(root, "admin-dashboard", "admin-settings-expanded.js"), "utf8");
const settingsCss = fs.readFileSync(path.join(root, "admin-dashboard", "admin-settings-expanded.css"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase", "migrations", "20261024193000_admin_settings_workspace.sql"), "utf8");
const pushFunction = fs.readFileSync(path.join(root, "supabase", "functions", "send-admin-push", "index.ts"), "utf8");

test("dashboard loads the expanded settings stylesheet and module after workspace initialization", () => {
  assert.match(dashboardHtml, /admin-settings-expanded\.css\?v=20261024-settings-sections-1/);
  assert.match(dashboardHtml, /admin-settings-expanded\.js\?v=20261024-settings-sections-1/);
  assert.ok(
    dashboardHtml.indexOf("admin-workspace.js") < dashboardHtml.indexOf("admin-settings-expanded.js"),
    "settings integration must load after the core workspace"
  );
});

test("all eight settings sections are mounted and navigable", () => {
  for (const section of [
    "sales", "business", "notifications", "templates",
    "security", "preferences", "website", "innerme"
  ]) {
    assert.match(settingsScript, new RegExp('data-settings-panel="' + section + '"'));
    assert.match(settingsScript, /data-settings-tab=.*section\[0\]/);
    assert.ok(settingsScript.includes('["' + section + '"'), "missing navigation entry for " + section);
  }
  assert.match(settingsScript, /sway-admin-greeting-form/);
  assert.match(settingsScript, /MutationObserver/);
});

test("greeting name is a Settings subpanel and Settings is a direct sidebar destination", () => {
  assert.match(settingsScript, /function normalizeSettingsSidebar\(\)/);
  assert.match(settingsScript, /data-nav-group="settings"/);
  assert.match(settingsScript, /classList\.add\("sway-settings-direct-nav"\)/);
  assert.match(settingsScript, /setAttribute\("aria-label", "Settings"\)/);
  assert.match(settingsScript, /greetingForm\.closest\("\.sway-panel"\)/);
  assert.match(settingsScript, /data-settings-panel="preferences"/);
  assert.match(settingsScript, /preferencesPanel\.insertBefore\(greetingPanel, preferencesPanel\.firstElementChild\)/);
  assert.match(settingsCss, /sway-settings-direct-nav/);
  assert.match(settingsCss, /swe-greeting-settings-panel/);
  assert.match(dashboardHtml, /admin-settings-expanded\.js\?v=20261024-settings-greeting-preferences-1/);
  assert.match(dashboardHtml, /admin-settings-expanded\.css\?v=20261024-settings-greeting-preferences-1/);
});

test("business-wide edits are owner-gated and use existing workflow and invoice records", () => {
  assert.match(settingsScript, /workflow_settings/);
  assert.match(settingsScript, /invoice_settings/);
  assert.match(settingsScript, /data-owner-only/);
  assert.match(migration, /public\.is_swayphics_owner\(\)/);
  assert.match(migration, /Swayphics owners can update workflow settings/);
});

test("personal preference tables enforce administrator-owned rows with RLS", () => {
  assert.match(migration, /create table if not exists public\.admin_notification_preferences/i);
  assert.match(migration, /create table if not exists public\.admin_dashboard_preferences/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /user_id = \(select auth\.uid\(\)\)/i);
});

test("notification preferences govern in-app and browser-push delivery", () => {
  assert.match(migration, /create or replace function public\.create_admin_notification/i);
  assert.match(migration, /notify_sales/);
  assert.match(migration, /notify_finance/);
  assert.match(migration, /notify_delivery/);
  assert.match(migration, /notify_innerme/);
  assert.match(pushFunction, /admin_notification_preferences/);
  assert.match(pushFunction, /browser_push_enabled === false/);
});

test("communication templates are readable by admins and editable only by the owner", () => {
  assert.match(migration, /create table if not exists public\.communication_templates/i);
  assert.match(migration, /Swayphics admins can read communication templates/);
  assert.match(migration, /Swayphics owners manage communication templates/);
  for (const key of [
    "initial_outreach", "follow_up_1", "follow_up_2",
    "meeting_confirmation", "proposal_follow_up", "payment_reminder", "review_request"
  ]) {
    assert.ok(migration.includes("'" + key + "'"), "missing seeded template: " + key);
  }
  assert.match(settingsScript, /data-action="copy-template"/);
});

test("InnerMe controls do not expose provider or service-role secrets", () => {
  assert.match(settingsScript, /data-action="run-innerme-health"/);
  assert.match(settingsScript, /server-side only/i);
  assert.doesNotMatch(settingsScript, /SUPABASE_SERVICE_ROLE_KEY|sb_secret_[A-Za-z0-9]+|VAPID_PRIVATE_KEY/);
  assert.match(settingsCss, /prefers-reduced-motion/);
});

