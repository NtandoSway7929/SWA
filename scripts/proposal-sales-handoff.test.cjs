"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const adminHtml = read("admin-dashboard/index.html");
const adminScript = read("admin-dashboard/proposal-sales-handoff.js");
const adminCss = read("admin-dashboard/proposal-sales-handoff.css");
const reviewPage = read("proposal-review/index.html");
const migration = read("supabase/migrations/20261128120000_swayphics_accepted_quote_sales_handoff.sql");
const deliveryMigration = read("supabase/migrations/20261128110000_swayphics_proposal_delivery_acceptance.sql");
const databaseTest = read("supabase/tests/accepted-quote-sales-handoff.test.sql");
const baseline = read("supabase/tests/accepted-quote-sales-baseline.sql");

assert.match(adminHtml, /proposal-sales-handoff\.css\?v=20261128-accepted-quote-sales-1/,
    "the admin dashboard must load accepted quote handoff styling");
assert.match(adminHtml, /proposal-sales-handoff\.js\?v=20261128-accepted-quote-sales-1/,
    "the admin dashboard must load accepted quote handoff actions");
assert.match(adminHtml, /proposal-sales-handoff\.css\?v=20261128-accepted-quote-sales-1/,
    "the admin dashboard must load accepted quote handoff styling");
assert.match(adminHtml, /proposal-delivery\.js[\s\S]*proposal-sales-handoff\.js/,
    "sales handoff actions must load after proposal delivery actions");

assert.match(adminScript, /swayphics_project_agreements\?select=/,
    "the admin workspace must load the accepted agreement records");
assert.match(adminScript, /admin_convert_accepted_quote_to_client/,
    "lead-to-client conversion must use the dedicated administrator RPC");
assert.match(adminScript, /Convert to client/,
    "accepted quotes linked to leads must expose client conversion");
assert.match(adminScript, /View accepted agreement/,
    "accepted quotes must expose the persisted agreement snapshot");
assert.match(adminScript, /data-create-invoice-from-quote/,
    "the sales handoff must preserve the existing quote invoice action");
assert.match(adminScript, /invoiceButton\.hidden = accepted && !hasClient/,
    "invoice creation must remain hidden until an accepted quote is linked to a client");
assert.doesNotMatch(adminScript, /admin_create_invoice_from_quote|\/rest\/v1\/invoices/,
    "the sales handoff must not duplicate the existing invoice workflow");
assert.doesNotMatch(adminScript, /RESEND_API_KEY|api\.resend\.com/,
    "the sales handoff must not duplicate the email provider pipeline");
assert.match(adminScript, /window\.location\.reload\(\)/,
    "client conversion must refresh the existing CRM and quote workspace");
assert.match(adminCss, /\.accepted-quote-handoff-actions/,
    "accepted quote conversion controls must be styled");
assert.match(adminCss, /\.sway-project-agreement-card/,
    "the agreement review panel must be styled");

assert.match(reviewPage, /href="https:\/\/swayphics\.co\.za\/terms-and-conditions\/" target="_blank"/,
    "the public proposal acceptance checkbox must link to the published Swayphics Terms & Conditions");
assert.match(reviewPage, /have read and agree to the/,
    "the acceptance statement must explicitly record agreement to the Terms & Conditions");
assert.match(reviewPage, /terms_accepted: result\.terms_accepted === true/,
    "the public page must display the server-recorded terms acknowledgement");
assert.match(migration, /terms_document_sha/,
    "the sales migration must persist and return the exact terms document revision reference");
const inlineScript = reviewPage.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(inlineScript, "the proposal review page must include its application script");
new vm.Script(inlineScript[1], { filename: "proposal-review-inline.js" });

assert.match(migration, /create table if not exists public\.swayphics_project_agreements/,
    "accepted proposal responses must create a dedicated agreement snapshot");
assert.match(migration, /after insert on public\.quote_review_responses/,
    "agreement snapshot creation must follow the recorded response");
assert.match(migration, /when new\.terms_accepted is not true/,
    "agreement creation must require the terms acknowledgement");
assert.match(migration, /proposal_snapshot jsonb not null/,
    "agreements must persist their immutable proposal content");
assert.match(migration, /commercial_snapshot jsonb not null/,
    "agreements must persist their immutable quote and line-item content");
assert.match(migration, /terms_document_sha text not null/,
    "agreements must preserve the exact Terms & Conditions document reference");
assert.match(migration, /prevent_swayphics_project_agreement_mutation/,
    "accepted agreement snapshots must be immutable apart from their one-time client association");
assert.match(migration, /admin_convert_accepted_quote_to_client/,
    "an accepted quote must have a controlled client conversion operation");
assert.match(migration, /A recorded client acceptance and Terms & Conditions acknowledgement are required/,
    "prospect conversion must require a recorded client acceptance agreement");
assert.match(adminScript, /Client acceptance required/,
    "the admin workspace must not offer client conversion for manually accepted quotes without agreement evidence");
assert.match(migration, /SWA-AGR-/,
    "accepted agreements must receive a generated Swayphics agreement reference");
assert.match(migration, /public\.admin_create_invoice_from_quote\(uuid\)/,
    "the handoff must explicitly preserve the existing quote-to-invoice RPC");
assert.match(migration, /swayphics\.quote_client_conversion/,
    "the quote's client association must be changed only inside the conversion workflow");
assert.match(migration, /swayphics\.agreement_client_conversion/,
    "the agreement's client association must be changed only inside the conversion workflow");
assert.match(migration, /public\.convert_swayphics_lead_to_client/,
    "client conversion must reuse the existing CRM lead conversion function");
assert.match(migration, /create or replace function public\.respond_swayphics_quote_review/,
    "terms acknowledgement must be integrated into the existing proposal response RPC");
assert.match(migration, /terms_accepted,\s*terms_url,\s*terms_document_sha,\s*acceptance_statement/,
    "the public acceptance RPC must persist the published terms reference and statement");
assert.match(migration, /public\.admin_create_invoice_from_quote/,
    "the sales handoff must leave invoice creation in the existing quote billing workflow");
assert.match(deliveryMigration, /create table if not exists public\.quote_review_responses/,
    "the sales migration must depend on the existing proposal response table");

assert.match(databaseTest, /select extensions\.plan\(41\)/,
    "the accepted quote sales test must declare its full assertion plan");
assert.match(databaseTest, /acceptance automatically creates one immutable agreement snapshot/,
    "the database test must verify agreement snapshot creation");
assert.match(databaseTest, /administrator conversion creates or reuses a client/,
    "the database test must verify the client conversion workflow");
assert.match(databaseTest, /repeating quote invoice conversion returns the existing invoice/,
    "the database test must verify invoice conversion idempotency");
assert.match(databaseTest, /a declined quotation does not create an accepted agreement snapshot/,
    "the database test must verify declined quotes do not create agreements");
assert.match(baseline, /create or replace function public\.convert_swayphics_lead_to_client/,
    "the disposable CRM baseline must provide the existing lead conversion dependency");

console.log("Accepted quote sales handoff source contracts passed.");
