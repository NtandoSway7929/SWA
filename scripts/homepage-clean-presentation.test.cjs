const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const home = fs.readFileSync(path.join(root, "index.html"), "utf8");
const motionCss = fs.readFileSync(path.join(root, "swayphics-motion.css"), "utf8");

test("the homepage has no first-load splash or animated loading-logo overlay", () => {
  assert.doesNotMatch(home, /sway-intro|first-load logo reveal|sway-public-loading-ui|sway-public-loading-observer|sway-loading-button/);
  assert.match(home, /class="hero-video"/, "normal hero video must remain");
});

test("decorative glowing dots and icon glyphs are removed from the homepage", () => {
  assert.doesNotMatch(home, /innerme-orb|innerme-note-dot|innerme-typing span|innerme-typing-bounce/);
  assert.doesNotMatch(motionCss, /\.sway-journey-proofline span::before/);
  assert.doesNotMatch(home, /[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]/u);
  assert.doesNotMatch(home, /[✓★]/);
  assert.match(home, /typing\\.textContent = "InnerMe is thinking"/);
  assert.match(home, /const ratingText = rating \\+ "\\/5"/);
  assert.doesNotMatch(home, /class="form-status-icon"|Enquiry Sent ✓/);
});

test("the homepage contains no em-dash characters", () => {
  assert.doesNotMatch(home, /—/);
});

test("text feedback and accessible ratings remain after icon removal", () => {
  assert.match(home, /Your enquiry has been received/);
  assert.match(home, /aria-label="\\$\\{rating\\} out of 5 rating"/);
  assert.match(home, /form-status\\.success/);
});
