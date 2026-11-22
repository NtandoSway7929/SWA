import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const MAX_CLOCK_SKEW_SECONDS = 300;

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function verifySignature(rawBody: string, req: Request, secret: string) {
  const id = req.headers.get("svix-id") || "";
  const timestamp = req.headers.get("svix-timestamp") || "";
  const signatures = req.headers.get("svix-signature") || "";
  if (!id || !/^\d+$/.test(timestamp) || !signatures) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) ||
    Math.abs(Date.now() / 1000 - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS) return false;

  const secretValue = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = decodeBase64(secretValue);
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signed = new TextEncoder().encode(id + "." + timestamp + "." + rawBody);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, signed));
  const expected = btoa(String.fromCharCode(...digest));

  return signatures.split(" ").some((part) => {
    const [version, signature] = part.split(",", 2);
    if (version !== "v1" || !signature) return false;
    try {
      return constantTimeEqual(decodeBase64(signature), decodeBase64(expected));
    } catch {
      return false;
    }
  });
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return response({ ok: false, error: "Method not allowed." }, 405);

  const secret = Deno.env.get("RESEND_WEBHOOK_SECRET");
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !url || !serviceKey) {
    console.error("Resend receipt webhook is missing required server configuration.");
    return response({ ok: false, error: "Webhook is not configured." }, 503);
  }

  const rawBody = await req.text();
  if (rawBody.length > 256_000) return response({ ok: false, error: "Webhook payload is too large." }, 413);
  if (!await verifySignature(rawBody, req, secret)) {
    return response({ ok: false, error: "Invalid webhook signature." }, 401);
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return response({ ok: false, error: "Invalid webhook JSON." }, 400);
  }

  const eventId = req.headers.get("svix-id") || "";
  const eventType = String(event?.type || "");
  const data = isRecord(event?.data) ? event.data : null;
  if (!data || !eventId || !eventType) return response({ ok: false, error: "Webhook event is incomplete." }, 400);

  const stateByType: Record<string, string> = {
    "email.delivered": "delivered",
    "email.delivery_delayed": "delayed",
    "email.bounced": "bounced",
    "email.complained": "complained",
  };
  const deliveryStatus = stateByType[eventType];
  if (!deliveryStatus) return response({ ok: true, ignored: true });

  const providerMessageId = String(data.email_id || "");
  const tagReceiptId = isRecord(data.tags) ? String(data.tags.receipt_id || "") : "";
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (tagReceiptId && !uuidPattern.test(tagReceiptId)) {
    return response({ ok: false, error: "Receipt correlation tag is invalid." }, 400);
  }
  if (!providerMessageId && !tagReceiptId) return response({ ok: true, ignored: true });

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  let receiptId = tagReceiptId;
  if (!receiptId && providerMessageId) {
    const { data: existing, error } = await admin.from("payment_receipt_deliveries")
      .select("receipt_id").eq("provider_message_id", providerMessageId).maybeSingle();
    if (error) return response({ ok: false, error: "Receipt correlation lookup failed." }, 503);
    receiptId = existing?.receipt_id || "";
  }
  if (!receiptId) return response({ ok: true, ignored: true });

  const { data: current, error: currentError } = await admin.from("payment_receipt_deliveries")
    .select("receipt_id,provider_delivery_status,provider_event_at")
    .eq("receipt_id", receiptId).maybeSingle();
  if (currentError) return response({ ok: false, error: "Receipt delivery lookup failed." }, 503);
  if (!current) return response({ ok: false, error: "Receipt delivery record is not ready yet." }, 503);

  const eventAt = typeof event.created_at === "string" && !Number.isNaN(Date.parse(event.created_at))
    ? new Date(event.created_at).toISOString()
    : new Date().toISOString();
  const previousAt = current.provider_event_at ? Date.parse(current.provider_event_at) : 0;
  const isNewer = Date.parse(eventAt) >= previousAt;
  const isTerminal = ["delivered", "bounced", "complained"].includes(current.provider_delivery_status);
  const canApply = isNewer && !(deliveryStatus === "delayed" && isTerminal);

  if (canApply) {
    const update: Record<string, unknown> = {
      provider_delivery_status: deliveryStatus,
      provider_event_at: eventAt,
      updated_at: new Date().toISOString(),
    };
    if (deliveryStatus === "delivered") update.provider_delivered_at = eventAt;
    const { error } = await admin.from("payment_receipt_deliveries")
      .update(update).eq("receipt_id", receiptId);
    if (error) return response({ ok: false, error: "Receipt delivery status could not be updated." }, 503);
  }

  const { error: eventError } = await admin.from("payment_receipt_provider_events").upsert({
    event_id: eventId,
    receipt_id: receiptId,
    event_type: eventType,
    provider_message_id: providerMessageId || null,
    event_created_at: eventAt,
  }, { onConflict: "event_id", ignoreDuplicates: true });
  if (eventError) return response({ ok: false, error: "Webhook event could not be recorded." }, 503);

  return response({ ok: true, updated: canApply });
});
