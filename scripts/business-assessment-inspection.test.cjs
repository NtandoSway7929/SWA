"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const config = read("supabase/config.toml");
const functionSource = read("supabase/functions/inspect-business-assessment/index.ts");
const provider = read("supabase/functions/inspect-business-assessment/provider.mjs");
const migration = read("supabase/migrations/20261126193000_business_assessment_evidence_inspection.sql");
const submissionRules = read("supabase/functions/submit-business-assessment/rules.mjs");
const publicForm = read("business-opportunity-finder/index.html");
const publicScript = read("business-opportunity-finder/business-opportunity-finder.js");
const adminScript = read("admin-dashboard/business-assessments.js");
const adminCss = read("admin-dashboard/business-assessments.css");

new Function(publicScript);
new Function(adminScript);

assert.match(config, /\[functions\.inspect-business-assessment\]\s*\nverify_jwt = true/,
    "The inspection function must use Supabase gateway JWT verification");
assert.match(functionSource, /TINYFISH_API_KEY/,
    "The server-side inspection worker must read the TinyFish API key from an environment secret");
assert.match(functionSource, /X-API-Key/,
    "TinyFish REST calls must authenticate using the API key header");
assert.match(functionSource, /auth\.getUser/,
    "The inspection function must verify the caller's Supabase identity");
assert.match(functionSource, /rpc\("is_swayphics_admin"\)/,
    "The inspection function must verify the Swayphics administrator role");
assert.match(functionSource, /presence\.inspection_consent !== true/,
    "The server must independently enforce inspection consent");
assert.match(functionSource, /presence\.inspection_consent_version !== CONSENT_VERSION/,
    "The server must enforce the current consent version");
assert.match(functionSource, /EdgeRuntime\.waitUntil\(task\)/,
    "The function must persist a run and schedule its bounded background worker");
assert.match(functionSource, /business_assessment_inspections/,
    "The function must persist inspection run state");
assert.match(functionSource, /business_assessment_evidence/,
    "The function must persist source-specific evidence");
assert.match(functionSource, /api\.search\.tinyfish\.ai/,
    "The worker must use the TinyFish Search REST endpoint");
assert.match(functionSource, /api\.fetch\.tinyfish\.ai/,
    "The worker must use the TinyFish Fetch REST endpoint");
assert.match(functionSource, /not_found_in_search/,
    "A search miss must be represented as a source status, not a factual absence claim");
assert.match(functionSource, /needs_admin_review/,
    "Ambiguous source identities must be flagged for administrator review");
assert.match(functionSource, /stale_worker/,
    "An abandoned active run must be detectable and retryable");
assert.doesNotMatch(functionSource, /console\.(log|error)\([^)]*(TINYFISH_API_KEY|SERVICE_ROLE_KEY)/,
    "Provider and service credentials must never be logged");

assert.match(provider, /export function normalisePublicUrl/,
    "User-supplied URLs must pass server-side public URL validation");
assert.match(provider, /export function matchBusinessIdentity/,
    "Source identity matching must be explicit and testable");
assert.match(provider, /export function sanitiseExcerpt/,
    "Stored evidence excerpts must be sanitised and bounded");
assert.match(provider, /export function mapTinyFishFetchError/,
    "Provider errors must map to explicit source statuses");

assert.match(migration, /alter table public\.business_assessment_inspections enable row level security/i);
assert.match(migration, /alter table public\.business_assessment_evidence enable row level security/i);
assert.match(migration, /revoke all on table public\.business_assessment_inspections from public, anon, authenticated/i);
assert.match(migration, /revoke all on table public\.business_assessment_evidence from public, anon, authenticated/i);
assert.match(migration, /is_swayphics_admin\(\)/i,
    "Only authenticated Swayphics admins may read inspection evidence");
assert.match(migration, /unique \(assessment_id, idempotency_key\)/i,
    "An inspection request must be idempotent at the database level");

assert.match(submissionRules, /normalizePublicPresence/,
    "Assessment submission must normalise the optional public-presence permission");
assert.match(submissionRules, /inspection_consent_version/,
    "Assessment submission must preserve the consent version");
assert.match(submissionRules, /detectPlatform/,
    "Submitted social links must be checked against their claimed platform");

assert.match(publicForm, /bof-inspection-consent/,
    "The public assessment must present a separate inspection permission control");
assert.match(publicForm, /No contact request|does not request contact|does not request contact/i,
    "The public notice must distinguish inspection consent from contact permission");
assert.match(publicScript, /buildPublicPresencePayload/,
    "The public page must only submit the optional public-presence payload through the assessment flow");
assert.match(publicScript, /inspection_consent: false/,
    "Without explicit consent, no inspection permission is sent");
assert.doesNotMatch(publicScript, /TINYFISH_API_KEY|SERVICE_ROLE_KEY/,
    "The public browser must not contain provider or service-role credentials");

assert.match(adminScript, /functions\/v1\/inspect-business-assessment/,
    "The private admin viewer must trigger the inspection Edge Function");
assert.match(adminScript, /window\.confirm/,
    "The admin must confirm the public source groups before inspection");
assert.match(adminScript, /business_assessment_inspections\?select=/,
    "The admin viewer must read the versioned inspection run history");
assert.match(adminScript, /business_assessment_evidence\?select=/,
    "The admin viewer must read source-specific evidence");
assert.match(adminScript, /renderInspectionSection/,
    "The admin viewer must render the evidence panel");
assert.doesNotMatch(adminScript, /SERVICE_ROLE_KEY|service_role/i,
    "The browser must not use the service-role credential");
assert.match(adminCss, /\.bfa-inspection-status/,
    "Inspection statuses must have a readable text-first presentation");

console.log("Business Opportunity Finder evidence inspection access, consent and privacy tests passed.");
