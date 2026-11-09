"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
    path.join(root, "supabase", "functions", "generate-invoice", "index.ts"),
    "utf8"
);

function extract(startMarker, endMarker, label) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.ok(start >= 0, label + " must exist");
    assert.ok(end > start, label + " must have a closing boundary");
    return source.slice(start, end);
}

const pdf = extract("async function buildPdf(", "\nfunction emailHtml(", "PDF invoice renderer");
const email = extract("function emailHtml(", "\nDeno.serve(", "invoice email renderer");

assert.equal((source.match(/async function buildPdf\(/g) || []).length, 1);
assert.equal((source.match(/function emailHtml\(/g) || []).length, 1);

for (const label of [
    "EMPOWERING THROUGH DESIGN",
    "INVOICE NUMBER",
    "ISSUE DATE",
    "PAYMENT DUE",
    "BILLED TO",
    "ISSUED BY",
    "SERVICE BREAKDOWN",
    "SERVICE / DESCRIPTION",
    "PROJECT NOTES",
    "PAYMENT INFORMATION",
    "TOTAL DUE",
    "TOTAL PAID"
]) {
    assert.ok(pdf.includes(label), "PDF must include the " + label + " hierarchy");
}

assert.ok(pdf.includes("startContinuation("), "PDF must paginate long invoices");
assert.ok(pdf.includes("pdfDoc.getPages()"), "PDF must add page numbering after pagination");
assert.ok(pdf.includes("wrapText("), "PDF must wrap long service descriptions and notes");
assert.ok(pdf.includes("invoice.amount_outstanding"), "PDF must use the outstanding balance when available");
assert.ok(pdf.includes("invoice.amount_paid"), "PDF must account for payments already received");
assert.ok(pdf.includes('invoice.status === "partially paid"'), "PDF must identify partially paid invoices");
assert.ok(pdf.includes('invoice.status === "overdue"'), "PDF must identify overdue balances");
assert.ok(pdf.includes("money(item.unit_price)"), "PDF must retain unit pricing");
assert.ok(pdf.includes("money(item.line_total)"), "PDF must retain line totals");

for (const label of [
    "EMPOWERING THROUGH DESIGN",
    "Your invoice is ready.",
    "SERVICE BREAKDOWN",
    "INVOICE NUMBER",
    "PAYMENT DUE",
    "PROJECT NOTES",
    "BANKING DETAILS"
]) {
    assert.ok(email.includes(label), "Invoice email must include " + label);
}

assert.ok(email.includes("escapeHtml(item.description)"), "Email must safely render service descriptions");
assert.ok(email.includes("escapeHtml(invoice.notes)"), "Email must safely render invoice notes");
assert.ok(email.includes("invoice.amount_outstanding"), "Email must display the outstanding balance");
assert.ok(email.includes("invoice.amount_paid"), "Email must reflect payments already received");
assert.ok(email.includes("attachments:" ) === false, "Attachment delivery remains in the send handler, not the HTML template");

assert.ok(source.includes('.from("invoice_items")'), "Invoice item lookup must remain intact");
assert.ok(source.includes("pdf_base64:"), "PDF response contract must remain intact");
assert.ok(source.includes("filename:"), "Invoice PDF filename contract must remain intact");
assert.ok(source.includes("attachments: ["), "Invoice email must continue attaching the PDF");

console.log("Premium invoice PDF and email design contracts passed.");
