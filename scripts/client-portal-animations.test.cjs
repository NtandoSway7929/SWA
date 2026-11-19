"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const portal = fs.readFileSync(path.join(root, "client-portal", "index.html"), "utf8");
const styleEnd = portal.indexOf("</style>");
assert.ok(styleEnd > 0, "Client portal stylesheet must exist.");
const styles = portal.slice(0, styleEnd);

test("page entrance animation does not replace the existing section navigation behaviour", () => {
  assert.match(styles, /\.portal-animate-in>\.portal-nav/);
  assert.match(styles, /\.portal-animate-in>\.portal-section-nav/);
  assert.match(styles, /@keyframes portalFadeUp/);
  assert.match(portal, /app\.className="portal-shell portal-animate-in"/);
  const navStart = portal.indexOf("function bindPortalNavigation(){");
  const navEnd = portal.indexOf("\nfunction render", navStart);
  assert.ok(navStart >= 0 && navEnd > navStart);
  const navigation = portal.slice(navStart, navEnd);
  assert.match(navigation, /link\.classList\.toggle\("active",active\)/);
  assert.match(navigation, /behavior:"smooth"/);
});

test("card hover effects are restricted to hover-capable pointers and reduced motion is respected", () => {
  assert.match(styles, /@media\(hover:hover\) and \(pointer:fine\) and \(prefers-reduced-motion:no-preference\)/);
  assert.match(styles, /\.portal-card:hover/);
  assert.match(styles, /prefers-reduced-motion:reduce/);
  assert.match(styles, /\.portal-card,.stat-card,.project-item,.financial-item/);
});

test("all portal modals use shared entrance and exit handling", () => {
  assert.match(styles, /\.portal-modal\.portal-modal-entering \.modal-card/);
  assert.match(styles, /\.portal-modal\.portal-modal-closing \.modal-card/);
  assert.match(portal, /function mountPortalModal\(modal\)/);
  assert.match(portal, /function closePortalModal\(modal,afterClose\)/);
  assert.match(portal, /if\(portalReducedMotion\(\)\|\|!card\)\{finish\(\);return\}/);
  for (const id of ["portal-document-preview-modal", "portal-bank-transfer-modal", "portal-financial-modal", "portal-project-modal"]) {
    assert.ok(portal.includes('modal.id="' + id + '"'), "missing modal: " + id);
  }
});

test("project progress segments and milestone rows animate without changing their stored stage values", () => {
  assert.match(styles, /@keyframes portalProgressFill/);
  assert.match(styles, /\.portal-animate-in \.progress span\.active/);
  assert.match(styles, /\.portal-modal\.portal-modal-entering \.project-milestone-step/);
  assert.match(portal, /aria-valuemax=\"4\"/);
  assert.match(portal, /animation-delay:'\+\(85\+index\*55\)\+'ms/);
});

test("onboarding, asset uploads and client requests animate existing feedback states", () => {
  assert.match(styles, /\.onboarding-form \.onboarding-section:not\(\[hidden\]\)/);
  assert.match(portal, /function animatePortalFeedback\(element\)/);
  assert.match(portal, /animatePortalFeedback\(assetUploadStatus\)/);
  assert.match(portal, /animatePortalFeedback\(message\)/);
  assert.match(portal, /animatePortalFeedback\(statusBox\)/);
  assert.match(portal, /Uploading \"+files\.length/);
});

const helperStart = portal.indexOf("function financialCounterValue(");
const helperEnd = portal.indexOf("\nfunction portalCounterAttributes", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "Currency-safe financial counter helper must exist.");
const counterContext = {};
vm.runInNewContext(
  portal.slice(helperStart, helperEnd) + "\nthis.financialCounterValue=financialCounterValue;",
  counterContext
);

test("financial counters animate only a single ZAR total", () => {
  const amount = item => item.amount;
  const currency = item => item.currency;
  assert.equal(counterContext.financialCounterValue([{ amount: 100, currency: "ZAR" }, { amount: 50, currency: "ZAR" }], amount, currency), 150);
  assert.equal(counterContext.financialCounterValue([{ amount: 100, currency: "ZAR" }, { amount: 50, currency: "USD" }], amount, currency), null);
  assert.equal(counterContext.financialCounterValue([{ amount: 100, currency: "USD" }], amount, currency), null);
  assert.equal(counterContext.financialCounterValue([], amount, currency), 0);
});

test("count-ups preserve their final display strings and respect reduced motion", () => {
  assert.match(styles, /@keyframes portalStatusIn/);
  assert.match(portal, /function animatePortalCounters\(root\)/);
  assert.match(portal, /if\(portalReducedMotion\(\)\|\|!Number\.isFinite\(target\)\|\|target===0\)\{element\.textContent=finalText;return;\}/);
  assert.match(portal, /else element\.textContent=finalText/);
  assert.match(portal, /animatePortalCounters\(app\)/);
  for (const attr of ["data-portal-count", "data-count-value", "data-count-format"]) assert.ok(portal.includes(attr), "missing counter metadata: " + attr);
});

test("Paystack, EFT and client request workflows remain present", () => {
  assert.ok(portal.includes("create-paystack-payment-checkout"));
  assert.ok(portal.includes("bankTransferPortalApi"));
  assert.ok(portal.includes('id="request-form"'));
  assert.ok(portal.includes('href="#projects-section"'));
  assert.ok(portal.includes('href="#finances-section"'));
});

console.log("Client portal motion and reduced-motion contracts passed.");
