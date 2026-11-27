"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const config = read("supabase/config.toml");
const functionSource = read("supabase/functions/inspect-business-assessment/index.ts");
const provider = read("supabase/functions/_shared/business-assessment-evidence.mjs");
const providerFacade = read("supabase/functions/inspect-business-assessment/provider.mjs");
const migration = read("supabase/migrations/20261126193000_business_assessment_evidence_inspection.sql");
const submissionRules = read("supabase/functions/submit-business-assessment/rules.mjs");
const publicForm = read("business-opportunity-finder/index.html");
const publicScript = read("business-opportunity-finder/business-opportunity-finder.js");
const adminScript = read("admin-dashboard/business-assessments.js");
const adminCss = read("admin-dashboard/business-assessments.css");
const adminAssessmentsPage = read("admin-dashboard/business-assessments.html");

new Function(publicScript);
new Function(adminScript);

assert.match(config, /\[functions\.inspect-business-assessment\]\s*\nverify_jwt = true/,
    "The inspection function must use Supabase gateway JWT verification");
assert.match(functionSource, /TINYFISH_API_KEY/,
    "The server-side inspection worker must read the TinyFish API key from an environment secret");
assert.match(functionSource, /Deno\.env\.get\("TINYFISH_RESTRICTED_PROCESSING_AGREEMENT_APPROVED"\) === "true"/,
    "Live provider use must require explicit approval of a signed restricted-processing agreement");
assert.match(functionSource, /Deno\.env\.get\("TINYFISH_RESTRICTED_PROCESSING_AGREEMENT_REFERENCE"\)/,
    "Live provider use must include a non-empty written-agreement reference");
assert.match(functionSource, /TINYFISH_RESTRICTED_PROCESSING_AGREEMENT_REFERENCE\.length > 0/,
    "The agreement approval gate must fail closed when the agreement reference is missing");
assert.match(functionSource, /code: "provider_restricted_agreement_not_configured"/,
    "Missing restricted-processing agreement approval must fail closed with an explicit status");
assert.match(functionSource, /provider_agreement_reference: TINYFISH_RESTRICTED_PROCESSING_AGREEMENT_REFERENCE/,
    "Each inspection run must retain the written-agreement reference used for processing");
const approvalGateIndex = functionSource.indexOf("if (!TINYFISH_RESTRICTED_PROCESSING_AGREEMENT_APPROVED)");
const inspectionRunInsertIndex = functionSource.search(/\.from\("business_assessment_inspections"\)\s*\.insert\(/);
assert.ok(approvalGateIndex >= 0 && approvalGateIndex < inspectionRunInsertIndex,
    "The signed-agreement gate must run before an inspection record is created or provider work is scheduled");
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
assert.match(functionSource, /let evidencePersisted = false/,
    "The worker must track whether its evidence batch has already been persisted");
assert.match(functionSource, /evidenceRows\.length && !evidencePersisted/,
    "A later run-status failure must not insert the same evidence batch a second time");
assert.match(functionSource, /if \(completionUpdateError\) throw new Error/,
    "A failed completion-status write must be treated as an inspection failure");
assert.match(functionSource, /api\.search\.tinyfish\.ai/,
    "The worker must use the TinyFish Search REST endpoint");
assert.match(functionSource, /api\.fetch\.tinyfish\.ai/,
    "The worker must use the TinyFish Fetch REST endpoint");
assert.match(functionSource, /not_found_in_search/,
    "A search miss must be represented as a source status, not a factual absence claim");
assert.ok(functionSource.includes('typeof providerError?.error === "string"'),
    "TinyFish per-URL error strings must be read from the documented error field");
assert.ok(functionSource.includes("google.co.za"),
    "South African Google Maps URLs must be included in profile discovery");
assert.match(functionSource, /needs_admin_review/,
    "Ambiguous source identities must be flagged for administrator review");
assert.match(functionSource, /stale_worker/,
    "An abandoned active run must be detectable and retryable");
assert.doesNotMatch(functionSource, /console\.(log|error)\([^)]*(TINYFISH_API_KEY|SERVICE_ROLE_KEY)/,
    "Provider and service credentials must never be logged");

assert.ok(providerFacade.includes('export * from "../_shared/business-assessment-evidence.mjs"'),
    "The inspection-local facade must re-export the canonical shared module");
assert.match(provider, /export function normalisePublicUrl/,
    "User-supplied URLs must pass server-side public URL validation");
assert.match(provider, /export function matchBusinessIdentity/,
    "Source identity matching must be explicit and testable");
assert.match(provider, /sourceType === "website"/,
    "A website must have an independent registered-domain identity signal");
assert.match(provider, /sourceType === "social_profile"/,
    "A social profile must have an independent profile-URL identity signal");
assert.match(provider, /url\.search = ""/,
    "Stored non-Google source URLs must not retain query tokens or tracking parameters");
assert.match(functionSource, /missingSocialPlatforms/,
    "Supplying one social URL must not disable discovery of missing supported platforms");
assert.match(functionSource, /const candidateUrl = safePublicUrl\(item\.url\)/,
    "Malformed search-result URLs must be skipped instead of aborting inspection");
assert.match(functionSource, /sourceType: candidate\.source_type/,
    "The source type and final URL must be used for identity validation");
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
assert.match(migration, /provider_agreement_reference text not null/i,
    "Every stored inspection run must identify the governing written provider agreement");

assert.match(submissionRules, /normalizePublicPresence/,
    "Assessment submission must normalise the optional public-presence permission");
assert.match(submissionRules, /inspection_consent_version/,
    "Assessment submission must preserve the consent version");
assert.match(submissionRules, /detectPlatform/,
    "Submitted social links must be checked against their claimed platform");

assert.match(publicForm, /bof-inspection-consent/,
    "The public assessment must present a separate inspection permission control");
assert.match(publicForm, /separate from any request for Swayphics to contact me/i,
    "The public notice must explicitly separate inspection consent from contact permission");
assert.match(publicScript, /buildPublicPresencePayload/,
    "The public page must only submit the optional public-presence payload through the assessment flow");
assert.match(publicScript, /inspection_consent: false/,
    "Without explicit consent, no inspection permission is sent");
assert.doesNotMatch(publicScript, /TINYFISH_API_KEY|SERVICE_ROLE_KEY/,
    "The public browser must not contain provider or service-role credentials");

assert.ok(adminAssessmentsPage.includes("business-assessments.css?v=20261126-phase4-inspection-1"));
assert.ok(adminAssessmentsPage.includes("business-assessments.js?v=20261126-phase4-inspection-1"));
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
