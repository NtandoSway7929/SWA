/**
 * Optional structured-answer contract shared by the internal chat prompt and
 * the answer normalizer. This is a presentation hint only: it does not change
 * provider routing, add provider calls, or authorize workspace mutations.
 */

export const INNERME_INTELLIGENT_UI_FORMAT_RULES = [
  "OPTIONAL STRUCTURED ANSWER FORMAT (InnerMe Intelligent UI v1):",
  "Use the existing concise natural-language format by default. Use structured output only when it materially improves a moderately complex response, such as an executive summary with named metrics, an actionable checklist, a sectioned report, or a chart of one comparable numeric series.",
  "Do not use this format for a simple factual answer, a diagnostic turn needing one direct question, client-ready copy, code, or answers that need inline source/citation formatting. Keep those in the existing format.",
  "When structured output is genuinely useful, return one complete valid JSON object and nothing else: no preamble, Markdown fences, trailing commentary, or unsupported fields.",
  'Example envelope: {"innerme_ui":{"version":1,"kind":"metrics","title":"Short title","summary":"Direct takeaway","metrics":[{"label":"Metric name","value":"Grounded value"}]}}',
  "The envelope key must be innerme_ui, version must be the number 1, and kind must be summary, metrics, checklist, chart, or sections. Omit optional fields you do not need; never fill every field just because it is available.",
  "summary is a concise direct answer. metrics contains up to 8 objects with string label and string value, preserving the original units. items contains up to 12 strings and is only for actionable checklist steps. sections contains up to 8 objects with string title and string body.",
  "Use kind chart only for a single numeric series with comparable values in the same unit and on the same scale. chart must contain a short title and up to 12 points, each with a string label and a finite JSON number value. Never combine unlike measures, such as raw counts, percentages, and satisfaction scores, into one chart. Use metrics for unlike measures.",
  "Use only values supported by the admin's question or verified workspace context. Do not fabricate figures or infer missing measures. Clearly identify any explicitly illustrative/example values as illustrative. Keep the whole envelope under 20,000 characters.",
  "Ensure all string values are valid JSON strings with escaped newlines and no raw control characters. Use arrays rather than bullet-prefixed text for list items. If structured output is uncertain or adds little value, answer normally."
].join("\n");

/**
 * Mirrors the frontend's strict opt-in payload contract so that normalization
 * cannot rewrite a valid JSON envelope and accidentally corrupt its strings.
 */
export function isInnerMeIntelligentUiEnvelope(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 20000) return false;
  const fenced = raw.match(/^\x60\x60\x60(?:json|innerme-ui)\s*([\s\S]*?)\s*\x60\x60\x60$/i);
  const candidate = fenced ? fenced[1] : raw;
  if (!candidate || candidate.length > 20000 || candidate[0] !== "{") return false;

  try {
    const value = JSON.parse(candidate);
    const payload = value && value.innerme_ui;
    if (!payload || payload.version !== 1 ||
        !["summary", "metrics", "checklist", "chart", "sections"].includes(payload.kind)) return false;
    if (payload.title !== undefined && typeof payload.title !== "string") return false;
    if (payload.summary !== undefined && typeof payload.summary !== "string") return false;
    if (payload.metrics !== undefined && (!Array.isArray(payload.metrics) || payload.metrics.length > 8 ||
        payload.metrics.some(item => !item || typeof item.label !== "string" || typeof item.value !== "string"))) return false;
    if (payload.items !== undefined && (!Array.isArray(payload.items) || payload.items.length > 12 ||
        payload.items.some(item => typeof item !== "string" && (!item || typeof item.label !== "string")))) return false;
    if (payload.sections !== undefined && (!Array.isArray(payload.sections) || payload.sections.length > 8 ||
        payload.sections.some(item => !item || typeof item.title !== "string" || typeof item.body !== "string"))) return false;
    if (payload.kind === "chart" &&
        (!payload.chart || !Array.isArray(payload.chart.points) || payload.chart.points.length > 12 ||
        payload.chart.points.some(point => !point || typeof point.label !== "string" ||
          typeof point.value !== "number" || !Number.isFinite(point.value)))) return false;
    return true;
  } catch {
    return false;
  }
}

/** Preserve valid structured payloads verbatim; keep legacy plain-text cleanup. */
export function normalizeInnerMeAnswer(value) {
  const raw = String(value || "");
  if (isInnerMeIntelligentUiEnvelope(raw)) return raw.trim();
  return raw
    .replace(/\\([#*_[\]()>+.!-])/g, "$1")
    .replace(/\\@/g, "@")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(^|\s)(\*)\s+/g, "$1• ")
    .replace(/(^|\s)•\s+/g, "\n• ")
    .replace(/\n\s*•/g, "\n•")
    .replace(/\s+(?=(?:Overdue Follow-ups|Due Today|Due Tomorrow|Status and Value|Contact Information|Follow-Up Status|Communication History|Key Communication History|Proposed Scope and Recommendations|Current Status|Next Steps|Suggested Next Step)\b)/g, "\n")
    .replace(/^(Leads Needing Follow-Up|Maisha's Touch Lead Overview)\s+/g, "$1\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
