/**
 * InnerMe progressive-disclosure context selector.
 *
 * The full authenticated workspace read remains the source of truth, while this
 * module decides which details should be sent to a provider for this turn.
 * Unselected datasets are represented by a small manifest, not guessed facts.
 */
const COLLECTIONS = Object.freeze({
  leads: {
    label: "Leads and prospects",
    triggers: ["lead", "leads", "prospect", "prospects", "pipeline", "conversion", "outreach"],
    identityFields: ["business_name", "contact_name", "name"],
  },
  followups: {
    label: "Scheduled follow-ups",
    triggers: ["follow-up", "follow up", "followups", "followups", "overdue", "due today", "due tomorrow", "reminder"],
    identityFields: ["business_name", "title", "name"],
  },
  clients: {
    label: "Clients",
    triggers: ["client", "clients", "customer", "customers", "retention", "referral"],
    identityFields: ["business_name", "contact_name", "name"],
  },
  projects: {
    label: "Client projects and delivery",
    triggers: ["project", "projects", "delivery", "deadline", "milestone"],
    identityFields: ["name", "title", "service"],
  },
  tasks: {
    label: "Tasks and work items",
    triggers: ["task", "tasks", "to-do", "todo", "assigned", "deadline", "work item"],
    identityFields: ["title", "name"],
  },
  quotes: {
    label: "Quotes and proposals",
    triggers: ["quote", "quotes", "quotation", "quotation", "proposal", "pricing"],
    identityFields: ["quote_number", "title", "business_name"],
  },
  invoices: {
    label: "Invoices",
    triggers: ["invoice", "invoices", "overdue invoice", "amount owed", "collection"],
    identityFields: ["invoice_number", "title", "business_name"],
  },
  payments: {
    label: "Payments and cash collection",
    triggers: ["payment", "payments", "paid", "unpaid", "cash collected", "cash collection"],
    identityFields: ["invoice_number", "business_name", "name"],
  },
  enquiries: {
    label: "Website enquiries",
    triggers: ["enquiry", "enquiries", "inquiry", "inquiries", "website form"],
    identityFields: ["business_name", "name", "contact_name"],
  },
  portal_requests: {
    label: "Client portal requests",
    triggers: ["portal request", "portal requests", "client request", "revision request"],
    identityFields: ["subject", "name", "request_type"],
  },
  communications: {
    label: "Communication history",
    triggers: ["communication", "communications", "last contacted", "contacted", "conversation history", "call history"],
    identityFields: ["subject", "business_name", "contact_name"],
  },
  email_messages: {
    label: "Mailbox messages",
    triggers: ["email", "emails", "inbox", "mailbox", "email thread", "email history", "reply"],
    identityFields: ["subject", "from_name", "to_email"],
  },
  activities: {
    label: "Activity timeline",
    triggers: ["activity", "activities", "timeline", "recent actions", "audit trail"],
    identityFields: ["action", "event", "entity_type"],
  },
});

const FOCUSED_RECORDS = Object.freeze({
  lead: { table: "leads", collection: "leads" },
  leads: { table: "leads", collection: "leads" },
  client: { table: "clients", collection: "clients" },
  clients: { table: "clients", collection: "clients" },
  project: { table: "client_projects", collection: "projects" },
  projects: { table: "client_projects", collection: "projects" },
  task: { table: "tasks", collection: "tasks" },
  tasks: { table: "tasks", collection: "tasks" },
  quote: { table: "quotes", collection: "quotes" },
  quotes: { table: "quotes", collection: "quotes" },
  invoice: { table: "invoices", collection: "invoices" },
  invoices: { table: "invoices", collection: "invoices" },
  enquiry: { table: "website_enquiries", collection: "enquiries" },
  enquiries: { table: "website_enquiries", collection: "enquiries" },
  "portal-request": { table: "client_portal_requests", collection: "portal_requests" },
  "portal-requests": { table: "client_portal_requests", collection: "portal_requests" },
});

const CORE_COLLECTIONS = Object.freeze(Object.keys(COLLECTIONS));
const BROAD_OPERATIONS_PATTERN = /\b(?:highest.value moves|what should i do today|what should i work on today|priorities for today|business overview|business review|overall business|full business picture|grow(?:ing)? (?:the )?business|grow revenue|increase revenue|make more money|revenue growth|business growth|commercial opportunities|cross.domain|across the business|all areas|daily priorities|daily briefing)\b/i;
const BUSINESS_BRAIN_PATTERN = /\b(?:innerme|business brain|playbook|playbooks|sop|sops|agent|agents|decision|decisions|experiment|experiments|insight|insights|preference|preferences|forecast|forecasts|phase\s*\d+|roadmap|architecture|governance|trust calibration)\b/i;

function normalizeText(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function hasTrigger(text, triggers) {
  const normalized = " " + normalizeText(text) + " ";
  return triggers.some((trigger) => {
    const needle = normalizeText(trigger);
    return needle && normalized.includes(" " + needle + " ");
  });
}

function compactLabel(row, identityFields) {
  for (const key of identityFields) {
    const value = row?.[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 100);
  }
  return "Record";
}

function recordIndex(rows, identityFields) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 2).map((row) => ({
    id: String(row?.id ?? "").slice(0, 80),
    label: compactLabel(row, identityFields),
    status: typeof row?.status === "string" ? row.status.slice(0, 40) : null,
  })).filter((row) => row.id);
}

function collectionForFocusType(type) {
  const descriptor = FOCUSED_RECORDS[String(type ?? "").trim().toLowerCase()];
  return descriptor?.collection ?? null;
}

function selectedCollectionsForText(text) {
  const selected = new Set();
  for (const [key, config] of Object.entries(COLLECTIONS)) {
    if (hasTrigger(text, config.triggers)) selected.add(key);
  }

  // A lead or follow-up question depends on their relationship, not on a single
  // isolated table. This adds only relevant linked collections.
  if (selected.has("leads")) {
    selected.add("followups");
    selected.add("communications");
    selected.add("quotes");
    selected.add("email_messages");
    selected.add("clients");
  }
  if (selected.has("clients")) {
    selected.add("projects");
    selected.add("tasks");
    selected.add("invoices");
    selected.add("payments");
    selected.add("portal_requests");
  }
  if (selected.has("projects")) {
    selected.add("clients");
    selected.add("tasks");
    selected.add("invoices");
  }
  if (selected.has("invoices")) {
    selected.add("payments");
    selected.add("clients");
  }
  if (selected.has("quotes")) selected.add("leads");
  if (selected.has("followups")) selected.add("leads");
  return selected;
}

function compactOperationalSummary(summary, includeFollowupDetails) {
  if (!summary || typeof summary !== "object") return summary ?? null;
  const result = { ...summary };
  if (!includeFollowupDetails) {
    delete result.followups_due;
    delete result.followup_attention_today;
  }
  return result;
}

function makeBusinessBrainView(brain, text) {
  if (!brain || typeof brain !== "object") return null;
  const needsBrainDetails = BUSINESS_BRAIN_PATTERN.test(text);
  const view = {};

  for (const [key, value] of Object.entries(brain)) {
    if (!Array.isArray(value)) continue;

    if (key === "playbooks") {
      const matching = value.filter((item) => {
        const name = normalizeText(item?.name);
        const purpose = normalizeText(item?.purpose);
        const query = normalizeText(text);
        return name.length > 0 && query.includes(name) ||
          purpose.split(" ").filter((token) => token.length >= 5 && query.includes(token)).length >= 2;
      }).slice(0, 3);
      view.playbook_index = value.slice(0, 12).map((item) => ({
        name: item?.name ?? "",
        purpose: item?.purpose ?? "",
        status: item?.status ?? "",
        definition_of_done: item?.definition_of_done ?? "",
        detail_available: Boolean(Array.isArray(item?.steps) && item.steps.length),
      }));
      if (matching.length) {
        view.matching_playbooks = matching;
      }
      continue;
    }

    if (key === "agents") {
      view.agent_index = value.slice(0, 12).map((item) => ({
        slug: item?.slug ?? "",
        name: item?.name ?? "",
        purpose: item?.purpose ?? "",
        trust_stage: item?.trust_stage ?? "",
        permissions: item?.permissions ?? [],
        status: item?.status ?? "",
        detail_available: Boolean(item?.instructions),
      }));
      if (needsBrainDetails) {
        view.matching_agent_details = value.filter((item) => {
          const name = normalizeText(item?.name);
          const slug = normalizeText(item?.slug);
          const query = normalizeText(text);
          return (name && query.includes(name)) || (slug && query.includes(slug));
        }).slice(0, 2);
      }
      continue;
    }

    const indexFields = {
      decisions: ["id", "title", "status", "updated_at"],
      active_experiments: ["id", "name", "hypothesis", "success_metric", "status", "review_date"],
      insights: ["id", "title", "category", "confidence", "status"],
      preferences: ["category", "preference_key", "value", "source"],
      predictive_business_intelligence: ["id", "forecast_key", "metric_label", "status", "verification_status", "forecast_date"],
    }[key];

    if (!indexFields) {
      view[key] = value.slice(0, needsBrainDetails ? 6 : 2);
    } else {
      view[key] = value.slice(0, needsBrainDetails ? 12 : 3).map((item) => {
        const output = {};
        for (const field of indexFields) {
          if (item?.[field] !== undefined) output[field] = item[field];
        }
        return output;
      });
    }
  }
  return view;
}

/**
 * Resolve an explicit UI-focused record to a table/collection descriptor.
 * The caller still uses the authenticated Supabase client and RLS.
 */
export function resolveInnerMeFocusedRecordDescriptor(focusedRecord) {
  const type = String(focusedRecord?.type ?? "").trim().toLowerCase();
  const id = String(focusedRecord?.id ?? "").trim();
  const descriptor = FOCUSED_RECORDS[type];
  if (!descriptor || !id || id.length > 100) return null;
  return { type, id, table: descriptor.table, collection: descriptor.collection };
}

/**
 * Keep a compact catalogue of what is available, while selecting only the
 * workspace detail domains relevant to the current request.
 *
 * The "loaded_records" field is explicitly a bounded query sample, never a
 * database-wide total. Business-specific facts should only be taken from
 * detail_collections, focused_record, connected_context, and summary metrics.
 */
export function buildInnerMeProgressiveContext(context, message, history = []) {
  const text = [
    String(message ?? ""),
    ...((Array.isArray(history) ? history : []).slice(-4).map((item) => item?.content ?? "")),
  ].join("\n");
  const focused = context?.focused_record;
  const focusCollection = collectionForFocusType(focused?.type);
  const broad = BROAD_OPERATIONS_PATTERN.test(text);
  const domainCollections = selectedCollectionsForText(text);
  const normalizedQuery = " " + normalizeText(text) + " ";
  // If a known row's distinctive label is explicitly named, reveal that
  // collection even when the user doesn't repeat its category word.
  for (const [key, config] of Object.entries(COLLECTIONS)) {
    const rows = Array.isArray(context?.[key]) ? context[key] : [];
    const mentioned = rows.some((row) => config.identityFields.some((field) => {
      const identity = normalizeText(row?.[field]);
      return identity.length >= 5 && normalizedQuery.includes(" " + identity + " ");
    }));
    if (mentioned) domainCollections.add(key);
  }
  for (const related of selectedCollectionsForText([...domainCollections].join(" "))) domainCollections.add(related);
  let profile = broad ? "broad_operations" : "manifest_only";
  let detailCollections = new Set(domainCollections);

  if (focused && focusCollection) {
    profile = "focused_record";
    detailCollections = new Set([focusCollection]);
    const relatedByFocus = {
      leads: ["followups", "communications", "quotes", "email_messages", "clients"],
      clients: ["projects", "tasks", "followups", "quotes", "invoices", "payments", "communications", "portal_requests", "email_messages"],
      projects: ["clients", "tasks", "invoices", "payments"],
      tasks: ["clients", "projects"],
      quotes: ["clients", "leads", "invoices"],
      invoices: ["clients", "projects", "payments", "email_messages"],
      enquiries: [],
      portal_requests: ["clients"],
      payments: ["invoices", "clients"],
    };
    for (const related of (relatedByFocus[focusCollection] ?? [])) detailCollections.add(related);
  } else if (broad) {
    detailCollections = new Set(CORE_COLLECTIONS);
  } else if (detailCollections.size > 0) {
    profile = "topic_focused";
  }

  const includeFollowupDetails =
    broad ||
    detailCollections.has("followups") ||
    Boolean(focusCollection && ["leads", "clients"].includes(focusCollection));

  const manifestCollections = {};
  for (const [key, config] of Object.entries(COLLECTIONS)) {
    const rows = Array.isArray(context?.[key]) ? context[key] : [];
    const isDetailed = detailCollections.has(key);
    manifestCollections[key] = {
      description: config.label,
      trigger_terms: config.triggers.slice(0, 8),
      loaded_records: rows.length,
      loaded_count_is_database_total: false,
      detail_loaded: isDetailed,
      ...(isDetailed ? {} : { record_index: recordIndex(rows, config.identityFields) }),
    };
  }

  const selectedModelCounts = {};
  for (const key of CORE_COLLECTIONS) {
    const rows = Array.isArray(context?.[key]) ? context[key] : [];
    selectedModelCounts[key] = detailCollections.has(key) ? rows.length : 0;
  }

  const selected = {
    generated_at: context?.generated_at ?? null,
    business_date_johannesburg: context?.business_date_johannesburg ?? null,
    query_failures: Array.isArray(context?.query_failures) ? context.query_failures : [],
    workspace_source_record_counts: context?.workspace_source_record_counts ?? {},
    workspace_model_context_record_counts: selectedModelCounts,
    workspace_manifest: {
      profile,
      reason: broad
        ? "Cross-domain decision-making request requires a multi-domain evidence set."
        : focused
          ? "Explicit focused record takes precedence; related details are selected narrowly."
          : detailCollections.size
            ? "Only domains that match this request and their key relationships are expanded."
            : "No workspace domain clearly matches this request; available records are indexed but not expanded.",
      detail_collections: [...detailCollections],
      progressive_disclosure_rule: "Only expanded collections contain row detail. Record-index entries are pointers, not enough evidence to assert row-specific facts. Loaded counts are bounded query sample sizes, not database-wide totals.",
      collections: manifestCollections,
    },
    operational_summary: compactOperationalSummary(context?.operational_summary, includeFollowupDetails),
    workspace_temporal_guidance: context?.workspace_temporal_guidance ?? null,
    workspace_model_context_exclusion_counts: context?.workspace_model_context_exclusion_counts ?? {},
    workspace_intelligence_notes: context?.workspace_intelligence_notes ?? [],
  };

  for (const key of detailCollections) {
    if (Array.isArray(context?.[key])) {
      selected[key] = context[key];
      selected.workspace_model_context_record_counts[key] = context[key].length;
    } else {
      selected.workspace_model_context_record_counts[key] = 0;
    }
  }

  if (focused) {
    selected.focused_record = focused;
    if (context?.connected_context) selected.connected_context = context.connected_context;
  }

  const brain = makeBusinessBrainView(context?.innerme_business_brain, text);
  if (brain) selected.innerme_business_brain = brain;

  if (context?.workspace_focused_record_lookup_status) {
    selected.workspace_focused_record_lookup_status = context.workspace_focused_record_lookup_status;
  }

  return selected;
}
