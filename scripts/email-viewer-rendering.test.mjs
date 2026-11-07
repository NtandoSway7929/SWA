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
  assert.ok(dashboardHtml.includes("admin-workspace.js?v=20261107-email-inbox-search-1"));
  assert.ok(dashboardHtml.includes("admin-workspace.css?v=20261107-email-inbox-search-1"));
});


test("Inbox search filters sender, subject, recipient and message content without changing email records", () => {
  assert.ok(workspaceJs.includes("function emailInboxVisibleThreads(threads)"));
  assert.ok(workspaceJs.includes("emailThreadSubject(thread)"));
  assert.ok(workspaceJs.includes("emailThreadSender(thread)"));
  assert.ok(workspaceJs.includes("emailMessageText(message)"));
  assert.ok(workspaceJs.includes('data-email-inbox-search'));
  assert.ok(workspaceJs.includes('data-email-inbox-filter'));
  assert.ok(workspaceJs.includes('value="unread"'));
  assert.ok(workspaceJs.includes('value="read"'));
  assert.ok(workspaceJs.includes("state.emailInboxSearch = input.value"));
  assert.ok(workspaceJs.includes("state.emailInboxFilter = select.value || \"all\""));
  assert.ok(workspaceJs.includes("emailInboxVisibleThreads(emailThreadGroups())"));
  assert.ok(workspaceCss.includes(".sway-email-inbox-filters"));
  assert.ok(workspaceCss.includes(".sway-email-inbox-filter-empty"));
  assert.ok(dashboardHtml.includes("admin-workspace.js?v=20261107-email-inbox-search-1"));
  assert.ok(dashboardHtml.includes("admin-workspace.css?v=20261107-email-inbox-search-1"));
});
