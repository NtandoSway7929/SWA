/**
 * Deterministic workspace-context guardrails for InnerMe.
 *
 * This is a presentation/context filter only: it never mutates source records.
 * Explicit record questions keep the original data available to the model.
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

function scheduledBeyondPlanningWindow(row, now, horizonMs) {
  const status = String(row?.status || "").trim().toLowerCase();
  if (status && !["pending", "scheduled", "open"].includes(status)) return false;
  const rawDate = row?.scheduled_for ?? row?.scheduled_at ?? row?.follow_up_at ?? row?.due_at;
  if (!rawDate) return false;
  const timestamp = Date.parse(String(rawDate));
  return Number.isFinite(timestamp) && timestamp > now + horizonMs;
}

export function buildInnerMeWorkspaceContextForModel(context, message, nowMs = Date.now()) {
  if (!context || typeof context !== "object") return context;
  const broadPlanning = isBroadBusinessPlanningRequest(message);
  if (!broadPlanning || isExplicitSwayphicsRecordRequest(message)) return context;

  const horizonMs = 7 * 24 * 60 * 60 * 1000;
  const leads = Array.isArray(context.leads) ? context.leads : [];
  const excludedSelfRecords = leads.filter((row) =>
    /^swayphics$/i.test(String(row?.business_name || "").trim())
  );
  const followups = Array.isArray(context.followups) ? context.followups : [];
  const deferredFollowups = followups.filter((row) =>
    scheduledBeyondPlanningWindow(row, nowMs, horizonMs)
  );

  if (excludedSelfRecords.length === 0 && deferredFollowups.length === 0) return context;

  const notes = [
    ...(Array.isArray(context.workspace_intelligence_notes) ? context.workspace_intelligence_notes : []),
  ];
  if (excludedSelfRecords.length > 0) {
    notes.push(`Excluded ${excludedSelfRecords.length} lead record(s) whose business_name is Swayphics from broad sales-priority context; these are not external prospects. The underlying records were not changed.`);
  }
  if (deferredFollowups.length > 0) {
    notes.push(`Excluded ${deferredFollowups.length} follow-up(s) scheduled more than seven days from the planning date from immediate-priority context. Preserve their recorded dates; they are not tasks for today.`);
  }

  return {
    ...context,
    ...(excludedSelfRecords.length > 0
      ? { leads: leads.filter((row) => !/^swayphics$/i.test(String(row?.business_name || "").trim())) }
      : {}),
    ...(deferredFollowups.length > 0
      ? { followups: followups.filter((row) => !scheduledBeyondPlanningWindow(row, nowMs, horizonMs)) }
      : {}),
    workspace_intelligence_notes: notes,
  };
}
