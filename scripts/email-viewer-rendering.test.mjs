import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspaceJs = readFileSync(
  new URL("../admin-dashboard/admin-workspace.js", import.meta.url),
  "utf8",
);
const workspaceCss = readFileSync(
  new URL("../admin-dashboard/admin-workspace.css", import.meta.url),
  "utf8",
);
const dashboardHtml = readFileSync(
  new URL("../admin-dashboard/index.html", import.meta.url),
  "utf8",
);

test("inline email images are constrained without stretching", () => {
  assert.ok(workspaceJs.includes(
    "img{display:block;max-width:100%!important;max-height:340px!important;width:auto!important;height:auto!important;object-fit:contain!important;"
  ));
});

test("private email attachments download in the dashboard without signed-URL navigation", () => {
  assert.ok(workspaceJs.includes('data-email-attachment-download="'));
  assert.ok(workspaceJs.includes("function emailAttachmentObjectUrl(storagePath)"));
  assert.ok(workspaceJs.includes("/storage/v1/object/swayphics-email-attachments/"));
  assert.ok(workspaceJs.includes("await response.blob()"));
  assert.ok(workspaceJs.includes("URL.createObjectURL(blob)"));
  assert.ok(workspaceJs.includes("downloadLink.download = safeFilename"));
  assert.ok(!workspaceJs.includes("cached.downloadUrl"));
  assert.ok(workspaceCss.includes("button.sway-email-attachment-file"));
});

test("signed URLs are requested only for image previews", () => {
  assert.ok(workspaceJs.includes(
    'if (!path || attachment.status !== "stored" || !isImage || seen.has(path)) return;'
  ));
  assert.ok(workspaceJs.includes("const url = await signedEmailAttachmentUrl(entry.path);"));
});

test("background inbox polling does not reload an unchanged selected email", () => {
  assert.ok(workspaceJs.includes("const selectedThreadContentSignature = function (threadId)"));
  assert.ok(workspaceJs.includes("const selectedThreadBefore = selectedThreadIdBefore"));
  assert.ok(workspaceJs.includes(
    "if (selectedThreadBefore !== selectedThreadContentSignature(selectedThreadIdBefore)) {"
  ));
});

test("the updated email viewer assets are cache-busted", () => {
  assert.ok(dashboardHtml.includes("admin-workspace.js?v=20261107-email-read-state-actions-1"));
  assert.ok(dashboardHtml.includes("admin-workspace.css?v=20261107-admin-table-filter-reset-email-read-state-actions-1"));
});

test("Inbox conversations can be marked read or unread from the list without opening them", () => {
  assert.ok(workspaceJs.includes("async function setEmailThreadReadState(threadId, isRead)"));
  assert.ok(workspaceJs.includes('data-email-thread-read-toggle="'));
  assert.ok(workspaceJs.includes('data-email-read-value="'));
  assert.ok(workspaceJs.includes('querySelectorAll("[data-email-thread-read-toggle]")'));
  assert.ok(workspaceJs.includes("is_read: isRead"));
  assert.ok(workspaceJs.includes("await setEmailThreadReadState(threadId, true)"));
  assert.ok(workspaceJs.includes("const nextToggle = Array.from("));
  assert.ok(workspaceJs.includes("if (fallback && typeof fallback.focus === \"function\")"));
  assert.ok(workspaceCss.includes(".sway-email-inbox-read-toggle"));
  assert.ok(workspaceCss.includes("body.sway-dark-mode #sway-admin-workspace .sway-email-inbox-read-toggle"));
  assert.ok(dashboardHtml.includes("admin-workspace.js?v=20261107-email-read-state-actions-1"));
  assert.ok(dashboardHtml.includes("admin-workspace.css?v=20261107-admin-table-filter-reset-email-read-state-actions-1"));
});
