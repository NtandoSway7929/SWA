import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import {
  getAdminClient,
  json,
} from "../_shared/yoco.ts";

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
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "https://swayphics.co.za",
        "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Vary": "Origin",
      },
    });
  }
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  const origin = req.headers.get("origin");
  if (origin && origin !== "https://swayphics.co.za") return json({ ok: false, error: "Origin not allowed." }, 403);

  try {
    if (!await authorizeAdmin(req)) return json({ ok: false, error: "Administrator access required." }, 403);

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body?.limit) || 30, 1), 100);
    const admin = getAdminClient();

    const [attemptsResult, casesResult, refundsResult] = await Promise.all([
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
    ]);

    if (attemptsResult.error || casesResult.error || refundsResult.error) {
      console.error("Payment reconciliation read failed:", attemptsResult.error?.message || casesResult.error?.message || refundsResult.error?.message);
      return json({ ok: false, error: "Reconciliation data could not be loaded." }, 503);
    }

    return json({
      ok: true,
      mode: "read_only_manual_reconciliation",
      environment: "test",
      attempts: attemptsResult.data || [],
      open_cases: casesResult.data || [],
      refunds: refundsResult.data || [],
      actions_taken: [],
    });
  } catch (error) {
    console.error("Payment reconciliation request failed:", error instanceof Error ? error.message : "Unknown error.");
    return json({ ok: false, error: "Reconciliation is temporarily unavailable." }, 500);
  }
});
