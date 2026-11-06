import test from "node:test";
import assert from "node:assert/strict";

import { resolveInboxDeleteUids } from "../supabase/functions/delete-email-messages/delete-helpers.mjs";

const row = (overrides = {}) => ({
  id: "9ac08ee2-2a4b-4c1a-8a43-13a7b7c08101",
  direction: "inbound",
  mailbox: "info@swayphics.co.za",
  imap_uid: 42,
  message_id: "<mail-42@example.test>",
  source_key: "imap:INBOX:42",
  ...overrides,
});

test("resolves only selected inbound UIDs whose live Message-ID still matches", () => {
  assert.deepEqual(
    resolveInboxDeleteUids(
      [row()],
      [{ uid: 42, envelope: { messageId: "<mail-42@example.test>" } }],
      "INBOX",
    ),
    [42],
  );
});

test("deduplicates selected inbound UIDs and ignores outbound dashboard copies", () => {
  assert.deepEqual(
    resolveInboxDeleteUids(
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
    [42],
  );
});

test("allows cleanup of a mirror when the original IMAP UID is already absent", () => {
  assert.deepEqual(resolveInboxDeleteUids([row()], [], "INBOX"), []);
});

test("rejects a UID that now identifies a different mailbox message", () => {
  assert.throws(
    () => resolveInboxDeleteUids(
      [row()],
      [{ uid: 42, envelope: { messageId: "<different-message@example.test>" } }],
      "INBOX",
    ),
    /identity .*changed/i,
  );
});

test("rejects inbound mirror rows without a Message-ID", () => {
  assert.throws(
    () => resolveInboxDeleteUids([row({ message_id: null })], [], "INBOX"),
    /no Message-ID/i,
  );
});

test("rejects a source key tied to a different IMAP folder", () => {
  assert.throws(
    () => resolveInboxDeleteUids([row({ source_key: "imap:Archive:42" })], [], "INBOX"),
    /selected IMAP folder/i,
  );
});

test("rejects malformed record and message input", () => {
  assert.throws(() => resolveInboxDeleteUids(null, [], "INBOX"), /must be arrays/i);
});
