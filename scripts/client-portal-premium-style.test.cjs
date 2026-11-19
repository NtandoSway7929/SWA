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


const refinementStart = styles.indexOf("/* Editorial premium refinement:");
assert.ok(refinementStart > 0, "The editorial premium refinement layer must exist.");
const refinement = styles.slice(refinementStart);
assert.match(refinement, /background:#F5F6F7;[\s\S]*?background-image:none/);
assert.match(refinement, /font-family:'Plus Jakarta Sans',sans-serif/);
assert.doesNotMatch(refinement, /(?:Mon|Ral)\w{4,}/);
assert.ok(portal.includes("family=Plus+Jakarta+Sans"), "The portal must keep its original Plus Jakarta Sans web font.");
assert.ok(!portal.includes("family=Montserrat") && !portal.includes("family=Raleway"), "The portal must not load a replacement font.");
assert.match(refinement, /\.portal-nav\{[\s\S]*?background:#FFFFFF[\s\S]*?backdrop-filter:none/);
assert.match(refinement, /\.stat-card::after\{display:none\}/);
assert.match(refinement, /\.portal-card\{[\s\S]*?background:#FFFFFF[\s\S]*?backdrop-filter:none/);
assert.match(refinement, /\.portal-button\{[\s\S]*?border-radius:10px[\s\S]*?background:var\(--deep\)/);
assert.match(refinement, /\.portal-section-nav a\.active\{[\s\S]*?background:#F0F4FA[\s\S]*?box-shadow:none/);
assert.match(refinement, /@media\(max-width:760px\)/);
assert.match(refinement, /@media\(prefers-reduced-motion:reduce\)/);
assert.ok(portal.includes("function bindOnboarding()"), "The existing onboarding controller must remain present.");
assert.ok(portal.includes("async function loadPortalDocuments()"), "The existing document retrieval flow must remain present.");
assert.ok(portal.includes("function startOnlineCheckout("), "The existing invoice checkout flow must remain present.");
assert.ok(portal.includes('id="request-form"'), "The client request form must remain present.");
assert.ok(portal.includes("function portalRpcWithRetry("), "The existing portal access retry handling must remain present.");
assert.ok(portal.includes("function openProjectModal("), "The existing project detail flow must remain present.");

console.log("Client portal editorial premium styling and workflow-preservation contract tests passed.");
