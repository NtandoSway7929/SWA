"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const portal = fs.readFileSync(path.join(root, "client-portal", "index.html"), "utf8");
const edge = fs.readFileSync(path.join(root, "supabase", "functions", "client-portal-documents", "index.ts"), "utf8");
const uploadEdge = fs.readFileSync(path.join(root, "supabase", "functions", "upload-client-onboarding-assets", "index.ts"), "utf8");
const config = fs.readFileSync(path.join(root, "supabase", "config.toml"), "utf8");
const workspace = fs.readFileSync(path.join(root, "admin-dashboard", "admin-workspace.js"), "utf8");

const edgeHelperStart = edge.indexOf("function isClientOwnedStoragePath(");
const edgeHelperEnd = edge.indexOf("\nfunction safeDownloadName(", edgeHelperStart);
assert.ok(edgeHelperStart >= 0 && edgeHelperEnd > edgeHelperStart, "Document ownership helpers must exist.");
const edgeContext = {};
const edgeHelperSource = edge.slice(edgeHelperStart, edgeHelperEnd)
  .replace(/: unknown/g, "")
  .replace(/: string/g, "");
vm.runInNewContext(
  edgeHelperSource +
    "\nthis.isClientOwnedStoragePath=isClientOwnedStoragePath;" +
    "\nthis.isInvoiceAvailableToClient=isInvoiceAvailableToClient;" +
    "\nthis.documentCategory=documentCategory;",
  edgeContext
);

const portalHelperStart = portal.indexOf("function portalDocumentCategory(");
const portalHelperEnd = portal.indexOf("\nfunction onboardingValue(", portalHelperStart);
assert.ok(portalHelperStart >= 0 && portalHelperEnd > portalHelperStart, "Portal document rendering helpers must exist.");
const portalContext = {
  esc: value => String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;"),
  date: value => value ? String(value).slice(0, 10) : "—"
};
vm.runInNewContext(
  portal.slice(portalHelperStart, portalHelperEnd) +
    "\nthis.portalDocumentCategory=portalDocumentCategory;" +
    "\nthis.formatPortalFileSize=formatPortalFileSize;" +
    "\nthis.filterPortalDocuments=filterPortalDocuments;" +
    "\nthis.renderPortalDocumentList=renderPortalDocumentList;",
  portalContext
);

test("stored file paths must be confined to the exact client folder from the verified portal token", () => {
  const clientId = "11111111-1111-4111-8111-111111111111";
  const otherClientId = "22222222-2222-4222-8222-222222222222";
  assert.equal(edgeContext.isClientOwnedStoragePath(clientId + "/design-final.pdf", clientId), true);
  assert.equal(edgeContext.isClientOwnedStoragePath(otherClientId + "/design-final.pdf", clientId), false);
  assert.equal(edgeContext.isClientOwnedStoragePath(clientId + "/../other/design.pdf", clientId), false);
  assert.equal(edgeContext.isClientOwnedStoragePath(clientId + "/folder/design.pdf", clientId), false);
  assert.equal(edgeContext.isClientOwnedStoragePath("/" + clientId + "/design.pdf", clientId), false);
  assert.equal(edgeContext.isClientOwnedStoragePath(clientId + "/design\\\\final.pdf", clientId), false);
  assert.equal(edgeContext.isClientOwnedStoragePath(clientId + "/design.pdf/", clientId), false);
});

test("only issued invoices can be downloaded by a client", () => {
  for (const status of ["sent", "partially paid", "paid", "overdue"]) {
    assert.equal(edgeContext.isInvoiceAvailableToClient(status), true, status + " invoices should be available.");
  }
  for (const status of ["draft", "cancelled", "unknown", null, ""]) {
    assert.equal(edgeContext.isInvoiceAvailableToClient(status), false, String(status) + " invoices must not be available.");
  }
});

test("file categories distinguish PDF, image and ordinary documents", () => {
  assert.equal(edgeContext.documentCategory("application/pdf", "invoice.pdf"), "pdf");
  assert.equal(edgeContext.documentCategory("image/webp", "approved-design.webp"), "image");
  assert.equal(edgeContext.documentCategory("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "brief.docx"), "other");
  assert.equal(portalContext.portalDocumentCategory(null, "preview.pdf"), "pdf");
  assert.equal(portalContext.portalDocumentCategory("image/png", "asset.png"), "image");
});

test("document filters display all, project-linked, PDF and image files without mutating source data", () => {
  const rows = [
    { id: "one", file_name: "design.pdf", mime_type: "application/pdf", project_name: "Website" },
    { id: "two", file_name: "logo.webp", mime_type: "image/webp", project_name: "Brand identity" },
    { id: "three", file_name: "brief.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", project_name: "General files" }
  ];
  const ids = filter => JSON.parse(JSON.stringify(portalContext.filterPortalDocuments(rows, filter).map(item => item.id)));
  assert.deepEqual(ids("all"), ["one", "two", "three"]);
  assert.deepEqual(ids("project"), ["one", "two"]);
  assert.deepEqual(ids("pdf"), ["one"]);
  assert.deepEqual(ids("images"), ["two"]);
  assert.equal(rows.length, 3);
});

test("document formatting handles byte sizes and escapes uploaded filenames in rendered cards", () => {
  assert.equal(portalContext.formatPortalFileSize(512), "512 B");
  assert.match(portalContext.formatPortalFileSize(2048), /KB/);
  assert.match(portalContext.formatPortalFileSize(2 * 1024 * 1024), /MB/);
  const markup = portalContext.renderPortalDocumentList([{
    id: "file-1",
    file_name: "<script>alert(1)</script>.pdf",
    mime_type: "application/pdf",
    size_bytes: 4096,
    created_at: "2026-11-08T10:00:00Z",
    project_name: "Website"
  }], "all");
  assert.doesNotMatch(markup, /<script>alert/);
  assert.match(markup, /&lt;script&gt;/);
  assert.match(markup, /data-document-action="preview"/);
  assert.match(markup, /data-document-action="download"/);
});

test("the document Edge Function verifies the private portal token before every action", () => {
  assert.match(edge, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(edge, /from\("client_portal_tokens"\)/);
  assert.match(edge, /\.eq\("token_hash", tokenHash\)/);
  assert.match(edge, /data\.active !== true/);
  assert.match(edge, /data\.expires_at/);
  assert.match(edge, /if \(!portalToken\)/);
  assert.match(edge, /SIGNED_URL_TTL_SECONDS = 300/);
});

test("document metadata and signed URL creation are scoped to the verified client and exact file record", () => {
  assert.match(edge, /from\("client_documents"\)[\s\S]*?\.eq\("client_id", clientId\)/);
  assert.match(edge, /\.eq\("id", documentId\)[\s\S]*?\.eq\("client_id", clientId\)/);
  assert.match(edge, /isClientOwnedStoragePath\(row\.storage_path, clientId\)/);
  assert.match(edge, /createSignedUrl\(row\.storage_path, SIGNED_URL_TTL_SECONDS/);
  assert.doesNotMatch(edge, /body\?\.storage_path/);
  assert.doesNotMatch(portal, /storage_path/);
  assert.doesNotMatch(portal, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("client invoice PDFs are scoped to the same client and exclude drafts and cancelled invoices", () => {
  assert.match(edge, /from\("invoices"\)[\s\S]*?\.eq\("id", invoiceId\)[\s\S]*?\.eq\("client_id", clientId\)/);
  assert.match(edge, /isInvoiceAvailableToClient\(invoice\.status\)/);
  assert.match(edge, /from\("invoice_items"\)/);
  assert.match(edge, /from\("invoice_settings"\)/);
  assert.match(edge, /"Content-Type": "application\/pdf"/);
  assert.match(portal, /Download invoice PDF/);
  assert.match(portal, /action:"invoice-pdf"/);
});

test("the browser validates signed URL origin and bucket path before preview or download", () => {
  assert.match(portal, /function validatedPortalSignedUrl/);
  assert.match(portal, /parsed\.origin!==base\.origin/);
  assert.match(portal, /storage\/v1\/object\/sign\/swayphics-client-files/);
  assert.match(portal, /referrerpolicy="no-referrer"/);
});

test("the client portal exposes a Documents section and the admin workspace retains the existing uploader", () => {
  assert.match(portal, /href="#documents-section"/);
  assert.match(portal, /id="documents-section"/);
  assert.match(portal, /data-document-filter="project"/);
  assert.match(portal, /data-document-filter="pdf"/);
  assert.match(portal, /data-document-filter="images"/);
  assert.match(workspace, /async function uploadClientDocument/);
  assert.match(workspace, /rest\/v1\/client_documents/);
});

test("the Edge Function is configured for application-level portal-token authentication", () => {
  assert.match(config, /\[functions\.client-portal-documents\]\s*verify_jwt = false/);
  assert.match(edge, /ALLOWED_ORIGIN = "https:\/\/swayphics\.co\.za"/);
});


test("business asset uploads use the same database-side portal token validation as portal access", () => {
  assert.match(uploadEdge, /admin\.rpc\("get_client_portal",\s*\{\s*p_token:\s*token\s*\}\)/);
  assert.match(uploadEdge, /data\?\.ok === true \? data\.client\?\.id : null/);
  assert.match(uploadEdge, /if \(error \|\| !clientId\) return null/);
  assert.match(uploadEdge, /auth\.clientId/);
  assert.doesNotMatch(uploadEdge, /crypto\.subtle\.digest/);
  assert.doesNotMatch(uploadEdge, /auth\.token\.client_id/);
});
