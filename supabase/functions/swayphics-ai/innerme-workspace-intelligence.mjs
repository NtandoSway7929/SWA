/**
 * Deterministic workspace-context guardrails for InnerMe.
 *
 * This is a presentation/context filter only: it never mutates source records.
 * Broad planning requests exclude known self/test records and receive
 * deterministic date classifications before the model writes its answer.
 */
export function isBroadBusinessPlanningRequest(message) {
  return /\b(?:today|daily|priorit(?:y|ies|ize|ise)|what should i do|next moves|next steps|recommend(?:ation|ations)?|plan my day|business growth|grow (?:the )?business|improve (?:the )?business|action plan|highest.value moves)\b/i.test(String(message || ""));
}

function isExplicitSwayphicsRecordRequest(message) {
  const text = String(message || "");
  return /\bswayphics\b/i.test(text) &&
    /\b(?:lead|enquir(?:y|ies)|inquir(?:y|ies)|record|test submission|test enquiry|test inquiry)\b/i.test(text) &&
    !isBroadBusinessPlanningRequest(text);
}

function normaliseIdentity(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function looksExplicitlyLikeTest(value) {
  const text = String(value || "").trim();
  return /^(?:test|testing|sample|demo)(?:\b|[_ -])/i.test(text);
}

function isSelfOrTestEnquiry(row, adminEmail) {
  const business = normaliseIdentity(row?.business_name);
  const name = normaliseIdentity(row?.name ?? row?.contact_name);
  const email = String(row?.email ?? row?.contact_email ?? row?.email_address ?? "").trim().toLowerCase();
  const normalizedAdminEmail = String(adminEmail || "").trim().toLowerCase();
  if (business === "swayphics") return true;
  // Known internal enquiry-test handle; separators and case do not matter.
  if (name === "ntandosway" || name === "ntandosway7929") return true;
  if (email && normalizedAdminEmail && email === normalizedAdminEmail) return true;
  return [row?.name, row?.business_name, row?.email, row?.contact_email]
    .some(looksExplicitlyLikeTest);
}

function scheduleDateInJohannesburg(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  // Database date columns are calendar dates, not UTC instants. Preserve them.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const field = (type) => parts.find((part) => part.type === type)?.value || "";
  const result = field("year") + "-" + field("month") + "-" + field("day");
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
}

function getJohannesburgBusinessDate(context, nowMs) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(context?.business_date_johannesburg || ""))) {
    return context.business_date_johannesburg;
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const field = (type) => parts.find((part) => part.type === type)?.value || "";
  return field("year") + "-" + field("month") + "-" + field("day");
}

function classifySchedule(value, businessDate) {
  const date = scheduleDateInJohannesburg(value);
  if (!date) return "unscheduled_or_unknown";
  if (date < businessDate) return "overdue";
  if (date === businessDate) return "due_today";
  return "upcoming";
}

function scheduledBeyondPlanningWindow(row, now, horizonMs) {
  const status = String(row?.status || "").trim().toLowerCase();
  if (status && !["pending", "scheduled", "open"].includes(status)) return false;
  const rawDate = row?.scheduled_for ?? row?.scheduled_at ?? row?.follow_up_at ?? row?.due_at;
  if (!rawDate) return false;
  const timestamp = Date.parse(String(rawDate));
  return Number.isFinite(timestamp) && timestamp > now + horizonMs;
}

function withScheduleClass(row, dateField, timingField, businessDate) {
  if (!row || typeof row !== "object") return row;
  return { ...row, [timingField]: classifySchedule(row[dateField], businessDate) };
}

export function buildInnerMeWorkspaceContextForModel(context, message, nowMs = Date.now()) {
  if (!context || typeof context !== "object") return context;
  const broadPlanning = isBroadBusinessPlanningRequest(message);
  if (!broadPlanning || isExplicitSwayphicsRecordRequest(message)) return context;

  const businessDate = getJohannesburgBusinessDate(context, nowMs);
  const horizonMs = 7 * 24 * 60 * 60 * 1000;
  const originalLeads = Array.isArray(context.leads) ? context.leads : [];
  const selfLeadRows = originalLeads.filter((row) =>
    normaliseIdentity(row?.business_name) === "swayphics"
  );
  const selfLeadIds = new Set(selfLeadRows.map((row) => String(row?.id || "")).filter(Boolean));
  const selfOrTestEnquiries = (Array.isArray(context.enquiries) ? context.enquiries : [])
    .filter((row) => isSelfOrTestEnquiry(row, context.user_email));

  const leads = originalLeads.filter((row) =>
    normaliseIdentity(row?.business_name) !== "swayphics"
  );
  const originalFollowups = Array.isArray(context.followups) ? context.followups : [];
  const selfLeadFollowups = originalFollowups.filter((row) =>
    selfLeadIds.has(String(row?.lead_id || ""))
  );
  const followups = originalFollowups.filter((row) =>
    !selfLeadIds.has(String(row?.lead_id || ""))
  );
  const deferredFollowups = followups.filter((row) =>
    scheduledBeyondPlanningWindow(row, nowMs, horizonMs)
  );
  const immediateFollowups = followups.filter((row) =>
    !scheduledBeyondPlanningWindow(row, nowMs, horizonMs)
  );

  // Reconcile the lead's own next_follow_up field with linked active follow-up
  // records. A blank lead field does not mean "unscheduled" when a pending
  // follow_ups row already has a date.
  const activeFollowupStatuses = new Set(["pending", "scheduled", "open"]);
  const pendingFollowupsByLeadId = new Map();
  for (const followup of followups) {
    const leadId = String(followup?.lead_id || "");
    const status = String(followup?.status || "").trim().toLowerCase();
    if (!leadId || !activeFollowupStatuses.has(status) || !followup?.scheduled_for) continue;
    const rows = pendingFollowupsByLeadId.get(leadId) || [];
    rows.push(followup);
    pendingFollowupsByLeadId.set(leadId, rows);
  }
  for (const rows of pendingFollowupsByLeadId.values()) {
    rows.sort((a, b) => String(a?.scheduled_for || "").localeCompare(String(b?.scheduled_for || "")));
  }

  const annotatedLeads = leads.map((lead) => {
    const leadId = String(lead?.id || "");
    const linked = pendingFollowupsByLeadId.get(leadId) || [];
    const earliestLinkedFollowup = linked[0] || null;
    const leadDate = lead?.next_follow_up || null;
    const linkedDate = earliestLinkedFollowup?.scheduled_for || null;
    const effectiveDate = linkedDate || leadDate;
    return {
      ...withScheduleClass(lead, "next_follow_up", "next_follow_up_timing", businessDate),
      effective_follow_up_date: effectiveDate,
      effective_follow_up_timing: classifySchedule(effectiveDate, businessDate),
      effective_follow_up_source: linkedDate ? "linked_pending_follow_up" : leadDate ? "lead_record" : "none",
      linked_pending_followup_count: linked.length,
      follow_up_schedule_conflict: Boolean(leadDate && linkedDate && String(leadDate).slice(0, 10) !== String(linkedDate).slice(0, 10)),
    };
  });

  const followUpScheduleConflicts = annotatedLeads
    .filter((lead) => lead.follow_up_schedule_conflict)
    .map((lead) => ({
      lead_id: lead.id || null,
      business_name: lead.business_name || "Unknown lead",
      lead_next_follow_up: lead.next_follow_up || null,
      earliest_linked_pending_follow_up: lead.effective_follow_up_date,
    }));

  const notes = [
    ...(Array.isArray(context.workspace_intelligence_notes) ? context.workspace_intelligence_notes : []),
  ];
  if (selfLeadRows.length > 0) {
    notes.push(`Excluded ${selfLeadRows.length} lead record(s) whose business name is Swayphics from broad sales priorities because they are not external prospects. Related follow-ups were also excluded. Source records were not changed.`);
  }
  if (selfOrTestEnquiries.length > 0) {
    notes.push(`Excluded ${selfOrTestEnquiries.length} website enquiry record(s) identified as self/test submissions from broad commercial priorities. This includes the known internal ntando_sway test handle. Genuine enquiries remain available. Source records were not changed.`);
  }
  if (deferredFollowups.length > 0) {
    notes.push(`Excluded ${deferredFollowups.length} follow-up(s) scheduled more than seven days after the request time from immediate-priority context. Preserve their recorded dates; they are not tasks for today.`);
  }
  notes.push(
    `DATE CLASSIFICATION: the business date in Africa/Johannesburg is ${businessDate}. Every supplied *_timing field is deterministic: overdue means a date before ${businessDate}; due_today means exactly ${businessDate}; upcoming means a later date. Never label an upcoming/future date overdue.`,
  );

  const filteredEnquiries = (Array.isArray(context.enquiries) ? context.enquiries : [])
    .filter((row) => !isSelfOrTestEnquiry(row, context.user_email));

  const nextContext = {
    ...context,
    leads: annotatedLeads,
    followups: immediateFollowups.map((row) =>
      withScheduleClass(row, "scheduled_for", "scheduled_timing", businessDate)
    ),
    enquiries: filteredEnquiries,
    workspace_intelligence_notes: notes,
    workspace_temporal_guidance: {
      business_date_johannesburg: businessDate,
      rule: "overdue=date before business date; due_today=date equal to business date; upcoming=date after business date; future dates must never be labelled overdue",
      // Effective counts use the earliest linked active follow-up when available,
      // falling back to the lead-level date only if no linked record is scheduled.
      lead_followup_date_counts: {
        overdue: annotatedLeads.filter((row) => row.effective_follow_up_timing === "overdue").length,
        due_today: annotatedLeads.filter((row) => row.effective_follow_up_timing === "due_today").length,
        upcoming: annotatedLeads.filter((row) => row.effective_follow_up_timing === "upcoming").length,
        unscheduled_or_unknown: annotatedLeads.filter((row) => row.effective_follow_up_timing === "unscheduled_or_unknown").length,
      },
      lead_recorded_next_follow_up_date_counts: {
        overdue: leads.filter((row) => classifySchedule(row?.next_follow_up, businessDate) === "overdue").length,
        due_today: leads.filter((row) => classifySchedule(row?.next_follow_up, businessDate) === "due_today").length,
        upcoming: leads.filter((row) => classifySchedule(row?.next_follow_up, businessDate) === "upcoming").length,
        unscheduled_or_unknown: leads.filter((row) => classifySchedule(row?.next_follow_up, businessDate) === "unscheduled_or_unknown").length,
      },
      lead_followup_schedule_conflict_count: followUpScheduleConflicts.length,
      lead_followup_schedule_conflicts: followUpScheduleConflicts.slice(0, 10),
      scheduled_followup_record_counts: {
        overdue: immediateFollowups.filter((row) => classifySchedule(row?.scheduled_for, businessDate) === "overdue").length,
        due_today: immediateFollowups.filter((row) => classifySchedule(row?.scheduled_for, businessDate) === "due_today").length,
        upcoming: immediateFollowups.filter((row) => classifySchedule(row?.scheduled_for, businessDate) === "upcoming").length,
        unscheduled_or_unknown: immediateFollowups.filter((row) => classifySchedule(row?.scheduled_for, businessDate) === "unscheduled_or_unknown").length,
      },
    },
    workspace_model_context_exclusion_counts: {
      self_owned_leads: selfLeadRows.length,
      related_self_lead_followups: selfLeadFollowups.length,
      self_or_test_enquiries: selfOrTestEnquiries.length,
    },
  };
  return nextContext;
}


const INNERME_EMAIL_BODY_INTENT_PATTERNS = Object.freeze([
  /\b(?:read|summari[sz]e|quote|extract|explain|review|analyse|analyze|rewrite|translate)\b.{0,100}\b(?:email|emails|inbox|mailbox|message|messages|thread|reply|replies|response|responses)\b/i,
  /\b(?:email|emails|message|messages|thread|reply|replies)\b.{0,100}\b(?:content|body|says|said|wrote|received|response|quote|text|summary)\b/i,
  /\b(?:emails?|messages?|threads?)\b.{0,100}\b(?:summari[sz]e|quote|extract|explain|review|analyse|analyze|translate)\b/i,
  /\b(?:what did (?:they|he|she|the client|[a-z][a-z0-9'’-]*) say|what does (?:the|this|that|their|the latest) (?:email|message|reply|thread) say|did .{1,60}\b(?:reply|respond|answer)|has .{1,60}\b(?:replied|responded|answered)|latest reply|their reply)\b/i,
]);

/**
 * Full email bodies are expensive input and are not useful for ordinary
 * operational questions. Fetch message content only when the admin explicitly
 * asks about what was written, a reply, or a specific email/thread.
 */
export function shouldLoadInnerMeEmailBodies(message) {
  const text = String(message || "");
  return INNERME_EMAIL_BODY_INTENT_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Select a small, relevant set of message IDs before fetching text_body.
 * Existing email metadata is already sorted newest-first by the caller.
 * Explicit lead/client focus and named-record matches never fall back to
 * unrelated mailbox content when no linked message is found.
 */
/**
 * Choose email bodies using only already-authorized mailbox metadata.
 * @param {{
 *   message?: string,
 *   focusedRecord?: {type?: string, id?: string}|null,
 *   emailRows?: Array<{id?: unknown, lead_id?: unknown, client_id?: unknown}>,
 *   leads?: Array<{id?: unknown, business_name?: unknown, contact_name?: unknown, name?: unknown}>,
 *   clients?: Array<{id?: unknown, business_name?: unknown, contact_name?: unknown, name?: unknown}>,
 *   maxRows?: number
 * }} [options]
 */
export function selectInnerMeEmailBodyIds(options = {}) {
  const {
    message,
    focusedRecord,
    emailRows,
    leads,
    clients,
    maxRows = 5,
  } = options;
  if (!shouldLoadInnerMeEmailBodies(message)) return [];

  const rows = Array.isArray(emailRows) ? emailRows : [];
  const limit = Number.isInteger(maxRows) ? Math.max(0, Math.min(8, maxRows)) : 5;
  if (!limit) return [];

  const focusedType = String(focusedRecord?.type || "").trim().toLowerCase();
  const focusedId = String(focusedRecord?.id || "").trim();
  if (focusedId && ["lead", "leads"].includes(focusedType)) {
    return rows
      .filter((row) => String(row?.lead_id || "") === focusedId)
      .slice(0, limit)
      .map((row) => String(row?.id || ""))
      .filter(Boolean);
  }
  if (focusedId && ["client", "clients"].includes(focusedType)) {
    return rows
      .filter((row) => String(row?.client_id || "") === focusedId)
      .slice(0, limit)
      .map((row) => String(row?.id || ""))
      .filter(Boolean);
  }
  // A focused record of another type is not a reason to attach unrelated
  // mailbox contents. A dedicated connected-record resolver can expand this
  // safely in a later change.
  if (focusedId) return [];

  const normalizedQuery = normaliseIdentity(message);
  const leadIds = new Set(
    (Array.isArray(leads) ? leads : [])
      .filter((row) => {
        const identities = [row?.business_name, row?.contact_name, row?.name];
        return identities.some((value) => {
          const identity = normaliseIdentity(value);
          return identity.length >= 5 && normalizedQuery.includes(identity);
        });
      })
      .map((row) => String(row?.id || ""))
      .filter(Boolean),
  );
  const clientIds = new Set(
    (Array.isArray(clients) ? clients : [])
      .filter((row) => {
        const identities = [row?.business_name, row?.contact_name, row?.name];
        return identities.some((value) => {
          const identity = normaliseIdentity(value);
          return identity.length >= 5 && normalizedQuery.includes(identity);
        });
      })
      .map((row) => String(row?.id || ""))
      .filter(Boolean),
  );

  const hasKnownNamedTarget = leadIds.size > 0 || clientIds.size > 0;
  const normalizedMessage = String(message || "");
  const hasExplicitRecipientOrSubject = /\b(?:from|for|about|regarding|with|of)\s+[^?.!,]{2,80}/i.test(normalizedMessage);
  const hasUnresolvedNamedPerson = /\b(?:did|has|have|what did|what has)\s+(?!they\b|them\b|he\b|she\b|we\b|you\b|the client\b|the lead\b|anyone\b|someone\b)([a-z][a-z0-9'’-]+(?:\s+[a-z][a-z0-9'’-]+){0,3})\s+(?:repl(?:y|ied|ies)|respond(?:ed|s)?|answer(?:ed|s)?|say|said|write|wrote|send|sent|email|message)\b/i.test(normalizedMessage);

  const hasNamedTarget = hasKnownNamedTarget || hasExplicitRecipientOrSubject || hasUnresolvedNamedPerson;
  const candidates = hasNamedTarget
    ? rows.filter((row) =>
        leadIds.has(String(row?.lead_id || "")) ||
        clientIds.has(String(row?.client_id || ""))
      )
    : rows;

  return candidates
    .slice(0, limit)
    .map((row) => String(row?.id || ""))
    .filter(Boolean);
}
