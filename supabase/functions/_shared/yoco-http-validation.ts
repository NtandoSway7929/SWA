export function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function normalizeReconciliationLimit(value: unknown): number {
  const parsed = typeof value === "number" || typeof value === "string"
    ? Number(value)
    : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return 30;
  return Math.min(Math.max(Math.floor(parsed), 1), 100);
}
