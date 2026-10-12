/** Fixed Cloudflare Workers AI model selected for the zero-cost copywriting route. */
export const CLOUDFLARE_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";

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
