"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workspace = fs.readFileSync(
    path.join(root, "admin-dashboard", "admin-workspace.js"),
    "utf8"
);
const start = workspace.indexOf("    async function draftLeadProposal(leadId) {");
const end = workspace.indexOf("    function openLeadProposalReview(", start);
assert.ok(start >= 0 && end > start, "The existing lead proposal workflow must exist");
const draft = workspace.slice(start, end);

assert.match(draft, /business_assessments\?select=/,
    "Proposal drafting must retrieve linked Business Opportunity Finder reports");
assert.match(draft, /lead_id=eq\./,
    "The report lookup must use the actual linked lead id");
assert.match(draft, /order=submitted_at\.desc&limit=1/,
    "The latest submitted assessment must be selected deterministically");
assert.match(draft, /business_opportunity_assessment:\s*opportunityAssessment/,
    "The proposal input must carry the structured assessment identity and report");
assert.match(draft, /assessment_snapshot:\s*assessmentSnapshot/,
    "The saved proposal must preserve a versioned report snapshot");
assert.match(draft, /\[Self-reported\]/,
    "Findings passed to InnerMe must retain their self-reported evidence classification");
assert.match(draft, /No independent website, social-media, Google Business Profile or operational inspection was performed/,
    "Proposal context must disclose the absence of independent inspection");
assert.match(draft, /findings\.length === 0 \|\| recommendations\.length === 0/,
    "A vague assessment without an actionable finding and recommendation must not generate a proposal");
assert.match(draft, /snapshot_created_at/,
    "The stored proposal snapshot must record when the assessment context was captured");
assert.match(draft, /business_assessment:\s*lead\.business_assessment/,
    "Existing lead assessment data must remain available to the proposal drafter");
assert.doesNotMatch(draft, /\.from\(["']leads["']\)\.update|update\(\s*\{[^}]*business_assessment/s,
    "Proposal preparation must not write synthesized report text back to the lead record");

console.log("Business Opportunity Finder proposal snapshot tests passed.");
