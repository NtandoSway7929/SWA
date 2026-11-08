"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workspace = fs.readFileSync(path.join(root, "admin-dashboard", "admin-workspace.js"), "utf8");
const html = fs.readFileSync(path.join(root, "admin-dashboard", "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "admin-dashboard", "admin-lead-cards.css"), "utf8");

function section(source, startMarker, endMarker, label) {
    const start = source.indexOf(startMarker);
    assert.ok(start >= 0, label + " start marker must exist");
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(end > start, label + " end marker must follow its start");
    return source.slice(start, end);
}

const renderer = section(
    workspace,
    "function renderLeads()",
    "function renderFollowups()",
    "lead-card renderer"
);

assert.match(renderer, /class="sway-lead-card"/);
assert.match(renderer, /class="sway-lead-card-open" data-edit="leads" data-id=/,
    "the primary card action must open the existing lead editor");
assert.match(renderer, /data-admin-table-row="leads"/,
    "each card must retain the shared list filter/sort row contract");
assert.match(renderer, /data-admin-table-search=/,
    "each card must retain the searchable-record attribute");
assert.match(renderer, /data-admin-table-filter=/,
    "each card must retain the status-filter attribute");
assert.match(renderer, /data-admin-table-select="leads"/,
    "each card must expose a selectable lead checkbox");
assert.match(renderer, /data-admin-table-select-all="leads"/,
    "the card view must retain select-all-visible behavior");
assert.match(renderer, /data-admin-table-no-results="leads"/,
    "the card view must retain the filtered-empty state");

for (const action of [
    "data-lead-email-id=",
    "data-export-lead-assessment=",
    "data-draft-lead-proposal=",
    "data-toggle-lead-contacted=",
    "data-mark-lead-not-interested=",
    "data-reactivate-lead=",
    "data-convert-lead=",
    'data-delete="leads"'
]) {
    assert.ok(renderer.includes(action), "lead cards must preserve the " + action + " action");
}

assert.match(renderer, /adminTableControls\.items\("leads", state\.leads\)/,
    "cards must continue to use shared search, filter and sort logic");
assert.match(renderer, /adminTableControls\.renderControls\("leads"\)/,
    "cards must retain the existing lead controls");

const leadEditor = section(
    workspace,
    '        leads: {\n            table: "leads"',
    "        followups: {",
    "lead editor configuration"
);
for (const field of [
    "business_name", "contact_name", "email", "phone", "service_interest",
    "source", "status", "estimated_value", "assigned_to", "next_follow_up",
    "business_assessment", "research_findings", "swayphics_solution",
    "recommended_services", "research_sources", "notes"
]) {
    assert.ok(leadEditor.includes('key: "' + field + '"'),
        "the complete lead editor should include " + field);
}

assert.match(html, /admin-lead-cards\.css\?v=20261108-lead-cards-1/,
    "the isolated lead-card stylesheet must be loaded with a cache-busting version");
assert.ok(
    html.indexOf("admin-workspace.css") < html.indexOf("admin-lead-cards.css"),
    "lead-card styles must load after the base workspace styles"
);
assert.match(css, /\.sway-lead-card-grid\s*\{[\s\S]*?display:\s*grid/);
assert.match(css, /\.sway-lead-card-open:focus-visible/);
assert.match(css, /body\.sway-dark-mode/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /@media \(max-width: 520px\)/);

console.log("Admin lead-card contract tests passed.");
