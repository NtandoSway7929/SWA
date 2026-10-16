/**
 * Extract a bearer token from an HTTP Authorization header.
 * Returns an empty string when the header does not use the Bearer scheme.
 * @param {string | null | undefined} authorization
 * @returns {string}
 */
export function extractBearerToken(authorization) {
  if (typeof authorization !== "string") return "";
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}
