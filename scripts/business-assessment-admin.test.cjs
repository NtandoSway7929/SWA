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
assert.match(page, /Assessment answers and reports are read-only/i,
    "The viewer must disclose that assessment answers and reports remain read-only");
assert.match(nav, /getElementById\("sway-nav-menu-crm"\)/,
    "The destination must target the actual CRM dropdown container in the dashboard");
assert.match(nav, /Business assessments/,
    "A Business assessments destination must be injected into the CRM navigation");
assert.match(nav, /sessionVerified/,
    "Assessment navigation must wait for the verified administrator session");
assert.match(nav, /embeddedAssessmentId/,
    "Assessment-linked enquiry protection must inspect the embedded reference immediately");
assert.match(nav, /directAssessmentId[\s\S]*attachAssessmentReviewAction/,
    "The legacy enquiry conversion action must be removed before the asynchronous lookup");
assert.match(nav, /data-enquiry-status\]\[data-status-next='contacted'\]/,
    "The generic Contacted-to-Lead action must be removed for assessment enquiries");
assert.match(script, /convert_business_assessment_to_lead/, "The viewer must call the dedicated admin conversion RPC");
assert.match(script, /last-contacted timestamp/, "The viewer must disclose the new-lead contact-history rule");
assert.match(script, /link_existing|create_new/, "The viewer must support explicit link-existing and create-new actions");
assert.match(nav, /Review assessment/,
    "Assessment enquiries must route to the linked report");
assert.match(css, /\.bfa-workspace/,
    "The admin review screen must have a responsive assessment workspace layout");



// Phase 4 admin evidence-panel contract.
const inspectionStart = script.indexOf("async function renderInspectionSection(parent, item)");
const inspectionEnd = script.indexOf("async function replaceInspectionSection(parent, oldSection, item)");
assert.ok(inspectionStart >= 0 && inspectionEnd > inspectionStart,
    "The admin viewer must keep its inspection panel in a dedicated render function");
const inspectionPanel = script.slice(inspectionStart, inspectionEnd);
const consentGuard = inspectionPanel.indexOf(
    'if (presence.inspection_consent !== true ||'
);
const historyLookup = inspectionPanel.indexOf(
    '"/rest/v1/business_assessment_inspections?select='
);
const inspectControl = inspectionPanel.indexOf(
    'element("button", "bfa-inspection-primary"'
);
assert.ok(consentGuard >= 0 && consentGuard < historyLookup && consentGuard < inspectControl,
    "The viewer must stop before history reads or inspection controls when consent is absent or outdated");
assert.match(inspectionPanel, /presence\.inspection_consent_version !== "bof-public-presence-v1"/,
    "The viewer must require the currently supported inspection consent version");
assert.match(inspectionPanel, /No valid public-presence inspection permission is recorded/,
    "The no-consent state must explicitly explain why no inspection is available");
assert.match(inspectionPanel, /No independent website, Google Business Profile or social-profile check has been run/,
    "The no-consent state must not imply that any source has been inspected");
assert.match(inspectionPanel, /provider_agreement_reference/,
    "The admin viewer must fetch the governing provider agreement reference with the inspection run");
assert.match(inspectionPanel, /Provider agreement reference:/,
    "The admin viewer must visibly display the provider agreement reference for audit");
assert.match(inspectionPanel, /\["queued", "running"\]\.includes\(run\.status\)/,
    "A queued or running inspection must not expose a second inspection action");
assert.match(inspectionPanel, /provider_restricted_agreement_not_configured|message\.textContent = error\.message/,
    "An agreement-gate refusal must be surfaced as an error rather than reported as accepted");
assert.match(inspectionPanel, /The inspection request failed\./,
    "The admin viewer must provide a clear fallback when an inspection request cannot start");

assert.match(script, /if \(!\["https:", "http:"\]\.includes\(url\.protocol\)\) return/,
    "Stored source links must reject non-web protocols before rendering");
assert.match(script, /link\.rel = "noopener noreferrer nofollow"/,
    "External evidence links must not inherit opener access or search-ranking endorsement");
assert.match(script, /identity_match_basis/,
    "The evidence viewer must display the basis for its source identity assessment");
assert.match(script, /Identity match:/,
    "The evidence viewer must make source identity status visible separately from fetch status");

console.log("Business Opportunity Finder admin access, navigation and inspection-panel tests passed.");
