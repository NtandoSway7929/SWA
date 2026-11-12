import { createClient } from "npm:@supabase/supabase-js@2.119.0";

export const ALLOWED_ORIGIN = "https://swayphics.co.za";
export const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, apikey, x-client-info, content-type, idempotency-key, webhook-id, webhook-timestamp, webhook-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

export async function readLimitedTextBody(req: Request, maxBytes: number) {
  const declaredLength = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false as const, reason: "too_large" as const };
  }
  const reader = req.body?.getReader();
  if (!reader) return { ok: true as const, body: "" };
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false as const, reason: "too_large" as const };
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return {
      ok: true as const,
      body: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  } catch {
    return { ok: false as const, reason: "invalid_utf8" as const };
  }
}

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
  return error instanceof Error
    ? error.message
    : "The payment service is temporarily unavailable.";
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}
