import { createClient } from "npm:@supabase/supabase-js@2.119.0";

export const ALLOWED_ORIGIN = "https://swayphics.co.za";
export const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, idempotency-key, webhook-id, webhook-timestamp, webhook-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export function optionsResponse() {
  return new Response("ok", { headers: corsHeaders });
}

export function checkOrigin(req: Request) {
  const origin = req.headers.get("origin");
  return !origin || origin === ALLOWED_ORIGIN;
}

export function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Server configuration is unavailable.");
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function resolvePortalToken(admin: any, rawToken: string) {
  if (rawToken.length < 32 || rawToken.length > 512) return null;
  const tokenHash = await sha256Hex(rawToken);
  const { data, error } = await admin
    .from("client_portal_tokens")
    .select("id,client_id,active,expires_at")
    .eq("token_hash", tokenHash)
    .eq("active", true)
    .maybeSingle();

  if (error || !data) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    return null;
  }

  await admin.from("client_portal_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);
  return data;
}

export function safeError(error: unknown) {
  // Never return provider response bodies, secrets, SQL errors, or stack traces.
  return error instanceof Error ? error.message : "The payment service is temporarily unavailable.";
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const SIGNATURE_TOLERANCE_SECONDS = 180;

function decodeYocoBase64(value: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function constantTimeBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function verifyYocoWebhookSignature(
  req: Request,
  rawBody: string,
  nowMs = Date.now(),
): Promise<boolean> {
  const webhookId = req.headers.get("webhook-id") || "";
  const timestamp = req.headers.get("webhook-timestamp") || "";
  const signatureHeader = req.headers.get("webhook-signature") || "";
  const secret = Deno.env.get("YOCO_WEBHOOK_SECRET") || "";

  if (!webhookId || !/^\\d+$/.test(timestamp) || !signatureHeader ||
      !secret.startsWith("whsec_")) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) ||
      Math.abs(nowMs / 1000 - timestampSeconds) > SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }

  const keyBytes = decodeYocoBase64(secret.slice("whsec_".length));
  if (!keyBytes) return false;

  const signedContent = webhookId + "." + timestamp + "." + rawBody;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(signedContent),
  ));

  const candidates = Array.from(
    signatureHeader.matchAll(/(?:^|\\s)v1,([A-Za-z0-9+/=]+)/g),
    (match) => match[1],
  );
  return candidates.some((candidate) => {
    const decoded = decodeYocoBase64(candidate);
    return !!decoded && constantTimeBytesEqual(expected, decoded);
  });
}
