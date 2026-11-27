"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const adminHtml = read("admin-dashboard/index.html");
const adminScript = read("admin-dashboard/proposal-delivery.js");
const adminCss = read("admin-dashboard/proposal-delivery.css");
const reviewPage = read("proposal-review/index.html");
const migration = read("supabase/migrations/20261128110000_swayphics_proposal_delivery_acceptance.sql");
const databaseTest = read("supabase/tests/proposal-review-workflow.test.sql");
const baseline = read("supabase/tests/proposal-review-baseline.sql");

assert.match(adminHtml, /proposal-delivery\.css\?v=20261128-proposal-delivery-1/,
    "the admin dashboard must load the proposal delivery styling");
assert.match(adminHtml, /proposal-delivery\.js\?v=20261128-proposal-delivery-1/,
    "the admin dashboard must load the proposal delivery actions");
assert.match(adminHtml, /admin-workspace\.js[\s\S]*proposal-delivery\.js/,
    "proposal delivery actions must load after the primary admin workspace");
assert.match(adminScript, /admin_issue_swayphics_quote_review/,
    "the admin action must create a server-controlled review link");
assert.match(adminScript, /functions\/v1\/send-email/,
    "proposal delivery must reuse the existing branded email function");
assert.match(adminScript, /email_consent_action = "marketing"/,
    "required lead consent must be passed through the existing sender");
assert.match(adminScript, /admin_revoke_swayphics_quote_review/,
    "failed delivery must revoke the unissued review link");
assert.match(adminScript, /quote_review_responses\?select=/,
    "the admin workspace must retrieve recorded client decisions");
assert.match(adminScript, /View client response/,
    "the admin workspace must expose the recorded client decision");
assert.doesNotMatch(adminScript, /RESEND_API_KEY|api\.resend\.com/,
    "the admin dashboard must not duplicate the Resend delivery pipeline");
assert.doesNotMatch(adminScript, /admin_create_invoice_from_quote|\/rest\/v1\/invoices/,
    "proposal delivery must not create invoice functionality");
assert.match(adminCss, /\.proposal-delivery-static/,
    "non-actionable quote status controls must be styled");

assert.match(reviewPage, /name="robots" content="noindex,nofollow,noarchive"/,
    "the private review route must not be indexed");
assert.match(reviewPage, /name="referrer" content="no-referrer"/,
    "the bearer token must not be sent as a referrer");
assert.doesNotMatch(reviewPage, /localStorage|sessionStorage/,
    "the public review page must not persist the bearer token");
assert.doesNotMatch(reviewPage, /\.innerHTML\s*=/,
    "proposal content from the database must not be rendered as raw HTML");
assert.match(reviewPage, /textContent\s*=/,
    "proposal content must be rendered as text");
assert.match(reviewPage, /respond_swayphics_quote_review/,
    "the recipient must be able to submit an acceptance or rejection");
assert.match(reviewPage, /id="accept-confirmation" type="checkbox"/,
    "acceptance must require explicit confirmation");
assert.match(reviewPage, /Decline proposal/,
    "the recipient must have a decline action");
assert.match(reviewPage, /id="quote-lines"/,
    "the client review must show the itemised commercial quotation");
const inlineScript = reviewPage.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(inlineScript, "the client review page must include its application script");
new vm.Script(inlineScript[1], { filename: "proposal-review-inline.js" });

assert.match(migration, /token_hash text not null unique/,
    "review links must persist only a unique token hash");
assert.match(migration, /extensions\.gen_random_bytes\(32\)/,
    "review tokens must use cryptographically secure random bytes");
assert.match(migration, /extensions\.digest\(v_token, 'sha256'\)/,
    "review tokens must be hashed before storage");
assert.match(migration, /proposal_version_id uuid not null/,
    "review links must identify the exact proposal revision");
assert.match(migration, /quote_review_responses[\s\S]*decision text not null check \(decision in \('accepted','rejected'\)\)/,
    "only explicit acceptance and rejection decisions can be stored");
assert.match(migration, /prevent_quote_review_response_mutation/,
    "client responses must be append-only");
assert.match(migration, /revoke all on table public\.quote_review_links[\s\S]*from public, anon, authenticated, service_role/,
    "raw review-link rows must not be accessible through direct table grants");
assert.match(migration, /grant execute on function public\.get_swayphics_quote_review\(text\)[\s\S]*to anon, authenticated/,
    "the recipient must use the narrowly scoped public review RPC");
assert.match(migration, /grant execute on function public\.respond_swayphics_quote_review/,
    "the recipient must use the narrowly scoped response RPC");
assert.match(migration, /Only an authenticated Swayphics administrator/,
    "link creation and revocation must require an authenticated Swayphics admin");
assert.match(migration, /p_confirmed is not true/,
    "acceptance must require an affirmative authority confirmation");
assert.match(migration, /Africa\/Johannesburg/,
    "quote validity dates must be interpreted in the South African timezone");
assert.match(databaseTest, /select extensions\.plan\(30\)/,
    "the database workflow must use its complete declared assertion plan");
assert.match(databaseTest, /client acceptance updates the existing quote status/,
    "the database workflow must verify quote acceptance");
assert.match(databaseTest, /client rejection updates the existing quote status/,
    "the database workflow must verify quote rejection");
assert.match(databaseTest, /revoked review links cannot be used/,
    "the database workflow must verify revocation");
assert.match(baseline, /email_consent_required/,
    "the disposable lead fixture must cover the existing email-consent fields");

console.log("Proposal delivery source contracts passed.");
