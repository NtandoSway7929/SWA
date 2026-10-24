export interface InboxThreadMessage {
  message_id?: string | null;
  thread_id?: string | null;
  client_id?: string | null;
  lead_id?: string | null;
}

/**
 * Return a bounded, ascending, duplicate-free batch of valid IMAP UIDs.
 * Keeping order is important: the sync cursor is derived from the highest
 * successfully stored UID, so messages must be processed in UID order.
 */
export function selectUidBatch(
  uids: unknown,
  maxMessages = 10,
): number[] {
  if (!Array.isArray(uids)) return [];

  const limit = Number.isFinite(Number(maxMessages))
    ? Math.max(1, Math.floor(Number(maxMessages)))
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
export function resolveMatchingThreadMessage(
  candidates: string[],
  rows: InboxThreadMessage[],
): InboxThreadMessage | null {
  for (const candidate of candidates) {
    const match = rows.find((row) => row?.message_id === candidate);
    if (match) return match;
  }

  return null;
}
