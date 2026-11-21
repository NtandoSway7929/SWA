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

assert.doesNotMatch(
  publicSite,
  /sway-intro|sway-public-loading-ui|sway-public-loading-observer|sway-loading-button|sway-fist-ink-draw-public/,
  "homepage must not retain a splash screen or animated public loading-logo treatment"
);
assert.match(publicSite, /class="hero-video"/, "normal homepage hero video must remain");

const cases = [
  {
    name: "admin workspace loader",
    source: adminLoader,
    asset: /background: url\\("\\.\\.\\/FIST\\.webp"\\) center \\/ contain no-repeat/,
    animation: /@keyframes sway-fist-ink-draw/,
    reducedMotion: /prefers-reduced-motion: reduce[\\s\\S]*?clip-path: none;[\\s\\S]*?opacity: 1;/
  },
  {
    name: "client portal loader",
    source: portalLoader,
    asset: /\\.sway-favicon-loader img\\{[\\s\\S]*?animation:sway-fist-ink-draw/,
    animation: /@keyframes sway-fist-ink-draw\\{/,
    reducedMotion: /prefers-reduced-motion:reduce[\\s\\S]*?clip-path:none;opacity:1/
  }
];

for (const item of cases) {
  assert.match(item.source, item.asset, item.name + ": original favicon asset must be used");
  assert.match(item.source, item.animation, item.name + ": draw animation must exist");
  assert.match(item.source, item.reducedMotion, item.name + ": reduced-motion fallback must be static");
}

for (const [name, source] of [["admin", adminLoader], ["portal", portalLoader]]) {
  assert.doesNotMatch(source, /sway-favicon-draw|sway-favicon-trace|sway-favicon-dot|sway-button-favicon-draw|rotate\\(360deg\\)/,
    name + ": old rotating-favicon animation must be removed");
}

assert.match(portalLoader, /\\.sway-favicon-loader-mark,\\.sway-favicon-loader-dot\\{display:none!important\\}/);
assert.ok(adminDashboard.includes("admin-workspace.css?v=20261119-fist-draw-loader-1"), "admin stylesheet cache key must change with the loader release");

console.log("Homepage splash removal and retained admin/client loader checks passed.");
