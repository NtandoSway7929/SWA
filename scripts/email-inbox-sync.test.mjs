import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const syncFunctionSource = readFileSync(
  new URL("../supabase/functions/sync-email-inbox/index.ts", import.meta.url),
  "utf8",
);

import {
  getSyncStartUid,
  resolveMatchingThreadMessage,
  selectUidBatch,
} from "../supabase/functions/sync-email-inbox/inbox-helpers.mjs";

test("selectUidBatch sorts, deduplicates, and rejects invalid UIDs", () => {
  assert.deepEqual(
    selectUidBatch([4, "1", 2, 0, -8, "bad", 2, 3.25, null], 3),
    [1, 2, 4],
  );
});

test("selectUidBatch caps work per sync and returns an ascending sequence", () => {
  assert.deepEqual(
    selectUidBatch([14, 12, 13, 11, 10], 2),
    [10, 11],
  );
});

test("selectUidBatch safely handles missing or non-array search results", () => {
  assert.deepEqual(selectUidBatch(null, 10), []);
  assert.deepEqual(selectUidBatch("1:10", 10), []);
  assert.deepEqual(selectUidBatch([], 10), []);
});

test("resolveMatchingThreadMessage respects In-Reply-To candidate priority", () => {
  const inReplyTo = "<original-message@example.test>";
  const reference = "<earlier-message@example.test>";
  const rows = [
    {
      message_id: reference,
      thread_id: "thread-old",
      client_id: null,
      lead_id: "lead-old",
    },
    {
      message_id: inReplyTo,
      thread_id: "thread-current",
      client_id: null,
      lead_id: "lead-current",
    },
  ];

  assert.deepEqual(
    resolveMatchingThreadMessage([inReplyTo, reference], rows),
    rows[1],
  );
});

test("resolveMatchingThreadMessage returns null for unrelated messages", () => {
  assert.equal(
    resolveMatchingThreadMessage(
      ["<unknown@example.test>"],
      [{ message_id: "<other@example.test>", thread_id: "other-thread" }],
    ),
    null,
  );
});

test("resolveMatchingThreadMessage can preserve an unlinked thread without inventing a contact", () => {
  const match = resolveMatchingThreadMessage(
    ["<in-reply-to@example.test>"],
    [{
      message_id: "<in-reply-to@example.test>",
      thread_id: "thread-1",
      client_id: null,
      lead_id: null,
    }],
  );

  assert.equal(match.thread_id, "thread-1");
  assert.equal(match.client_id, null);
  assert.equal(match.lead_id, null);
});

test("getSyncStartUid starts with a bounded recent window for an empty cursor", () => {
  assert.equal(getSyncStartUid(0, 100, 25), 76);
});

test("getSyncStartUid resumes immediately after the cursor", () => {
  assert.equal(getSyncStartUid(75, 100, 25), 76);
});

test("getSyncStartUid recovers when mailbox UIDs reset below the stored cursor", () => {
  assert.equal(getSyncStartUid(900, 12, 10), 3);
});

test("getSyncStartUid handles an empty mailbox and invalid limits safely", () => {
  assert.equal(getSyncStartUid(0, 0, 10), 1);
  assert.equal(getSyncStartUid(0, 10, 0), 1);
});



test("IMAP sync uses bounded role-specific socket timeouts", () => {
  assert.ok(syncFunctionSource.includes("connectionTimeout: IMAP_CONNECTION_TIMEOUT_MS"));
  assert.ok(syncFunctionSource.includes("greetingTimeout: IMAP_GREETING_TIMEOUT_MS"));
  assert.ok(syncFunctionSource.includes("socketTimeout: isAuthenticatedUser"));
  assert.ok(syncFunctionSource.includes("const IMAP_CONNECTION_TIMEOUT_MS = 8000;"));
  assert.ok(syncFunctionSource.includes("const IMAP_GREETING_TIMEOUT_MS = 8000;"));
  assert.ok(syncFunctionSource.includes("const IMAP_SCHEDULED_SOCKET_TIMEOUT_MS = 12000;"));
  assert.ok(syncFunctionSource.includes("const IMAP_MEDIA_SOCKET_TIMEOUT_MS = 30000;"));
  assert.ok(syncFunctionSource.includes("const EXISTING_MEDIA_BACKFILL_BATCH = 1;"));
  assert.ok(syncFunctionSource.includes('client.on("error"'));
});

test("existing inbound media backfill leaves incomplete body downloads retryable", () => {
  const backfillStart = syncFunctionSource.indexOf("const refreshedBody = await fetchMessageBody(");
  const bodyGuard = syncFunctionSource.indexOf("if (!refreshedBody.bodyDownloadSucceeded)", backfillStart);
  const attachmentDownload = syncFunctionSource.indexOf("const refreshedAttachments = await storeEmailAttachments(", backfillStart);
  const completionUpdate = syncFunctionSource.indexOf("media_processed_at: new Date().toISOString()", backfillStart);

  assert.notEqual(backfillStart, -1);
  assert.notEqual(bodyGuard, -1);
  assert.notEqual(attachmentDownload, -1);
  assert.notEqual(completionUpdate, -1);
  assert.ok(backfillStart < bodyGuard);
  assert.ok(bodyGuard < attachmentDownload);
  assert.ok(attachmentDownload < completionUpdate);
});

test("new inbound email is persisted before MIME body or attachment downloads", () => {
  const newMessageFlow = syncFunctionSource.slice(
    syncFunctionSource.indexOf("const emailRecordId ="),
  );
  const insertIndex = newMessageFlow.indexOf('.from("email_messages")');
  const insertCallIndex = newMessageFlow.indexOf(".insert({", insertIndex);
  const bodyDownloadIndex = newMessageFlow.indexOf("const body = await fetchMessageBody(");
  const attachmentDownloadIndex = newMessageFlow.indexOf("const attachmentMetadata = await storeEmailAttachments(");

  assert.notEqual(insertIndex, -1);
  assert.notEqual(insertCallIndex, -1);
  assert.notEqual(bodyDownloadIndex, -1);
  assert.notEqual(attachmentDownloadIndex, -1);
  assert.ok(insertCallIndex < bodyDownloadIndex);
  assert.ok(bodyDownloadIndex < attachmentDownloadIndex);

  const insertPayload = newMessageFlow.slice(insertCallIndex, bodyDownloadIndex);
  assert.ok(insertPayload.includes("text_body:"));
  assert.ok(insertPayload.includes("html_body: null"));
  assert.ok(insertPayload.includes("attachments: []"));
  assert.ok(insertPayload.includes("media_processed_at: null"));
});

test("scheduled ingestion does not block inbox persistence on optional media downloads", () => {
  const newMessageFlow = syncFunctionSource.slice(
    syncFunctionSource.indexOf("const emailRecordId ="),
  );
  const mediaGateIndex = newMessageFlow.indexOf("if (isAuthenticatedUser)");
  const attachmentDownloadIndex = newMessageFlow.indexOf("const attachmentMetadata = await storeEmailAttachments(");
  const communicationLogIndex = newMessageFlow.indexOf("communication_logs");

  assert.notEqual(mediaGateIndex, -1);
  assert.notEqual(attachmentDownloadIndex, -1);
  assert.notEqual(communicationLogIndex, -1);
  assert.ok(mediaGateIndex < attachmentDownloadIndex);
  assert.ok(attachmentDownloadIndex < communicationLogIndex);
});

test("failed MIME body downloads remain pending for a later retry", () => {
  assert.ok(
    syncFunctionSource.includes("bodyDownloadSucceeded: plainTextDownloaded && htmlDownloaded"),
  );
  assert.equal(syncFunctionSource.split(".bodyDownloadSucceeded").length - 1, 3);
  assert.ok(syncFunctionSource.includes('.is("media_processed_at", null)'));
});
