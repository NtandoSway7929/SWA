/**
 * Bounded InnerMe workspace context compaction.
 *
 * Critical business collections are preserved separately from high-volume
 * activity streams so the model cannot mistake a shortened sample for the
 * complete sales pipeline. Source counts should be supplied alongside this
 * compacted representation.
 */

const CRITICAL_COLLECTION_LIMITS = Object.freeze({
  leads: 30,
  followups: 30,
  clients: 20,
  projects: 20,
  tasks: 30,
  quotes: 20,
  payments: 20,
  enquiries: 20,
  invoices: 20,
  portal_requests: 20,
});

const RECENT_COLLECTION_LIMITS = Object.freeze({
  communications: 6,
  activities: 6,
  email_messages: 6,
});

const CRITICAL_AGGRESSIVE_LIMITS = Object.freeze({
  leads: 24,
  followups: 24,
  clients: 16,
  projects: 16,
  tasks: 24,
  quotes: 16,
  payments: 16,
  enquiries: 16,
  invoices: 16,
  portal_requests: 16,
});

const RECENT_AGGRESSIVE_LIMITS = Object.freeze({
  communications: 2,
  activities: 2,
  email_messages: 2,
});

function cleanString(value, maxChars) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function collectionLimit(key, fallback, aggressive) {
  if (aggressive && Object.prototype.hasOwnProperty.call(CRITICAL_AGGRESSIVE_LIMITS, key)) {
    return CRITICAL_AGGRESSIVE_LIMITS[key];
  }
  if (Object.prototype.hasOwnProperty.call(CRITICAL_COLLECTION_LIMITS, key)) {
    return CRITICAL_COLLECTION_LIMITS[key];
  }
  if (aggressive && Object.prototype.hasOwnProperty.call(RECENT_AGGRESSIVE_LIMITS, key)) {
    return RECENT_AGGRESSIVE_LIMITS[key];
  }
  if (Object.prototype.hasOwnProperty.call(RECENT_COLLECTION_LIMITS, key)) {
    return RECENT_COLLECTION_LIMITS[key];
  }
  return fallback;
}

/**
 * options: maxArrayItems, maxStringChars, maxObjectKeys, maxDepth, aggressive.
 * Query results are ordered before this helper runs: preserve the first items
 * for timestamp-descending lists and scheduled-date-ascending follow-ups.
 */
export function compactInnerMeContextForModel(value, options = {}) {
  const maxArrayItems = Number.isInteger(options.maxArrayItems) ? options.maxArrayItems : 3;
  const maxStringChars = Number.isInteger(options.maxStringChars) ? options.maxStringChars : 220;
  const maxObjectKeys = Number.isInteger(options.maxObjectKeys) ? options.maxObjectKeys : 30;
  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : 5;
  const aggressive = options.aggressive === true;

  function visit(current, depth, parentKey) {
    if (current == null || typeof current === "number" || typeof current === "boolean") {
      return current;
    }
    if (typeof current === "string") {
      return cleanString(current, maxStringChars);
    }
    if (Array.isArray(current)) {
      const limit = collectionLimit(parentKey, maxArrayItems, aggressive);
      // The underlying workspace queries are ordered intentionally. Keep the
      // first rows so pending soonest follow-ups and most recently updated
      // records survive compaction.
      return current.slice(0, limit).map((item) =>
        visit(item, depth + 1, parentKey)
      );
    }
    if (typeof current === "object") {
      if (depth >= maxDepth) return "[nested context omitted]";
      const entries = Object.entries(current);
      // Preserve root-level collection counts and record collections.
      // Only nested record objects use the object-key budget.
      const boundedEntries = depth === 0
        ? entries
        : entries.slice(0, maxObjectKeys);
      const output = {};
      for (const [key, item] of boundedEntries) {
        const fieldLimit = /(^|_)(id|status|date|at|amount|value|name|title|email|phone|type|number|url|count|total|priority|stage|source)(_|$)/i.test(key)
          ? Math.min(180, maxStringChars)
          : maxStringChars;
        output[key] = typeof item === "string"
          ? cleanString(item, fieldLimit)
          : visit(item, depth + 1, key);
      }
      return output;
    }
    return String(current).slice(0, maxStringChars);
  }

  return visit(value, 0, "");
}
