"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const adminHtml = fs.readFileSync(path.join(root, "admin-dashboard", "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "admin-dashboard", "business-assessment-lead-history.js"), "utf8");
const css = fs.readFileSync(path.join(root, "admin-dashboard", "business-assessment-lead-history.css"), "utf8");

new Function(script);

assert.match(adminHtml, /business-assessment-lead-history\.js/,
    "The admin workspace must load the linked assessment history module");
assert.match(adminHtml, /business-assessment-lead-history\.css/,
    "The admin workspace must load the linked assessment history styles");
assert.match(script, /swayphics_admin_access_token/,
    "The history reader must use the existing administrator session");
assert.match(script, /swayphicsAdminSessionReady/,
    "The history reader must wait for the verified admin session");
assert.match(script, /business_assessments\?select=/,
    "The history reader must query linked assessment records through the Data API");
assert.match(script, /lead_id=eq\./,
    "The history query must use the actual lead id, not business-name matching");
assert.match(script, /business-assessments\.html\?assessment=/,
    "Each history item must link to its private assessment report");
assert.match(script, /RESPONDENT-REPORTED OPPORTUNITIES/,
    "Assessment findings must retain their respondent-reported evidence label");
assert.doesNotMatch(script, /submission_key/,
    "The lead profile must not request assessment idempotency keys");
assert.doesNotMatch(script, /SUPABASE_SERVICE_ROLE_KEY|service_role/i,
    "The browser history module must not use service-role credentials");
assert.match(script, /sway-lead-profile-modal/,
    "The module must attach history to the existing lead profile modal");
assert.match(script, /sway-lead-card-open\[data-id\]/,
    "The module must capture the lead id from the actual lead profile trigger");
assert.match(css, /\.bfa-lead-history-card/,
    "The linked assessment history needs dedicated presentation styles");

console.log("Business Opportunity Finder lead profile history tests passed.");
