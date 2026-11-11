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
import { buildYocoOperationalAlerts } from "../_shared/yoco-operations.ts";

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

    const [attemptsResult, casesResult, refundsResult, eventsResult, attentionAttemptsResult] = await Promise.all([
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
        .order("received_at", { ascending: true })
        .limit(limit),
      admin.from("payment_attempts")
        .select("id,invoice_id,client_id,amount_cents,currency,status,provider_checkout_id,payment_id,created_at,updated_at,expires_at")
        .eq("provider", "yoco")
        .eq("environment", "test")
        .in("status", ["created", "pending", "requires_review"])
        .order("created_at", { ascending: true })
        .limit(limit),
    ]);

    if (attemptsResult.error || casesResult.error || refundsResult.error || eventsResult.error || attentionAttemptsResult.error) {
      console.error("Payment reconciliation read failed:", attemptsResult.error?.message || casesResult.error?.message || refundsResult.error?.message || eventsResult.error?.message || attentionAttemptsResult.error?.message);
      return json({ ok: false, error: "Reconciliation data could not be loaded." }, 503);
    }

    const caseIds = (casesResult.data || []).map((item) => item.id);
    const [evidenceResult, actionsResult] = caseIds.length
      ? await Promise.all([
        admin.from("payment_reconciliation_evidence")
          .select("id,reconciliation_id,evidence_type,reference,note,created_by,created_at")
          .in("reconciliation_id", caseIds)
          .order("created_at", { ascending: true })
          .limit(500),
        admin.from("payment_reconciliation_actions")
          .select("id,reconciliation_id,action,previous_status,new_status,outcome,reason,related_payment_id,related_refund_id,actor_user_id,created_at")
          .in("reconciliation_id", caseIds)
          .order("created_at", { ascending: true })
          .limit(500),
      ])
      : [{ data: [], error: null }, { data: [], error: null }];

    if (evidenceResult.error || actionsResult.error) {
      console.error("Payment reconciliation history read failed:", evidenceResult.error?.message || actionsResult.error?.message);
      return json({ ok: false, error: "Reconciliation history could not be loaded." }, 503);
    }

    const now = Date.now();
    const operationalAlerts = buildYocoOperationalAlerts(
      attentionAttemptsResult.data || [],
      eventsResult.data || [],
      now,
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
      evidence: evidenceResult.data || [],
      case_actions: actionsResult.data || [],
      refunds: refundsResult.data || [],
      attempts_needing_attention: attentionAttemptsResult.data || [],
      webhook_events_needing_attention: eventsResult.data || [],
      actions_taken: [],
    });
  } catch (error) {
    console.error("Payment reconciliation request failed:", error instanceof Error ? error.message : "Unknown error.");
    return json({ ok: false, error: "Reconciliation is temporarily unavailable." }, 500);
  }
});
