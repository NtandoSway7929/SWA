const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const publicSite = read("index.html");
const adminStyles = read("admin-dashboard/admin-workspace.css");
const clientPortal = read("client-portal/index.html");

const cases = [
  {
    name: "public site button loader",
    source: publicSite,
    asset: /background:url\("FIST\.webp"\) center\/contain no-repeat/,
    animation: /@keyframes sway-fist-ink-draw-public/,
    reducedMotion: /prefers-reduced-motion:reduce[\s\S]*?clip-path:none;opacity:1/
  },
  {
    name: "admin workspace loader",
    source: adminStyles,
    asset: /background: url\("\.\.\/FIST\.webp"\) center \/ contain no-repeat/,
    animation: /@keyframes sway-fist-ink-draw/,
    reducedMotion: /prefers-reduced-motion: reduce[\s\S]*?clip-path: none;[\s\S]*?opacity: 1;/
  },
  {
    name: "client portal loader",
    source: clientPortal,
    asset: /\.sway-favicon-loader img\{[\s\S]*?animation:sway-fist-ink-draw/,
    animation: /@keyframes sway-fist-ink-draw\{/,
    reducedMotion: /prefers-reduced-motion:reduce[\s\S]*?clip-path:none;opacity:1/
  }
];

for (const item of cases) {
  assert.match(item.source, item.asset, `${item.name}: original favicon asset must be used`);
  assert.match(item.source, item.animation, `${item.name}: draw animation must exist`);
  assert.match(item.source, item.reducedMotion, `${item.name}: reduced-motion fallback must be static`);
}

const adminLoaderSection = adminStyles.slice(
  adminStyles.indexOf("/* SWAYPHICS FIST DRAW LOADER */"),
  adminStyles.indexOf("/* INSTANT WORKSPACE LOADING STATE */")
);
assert.doesNotMatch(adminLoaderSection, /sway-favicon-draw|sway-favicon-trace|sway-favicon-dot|rotate\(360deg\)/);
assert.match(clientPortal, /\.sway-favicon-loader-mark,\.sway-favicon-loader-dot\{display:none!important\}/);
assert.match(publicSite, /\.sway-loading-button::before\{[^}]*background:url\("FIST\.webp"\)/);

console.log("Swayphics loader source, draw animation and reduced-motion checks passed.");
