/** Fixed Cloudflare Workers AI model selected for the zero-cost copywriting route. */
export const CLOUDFLARE_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";

/** Approved Gemini models for the interactive chat routing experiment. */
export const INNERME_CHAT_ROUTINE_MODEL = "gemini-3.5-flash-lite";
export const INNERME_CHAT_REASONING_MODEL = "gemini-3.8-flash";

const INNERME_COMPLEX_CHAT_PATTERN = /\b(?:analyse|analyze|analysis|architecture|audit|benchmark|causal|compare|counterfactual|diagnos(?:e|is|tic)|evaluate|forecast|governance|financial|revenue|profit|cash|invoice|payment|collection|money|outstanding|confidential|send(?:ing)?\s+(?:an?\s+)?(?:email|message)|create|delete|update|approve|modify|optim(?:ise|ize|isation|ization)|policy|priorit(?:ise|ize|isation|ization)|predict|root cause|security|strateg(?:y|ic|ies)|trade.?off|trust calibration|verify|verification|execute|execution|automation|action proposal|phase\s*\d+)\b/i;

/**
 * Select a model tier for the primary interactive chat request.
 *
 * Routine, stateless questions use Flash-Lite. Stateful conversations, focused
 * records, long messages, and explicitly complex/high-consequence questions
 * retain the stronger model. The caller uses the returned fallback for one
 * bounded retry, subject to the existing quota guard.
 *
 * @param {string} message
 * @param {Array<{ role: "user" | "assistant", content: string }>} history
 * @param {unknown} focusedRecord
 */
export function selectInnerMeChatRoute(message, history = [], focusedRecord = null) {
  const value = String(message ?? "").trim();
  const hasHistory = Array.isArray(history) && history.length > 0;
  const hasFocusedRecord = focusedRecord !== null && focusedRecord !== undefined;

  const reason = hasHistory
    ? "conversation_history"
    : hasFocusedRecord
    ? "focused_record"
    : value.length > 700
    ? "long_request"
    : INNERME_COMPLEX_CHAT_PATTERN.test(value)
    ? "complex_request"
    : "routine_request";

  if (reason !== "routine_request") {
    return {
      tier: "reasoning",
      reason,
      primaryModel: INNERME_CHAT_REASONING_MODEL,
      fallbackModel: INNERME_CHAT_ROUTINE_MODEL,
    };
  }

  return {
    tier: "routine",
    reason,
    primaryModel: INNERME_CHAT_ROUTINE_MODEL,
    fallbackModel: INNERME_CHAT_REASONING_MODEL,
  };
}


/**
 * Keep Cloudflare restricted to short, standalone, low-risk writing requests.
 * Conversation history, focused records, PII, and business-sensitive work must
 * stay on the normal guarded assistant route.
 *
 * @param {string} value
 * @param {Array<{ role: "user" | "assistant", content: string }>} history
 * @param {unknown} focusedRecord
 * @returns {boolean}
 */
export function isCloudflareEligibleWritingRequest(value, history, focusedRecord) {
  if (focusedRecord || history.length > 0 || value.length > 1200) return false;
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)) return false;
  if (/(?:\+?27|0)\s*\d(?:[\s()-]*\d){8,}/.test(value)) return false;
  if (/\b(?:R\s?\d|ZAR|invoice|payment|financial|lead|client|customer record|proposal|follow-up|strategy|analyse|analyze|forecast|calculate|roadmap|workspace|private|confidential)\b/i.test(value)) return false;
  return /\b(?:rewrite|rephrase|polish|proofread|fix the grammar|improve the wording|write a caption|caption for|social media caption|tagline|slogan|headline|short bio|product description|meta description|call to action|CTA)\b/i.test(value);
}
