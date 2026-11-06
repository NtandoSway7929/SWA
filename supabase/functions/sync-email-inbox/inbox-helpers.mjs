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

/**
 * Choose the next UID to search for. If a stored cursor is missing or lies
 * beyond the current mailbox's UIDNEXT, restart with a bounded recent window.
 * The caller scopes stored cursors to the current UIDVALIDITY.
 */
export function getSyncStartUid(latestStoredUid, newestUid, initialLimit = 10) {
  const latest = Number(latestStoredUid);
  const newest = Number(newestUid);
  const parsedLimit = Number(initialLimit);
  const limit = Number.isSafeInteger(parsedLimit) && parsedLimit > 0
    ? parsedLimit
    : 10;

  if (!Number.isSafeInteger(newest) || newest <= 0) return 1;

  if (
    !Number.isSafeInteger(latest) ||
    latest <= 0 ||
    latest > newest
  ) {
    return Math.max(1, newest - limit + 1);
  }

  return latest + 1;
}
