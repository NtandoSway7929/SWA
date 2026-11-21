const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const home = fs.readFileSync(path.join(root, "index.html"), "utf8");
const motionCss = fs.readFileSync(path.join(root, "swayphics-motion.css"), "utf8");

test("the homepage has no first-load splash or animated loading-logo overlay", () => {
  for (const removed of [
    "sway-intro",
    "first-load logo reveal",
    "sway-public-loading-ui",
    "sway-public-loading-observer",
    "sway-loading-button"
  ]) {
    assert.equal(home.includes(removed), false, "homepage must not include " + removed);
  }
  assert.ok(home.includes('class="hero-video"'), "normal hero video must remain");
});

test("decorative glowing dots and icon glyphs are removed from the homepage", () => {
  for (const removed of [
    "innerme-orb",
    "innerme-note-dot",
    "innerme-typing span",
    "innerme-typing-bounce",
    "✓",
    "★",
    "😀",
    "✨",
    "💫",
    "🌟"
  ]) {
    assert.equal(home.includes(removed), false, "homepage must not include " + removed);
  }
  assert.equal(motionCss.includes(".sway-journey-proofline span::before"), false);
  assert.ok(home.includes('typing.textContent = "InnerMe is thinking"'));
  assert.ok(home.includes('const ratingText = rating + "/5";'));
  assert.equal(home.includes('class="form-status-icon"'), false);
  assert.equal(home.includes("Enquiry Sent ✓"), false);
});

test("the homepage contains no em-dash characters", () => {
  assert.equal(home.includes("—"), false);
});

test("text feedback and accessible ratings remain after icon removal", () => {
  assert.ok(home.includes("Your enquiry has been received"));
  const accessibleRating = "aria-label=" + '"' + "$" + "{rating} out of 5 rating" + '"' ;
  assert.ok(home.includes(accessibleRating));
  assert.ok(home.includes(".form-status.success"));
});
