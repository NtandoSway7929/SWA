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
const stylesheet = fs.readFileSync(
    path.join(dashboardDir, "admin-cash-flow-data.css"),
    "utf8"
);
const dashboardHtml = fs.readFileSync(
    path.join(dashboardDir, "index.html"),
    "utf8"
);

const helperStart = workspaceSource.indexOf("    function cashFlowDataTable(");
const chartStart = workspaceSource.indexOf(
    "    function businessCashFlowChart(",
    helperStart
);
const chartEnd = workspaceSource.indexOf(
    "    function businessConversionGauge(",
    chartStart
);
assert.ok(helperStart >= 0 && chartStart > helperStart && chartEnd > chartStart,
    "the Cash Flow table helper must be defined before the cash flow chart renderer");

const helperSource = workspaceSource.slice(helperStart, chartStart);
const chartSource = workspaceSource.slice(chartStart, chartEnd);

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
    },
    insightCompactValue(value) {
        return "R" + Math.round(Number(value));
    },
    insightXAxis(labels) {
        return '<div class="x-axis">' + labels.map(String).join(" · ") + "</div>";
    }
};

vm.runInNewContext(
    helperSource +
    "\n" +
    chartSource +
    "\nthis.renderCashFlowChart = businessCashFlowChart;",
    sandbox
);

const actualChart = sandbox.renderCashFlowChart(
    [1250.5, 0, 873.25],
    ["Sep 2026", "Oct 2026", "Nov & 2026"],
    "#002096",
    "actual",
    "Cash collected over the last three months"
);

assert.ok(actualChart.includes('<details class="sway-cf-data-details">'),
    "each Cash Flow chart must include a native expandable breakdown");
assert.ok(actualChart.includes("<summary>"),
    "the breakdown must use a native disclosure summary");
assert.ok(actualChart.includes("<caption>Cash collected over the last three months monthly breakdown</caption>"),
    "the table must have a descriptive accessible caption");
assert.ok(actualChart.includes('<th scope="col">Month</th>') &&
    actualChart.includes('<th scope="col">Amount</th>'),
    "the table must expose semantic column headers");
assert.ok(actualChart.includes('<th scope="row">Sep 2026</th>'),
    "months must be semantic row headers");
assert.ok(actualChart.includes("R1250.50") && actualChart.includes("R0.00") &&
    actualChart.includes("R873.25"),
    "every plotted value, including zero, must be present using currency formatting");
assert.ok(actualChart.includes("Nov &amp; 2026"),
    "month labels must be HTML-escaped");
assert.ok(actualChart.includes("R2123.75"),
    "the chart summary total must remain consistent with the unchanged plotted values");
assert.ok(actualChart.includes("Cash collected over the last three months"),
    "the original chart label must remain present");

const scheduledChart = sandbox.renderCashFlowChart(
    [300, 400],
    ["Nov 2026", "Dec 2026"],
    "#0152F4",
    "scheduled",
    "Scheduled invoice balances"
);
assert.ok(scheduledChart.includes("R300.00") && scheduledChart.includes("R400.00"),
    "scheduled invoice values must also be exposed");
assert.ok(scheduledChart.includes("sway-cash-scheduled-fill"),
    "the scheduled chart's existing visual mode must be preserved");

const emptyChart = sandbox.renderCashFlowChart(
    [],
    [],
    "#002096",
    "actual",
    "Cash collected"
);
assert.ok(emptyChart.includes("No monthly data available."),
    "an empty chart must have a clear empty state in its breakdown");

assert.ok(stylesheet.includes(".sway-cf-data-details > summary:focus-visible"),
    "the disclosure summary must have visible keyboard focus styling");
assert.ok(stylesheet.includes(".sway-cf-data-table-wrap") &&
    stylesheet.includes("overflow-x: auto;"),
    "the data table must scroll horizontally on narrow screens");
assert.ok(stylesheet.includes(".sway-cf-data-table caption"),
    "the table caption must remain available to assistive technology");

assert.ok(dashboardHtml.includes(
    'href="admin-cash-flow-data.css?v=20261107-cash-flow-data-1"'
), "the dashboard must load the dedicated Cash Flow data-table stylesheet");

console.log("Cash Flow accessible monthly breakdown tests passed.");
