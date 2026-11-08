"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const portal = fs.readFileSync(path.join(root, "client-portal", "index.html"), "utf8");

const sectionStart = portal.indexOf('<section class="onboarding-section" data-onboarding-step="offers"><div class="onboarding-section-head"><span class="onboarding-number">03</span>');
const sectionEnd = portal.indexOf('Skip this step <span aria-hidden="true">→</span></button></section>', sectionStart);
assert.ok(sectionStart >= 0, "Onboarding step 3 must exist.");
assert.ok(sectionEnd > sectionStart, "Onboarding step 3 must end before step 4.");

const section = portal.slice(sectionStart, sectionEnd);
assert.ok(section.includes("<h4>Vouchers &amp; promotions (optional)</h4>"), "Step 3 must be framed as a general optional promotions section.");
assert.match(section, /Leave this section blank if you do not offer any/i, "Clients without promotions must be explicitly told they can skip this section.");
assert.ok(section.includes("What vouchers, discounts or special offers do you currently offer?"), "The primary prompt must support different offer types.");
assert.ok(section.includes("Daddy’s Deals voucher"), "Daddy’s Deals may remain as one illustrative example, not the subject of the section.");
assert.ok(!/\srequired(?:\s|=|>)/i.test(section), "No field in the optional promotions section may have a required attribute.");
assert.ok(section.includes("Terms &amp; conditions"), "Offer terms must be described generically.");
assert.ok(section.includes("How do customers redeem the offer?"), "Redemption instructions must be described generically.");

const collectorStart = portal.indexOf("function collectOnboarding()");
const collectorEnd = portal.indexOf("\nfunction formatFileSize", collectorStart);
assert.ok(collectorStart >= 0 && collectorEnd > collectorStart, "Onboarding payload collector must exist.");
const collector = portal.slice(collectorStart, collectorEnd);
for (const legacyKey of ["daddy_deals_vouchers", "daddy_deals_terms", "voucher_redemption_process"]) {
  assert.ok(collector.includes(legacyKey), "Existing saved onboarding field must remain compatible: " + legacyKey);
}
assert.ok(section.includes('onboardingValue(o,"daddy_deals_vouchers")'), "Previously saved offer details must continue to populate the form.");
assert.ok(section.includes('onboardingValue(o,"daddy_deals_terms")'), "Previously saved offer terms must continue to populate the form.");
assert.ok(section.includes('onboardingValue(o,"voucher_redemption_process")'), "Previously saved redemption details must continue to populate the form.");

console.log("Client portal onboarding promotions contract tests passed.");
