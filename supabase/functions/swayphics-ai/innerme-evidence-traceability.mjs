/**
 * Shared evidence rules and compact source metadata formatting for InnerMe.
 * The module deliberately depends on the caller's existing sanitizer so prompt
 * construction retains the same text-cleaning behavior as the Edge Function.
 */
export const INNERME_EVIDENCE_TRACEABILITY_RULES = [
  "SOURCE-LEVEL EVIDENCE TRACEABILITY:",
  "- Apply these rules to material factual, architectural, roadmap, dependency, implementation, security, benchmark, and runtime-status claims. Keep routine conversation and creative drafts uncluttered.",
  "- SOURCE: for a claim supported by retrieved InnerMe knowledge, name the exact record title and full knowledge-record ID. Include its recorded source name, publisher, and URL when supplied. Do not cite a record merely because it is related to the topic.",
  "- SOURCE PATH: for repository and architecture claims, identify exact file or migration paths only when an authoritative source supplies them. A roadmap index establishes what the index documents, not that the underlying behaviour works. Never guess paths or cite files that have not been supplied or verified.",
  "- EVIDENCE: state what the source explicitly establishes without extending its scope.",
  "- INFERENCE: label a conclusion that goes beyond the source as 'Inference:' when that distinction materially affects the answer. Do not present a conceptual relationship as a documented dependency.",
  "- VERIFICATION: distinguish artifact existence, documented design/dependency, automated test results, and observed runtime behaviour. Claim behaviour was tested only when supplied evidence names the test and its result. Otherwise say 'runtime verification not established by the available evidence.'",
  "- INSUFFICIENT EVIDENCE: when evidence is missing, ambiguous, stale, or conflicting, state what cannot be confirmed. Never invent source IDs, source paths, test names, benchmark results, or runtime observations.",
  "- Keep attribution concise and claim-specific. For material evidence-sensitive answers, cover Source, Evidence, Inference, and Verification where relevant.",
].join("\n");

/**
 * @param {Record<string, unknown>} item
 * @param {number} index
 * @param {(value: unknown, max?: number) => string} cleanForModel
 */
export function formatInnerMeKnowledgeEvidence(item, index, cleanForModel) {
  const field = function (value, fallback, max) {
    return cleanForModel(value || fallback, max);
  };
  const similarity = Number(item?.similarity || 0);

  return [
    String(index + 1) + ". " + field(item?.title, "Knowledge record", 180),
    "Knowledge record ID: " + field(item?.id, "not supplied", 80),
    "Evidence level: " + field(item?.evidence_level, "not supplied", 40),
    "Confidence: " + field(item?.confidence, "not supplied", 40),
    "Jurisdiction: " + field(item?.jurisdiction, "not supplied", 80),
    "Source name: " + field(item?.source_name, "not supplied", 180),
    "Publisher: " + field(item?.source_publisher, "not supplied", 120),
    "Similarity: " + String(Number(similarity.toFixed(3))),
    "Statement: " + field(item?.statement, "not supplied", 900),
    "Application: " + field(item?.application, "not supplied", 700),
    "Constraints: " + field(item?.constraints, "none stated", 500),
    "Do not use when: " + field(item?.do_not_use_when, "none stated", 500),
    "Source URL on record: " + field(item?.source_url, "not supplied", 500),
  ].join("\n");
}
