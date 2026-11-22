"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
    path.join(__dirname, "..", "admin-dashboard", "admin-workspace.js"),
    "utf8"
);

const helperStart = source.indexOf("    function applyRevenuePipelineStageFilter(");
const helperEnd = source.indexOf(
    "\n    function cashFlowMonths(",
    helperStart
);
assert.ok(helperStart >= 0 && helperEnd > helperStart,
    "the workspace must define its Revenue Pipeline stage-filter helper");

const helperSource = source.slice(helperStart, helperEnd);
const sandbox = {
    state: {
        tableControls: {
            leads: {
                search: "old query",
                filter: "all",
                sort: "value_desc"
            }
        }
    }
};
vm.runInNewContext(
    helperSource + "\nthis.applyStageFilter = applyRevenuePipelineStageFilter;",
    sandbox
);

const supportedStages = [
    "new",
    "contacted",
    "follow-up",
    "interested",
    "proposal sent",
    "negotiating",
    "won"
];

for (const stage of supportedStages) {
    assert.equal(sandbox.applyStageFilter(stage), true,
        "the " + stage + " stage must be accepted");
    assert.equal(sandbox.state.tableControls.leads.filter, stage,
        "the Leads table filter must be set to " + stage);
    assert.equal(sandbox.state.tableControls.leads.search, "",
        "the stale search query must be cleared when opening " + stage);
    assert.equal(sandbox.state.tableControls.leads.sort, "value_desc",
        "the user's existing Leads sort preference must be preserved");
}

sandbox.state.tableControls.leads.filter = "all";
sandbox.state.tableControls.leads.search = "keep this";
assert.equal(sandbox.applyStageFilter("not-a-stage"), false,
    "unsupported statuses must be rejected");
assert.equal(sandbox.state.tableControls.leads.filter, "all",
    "an unsupported stage must not change the filter");
assert.equal(sandbox.state.tableControls.leads.search, "keep this",
    "an unsupported stage must not change the search");

const pipelineStart = source.indexOf("    function renderRevenuePipeline() {");
const pipelineEnd = source.indexOf(
    "    function applyRevenuePipelineStageFilter(",
    pipelineStart
);
const pipelineSource = source.slice(pipelineStart, pipelineEnd);
assert.ok(pipelineSource.includes(
    'data-lead-stage-filter="' + "' + esc(stage.status) + '" 
), "each Revenue Pipeline stage button must carry its own status filter");

const navigationIndex = source.indexOf('querySelectorAll("[data-view-target]")');
const navigationSource = source.slice(navigationIndex, navigationIndex + 1200);
assert.ok(navigationSource.includes('button.getAttribute("data-lead-stage-filter")'),
    "the shared navigation handler must read the optional pipeline stage");
assert.ok(navigationSource.includes("applyRevenuePipelineStageFilter(leadStageFilter)"),
    "the shared navigation handler must apply the matching status before rendering Leads");
assert.ok(navigationSource.includes("persistWorkspaceView("),
    "navigation must continue persisting the selected workspace view");

console.log("Revenue Pipeline stage navigation tests passed.");
