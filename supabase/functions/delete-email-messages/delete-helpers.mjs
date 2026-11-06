/**
 * Resolve the live IMAP UIDs corresponding to selected inbox mirror rows.
 *
 * A mailbox UID can only be trusted when its source key still matches the
 * configured folder and the live message's RFC Message-ID matches the stored
 * mirror. A missing UID is safe to clean up from the database because that
 * original mailbox message is already gone. A mismatched UID is rejected to
 * prevent deleting a different message if the mailbox has been reset.
 */
export function resolveInboxDeleteUids(records, currentMessages, folder = "INBOX") {
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
    if (!liveMessage) {
      // The source message is already absent; only its mirror needs cleanup.
      continue;
    }

    const liveMessageId = String(liveMessage.envelope?.messageId || "").trim();
    if (!liveMessageId || liveMessageId !== expectedMessageId) {
      throw new Error("The mailbox identity for a selected message has changed. Refresh the inbox before deleting.");
    }

    uids.add(uid);
  }

  return [...uids].sort((a, b) => a - b);
}
