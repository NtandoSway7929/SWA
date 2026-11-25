"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "business-opportunity-finder", "index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "business-opportunity-finder", "assessment.js"), "utf8");
const css = fs.readFileSync(path.join(root, "business-opportunity-finder", "assessment.css"), "utf8");

assert.match(html, /id="start-button"/);
assert.match(html, /id="assessment"/);
assert.match(html, /id="results"/);
assert.match(html, /name="consent"/);
assert.match(html, /name="businessName"/);
assert.match(html, /name="email"/);
assert.match(js, /const sequence = \["industry", "booking", "enquiry_process", "discovery", "challenge"\]/);
assert.match(js, /industrySpecific/);
assert.match(js, /findingsForAnswers/);
assert.match(js, /not active in this prototype/);
assert.match(js, /skipButton\.addEventListener/);
assert.match(css, /\.secondary-actions/);
assert.match(css, /prefers-reduced-motion/);

console.log("Business Opportunity Finder frontend contract tests passed.");
