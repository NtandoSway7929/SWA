const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const publicSite = read("index.html");
const adminStyles = read("admin-dashboard/admin-workspace.css");
const clientPortal = read("client-portal/index.html");
const adminDashboard = read("admin-dashboard/index.html");

const adminStart = adminStyles.indexOf("SWAYPHICS FIST DRAW LOADER");
const adminEnd = adminStyles.indexOf("INSTANT WORKSPACE LOADING STATE", adminStart);
assert.ok(adminStart >= 0 && adminEnd > adminStart, "admin loader section must be present");
const adminLoader = adminStyles.slice(adminStart, adminEnd);

const portalStart = clientPortal.indexOf(".sway-favicon-loader{");
const portalEnd = clientPortal.indexOf("\n.portal-modal{", portalStart);
assert.ok(portalStart >= 0 && portalEnd > portalStart, "portal loader section must be present");
const portalLoader = clientPortal.slice(portalStart, portalEnd);

for (const removed of [
  "sway-intro",
  "sway-public-loading-ui",
  "sway-public-loading-observer",
  "sway-loading-button",
  "sway-fist-ink-draw-public"
]) {
  assert.equal(publicSite.includes(removed), false, "homepage must not retain " + removed);
}
assert.ok(publicSite.includes('class="hero-video"'), "normal homepage hero video must remain");

assert.ok(adminLoader.includes('background: url("../FIST.webp") center / contain no-repeat;'));
assert.ok(adminLoader.includes("@keyframes sway-fist-ink-draw"));
assert.ok(adminLoader.includes("prefers-reduced-motion: reduce"));
assert.ok(adminLoader.includes("clip-path: none;"));
assert.ok(adminLoader.includes("opacity: 1;"));

assert.ok(portalLoader.includes(".sway-favicon-loader img{"));
assert.ok(portalLoader.includes("animation:sway-fist-ink-draw"));
assert.ok(portalLoader.includes("@keyframes sway-fist-ink-draw{"));
assert.ok(portalLoader.includes("prefers-reduced-motion:reduce"));
assert.ok(portalLoader.includes("clip-path:none;opacity:1"));

for (const source of [adminLoader, portalLoader]) {
  for (const removed of [
    "sway-favicon-draw",
    "sway-favicon-trace",
    "sway-favicon-dot",
    "sway-button-favicon-draw",
    "rotate(360deg)"
  ]) {
    assert.equal(source.includes(removed), false, "legacy loader effect must be absent: " + removed);
  }
}

assert.ok(portalLoader.includes(".sway-favicon-loader-mark,.sway-favicon-loader-dot{display:none!important}"));
assert.ok(adminDashboard.includes("admin-workspace.css?v=20261128-project-readiness-2"));

console.log("Homepage splash removal and retained admin/client loader checks passed.");
