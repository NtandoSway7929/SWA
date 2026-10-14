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
  leads: 24,
  followups: 18,
  clients: 20,
  projects: 20,
  tasks: 24,
  quotes: 20,
  payments: 20,
  enquiries: 20,
  invoices: 20,
  portal_requests: 20,
});

const ULTRA_RECENT_COLLECTION_LIMITS = Object.freeze({
  communications: 1,
  activities: 1,
  email_messages: 1,
});

const ULTRA_RECORD_FIELDS = Object.freeze({
  leads: ["id", "business_name", "contact_name", "service_interest", "status", "estimated_value", "next_follow_up", "last_contacted_at", "created_at", "updated_at", "converted_client_id", "source", "notes", "contacted_manually"],
  followups: ["id", "lead_id", "client_id", "scheduled_for", "channel", "status", "note", "created_at", "completed_at"],
  clients: ["id", "business_name", "contact_name", "status", "source_lead_id", "created_at", "updated_at"],
  projects: ["id", "client_id", "name", "service", "description", "status", "value", "due_date", "payment_status", "created_at", "completed_at"],
  tasks: ["id", "title", "description", "status", "priority", "due_date", "lead_id", "client_id", "project_id", "created_at", "completed_at"],
  quotes: ["id", "quote_number", "title", "lead_id", "client_id", "amount", "status", "valid_until", "created_at"],
  payments: ["id", "invoice_id", "client_id", "amount", "status", "paid_at", "created_at"],
  enquiries: ["id", "name", "business_name", "service", "status", "created_at", "converted_lead_id", "message"],
  invoices: ["id", "invoice_number", "client_id", "project_id", "issue_date", "due_date", "status", "total", "amount_paid", "amount_outstanding", "created_at", "archived"],
  portal_requests: ["id", "client_id", "request_type", "status", "created_at", "updated_at", "due_date", "subject", "description"],
  communications: ["id", "lead_id", "client_id", "channel", "direction", "subject", "message", "contacted_at", "created_at"],
  activities: ["id", "action", "event", "entity_type", "entity_id", "description", "created_at"],
  email_messages: ["id", "direction", "thread_id", "from_name", "from_email", "to_email", "subject", "text_body", "received_at", "is_read", "client_id", "lead_id", "created_at"],
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
        if (!ultraCompact && depth > 0 && Object.keys(output).length >= maxObjectKeys) break;
        const isIdentifier = /^(?:id|.+_id)$/i.test(key);
        const isExactDateOrTimestamp = /(?:^date$|_date$|_at$|^scheduled_for$|^next_follow_up$|^valid_until$|^due_date$|^issue_date$|^completed_at$)/i.test(key);
        const fieldLimit = isIdentifier || isExactDateOrTimestamp
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
      "Emergency size-reduction mode: business-critical records retain only selected operational fields; follow-ups and communication streams may be sampled to fit the provider budget; optional InnerMe business-brain details were omitted. Use workspace_source_record_counts and workspace_model_context_record_counts for counts before row compaction, workspace_compacted_record_counts for rows shown in detail, and do not treat the compacted record lists as the full workspace.";
  }
  return result;
}
