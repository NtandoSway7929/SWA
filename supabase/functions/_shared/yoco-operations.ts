export type YocoOperationalAlert = {
  source: "payment_attempt" | "webhook_event";
  id: string;
  severity: "high" | "medium";
  code: string;
  created_at?: string;
  received_at?: string;
  provider_event_id?: string;
  processing_status?: string;
  message: string;
};

export function buildYocoOperationalAlerts(
  attempts: Array<Record<string, any>>,
  events: Array<Record<string, any>>,
  now = Date.now(),
): YocoOperationalAlert[] {
  const alerts: YocoOperationalAlert[] = [];
  const staleAttemptMs = 15 * 60 * 1000;
  const staleWebhookMs = 5 * 60 * 1000;

  for (const attempt of attempts) {
    const ageMs = now - Date.parse(attempt.created_at || "");
    if (attempt.status === "requires_review") {
      alerts.push({
        source: "payment_attempt",
        id: attempt.id,
        severity: "high",
        code: "payment_attempt_requires_review",
        created_at: attempt.created_at,
        message: "Payment attempt requires administrator investigation.",
      });
    } else if (
      attempt.status === "created" &&
      !attempt.provider_checkout_id &&
      Number.isFinite(ageMs) &&
      ageMs >= staleAttemptMs
    ) {
      alerts.push({
        source: "payment_attempt",
        id: attempt.id,
        severity: "medium",
        code: "checkout_attachment_unconfirmed",
        created_at: attempt.created_at,
        message: "Attempt has no attached checkout after 15 minutes. Verify provider state before retrying; an orphaned checkout is not confirmed by this signal.",
      });
    } else if (
      attempt.status === "pending" &&
      attempt.expires_at &&
      Date.parse(attempt.expires_at) < now
    ) {
      alerts.push({
        source: "payment_attempt",
        id: attempt.id,
        severity: "medium",
        code: "checkout_expired_unresolved",
        created_at: attempt.created_at,
        message: "Checkout expiry has passed but the attempt remains pending. Verify provider state before changing its status.",
      });
    }
  }

  for (const event of events) {
    const ageMs = now - Date.parse(event.received_at || "");
    const stale = ["received", "processing"].includes(event.processing_status) &&
      Number.isFinite(ageMs) && ageMs >= staleWebhookMs;
    if (event.processing_status === "requires_review" || event.processing_status === "failed_retryable" || stale) {
      alerts.push({
        source: "webhook_event",
        id: event.id,
        provider_event_id: event.provider_event_id,
        severity: event.processing_status === "requires_review" ? "high" : "medium",
        code: event.failure_code || (stale ? "webhook_processing_stale" : "webhook_retry_required"),
        processing_status: event.processing_status,
        received_at: event.received_at,
        message: event.processing_status === "requires_review"
          ? "Verified provider event requires administrator investigation."
          : stale
          ? "Webhook event has remained unprocessed for at least five minutes."
          : "Webhook event is marked for retry; inspect the failure before replaying.",
      });
    }
  }

  return alerts.sort((a, b) =>
    (a.severity === "high" ? 0 : 1) - (b.severity === "high" ? 0 : 1)
  );
}
