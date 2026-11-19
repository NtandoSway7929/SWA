"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const portal = fs.readFileSync(path.join(root, "client-portal", "index.html"), "utf8");
const styleEnd = portal.indexOf("</style>");
assert.ok(styleEnd > 0, "Client portal stylesheet must exist.");
const styles = portal.slice(0, styleEnd);

assert.ok(styles.includes("--charcoal:#343A40"), "The portal must define its charcoal brand-neutral colour.");
assert.ok(styles.includes("--charcoal-deep:#252B31"), "The portal must define a deeper charcoal for headings and emphasis.");
assert.ok(styles.includes("rgba(248,249,250,.965)"), "The wallpaper must sit behind a near-opaque neutral overlay.");
assert.ok(styles.includes("background:rgba(250,251,252,.97)"), "The navigation surface must be substantially more opaque.");
assert.match(styles, /\.stat-card,\.portal-card\{[\s\S]*?rgba\(255,255,255,\.99\)/, "Dashboard cards must use nearly opaque surfaces.");
assert.match(styles, /\.project-item,\.financial-item\{[\s\S]*?background:#F6F7F8/, "Nested project and financial cards must use solid neutral surfaces.");
assert.match(styles, /\.onboarding-section\{[\s\S]*?background:rgba\(249,250,251,\.98\)/, "Onboarding sections must no longer look overly transparent.");
assert.match(styles, /\.onboarding-number\{[\s\S]*?linear-gradient\(145deg,#414A53,#293139\)[\s\S]*?color:#fff/, "Onboarding step markers must use the charcoal treatment with readable contrast.");
assert.match(styles, /\.modal-card\{[\s\S]*?background:linear-gradient\(145deg,#FFFFFF,#F5F7F8\)/, "Project detail modals must use the same opaque premium surface.");
assert.match(styles, /\.onboarding-form \.field input[\s\S]*?background:#fff/, "Form controls must remain clear and readable against the neutral surfaces.");
assert.ok(styles.includes("color:var(--blue)") && styles.includes("linear-gradient(135deg,var(--deep),var(--blue))"), "Swayphics blue must remain the accent and primary action colour.");
assert.ok(portal.includes("id=\"onboarding-form\""), "The existing onboarding form must remain present.");
assert.ok(portal.includes("id=\"request-form\""), "The existing client request form must remain present.");

console.log("Client portal premium charcoal styling contract tests passed.");
