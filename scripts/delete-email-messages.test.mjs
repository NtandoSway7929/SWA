import test from "node:test";
import assert from "node:assert/strict";

import { resolveInboxDeleteTargets } from "../supabase/functions/delete-email-messages/delete-helpers.mjs";

const row = (overrides = {}) => ({
  id: "9ac08ee2-2a4b-4c1a-8a43-13a7b7c08101",
  direction: "inbound",
  mailbox: "info@swayphics.co.za",
  imap_uid: 42,
  message_id: "<mail-42@example.test>",
  source_key: "imap:INBOX:42",
  ...overrides,
});

test("resolves selected inbound UIDs whose live Message-ID still matches", () => {
  assert.deepEqual(
    resolveInboxDeleteTargets(
      [row()],
      [{ uid: 42, envelope: { messageId: "<mail-42@example.test>" } }],
      "INBOX",
    ),
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
          message_id: null,
          source_key: "outbound:send-email:sample",
        }),
      ],
      [{ uid: 42, envelope: { messageId: "<mail-42@example.test>" } }],
      "INBOX",
    ),
    { uids: [42], messageIdLookups: [] },
  );
});

test("requests Message-ID reconciliation when the original UID is already absent", () => {
  assert.deepEqual(
    resolveInboxDeleteTargets([row()], [], "INBOX"),
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
      [{ uid: 42, envelope: { messageId: "<different-message@example.test>" } }],
      "INBOX",
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
      [{ uid: 42, envelope: { messageId: "" } }],
      "INBOX",
    ).messageIdLookups[0].messageId,
    "<mail-42@example.test>",
  );
});

test("rejects inbound mirror rows without a Message-ID", () => {
  assert.throws(
    () => resolveInboxDeleteTargets([row({ message_id: null })], [], "INBOX"),
    /no Message-ID/i,
  );
});

test("rejects a source key tied to a different IMAP folder", () => {
  assert.throws(
    () => resolveInboxDeleteTargets([row({ source_key: "imap:Archive:42" })], [], "INBOX"),
    /selected IMAP folder/i,
  );
});

test("rejects malformed record and message input", () => {
  assert.throws(() => resolveInboxDeleteTargets(null, [], "INBOX"), /must be arrays/i);
});
