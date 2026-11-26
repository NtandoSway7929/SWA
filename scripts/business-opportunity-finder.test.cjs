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
const dynamicallyCreatedIds = new Set([
    "bof-business-name",
    "bof-location",
    "bof-contact-panel",
    "bof-contact-form",
    "bof-contact-title",
    "bof-contact-status",
    "bof-contact-submit",
    "bof-contact-cancel",
    "bof-open-contact",
    "bof-copy-report",
    "bof-restart"
]);
const jsIds = [...js.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);

for (const id of jsIds) {
    assert.ok(
        staticIds.has(id) || dynamicallyCreatedIds.has(id),
        "JavaScript references an unexpected or missing element: " + id
    );
}

assert.match(html, /name="robots" content="noindex, nofollow"/,
    "The assessment should remain noindex until launch review");
assert.match(html, /Your report is based on the answers you submit/i,
    "The introduction must explain how the report is generated");
assert.match(html, /Swayphics stores submitted answers and reports/i,
    "The introduction must disclose assessment storage");
assert.match(html, /asking us to contact you is a separate, optional step/i,
    "The page must separate report generation from consent to be contacted");
assert.match(html, /business-opportunity-finder\.css/,
    "The page must load its own stylesheet");
assert.match(html, /business-opportunity-finder\.js/,
    "The page must load its own behaviour");
assert.match(html, /Evidence and privacy/i,
    "The completed report must explain evidence and data handling");

assert.match(js, /const stepCount = 5/,
    "The assessment should remain a five-question guided flow");
assert.match(js, /aria-pressed=/,
    "Selected options must use the native toggle-button pressed state");
assert.doesNotMatch(js, /aria-checked=|role="radio"|role="checkbox"/,
    "Native buttons must not be given unsupported radio or checkbox roles");
assert.match(js, /class="bof-step-title" tabindex="-1"/,
    "Question headings must be available for managed keyboard focus");
assert.match(js, /Not established from your answers/,
    "An unreported website status must remain distinct from no website");
assert.match(js, /No website reported/,
    "A stated lack of a website must be reflected in the report");
assert.match(js, /No online presence cannot be combined with online discovery channels/,
    "The report rules must not treat an online presence as absent when online channels are selected");
assert.match(js, /action: "complete_assessment"/,
    "Completed answers must be submitted to the dedicated backend");
assert.match(js, /action: "request_contact"/,
    "The optional contact form must use its separate backend action");
assert.match(js, /CONTACT_NOTICE_VERSION/,
    "The contact request must include the current contact notice version");
assert.match(js, /contactPanel\.hidden = false/,
    "The contact form must only be revealed by a user action after the report");
assert.match(js, /assessmentSubmissionKey/,
    "The submission key must be reused for safe retries");
assert.match(js, /SUPABASE_PUBLISHABLE_KEY/,
    "The public request must use a publishable key");
assert.doesNotMatch(js, /SUPABASE_SERVICE_ROLE_KEY|service_role/i,
    "A service-role key must never appear in browser code");
assert.doesNotMatch(js, /localStorage|sessionStorage/,
    "Assessment answers and contact details must not be persisted in browser storage");

for (const asset of [
    "business-opportunity-finder.css",
    "business-opportunity-finder.js"
]) {
    assert.ok(fs.existsSync(path.join(feature, asset)), "The page dependency must exist: " + asset);
}

const serviceRoutes = [
    "../services/website-design/",
    "../services/booking-systems/",
    "../services/ai-customer-replies/",
    "../services/google-business-profile/",
    "../services/review-collection/"
];
for (const route of serviceRoutes) {
    assert.ok(
        fs.existsSync(path.resolve(feature, route, "index.html")),
        "Recommendation route must exist: " + route
    );
}

assert.match(css, /\.bof-contact-panel/,
    "The post-report contact form must have its own layout");
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/,
    "The page must respect reduced-motion preferences");
assert.match(css, /@media \(max-width: 640px\)/,
    "The page must include mobile layout rules");
assert.match(css, /:focus-visible/,
    "Keyboard focus must remain visible");

console.log("Business Opportunity Finder live integration contract tests passed.");
