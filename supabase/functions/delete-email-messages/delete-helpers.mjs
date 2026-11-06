/**
 * Resolve selected inbound rows to live mailbox UIDs without trusting a
 * potentially stale UID on its own.
 *
 * IMAP UIDs are unique only inside one mailbox UIDVALIDITY generation. A
 * generation mismatch always requires an exact Message-ID search, even when
 * the old UID currently appears to contain the same Message-ID.
 *
 * Rows created before UIDVALIDITY tracking are supported as legacy records,
 * but are also reconciled by Message-ID instead of trusting their old UID.
 */
export function resolveInboxDeleteTargets(
  records,
  currentMessages,
  folder = "INBOX",
  currentUidValidity = null,
) {
  if (!Array.isArray(records) || !Array.isArray(currentMessages)) {
    throw new TypeError("Inbox message records and live IMAP messages must be arrays.");
  }

  const mailboxFolder = String(folder || "INBOX");
  const liveUidValidity = Number(currentUidValidity);
  if (!Number.isSafeInteger(liveUidValidity) || liveUidValidity <= 0) {
    throw new Error("The connected mailbox did not provide a valid UIDVALIDITY value.");
  }

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

    const rawUidValidity = record.imap_uid_validity;
    const hasUidValidity = rawUidValidity !== null &&
      rawUidValidity !== undefined &&
      rawUidValidity !== "";
    const storedUidValidity = hasUidValidity ? Number(rawUidValidity) : null;

    if (hasUidValidity &&
        (!Number.isSafeInteger(storedUidValidity) || storedUidValidity <= 0)) {
      throw new Error("An incoming message has an invalid mailbox UIDVALIDITY value.");
    }

    const expectedSourceKey = hasUidValidity
      ? "imap:" + String(storedUidValidity) + ":" + mailboxFolder + ":" + String(uid)
      : "imap:" + mailboxFolder + ":" + String(uid);

    if (String(record.source_key || "") !== expectedSourceKey) {
      throw new Error("An incoming message does not belong to the selected IMAP folder.");
    }

    const expectedMessageId = String(record.message_id || "").trim();
    if (!expectedMessageId) {
      throw new Error("An incoming message has no Message-ID and cannot be safely matched to the mailbox.");
    }

    const liveMessage = liveByUid.get(uid);
    const liveMessageId = String(liveMessage?.envelope?.messageId || "").trim();
    const sameUidGeneration = storedUidValidity === liveUidValidity;

    if (!sameUidGeneration || !liveMessage || !liveMessageId ||
        liveMessageId !== expectedMessageId) {
      // Never delete by UID across UIDVALIDITY generations or when the current
      // envelope differs. The caller must search and verify the exact Message-ID.
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
