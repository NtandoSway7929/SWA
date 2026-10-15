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

const ULTRA_CRITICAL_COLLECTION_LIMITS = Object.freeze({
  // Preserve the complete prospect pipeline when it fits, while sharply
  // bounding less urgent collections so the combined provider request fits.
  leads: 24,
  followups: 9,
  clients: 2,
  projects: 2,
  tasks: 3,
  quotes: 2,
  payments: 2,
  enquiries: 3,
  invoices: 2,
  portal_requests: 1,
});

const ULTRA_RECENT_COLLECTION_LIMITS = Object.freeze({
  communications: 1,
  activities: 1,
  email_messages: 1,
});

const ULTRA_RECORD_FIELDS = Object.freeze({
  leads: ["id", "business_name", "service_interest", "status", "estimated_value", "next_follow_up", "next_follow_up_timing", "effective_follow_up_date", "effective_follow_up_timing", "effective_follow_up_source", "linked_pending_followup_count", "follow_up_schedule_conflict", "converted_client_id"],
  followups: ["id", "lead_id", "client_id", "scheduled_for", "scheduled_timing", "channel", "status", "note"],
  clients: ["id", "business_name", "status", "source_lead_id"],
  projects: ["id", "client_id", "name", "service", "status", "value", "due_date", "payment_status"],
  tasks: ["id", "title", "status", "priority", "due_date", "lead_id", "client_id", "project_id"],
  quotes: ["id", "quote_number", "title", "lead_id", "client_id", "amount", "status", "valid_until"],
  payments: ["id", "invoice_id", "client_id", "amount", "status", "paid_at"],
  enquiries: ["id", "name", "business_name", "service", "status", "created_at", "converted_lead_id"],
  invoices: ["id", "invoice_number", "client_id", "project_id", "issue_date", "due_date", "status", "total", "amount_outstanding", "archived"],
  portal_requests: ["id", "client_id", "request_type", "status", "due_date", "subject"],
  communications: ["id", "lead_id", "client_id", "channel", "direction", "subject", "contacted_at", "created_at"],
  activities: ["id", "action", "event", "entity_type", "entity_id", "created_at"],
  email_messages: ["id", "direction", "thread_id", "from_name", "from_email", "to_email", "subject", "received_at", "is_read", "client_id", "lead_id", "created_at"],
  decisions: ["id", "title", "decision", "status", "rationale", "updated_at"],
  playbooks: ["id", "name", "purpose", "status", "definition_of_done", "updated_at"],
  active_experiments: ["id", "name", "hypothesis", "action", "success_metric", "status", "review_date", "result", "updated_at"],
  insights: ["id", "title", "insight", "confidence", "category", "status", "updated_at"],
  preferences: ["id", "category", "preference_key", "value", "source", "updated_at"],
  agents: ["id", "slug", "name", "purpose", "outputs", "trust_stage", "permissions", "status", "updated_at"],
  predictive_business_intelligence: ["id", "forecast_key", "forecast_type", "forecast_date", "status", "confidence", "baseline_value", "projected_value", "delta_value", "direction", "metric_label", "statement", "verification_status", "actual_value", "forecast_error", "updated_at"],
});

const ULTRA_OMITTED_ROOT_DETAILS = new Set(["innerme_business_brain"]);

const RECENT_AGGRESSIVE_LIMITS = Object.freeze({
  communications: 2,
  activities: 2,
  email_messages: 2,
});

function cleanString(value, maxChars) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function collectionLimit(key, fallback, aggressive, ultraCompact) {
  if (ultraCompact && Object.prototype.hasOwnProperty.call(ULTRA_CRITICAL_COLLECTION_LIMITS, key)) {
    return ULTRA_CRITICAL_COLLECTION_LIMITS[key];
  }
  if (ultraCompact && Object.prototype.hasOwnProperty.call(ULTRA_RECENT_COLLECTION_LIMITS, key)) {
    return ULTRA_RECENT_COLLECTION_LIMITS[key];
  }
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
 * options: maxArrayItems, maxStringChars, maxObjectKeys, maxDepth,
 * aggressive, ultraCompact.
 * Ultra-compaction keeps only operationally relevant fields on business records
 * and omits the optional InnerMe business-brain detail block. The source counts
 * and an explicit omission note remain available for honest model responses.
 */
export function compactInnerMeContextForModel(value, options = {}) {
  const maxArrayItems = Number.isInteger(options.maxArrayItems) ? options.maxArrayItems : 3;
  const maxStringChars = Number.isInteger(options.maxStringChars) ? options.maxStringChars : 220;
  const maxObjectKeys = Number.isInteger(options.maxObjectKeys) ? options.maxObjectKeys : 30;
  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : 5;
  const emailBodyMaxChars = Number.isInteger(options.emailBodyMaxChars)
    ? Math.max(maxStringChars, Math.min(4000, options.emailBodyMaxChars))
    : maxStringChars;
  const aggressive = options.aggressive === true;
  const ultraCompact = options.ultraCompact === true;

  function visit(current, depth, parentKey) {
    if (current == null || typeof current === "number" || typeof current === "boolean") {
      return current;
    }
    if (typeof current === "string") {
      return cleanString(current, maxStringChars);
    }
    if (Array.isArray(current)) {
      const limit = collectionLimit(parentKey, maxArrayItems, aggressive, ultraCompact);
      // The underlying workspace queries are ordered intentionally. Keep the
      // earliest scheduled follow-ups and newest records.
      return current.slice(0, limit).map((item) =>
        visit(item, depth + 1, parentKey)
      );
    }
    if (typeof current === "object") {
      if (depth >= maxDepth) return "[nested context omitted]";
      const entries = Object.entries(current);
      const output = {};
      for (const [key, item] of entries) {
        if (ultraCompact && depth === 0 && ULTRA_OMITTED_ROOT_DETAILS.has(key)) {
          continue;
        }
        const allowedFields = ultraCompact && depth === 2
          ? ULTRA_RECORD_FIELDS[parentKey]
          : null;
        if (Array.isArray(allowedFields) && !allowedFields.includes(key)) continue;
        // Null fields carry no decision value; omit them to save space while
        // preserving every non-null identifier and exact date needed for joins.
        if (ultraCompact && item == null) continue;
        // Keep the key cap active in emergency mode too: non-allowlisted nested
        // objects can otherwise bypass the byte budget even when arrays are bounded.
        if (depth > 0 && Object.keys(output).length >= maxObjectKeys) break;
        const isIdentifier = /^(?:id|.+_id)$/i.test(key);
        const isExactDateOrTimestamp = /(?:^date$|_date$|_at$|^scheduled_for$|^next_follow_up$|^valid_until$|^due_date$|^issue_date$|^completed_at$)/i.test(key);
        // Exact record labels must survive emergency mode. A 28-character
        // content budget must not silently rename the business being discussed.
        const isExactDisplayIdentity =
          /(?:^|_)(?:business_name|contact_name|name|title)$/i.test(key) ||
          /^(?:quote_number|invoice_number)$/i.test(key);
        const isEmailBody = parentKey === "email_messages" && key === "text_body";
        const fieldLimit = isEmailBody
          ? emailBodyMaxChars
          : isIdentifier || isExactDateOrTimestamp || isExactDisplayIdentity
            ? 180
            : /(^|_)(status|amount|value|name|title|email|phone|type|number|url|count|total|priority|stage|source)(_|$)/i.test(key)
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

  const result = visit(value, 0, "");
  if (ultraCompact && result && typeof result === "object" && !Array.isArray(result)) {
    result.workspace_compacted_record_counts = {};
    for (const key of [
      "tasks", "leads", "followups", "clients", "projects", "quotes",
      "payments", "enquiries", "invoices", "portal_requests",
      "communications", "activities", "email_messages",
    ]) {
      if (Array.isArray(result[key])) {
        result.workspace_compacted_record_counts[key] = result[key].length;
      }
    }
    result.context_compaction_note =
      "Emergency compaction keeps key business fields and exact names/dates, but samples some records. Source/model counts are pre-compaction counts; workspace_compacted_record_counts is the detail sample only. Optional business-brain details are omitted. Do not infer totals from sampled rows.";
  }
  return result;
}


/**
 * Compact workspace JSON to a byte budget calculated from the complete provider
 * request envelope. Exact identities, IDs, dates, source counts and lead/follow-up
 * records are protected for as long as possible; optional roots and secondary
 * collection samples are reduced first. This helper never mutates source data.
 */
export function compactInnerMeContextToByteBudget(value, maxBytes) {
  const budget = Number.isFinite(maxBytes) ? Math.max(0, Math.floor(maxBytes)) : 0;
  const byteLength = (current) => new TextEncoder().encode(JSON.stringify(current)).byteLength;
  const steps = [
    { maxStringChars: 60, maxObjectKeys: 24 },
    { maxStringChars: 42, maxObjectKeys: 18 },
    { maxStringChars: 28, maxObjectKeys: 14 },
    { maxStringChars: 16, maxObjectKeys: 12 },
    { maxStringChars: 8, maxObjectKeys: 10 },
    { maxStringChars: 4, maxObjectKeys: 8 },
  ];
  let result = null;
  for (const step of steps) {
    result = compactInnerMeContextForModel(value, {
      maxArrayItems: 1,
      maxStringChars: step.maxStringChars,
      maxObjectKeys: step.maxObjectKeys,
      maxDepth: 3,
      aggressive: true,
      ultraCompact: true,
    });
    if (byteLength(result) <= budget) return result;
  }

  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }

  const protectedRootKeys = new Set([
    "generated_at", "business_date_johannesburg", "query_failures",
    "workspace_source_record_counts", "workspace_model_context_record_counts",
    "workspace_compacted_record_counts", "workspace_temporal_guidance",
    "workspace_model_context_exclusion_counts", "workspace_intelligence_notes",
    "context_compaction_note", "leads", "followups", "tasks", "clients",
    "projects", "enquiries", "quotes", "payments", "invoices", "portal_requests",
    "communications", "activities", "email_messages",
  ]);

  // Drop any unexpected/optional detail roots by largest serialized cost first.
  const optionalRoots = Object.keys(result)
    .filter((key) => !protectedRootKeys.has(key))
    .sort((a, b) => byteLength(result[b]) - byteLength(result[a]));
  for (const key of optionalRoots) {
    delete result[key];
    if (byteLength(result) <= budget) return result;
  }

  // If more room is needed, reduce secondary operational collections before
  // the sales pipeline. Source counts remain intact so a sample is never a total.
  const reductionOrder = [
    "email_messages", "activities", "communications", "portal_requests",
    "invoices", "payments", "quotes", "projects", "clients", "enquiries", "tasks",
    "followups", "leads",
  ];
  for (const key of reductionOrder) {
    if (!Array.isArray(result[key])) continue;
    while (result[key].length > 1 && byteLength(result) > budget) {
      result[key] = result[key].slice(0, Math.ceil(result[key].length / 2));
      if (result.workspace_compacted_record_counts && typeof result.workspace_compacted_record_counts === "object") {
        result.workspace_compacted_record_counts[key] = result[key].length;
      }
    }
    if (byteLength(result) <= budget) return result;
  }

  // Last resort: discard explanatory notes and nonessential conflict examples,
  // but keep deterministic timing totals and the business-date anchor.
  if (Array.isArray(result.workspace_intelligence_notes)) result.workspace_intelligence_notes = [];
  if (result.workspace_temporal_guidance && typeof result.workspace_temporal_guidance === "object") {
    delete result.workspace_temporal_guidance.lead_followup_schedule_conflicts;
  }
  return result;
}
