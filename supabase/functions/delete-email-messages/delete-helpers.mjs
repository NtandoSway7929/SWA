/**
 * Resolve selected inbound rows to live mailbox UIDs without trusting a
 * potentially stale UID on its own.
 *
 * IMAP UIDs are only unique within a mailbox UIDVALIDITY generation. If a
 * mailbox is rebuilt/reset, an old UID can be reused by a different message.
 * The caller must then re-resolve the selected message by its exact
 * Message-ID before deleting anything from the live mailbox.
 */
export function resolveInboxDeleteTargets(records, currentMessages, folder = "INBOX") {
  if (!Array.isArray(records) || !Array.isArray(currentMessages)) {
    throw new TypeError("Inbox message records and live IMAP messages must be arrays.");
  }

  const mailboxFolder = String(folder || "INBOX");
  const liveByUid = new Map();
  for (const message of currentMessages) {
    const uid = Number(message?.uid);
    if (Number.isSafeInteger(uid) && uid > 0) {
      liveByUid.set(uid, message);
    }
  }

  const uids = new Set();
  const messageIdLookups = [];
  for (const record of records) {
    if (!record || record.direction === "outbound") continue;
    if (record.direction !== "inbound") {
      throw new Error("An inbox record has an unsupported direction.");
    }

    const uid = Number(record.imap_uid);
    if (!Number.isSafeInteger(uid) || uid <= 0) {
      throw new Error("An incoming message is missing its mailbox UID.");
    }

    const expectedSourceKey = "imap:" + mailboxFolder + ":" + String(uid);
    if (String(record.source_key || "") !== expectedSourceKey) {
      throw new Error("An incoming message does not belong to the selected IMAP folder.");
    }

    const expectedMessageId = String(record.message_id || "").trim();
    if (!expectedMessageId) {
      throw new Error("An incoming message has no Message-ID and cannot be safely matched to the mailbox.");
    }

    const liveMessage = liveByUid.get(uid);
    const liveMessageId = String(liveMessage?.envelope?.messageId || "").trim();
    if (!liveMessage || !liveMessageId || liveMessageId !== expectedMessageId) {
      // Never delete a live message merely because it now occupies an old UID.
      // The caller must search by Message-ID and verify the exact envelope ID.
      messageIdLookups.push({
        recordId: String(record.id || ""),
        originalUid: uid,
        messageId: expectedMessageId,
      });
      continue;
    }

    uids.add(uid);
  }

  return {
    uids: [...uids].sort((a, b) => a - b),
    messageIdLookups,
  };
}
