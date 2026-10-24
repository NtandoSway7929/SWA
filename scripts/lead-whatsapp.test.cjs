"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
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
