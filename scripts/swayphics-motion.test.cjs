
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const motionCss = fs.readFileSync(path.join(root, "swayphics-motion.css"), "utf8");
const motionJs = fs.readFileSync(path.join(root, "swayphics-motion.js"), "utf8");

const motionPages = [
  "index.html",
  "card/index.html",
  "admin-dashboard/index.html",
  "client-portal/index.html",
  "testimonial.html",
  "testimonial/index.html",
  "services/brand-identity/index.html",
  "services/website-design/index.html",
  "services/google-business-profile/index.html",
  "services/booking-systems/index.html"
];

test("the shared motion assets are linked to each intended Swayphics experience", () => {
  for (const relativePath of motionPages) {
    const html = fs.readFileSync(path.join(root, relativePath), "utf8");
    assert.match(html, /swayphics-motion\.css\?v=20261121-motion-system-1/, relativePath + " must load the shared motion stylesheet");
    assert.match(html, /swayphics-motion\.js\?v=20261121-motion-system-1/, relativePath + " must load the shared motion script");
  }
});

test("the homepage motion journey contains five stages and user controls", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.equal((html.match(/data-sway-journey-panel=/g) || []).length, 5);
  assert.match(html, /data-sway-journey-toggle/);
  assert.match(html, /data-sway-journey-previous/);
  assert.match(html, /data-sway-journey-next/);
  assert.match(html, /Illustrative workflow/);
});

test("the shared motion engine supports dynamic content and reduced motion", () => {
  assert.match(motionJs, /IntersectionObserver/);
  assert.match(motionJs, /MutationObserver/);
  assert.match(motionJs, /prefers-reduced-motion/);
  assert.match(motionJs, /data-sway-journey-panel/);
  assert.match(motionCss, /prefers-reduced-motion:\s*reduce/);
  assert.match(motionCss, /\.sway-motion-item\.sway-motion-visible/);
});

test("legal pages do not load the shared motion layer", () => {
  for (const relativePath of ["privacy-policy/index.html", "cookie-policy/index.html", "terms-and-conditions/index.html", "paia-manual/index.html"]) {
    const html = fs.readFileSync(path.join(root, relativePath), "utf8");
    assert.doesNotMatch(html, /swayphics-motion\.(?:css|js)/, relativePath + " must remain outside the motion rollout");
  }
});
