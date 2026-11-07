"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const dashboardDir = path.join(__dirname, "..", "admin-dashboard");
const workspaceSource = fs.readFileSync(
    path.join(dashboardDir, "admin-workspace.js"),
    "utf8"
);
const workspaceCss = fs.readFileSync(
    path.join(dashboardDir, "admin-workspace.css"),
    "utf8"
);
const dashboardHtml = fs.readFileSync(
    path.join(dashboardDir, "index.html"),
    "utf8"
);

const helperStart = workspaceSource.indexOf("    function insightDataTable(");
const helperEnd = workspaceSource.indexOf(
    "\n    function businessTrendChart(",
    helperStart
);
assert.ok(helperStart >= 0 && helperEnd > helperStart,
    "the workspace must define the chart data-table helper before the chart renderers");

const helperSource = workspaceSource.slice(helperStart, helperEnd);
const sandbox = {
    esc(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
            return {
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;"
            }[character];
        });
    },
    money(value) {
        return "R" + Number(value).toFixed(2);
    }
};
vm.runInNewContext(
    helperSource + "\nthis.renderInsightDataTable = insightDataTable;",
    sandbox
);

const currencyTable = sandbox.renderInsightDataTable(
    [
        { name: "Cash received", values: [1234.5, 0] },
        { name: "New pipeline", values: [2500, 375] }
    ],
    ["Jan 2026", "Feb <2026>"],
    true,
    "Monthly business momentum"
);

assert.ok(currencyTable.includes("<details class=\"sway-bi-data-details\">"),
    "chart data must be available through a native expandable disclosure");
assert.ok(currencyTable.includes("<summary>"),
    "the disclosure must have a native summary control");
assert.ok(currencyTable.includes("<caption>Monthly business momentum monthly data</caption>"),
    "the table must include a descriptive accessible caption");
assert.ok(currencyTable.includes("<th scope=\"col\">Month</th>"),
    "the table must identify its month column");
assert.ok(currencyTable.includes("<th scope=\"col\">Cash received</th>"),
    "the table must preserve series headings");
assert.ok(currencyTable.includes("<th scope=\"row\">Feb &lt;2026&gt;</th>"),
    "month labels must be escaped and marked as row headers");
assert.ok(currencyTable.includes("<td>R1234.50</td>"),
    "currency values must use the chart's money formatter");
assert.ok(currencyTable.includes("<td>R0.00</td>"),
    "zero currency values must remain visible");
assert.ok(currencyTable.includes("<td>R2500.00</td>"),
    "each series value must be included for each month");
assert.ok(!currencyTable.includes("Feb <2026>"),
    "unescaped user-facing strings must not be emitted into the table");

const countTable = sandbox.renderInsightDataTable(
    [{ name: "Completed", values: [2.4, 5] }],
    ["Mar 2026", "Apr 2026"],
    false,
    "Task throughput"
);
assert.ok(countTable.includes("<td>2</td>"),
    "count values must use the same integer rounding as the chart");
assert.ok(countTable.includes("<td>5</td>"),
    "all count series values must be included");

const trendStart = workspaceSource.indexOf(
    "    function businessTrendChart(series, labels, currency, ariaLabel) {"
);
const trendEnd = workspaceSource.indexOf(
    "    function businessGroupedBars(series, labels, ariaLabel) {",
    trendStart
);
const trendSource = workspaceSource.slice(trendStart, trendEnd);
assert.ok(trendSource.includes("insightDataTable(series, labels, currency, ariaLabel)"),
    "line charts must expose their exact monthly data");

const barsStart = trendEnd;
const barsEnd = workspaceSource.indexOf(
    "    function businessHorizontalBars(items, currency, ariaLabel) {",
    barsStart
);
const barsSource = workspaceSource.slice(barsStart, barsEnd);
assert.ok(barsSource.includes("insightDataTable(series, labels, false, ariaLabel)"),
    "grouped bar charts must expose their exact monthly data");

assert.ok(workspaceCss.includes("#sway-admin-workspace .sway-bi-data-details > summary:focus-visible"),
    "the disclosure summary must have a visible keyboard focus state");
assert.ok(workspaceCss.includes("#sway-admin-workspace .sway-bi-data-table-wrap") &&
    workspaceCss.includes("overflow-x: auto;"),
    "the data table must be horizontally scrollable on narrow screens");
assert.ok(workspaceCss.includes("#sway-admin-workspace .sway-bi-data-table caption"),
    "the data table caption must remain available to assistive technology");

assert.ok(dashboardHtml.includes(
    'href="admin-workspace.css?v=20261107-insights-data-tables-1"'
), "the dashboard must use a refreshed stylesheet cache key");

console.log("Admin Insights accessible chart data-table tests passed.");
