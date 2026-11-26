"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const feature = path.join(root, "business-opportunity-finder");
const html = fs.readFileSync(path.join(feature, "index.html"), "utf8");
const css = fs.readFileSync(path.join(feature, "business-opportunity-finder.css"), "utf8");
const js = fs.readFileSync(path.join(feature, "business-opportunity-finder.js"), "utf8");

new Function(js);

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, "HTML IDs must be unique");

const staticIds = new Set(ids);
const dynamicallyCreatedIds = new Set(["bof-business-name", "bof-location"]);
const jsIds = [...js.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);

for (const id of jsIds) {
    assert.ok(
        staticIds.has(id) || dynamicallyCreatedIds.has(id),
        "JavaScript references an unexpected or missing element: " + id
    );
}

for (const asset of [
    "business-opportunity-finder.css",
    "business-opportunity-finder.js"
]) {
    assert.ok(
        fs.existsSync(path.join(feature, asset)),
        "The page dependency must exist: " + asset
    );
}

assert.match(html, /name="robots" content="noindex, nofollow"/,
    "The unconnected preview must not be indexed");
assert.match(html, /business-opportunity-finder\.css/,
    "The page must load its own stylesheet");
assert.match(html, /business-opportunity-finder\.js/,
    "The page must load its own behaviour");
assert.match(html, /Nothing is submitted to Swayphics/,
    "The preview must disclose that answers are not submitted");
assert.match(js, /const stepCount = 5/,
    "The assessment should remain a five-question guided flow");
assert.match(js, /aria-pressed=/,
    "Selected options must use the native toggle-button pressed state");
assert.doesNotMatch(js, /aria-checked=|role="radio"|role="checkbox"/,
    "Native buttons must not be given unsupported radio or checkbox roles");
assert.match(js, /class="bof-step-title" tabindex="-1"/,
    "Question headings must be available for managed keyboard focus");
assert.match(js, /evidence: "Self-reported"/,
    "Findings must retain their evidence classification");
assert.match(js, /Website status not established/,
    "The report must keep an unreported website status distinct from no website");
assert.match(js, /No website reported/,
    "A stated lack of a website must be reported as self-reported");
assert.match(js, /"website", "no_website", "directories"/,
    "Selecting no online presence must clear a separate no-website answer");
assert.match(html, /no independent website, social-media or Google Business Profile checks have been performed/i,
    "The report must disclose that external inspection has not occurred");
assert.doesNotMatch(js, /fetch\s*\(|supabase|localStorage|sessionStorage/i,
    "The preview must not submit or persist assessment data");

const serviceRoutes = [
    "../services/website-design/",
    "../services/booking-systems/",
    "../services/ai-customer-replies/",
    "../services/google-business-profile/",
    "../services/review-collection/"
];

for (const route of serviceRoutes) {
    const target = path.resolve(feature, route, "index.html");
    assert.ok(fs.existsSync(target), "Recommendation route must exist: " + route);
}

assert.match(css, /@media \(prefers-reduced-motion: reduce\)/,
    "The page must respect reduced-motion preferences");
assert.match(css, /@media \(max-width: 640px\)/,
    "The page must include mobile layout rules");
assert.match(css, /:focus-visible/,
    "Keyboard focus must remain visible");

console.log("Business Opportunity Finder preview contract tests passed.");
