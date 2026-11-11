import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import {
  getAdminClient,
  json,
  optionsResponse,
  readLimitedTextBody,
} from "../_shared/yoco.ts";
import {
  normalizeReconciliationLimit,
  parseJsonObject,
} from "../_shared/yoco-http-validation.ts";

function getPublishableKey() {
  const legacy = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    return typeof keys.default === "string" ? keys.default : null;
  } catch {
    return null;
  }
}

async function authorizeAdmin(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1] || "";
  const url = Deno.env.get("SUPABASE_URL");
  const publishableKey = getPublishableKey();
  if (!token || !url || !publishableKey) return false;

  const userClient = createClient(url, publishableKey, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData?.user) return false;

  const { data: isAdmin, error: adminError } = await userClient.rpc("is_swayphics_admin");
  return !adminError && isAdmin === true;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return optionsResponse();
  }
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  const origin = req.headers.get("origin");
  if (origin && origin !== "https://swayphics.co.za") return json({ ok: false, error: "Origin not allowed." }, 403);

  try {
    if (!await authorizeAdmin(req)) return json({ ok: false, error: "Administrator access required." }, 403);

    const limitedBody = await readLimitedTextBody(req, 8_192);
    if (!limitedBody.ok) {
      return json({
        ok: false,
        error: limitedBody.reason === "too_large" ? "Request is too large." : "Request must be valid UTF-8.",
      }, limitedBody.reason === "too_large" ? 413 : 400);
    }
    const body = limitedBody.body ? parseJsonObject(limitedBody.body) : {};
    if (!body) return json({ ok: false, error: "A JSON object is required." }, 400);
    const limit = normalizeReconciliationLimit(body.limit);
    const admin = getAdminClient();

    const [attemptsResult, casesResult, refundsResult, eventsResult] = await Promise.all([
      admin.from("payment_attempts")
        .select("id,invoice_id,client_id,amount_cents,currency,status,provider_checkout_id,payment_id,created_at,updated_at,expires_at")
        .eq("provider", "yoco")
        .eq("environment", "test")
        .order("created_at", { ascending: false })
        .limit(limit),
      admin.from("payment_reconciliation")
        .select("id,payment_attempt_id,payment_id,refund_id,discrepancy_type,status,summary,resolution,created_at,updated_at")
        .eq("provider", "yoco")
        .eq("environment", "test")
        .in("status", ["open", "investigating"])
        .order("created_at", { ascending: false })
        .limit(limit),
      admin.from("payment_refunds")
        .select("id,payment_id,provider_refund_id,amount,currency,status,created_at,processed_at")
        .eq("provider", "yoco")
        .eq("environment", "test")
        .order("created_at", { ascending: false })
        .limit(limit),
      admin.from("payment_webhook_events")
        .select("id,provider_event_id,event_type,payment_attempt_id,processing_status,failure_code,received_at,processed_at")
        .eq("provider", "yoco")
        .eq("environment", "test")
        .in("processing_status", ["received", "processing", "failed_retryable", "requires_review"])
        .order("received_at", { ascending: false })
        .limit(limit),
    ]);

    if (attemptsResult.error || casesResult.error || refundsResult.error || eventsResult.error) {
      console.error("Payment reconciliation read failed:", attemptsResult.error?.message || casesResult.error?.message || refundsResult.error?.message || eventsResult.error?.message);
      return json({ ok: false, error: "Reconciliation data could not be loaded." }, 503);
    }

    const now = Date.now();
    const staleAttemptMs = 15 * 60 * 1000;
    const staleWebhookMs = 5 * 60 * 1000;
    const operationalAlerts: Array<Record<string, unknown>> = [];

    for (const attempt of attemptsResult.data || []) {
      const ageMs = now - Date.parse(attempt.created_at);
      if (attempt.status === "requires_review") {
        operationalAlerts.push({
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
        operationalAlerts.push({
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
        operationalAlerts.push({
          source: "payment_attempt",
          id: attempt.id,
          severity: "medium",
          code: "checkout_expired_unresolved",
          created_at: attempt.created_at,
          message: "Checkout expiry has passed but the attempt remains pending. Verify provider state before changing its status.",
        });
      }
    }

    for (const event of eventsResult.data || []) {
      const ageMs = now - Date.parse(event.received_at);
      const stale = ["received", "processing"].includes(event.processing_status) &&
        Number.isFinite(ageMs) && ageMs >= staleWebhookMs;
      if (event.processing_status === "requires_review" || event.processing_status === "failed_retryable" || stale) {
        operationalAlerts.push({
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

    operationalAlerts.sort((a, b) =>
      (a.severity === "high" ? 0 : 1) - (b.severity === "high" ? 0 : 1)
    );

    return json({
      ok: true,
      mode: "read_only_manual_reconciliation",
      environment: "test",
      generated_at: new Date(now).toISOString(),
      monitoring_thresholds: {
        checkout_attachment_warning_minutes: 15,
        webhook_processing_warning_minutes: 5,
      },
      operational_summary: {
        alert_count: operationalAlerts.length,
        high_severity_count: operationalAlerts.filter((alert) => alert.severity === "high").length,
        medium_severity_count: operationalAlerts.filter((alert) => alert.severity === "medium").length,
        monitoring_scope: "latest queried records only",
      },
      operational_alerts: operationalAlerts,
      attempts: attemptsResult.data || [],
      open_cases: casesResult.data || [],
      refunds: refundsResult.data || [],
      webhook_events_needing_attention: eventsResult.data || [],
      actions_taken: [],
    });
  } catch (error) {
    console.error("Payment reconciliation request failed:", error instanceof Error ? error.message : "Unknown error.");
    return json({ ok: false, error: "Reconciliation is temporarily unavailable." }, 500);
  }
});
