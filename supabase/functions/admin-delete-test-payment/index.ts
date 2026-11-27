import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const ORIGIN = "https://swayphics.co.za";
const corsHeaders = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function createUserClient(token: string) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!url || !key) throw new Error("Server configuration is unavailable.");
  return createClient(url, key, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function createServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Server configuration is unavailable.");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function authorize(token: string) {
  const userClient = createUserClient(token);
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data?.user?.id) {
    return { ok: false as const, status: 401, error: "Administrator session expired. Sign in again." };
  }
  const { data: owner, error: ownerError } = await userClient.rpc("is_swayphics_owner");
  if (ownerError) {
    return { ok: false as const, status: 503, error: "Owner access could not be verified." };
  }
  if (owner !== true) {
    return { ok: false as const, status: 403, error: "Only the Swayphics owner can manage test-payment deletion." };
  }
  return { ok: true as const, userClient };
}

async function processCleanup(admin: ReturnType<typeof createServiceClient>, ids?: string[]) {
  let query = admin.from("payment_test_deletion_storage_cleanup")
    .select("id,bucket_id,object_path,attempt_count")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(100);
  if (ids?.length) query = query.in("id", ids);

  const { data: rows, error } = await query;
  if (error) throw new Error("Pending receipt-file cleanup records could not be loaded.");

  let completed = 0;
  let pending = 0;
  for (const row of rows || []) {
    const { error: removeError } = await admin.storage
      .from(String(row.bucket_id))
      .remove([String(row.object_path)]);

    if (removeError) {
      pending += 1;
      await admin.from("payment_test_deletion_storage_cleanup")
        .update({
          attempt_count: Number(row.attempt_count || 0) + 1,
          last_error: "Storage removal failed; retry is available.",
        })
        .eq("id", row.id);
      continue;
    }

    const { error: updateError } = await admin.from("payment_test_deletion_storage_cleanup")
      .update({
        status: "completed",
        attempt_count: Number(row.attempt_count || 0) + 1,
        last_error: null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (updateError) {
      pending += 1;
      continue;
    }
    completed += 1;
  }
  return { completed, pending };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  const origin = req.headers.get("origin");
  if (origin && origin !== ORIGIN) return json({ ok: false, error: "Origin not allowed." }, 403);

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\\s+/i, "").trim();
  if (!token) return json({ ok: false, error: "Owner session required." }, 401);

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ ok: false, error: "Invalid request body." }, 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid request body." }, 400);
  }

  const auth = await authorize(token);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const admin = createServiceClient();

  if (body.action === "retry_cleanup") {
    try {
      const cleanup = await processCleanup(admin);
      return json({ ok: true, action: "retry_cleanup", storage_cleanup: cleanup });
    } catch (error) {
      return json({
        ok: false,
        error: error instanceof Error ? error.message : "Receipt-file cleanup could not be retried.",
      }, 503);
    }
  }

  if (body.action !== "delete" || !validUuid(body.payment_id) ||
      typeof body.confirmation !== "string" || body.confirmation.length > 100) {
    return json({ ok: false, error: "A valid test payment and exact confirmation are required." }, 400);
  }

  const { data: result, error } = await auth.userClient.rpc("admin_permanently_delete_test_payment", {
    p_payment_id: body.payment_id,
    p_confirmation: body.confirmation,
  });
  if (error || !result || result.deleted !== true) {
    return json({
      ok: false,
      error: error?.message || "The database did not confirm test-payment deletion.",
    }, error?.code === "42501" ? 403 : 409);
  }

  try {
    const ids = Array.isArray(result.storage_cleanup_ids)
      ? result.storage_cleanup_ids.filter(validUuid)
      : [];
    const cleanup = await processCleanup(admin, ids);
    return json({
      ok: true,
      deleted: true,
      payment_id: body.payment_id,
      receipts_deleted: Number(result.receipts_deleted || 0),
      storage_cleanup: cleanup,
      cleanup_pending: cleanup.pending > 0,
    });
  } catch {
    return json({
      ok: true,
      deleted: true,
      payment_id: body.payment_id,
      receipts_deleted: Number(result.receipts_deleted || 0),
      storage_cleanup: { completed: 0, pending: Array.isArray(result.storage_cleanup_ids) ? result.storage_cleanup_ids.length : 0 },
      cleanup_pending: true,
    });
  }
});
