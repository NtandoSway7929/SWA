/**
 * Return a bounded, ascending, duplicate-free batch of valid IMAP UIDs.
 * Keeping order is important: the sync cursor is derived from the highest
 * successfully stored UID, so messages must be processed in UID order.
 */
export function selectUidBatch(uids, maxMessages = 10) {
  if (!Array.isArray(uids)) return [];

  const parsedLimit = Number(maxMessages);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.floor(parsedLimit)
    : 10;

  return [...new Set(
    uids
      .map((uid) => Number(uid))
      .filter((uid) => Number.isSafeInteger(uid) && uid > 0),
  )]
    .sort((a, b) => a - b)
    .slice(0, limit);
}

/**
 * Validate and bound a UID SEARCH response. ImapFlow can resolve a rejected
 * IMAP SEARCH to false; callers must never interpret that as an empty mailbox.
 */
export function normalizeUidSearchResult(uids, startUid, newestUid) {
  if (!Array.isArray(uids)) {
    throw new Error(
      "IMAP UID SEARCH did not return a valid result. The mailbox search may have been rejected.",
    );
  }

  const start = Number(startUid);
  const end = Number(newestUid);

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 1 ||
    end < 1
  ) {
    throw new Error("IMAP UID search range is invalid.");
  }

  if (start > end) return [];

  return selectUidBatch(
    uids
      .map((uid) => Number(uid))
      .filter((uid) => Number.isSafeInteger(uid) && uid >= start && uid <= end),
    Number.MAX_SAFE_INTEGER,
  );
}

/**
 * Match References/In-Reply-To in caller-provided priority order. The query
 * result order is not guaranteed to reflect the RFC header priority.
 */
export function resolveMatchingThreadMessage(candidates, rows) {
  for (const candidate of candidates) {
    const match = rows.find((row) => row?.message_id === candidate);
    if (match) return match;
  }

  return null;
}
