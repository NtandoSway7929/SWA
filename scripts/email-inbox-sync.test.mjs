import test from "node:test";
import assert from "node:assert/strict";

import {
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
