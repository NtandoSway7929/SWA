"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
    path.join(root, "supabase", "migrations", "20261126181839_business_assessment_lead_conversion.sql"),
    "utf8"
);
const adminScript = fs.readFileSync(
    path.join(root, "admin-dashboard", "business-assessments.js"),
    "utf8"
);

assert.match(migration, /create or replace function public\.convert_business_assessment_to_lead/i);
assert.match(migration, /security definer/i);
assert.match(migration, /set search_path = ''/i);
assert.match(migration, /public\.is_swayphics_admin\(\)/i);
assert.match(migration, /revoke all on function public\.convert_business_assessment_to_lead[\s\S]*from public, anon, authenticated/i);
assert.match(migration, /grant execute on function public\.convert_business_assessment_to_lead[\s\S]*to authenticated/i);

assert.match(migration, /'preview', 'link_existing', 'create_new'/,
    "The conversion RPC must expose only its three supported actions");
assert.match(migration, /'possible_matches'/,
    "The RPC must return possible matches for administrator review");
assert.match(migration, /'matching_reasons'/,
    "The match result must show why a lead was suggested");
assert.match(migration, /'status', 'linked_existing'/,
    "Existing leads must be linkable explicitly");
assert.match(migration, /'status', 'created'/,
    "A separate new lead must be creatable explicitly");
assert.match(migration, /'Business Opportunity Finder'/,
    "New leads must have the correct source");
assert.match(migration, /'new'/,
    "New leads must start at the New stage");
assert.match(migration, /'converted'/,
    "The linked website enquiry must use its supported converted status");
assert.match(migration, /p_confirm_create_new is not true/,
    "Creating a separate lead must require an explicit confirmation");
assert.match(migration, /p_existing_lead_id/,
    "Linking an existing lead must require an explicit selected lead");
assert.match(migration, /pg_advisory_xact_lock/,
    "Concurrent conversions sharing identifiers must be serialized");
assert.match(migration, /lead_status_preserved/,
    "Linking an existing lead must report that its stage is preserved");
assert.match(migration, /lead_source_preserved/,
    "Linking an existing lead must report that its source is preserved");

const insertBlock = migration.match(/insert into public\.leads\s*\(([\s\S]*?)\)\s*values/i);
assert.ok(insertBlock, "The migration must contain a dedicated new-lead insert");
assert.doesNotMatch(insertBlock[1], /last_contacted_at|contacted_manually_at/i,
    "Creating an assessment lead must not write a contacted timestamp");
assert.match(insertBlock[1], /assigned_to/i,
    "The new lead must be assigned to the administrator completing the conversion");

assert.doesNotMatch(migration, /update public\.leads\s+set/i,
    "Linking an existing lead must not overwrite its details, source or status");
assert.match(migration, /update public\.business_assessments[\s\S]*lead_id = v_existing_lead\.id/i,
    "Linking an existing lead must link the assessment record");
assert.match(migration, /update public\.website_enquiries[\s\S]*converted_lead_id = v_existing_lead\.id/i,
    "Linking an existing lead must link the enquiry record");

assert.match(adminScript, /convert_business_assessment_to_lead/,
    "The assessment viewer must call the dedicated conversion RPC");
assert.match(adminScript, /p_action: "preview"/,
    "The viewer must check for matches before conversion");
assert.match(adminScript, /p_action: "link_existing"/,
    "The viewer must support explicit linking to an existing lead");
assert.match(adminScript, /p_action: "create_new"/,
    "The viewer must support explicit new-lead creation");
assert.match(adminScript, /window\.confirm/,
    "Potential duplicates and lead conversion must be explicitly confirmed");
assert.match(adminScript, /last-contacted timestamp/,
    "The conversion interface must explain the no-false-contact rule");

console.log("Business Opportunity Finder lead conversion contract tests passed.");
