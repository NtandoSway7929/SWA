/**
 * Deterministic workspace-context guardrails for InnerMe.
 *
 * This is a presentation/context filter only: it never mutates source records.
 * Explicit record questions keep the original data available to the model.
 */
export function isBroadBusinessPlanningRequest(message) {
  return /\b(?:today|daily|priorit(?:y|ies|ize|ise)|what should i do|next moves|next steps|recommend(?:ation|ations)?|plan my day|business growth|grow (?:the )?business|improve (?:the )?business|action plan|highest.value moves)\b/i.test(String(message || ""));
}

export function buildInnerMeWorkspaceContextForModel(context, message) {
  if (!context || typeof context !== "object") return context;
  if (!isBroadBusinessPlanningRequest(message) || /\bswayphics\b/i.test(String(message || ""))) {
    return context;
  }

  const leads = Array.isArray(context.leads) ? context.leads : [];
  const excludedSelfRecords = leads.filter((row) =>
    /^swayphics$/i.test(String(row?.business_name || "").trim())
  );

  if (excludedSelfRecords.length === 0) return context;

  return {
    ...context,
    leads: leads.filter((row) =>
      !/^swayphics$/i.test(String(row?.business_name || "").trim())
    ),
    workspace_intelligence_notes: [
      ...(Array.isArray(context.workspace_intelligence_notes) ? context.workspace_intelligence_notes : []),
      `Excluded ${excludedSelfRecords.length} lead record(s) whose business_name is Swayphics from broad sales-priority context; these are not external prospects. The underlying records were not changed.`,
    ],
  };
}
