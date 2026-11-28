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

assert.match(adminHtml, /proposal-sales-handoff\.css\?v=20261128-project-kickoff-1/,
    "the admin dashboard must load accepted quote handoff styling");
assert.match(adminHtml, /proposal-sales-handoff\.js\?v=20261128-project-kickoff-1/,
    "the admin dashboard must load accepted quote handoff actions");
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
assert.match(adminScript, /client_projects\?select=.*source_quote_id=not\.is\.null/,
    "the quote handoff must load projects already linked to accepted quotations");
assert.match(adminScript, /admin_create_project_from_accepted_quote/,
    "the administrator kickoff action must use the dedicated guarded project RPC");
assert.match(adminScript, /Create project/,
    "converted accepted quotes must expose the explicit project creation action");
assert.match(adminScript, /quote_items\?select=/,
    "project kickoff must derive its scope from the accepted quote line items");
assert.match(adminScript, /Client onboarding and file uploads remain available through the existing client portal/,
    "project kickoff must reuse the existing client onboarding and asset-upload portal");
assert.match(adminScript, /projectRows = new Map\(\)/,
    "the handoff UI must recognise existing projects and avoid prompting for duplicates");
assert.match(adminScript, /card\.querySelector\("\.sway-record-card-actions"\)/,
    "sales handoff controls must be appended after the existing quote card actions, not inside the quote title or details");
assert.match(adminScript, /data-create-invoice-from-quote/,
    "the sales handoff must preserve the existing quote invoice action");
assert.match(adminScript, /invoiceButton\.hidden = accepted && \(!hasClient \|\| !agreement\)/,
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
assert.match(adminCss, /\.sway-project-kickoff-card/,
    "the project kickoff dialog must have responsive styling");

assert.match(reviewPage, /href="https:\/\/swayphics\.co\.za\/terms-and-conditions\/revisions\/fa302aec3ab9fd2e8e6458f53726f48cae765e5e\/" target="_blank"/,
    "the public proposal acceptance checkbox must link to the immutable archived Swayphics Terms & Conditions revision");
assert.match(reviewPage, /acknowledge the Swayphics Terms &amp; Conditions/,
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
assert.match(migration, /new\.terms_accepted is not true/,
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
assert.match(migration, /A recorded client acceptance and Terms & Conditions acknowledgement are required before creating an invoice/,
    "the existing invoice conversion RPC must require matching accepted agreement evidence");
assert.match(adminScript, /invoiceButton\.hidden = accepted && \(!hasClient \|\| !agreement\)/,
    "the invoice action must remain hidden until both a client and accepted agreement record exist");
assert.match(migration, /swayphics_private\.client_association_authorizations/,
    "client associations must be authorised through private transaction-scoped records");
assert.match(migration, /pg_catalog\.pg_current_xact_id\(\)/,
    "client association authorisations must be bound to the active database transaction");
assert.doesNotMatch(migration, /current_setting\('swayphics\.(?:quote|agreement)_client_conversion|current_setting\('swayphics\.quote_invoice_conversion'/,
    "caller-settable GUCs must not authorise client or invoice association changes");
assert.match(migration, /target_type = 'invoice'[\s\S]*client_id = new\.client_id/,
    "invoice links must also use the private transaction-scoped authorisation records");
assert.match(migration, /public\.convert_swayphics_lead_to_client/,
    "client conversion must reuse the existing CRM lead conversion function");
assert.match(migration, /set status = 'won',[\s\S]*converted_client_id = v_client_id/,
    "the conversion handoff must reconcile the lead's won status and client reference");
assert.match(migration, /create or replace function public\.respond_swayphics_quote_review/,
    "terms acknowledgement must be integrated into the existing proposal response RPC");
assert.match(migration, /terms_accepted,\s*terms_url,\s*terms_document_sha,\s*acceptance_statement/,
    "the public acceptance RPC must persist the published terms reference and statement");
assert.match(migration, /'terms_accepted', v_existing\.terms_accepted[\s\S]*'terms_document_sha', v_existing\.terms_document_sha/,
    "idempotent proposal acceptance must return the original Terms acknowledgement metadata");
assert.match(migration, /public\.admin_create_invoice_from_quote/,
    "the sales handoff must leave invoice creation in the existing quote billing workflow");
assert.match(deliveryMigration, /create table if not exists public\.quote_review_responses/,
    "the sales migration must depend on the existing proposal response table");

assert.match(databaseTest, /select extensions\.plan\(66\)/,
    "the accepted quote sales and project kickoff test must declare its full assertion plan");
assert.match(migration, /admin_create_project_from_accepted_quote/,
    "the accepted quote migration must expose the administrator project kickoff RPC");
const projectMigration = read("supabase/migrations/20261128130000_swayphics_accepted_quote_project_kickoff.sql");
assert.match(projectMigration, /source_quote_id uuid/,
    "projects must retain the source accepted quote");
assert.match(projectMigration, /source_agreement_id uuid/,
    "projects must retain the exact accepted agreement");
assert.match(projectMigration, /client_projects_source_quote_uidx/,
    "a quote must not produce multiple kickoff projects");
assert.match(projectMigration, /A project source quote and accepted agreement cannot be changed after kickoff/,
    "project source links must be immutable after kickoff");
assert.match(projectMigration, /link_swayphics_project_invoice_after_quote_change/,
    "invoices created after kickoff must be automatically linked to the project");
assert.match(projectMigration, /admin_create_project_from_accepted_quote/,
    "project creation must be restricted to the guarded admin RPC");
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
assert.match(baseline, /create table public\.tasks/,
    "the disposable project fixture must provide the existing task table");
assert.match(baseline, /create table public\.workflow_settings/,
    "the disposable project fixture must provide existing project delivery settings");

console.log("Accepted quote sales handoff source contracts passed.");
