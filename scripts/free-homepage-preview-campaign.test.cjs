const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "admin-dashboard", "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "admin-dashboard", "free-homepage-preview-campaign.js"), "utf8");
const css = fs.readFileSync(path.join(root, "admin-dashboard", "free-homepage-preview-campaign.css"), "utf8");

test("campaign assets are loaded with cache-busting versions", () => {
  assert.match(html, /free-homepage-preview-campaign\.css\?v=20261026-campaign-preview-1/);
  assert.match(html, /free-homepage-preview-campaign\.js\?v=20261026-campaign-preview-1/);
  assert.ok(html.indexOf("admin-settings-expanded.js") < html.indexOf("free-homepage-preview-campaign.js"));
});

test("campaign defaults preserve the approved seven-day, three-concept offer", () => {
  assert.match(script, /durationDays:7/);
  assert.match(script, /conceptSlots:3/);
  assert.match(script, /websiteStartingPrice:1500/);
  assert.match(script, /conceptMinutesLimit:90/);
  assert.match(script, /status:"draft"/);
});

test("campaign is browser-local and clearly separated from live lead records", () => {
  assert.match(script, /swayphics_free_homepage_preview_campaign_v1/);
  assert.match(script, /does not publish posts or alter lead records/);
  assert.match(script, /do not modify the main lead pipeline/);
  assert.match(css, /#sway-campaign-settings/);
});
