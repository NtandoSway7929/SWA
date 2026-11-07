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


test("IMAP sync uses bounded connection and socket timeouts", () => {
  assert.match(syncFunctionSource, /connectionTimeout:\\s*IMAP_CONNECTION_TIMEOUT_MS/);
  assert.match(syncFunctionSource, /greetingTimeout:\\s*IMAP_GREETING_TIMEOUT_MS/);
  assert.match(syncFunctionSource, /socketTimeout:\\s*IMAP_SOCKET_TIMEOUT_MS/);
  assert.match(syncFunctionSource, /const IMAP_CONNECTION_TIMEOUT_MS = 8000;/);
  assert.match(syncFunctionSource, /const IMAP_GREETING_TIMEOUT_MS = 8000;/);
  assert.match(syncFunctionSource, /const IMAP_SOCKET_TIMEOUT_MS = 12000;/);
  assert.match(syncFunctionSource, /client\\.on\\(["']error["']/);
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
  assert.match(insertPayload, /text_body:\\s*textBody/);
  assert.match(insertPayload, /html_body:\\s*null/);
  assert.match(insertPayload, /attachments:\\s*\\[\\]/);
  assert.match(insertPayload, /media_processed_at:\\s*null/);
});

test("scheduled ingestion does not block inbox persistence on optional media downloads", () => {
  const newMessageFlow = syncFunctionSource.slice(
    syncFunctionSource.indexOf("const emailRecordId ="),
  );
  const mediaGateIndex = newMessageFlow.indexOf("if (isAuthenticatedUser)");
  const attachmentDownloadIndex = newMessageFlow.indexOf("const attachmentMetadata = await storeEmailAttachments(");
  const communicationLogIndex = newMessageFlow.indexOf('.from("communication_logs")');

  assert.notEqual(mediaGateIndex, -1);
  assert.notEqual(attachmentDownloadIndex, -1);
  assert.notEqual(communicationLogIndex, -1);
  assert.ok(mediaGateIndex < attachmentDownloadIndex);
  assert.ok(attachmentDownloadIndex < communicationLogIndex);
});

test("failed MIME body downloads remain pending for a later retry", () => {
  assert.match(
    syncFunctionSource,
    /bodyDownloadSucceeded:\\s*plainTextDownloaded && htmlDownloaded/,
  );
  assert.ok(
    (syncFunctionSource.match(/bodyDownloadSucceeded\\s*\\?/g) || []).length >= 2,
  );
  assert.match(
    syncFunctionSource,
    /\\.is\\("media_processed_at", null\\)/,
  );
});
