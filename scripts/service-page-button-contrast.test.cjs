const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "service-pages.css"), "utf8");
const pages = [
  "services/website-design/index.html",
  "services/brand-identity/index.html",
  "services/google-business-profile/index.html",
  "services/booking-systems/index.html"
];
const version = "20261121-button-contrast-v3";
const contrastStart = css.lastIndexOf("SERVICE PAGE BUTTON CONTRAST V3");
assert.notEqual(contrastStart, -1, "the final CTA contrast rules must exist");
const contrast = css.slice(contrastStart);

function luminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map(value => parseInt(value, 16) / 255);
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("all service pages load motion CSS before cache-busted service component CSS", () => {
  for (const relativePath of pages) {
    const html = fs.readFileSync(path.join(root, relativePath), "utf8");
    const motionIndex = html.indexOf("swayphics-motion.css");
    const serviceIndex = html.indexOf("service-pages.css");
    assert.notEqual(motionIndex, -1, relativePath + " must load motion CSS");
    assert.notEqual(serviceIndex, -1, relativePath + " must load service CSS");
    assert.ok(serviceIndex > motionIndex, relativePath + " must load service CSS last");
    assert.ok(html.includes("service-pages.css?v=" + version), relativePath + " must use the new cache key");
  }
});

test("filled blue CTAs force white text in every interaction state", () => {
  for (const token of [
    "background-color: #0152F4 !important;",
    "color: #FFFFFF !important;",
    "-webkit-text-fill-color: #FFFFFF !important;",
    "opacity: 1 !important;",
    "background-color: #0031C5 !important;"
  ]) assert.ok(contrast.includes(token), "missing primary CTA rule: " + token);
  assert.ok(contrast.includes(":link,"));
  assert.ok(contrast.includes(":visited,"));
  assert.ok(contrast.includes(":focus-visible,"));
  assert.ok(contrast.includes(":active,"));
});

test("light and outline CTAs retain readable text/background combinations", () => {
  assert.ok(contrast.includes("background-color: #FFFFFF !important;"));
  assert.ok(contrast.includes("color: #002096 !important;"));
  assert.ok(contrast.includes("color: #343A40 !important;"));
  assert.ok(contrast.includes("background-color: #343A40 !important;"));
  assert.ok(contrastRatio("#FFFFFF", "#0152F4") >= 4.5, "white text on blue must meet WCAG AA");
  assert.ok(contrastRatio("#002096", "#FFFFFF") >= 4.5, "navy text on white must meet WCAG AA");
  assert.ok(contrastRatio("#343A40", "#FFFFFF") >= 4.5, "charcoal text on white must meet WCAG AA");
  assert.ok(contrastRatio("#FFFFFF", "#343A40") >= 4.5, "white text on charcoal hover must meet WCAG AA");
});

test("all four service pages retain primary, outline, pricing and bottom CTAs", () => {
  for (const relativePath of pages) {
    const html = fs.readFileSync(path.join(root, relativePath), "utf8");
    assert.match(html, /class="sp-button"/, relativePath + " must retain a primary CTA");
    assert.match(html, /class="sp-button sp-button--outline"/, relativePath + " must retain an outline CTA");
    assert.match(html, /class="sp-button sp-button--light"/, relativePath + " must retain a light pricing CTA");
    assert.match(html, /class="sp-bottom-cta"/, relativePath + " must retain its bottom CTA section");
  }
});
