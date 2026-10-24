"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const root = path.join(__dirname, "..");
const dashboardHtml = fs.readFileSync(path.join(root, "admin-dashboard", "index.html"), "utf8");
const workspaceSource = fs.readFileSync(path.join(root, "admin-dashboard", "admin-workspace.js"), "utf8");
const helperIndex = dashboardHtml.indexOf('src="lead-whatsapp.js');
const workspaceIndex = dashboardHtml.indexOf('src="admin-workspace.js');
assert.ok(helperIndex >= 0 && workspaceIndex > helperIndex, "WhatsApp helper must load before workspace");
assert.ok(workspaceSource.includes("window.swayphicsLeadWhatsApp.buildUrl(item.phone)"), "lead action must use the stored lead phone");
assert.match(workspaceSource, /sway-lead-whatsapp-link[\\s\\S]*?target="_blank"[\\s\\S]*?rel="noopener noreferrer"/, "chat link must open safely in a new tab");
assert.match(workspaceSource, /WhatsApp unavailable · check number/, "invalid or missing phone must not create a guessed destination");
global.window = {};
require(path.join(__dirname, "..", "admin-dashboard", "lead-whatsapp.js"));
const links = global.window.swayphicsLeadWhatsApp;
assert.equal(links.normalizePhone("+234 810 690 9230"), "2348106909230");
assert.equal(links.normalizePhone("+ 1 918-940-0592"), "19189400592");
assert.equal(links.normalizePhone("07405 673838"), "447405673838");
assert.equal(links.normalizePhone("081 237 0381"), "27812370381");
assert.equal(links.normalizePhone("00 44 7405 673838"), "447405673838");
assert.equal(links.normalizePhone("27692087424"), "27692087424");
assert.equal(links.normalizePhone("+27 (81) 234-5678 ext 9"), "27812345678");
for (const phone of ["", null, "N/A", "1234567", "918-940-0592", "Call +27 82 123 4567"]) {
  assert.equal(links.normalizePhone(phone), "");
  assert.equal(links.buildUrl(phone), "");
}
assert.equal(links.buildUrl("+234 810 690 9230"), "https://wa.me/2348106909230");
console.log("Lead WhatsApp contact tests passed.");
