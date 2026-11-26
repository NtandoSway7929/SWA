"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const adminHtml = fs.readFileSync(path.join(root, "admin-dashboard", "index.html"), "utf8");
const page = fs.readFileSync(path.join(root, "admin-dashboard", "business-assessments.html"), "utf8");
const script = fs.readFileSync(path.join(root, "admin-dashboard", "business-assessments.js"), "utf8");
const nav = fs.readFileSync(path.join(root, "admin-dashboard", "business-assessments-nav.js"), "utf8");
const css = fs.readFileSync(path.join(root, "admin-dashboard", "business-assessments.css"), "utf8");

new Function(script);
new Function(nav);

assert.match(adminHtml, /business-assessments-nav\.js/,
    "The admin workspace must load the assessment navigation module");
assert.match(page, /name="robots" content="noindex, nofollow, noarchive"/,
    "The private review screen must not be indexed");
assert.match(page, /business-assessments\.js/,
    "The private review screen must load its reader module");
assert.match(script, /swayphics_admin_access_token/,
    "The assessment viewer must use the existing admin session");
assert.match(script, /auth\/v1\/user/,
    "The viewer must verify the Supabase user before reading data");
assert.match(script, /rpc\/is_swayphics_admin/,
    "The viewer must verify Swayphics admin permissions");
assert.match(script, /business_assessments\?select=/,
    "The viewer must read assessment records through the authenticated Data API");
assert.match(script, /website_enquiries\?select=/,
    "The viewer must show a separately linked contact request when one exists");
assert.doesNotMatch(script, /submission_key/,
    "The private idempotency key must not be retrieved or exposed by the admin viewer");
assert.doesNotMatch(script, /SUPABASE_SERVICE_ROLE_KEY|service_role/i,
    "The admin browser must not use a service-role credential");
assert.match(page, /read-only review/i,
    "The viewer must disclose that it does not convert leads or change assessments");
assert.match(nav, /Business assessments/,
    "A Business assessments destination must be injected into the CRM navigation");
assert.match(nav, /data-enquiry-status\]\[data-status-next='contacted'\]/,
    "The generic Contacted-to-Lead action must be removed for assessment enquiries");
assert.match(script, /convert_business_assessment_to_lead/, "The viewer must call the dedicated admin conversion RPC");
assert.match(script, /last-contacted timestamp/, "The viewer must disclose the new-lead contact-history rule");
assert.match(script, /link_existing|create_new/, "The viewer must support explicit link-existing and create-new actions");
assert.match(nav, /Review assessment/,
    "Assessment enquiries must route to the linked report");
assert.match(css, /\.bfa-workspace/,
    "The admin review screen must have a responsive assessment workspace layout");

console.log("Business Opportunity Finder admin access and navigation tests passed.");
