"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const portal = fs.readFileSync(path.join(root, "client-portal", "index.html"), "utf8");

const journeyStart = portal.indexOf("function onboardingJourneyMode(");
const journeyEnd = portal.indexOf("\nfunction serviceRows", journeyStart);
assert.ok(journeyStart >= 0 && journeyEnd > journeyStart, "Customer-journey helpers must be isolated for testing.");
const payloadStart = portal.indexOf("function buildOnboardingPayload(");
const payloadEnd = portal.indexOf("\nfunction collectOnboarding(", payloadStart);
assert.ok(payloadStart >= 0 && payloadEnd > payloadStart, "The onboarding payload mapper must exist.");
const context = {};
vm.runInNewContext(
  'function onboardingValue(onboarding,key){return onboarding&&onboarding[key]!=null?onboarding[key]:"";}\n' +
    portal.slice(journeyStart, journeyEnd) +
    "\n" +
    portal.slice(payloadStart, payloadEnd) +
    "\nthis.onboardingJourneyMode = onboardingJourneyMode;" +
    "\nthis.onboardingJourneyText = onboardingJourneyText;" +
    "\nthis.onboardingJourneyCopy = onboardingJourneyCopy;" +
    "\nthis.buildOnboardingPayload = buildOnboardingPayload;",
  context
);

const fields = {
  business_name: "Northstar Retail",
  contact_name: "Alex",
  email: "hello@example.co.za",
  phone: "071 000 0000",
  address: "Johannesburg",
  operating_hours: "Mon-Fri",
  social_links: "",
  daddy_deals_vouchers: "",
  daddy_deals_terms: "",
  voucher_redemption_process: "",
  booking_system: "Shopify",
  booking_process: "Customer browses products and checks out online.",
  booking_rules: "Delivery in 2-4 days.",
  booking_whatsapp: "071 000 0000",
  about_business: "An independent retail store.",
  branding_notes: "Keep the existing logo.",
  asset_notes: "Product photos supplied."
};

test("guided onboarding exposes seven steps including a final review screen", () => {
  const keys = ["business", "catalogue", "offers", "journey", "story", "assets", "review"];
  for (const key of keys) {
    assert.ok(portal.includes('data-onboarding-step="' + key + '"'), "missing onboarding step: " + key);
  }
  assert.ok(portal.includes('id="onboarding-progress-track"'), "a visible progress indicator must exist.");
  assert.ok(portal.includes('id="onboarding-review-summary"'), "a final review summary must exist.");
  assert.ok(portal.includes('id="onboarding-back"') && portal.includes('id="onboarding-next"'), "previous and continue controls must exist.");
});

test("business journey options cover appointments, retail, online orders and enquiries", () => {
  for (const option of [
    '["appointments","Appointments & bookings"]',
    '["retail","In-person retail"]',
    '["ecommerce","Online store / e-commerce"]',
    '["enquiries","Enquiry-based business"]',
    '["not_applicable","No bookings or structured orders"]'
  ]) {
    assert.ok(portal.includes(option), "missing customer-journey option definition: " + option);
  }
  assert.ok(portal.includes("function updateJourneyMode()"), "journey-specific field adaptation must be wired.");
  assert.ok(portal.includes("fields.hidden=!mode||mode===\"not_applicable\""), "irrelevant booking questions must be hidden when not applicable or not selected.");
});

test("journey-specific prompts adapt for retail and online businesses", () => {
  assert.match(context.onboardingJourneyCopy("retail").processLabel, /purchase in-store/i);
  assert.match(context.onboardingJourneyCopy("ecommerce").processLabel, /online order/i);
  assert.match(context.onboardingJourneyCopy("enquiries").processLabel, /enquiry/i);
  assert.match(context.onboardingJourneyCopy("appointments").processLabel, /book/i);
});

test("the selected customer journey type survives draft saving and reload", () => {
  for (const mode of ["appointments", "retail", "ecommerce", "enquiries"]) {
    const saved = context.buildOnboardingPayload(fields, [{ name: "Product", price: "R100" }], mode, false);
    assert.equal(context.onboardingJourneyMode({ booking_process: saved.booking_process.trim() }), mode);
    assert.equal(context.onboardingJourneyText({ booking_process: saved.booking_process.trim() }), fields.booking_process);
  }
});

test("legacy onboarding booking text continues to load as appointment-based", () => {
  const legacy = { booking_process: "Customers choose a service then message us on WhatsApp." };
  assert.equal(context.onboardingJourneyMode(legacy), "appointments");
  assert.equal(context.onboardingJourneyText(legacy), legacy.booking_process);
});

test("no-booking businesses are saved as not applicable without booking-only fields", () => {
  const result = context.buildOnboardingPayload(
    { ...fields, booking_system: "Old booking app", booking_whatsapp: "071 111 1111", booking_rules: "Old rules" },
    [{ name: "Consultation" }],
    "not_applicable",
    true
  );
  assert.equal(result.booking_process, "Not applicable");
  assert.equal(result.booking_system, "");
  assert.equal(result.booking_whatsapp, "");
  assert.equal(result.booking_rules, "");
  assert.equal(context.onboardingJourneyMode({ booking_process: result.booking_process }), "not_applicable");
});

test("optional promotions remain blank during draft saves", () => {
  const draft = context.buildOnboardingPayload(fields, [{ name: "Product" }], "ecommerce", false);
  assert.equal(draft.daddy_deals_vouchers, "");
});

test("optional promotions satisfy the existing submit RPC when left blank", () => {
  const submitted = context.buildOnboardingPayload(fields, [{ name: "Product" }], "ecommerce", true);
  assert.equal(submitted.daddy_deals_vouchers, "No current promotions");
});

test("the payload retains the existing Supabase onboarding field contract", () => {
  const result = context.buildOnboardingPayload(fields, [{ name: "Product", price: "R100", description: "Details" }], "retail", false);
  const expected = [
    "business_name", "contact_name", "email", "phone", "address", "operating_hours",
    "social_links", "services", "daddy_deals_vouchers", "daddy_deals_terms",
    "voucher_redemption_process", "booking_system", "booking_process", "booking_rules",
    "booking_whatsapp", "about_business", "branding_notes", "asset_notes"
  ].sort();
  assert.deepEqual(Object.keys(result).sort(), expected);
  assert.equal(result.services.length, 1);
  assert.ok(!Object.hasOwn(result, "business_model"), "the front end must not invent an unsupported database field.");
});

test("progress autosaves through the existing secure onboarding RPC", () => {
  const bindStart = portal.indexOf("function bindOnboarding()");
  const bindEnd = portal.indexOf("\nfunction isClientInvoicePayable", bindStart);
  assert.ok(bindStart >= 0 && bindEnd > bindStart, "onboarding controller must exist.");
  const bind = portal.slice(bindStart, bindEnd);
  assert.match(bind, /window\.setTimeout\(function\(\)\{autosaveTimer=null;saveOnboarding\(false,true\)\},900\)/);
  assert.ok(bind.includes('portalRpc("save_client_onboarding"'), "autosave must use the existing token-protected RPC.");
  assert.ok(bind.includes("saveOnboarding(true,false)"), "the final review step must submit through the same RPC.");
});

test("the form supports optional skips, asset upload and edit-from-review actions", () => {
  assert.ok(portal.includes('data-onboarding-skip="offers"'), "promotions must be skippable.");
  assert.ok(portal.includes('data-onboarding-skip="assets"'), "asset upload must be skippable.");
  assert.ok(portal.includes('data-edit-onboarding-step'), "review cards must provide edit navigation.");
  assert.ok(portal.includes('id="upload-assets"'), "existing asset upload functionality must remain available.");
});

console.log("Client portal Phase 2 guided onboarding contract tests passed.");
