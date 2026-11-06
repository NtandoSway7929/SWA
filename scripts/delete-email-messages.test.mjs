import test from "node:test";
import assert from "node:assert/strict";

import { resolveInboxDeleteTargets } from "../supabase/functions/delete-email-messages/delete-helpers.mjs";

const UID_VALIDITY = 1790292229;
const row = (overrides = {}) => ({
  id: "9ac08ee2-2a4b-4c1a-8a43-13a7b7c08101",
  direction: "inbound",
  mailbox: "info@swayphics.co.za",
  imap_uid: 42,
  imap_uid_validity: UID_VALIDITY,
  message_id: "<mail-42@example.test>",
  source_key: "imap:" + UID_VALIDITY + ":INBOX:42",
  ...overrides,
});

const liveMessage = (uid = 42, messageId = "<mail-42@example.test>") => ({
  uid,
  envelope: { messageId },
});

test("resolves selected inbound UIDs when UIDVALIDITY and Message-ID match", () => {
  assert.deepEqual(
    resolveInboxDeleteTargets([row()], [liveMessage()], "INBOX", UID_VALIDITY),
    { uids: [42], messageIdLookups: [] },
  );
});

test("deduplicates selected inbound UIDs and ignores outbound dashboard copies", () => {
  assert.deepEqual(
    resolveInboxDeleteTargets(
      [
        row(),
        row({ id: "ac5f5a54-28bf-4c44-94b2-39864b7ad6a1" }),
        row({
          id: "b4b2b18b-087b-4912-a55b-f5a89d17b84d",
          direction: "outbound",
          imap_uid: null,
          imap_uid_validity: null,
          message_id: null,
          source_key: "outbound:send-email:sample",
        }),
      ],
      [liveMessage()],
      "INBOX",
      UID_VALIDITY,
    ),
    { uids: [42], messageIdLookups: [] },
  );
});

test("requests Message-ID reconciliation when the original UID is absent", () => {
  assert.deepEqual(
    resolveInboxDeleteTargets([row()], [], "INBOX", UID_VALIDITY),
    {
      uids: [],
      messageIdLookups: [{
        recordId: "9ac08ee2-2a4b-4c1a-8a43-13a7b7c08101",
        originalUid: 42,
        messageId: "<mail-42@example.test>",
      }],
    },
  );
});

test("reconciles by Message-ID after UIDVALIDITY changes, even if the UID and ID appear to match", () => {
  assert.deepEqual(
    resolveInboxDeleteTargets(
      [row()],
      [liveMessage()],
      "INBOX",
      UID_VALIDITY + 1,
    ),
    {
      uids: [],
      messageIdLookups: [{
        recordId: "9ac08ee2-2a4b-4c1a-8a43-13a7b7c08101",
        originalUid: 42,
        messageId: "<mail-42@example.test>",
      }],
    },
  );
});

test("does not trust a reused UID that now identifies a different message", () => {
  assert.deepEqual(
    resolveInboxDeleteTargets(
      [row()],
      [liveMessage(42, "<different-message@example.test>")],
      "INBOX",
      UID_VALIDITY,
    ),
    {
      uids: [],
      messageIdLookups: [{
        recordId: "9ac08ee2-2a4b-4c1a-8a43-13a7b7c08101",
        originalUid: 42,
        messageId: "<mail-42@example.test>",
      }],
    },
  );
});

test("requests reconciliation when a live UID has no Message-ID", () => {
  assert.equal(
    resolveInboxDeleteTargets(
      [row()],
      [liveMessage(42, "")],
      "INBOX",
      UID_VALIDITY,
    ).messageIdLookups[0].messageId,
    "<mail-42@example.test>",
  );
});

test("supports legacy rows without UIDVALIDITY only through Message-ID reconciliation", () => {
  assert.deepEqual(
    resolveInboxDeleteTargets(
      [row({
        imap_uid_validity: null,
        source_key: "imap:INBOX:42",
      })],
      [liveMessage()],
      "INBOX",
      UID_VALIDITY,
    ),
    {
      uids: [],
      messageIdLookups: [{
        recordId: "9ac08ee2-2a4b-4c1a-8a43-13a7b7c08101",
        originalUid: 42,
        messageId: "<mail-42@example.test>",
      }],
    },
  );
});

test("rejects inbound mirror rows without a Message-ID", () => {
  assert.throws(
    () => resolveInboxDeleteTargets([row({ message_id: null })], [], "INBOX", UID_VALIDITY),
    /no Message-ID/i,
  );
});

test("rejects a source key tied to a different IMAP folder", () => {
  assert.throws(
    () => resolveInboxDeleteTargets(
      [row({ source_key: "imap:" + UID_VALIDITY + ":Archive:42" })],
      [],
      "INBOX",
      UID_VALIDITY,
    ),
    /selected IMAP folder/i,
  );
});

test("rejects malformed UIDVALIDITY values rather than trusting the UID", () => {
  assert.throws(
    () => resolveInboxDeleteTargets(
      [row({ imap_uid_validity: 0 })],
      [liveMessage()],
      "INBOX",
      UID_VALIDITY,
    ),
    /invalid mailbox UIDVALIDITY/i,
  );
});

test("requires the live mailbox UIDVALIDITY value", () => {
  assert.throws(
    () => resolveInboxDeleteTargets([row()], [liveMessage()], "INBOX", null),
    /valid UIDVALIDITY/i,
  );
});

test("rejects malformed record and message input", () => {
  assert.throws(
    () => resolveInboxDeleteTargets(null, [], "INBOX", UID_VALIDITY),
    /must be arrays/i,
  );
});
