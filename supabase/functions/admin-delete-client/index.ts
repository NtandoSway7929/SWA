import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const ALLOWED_ORIGIN = "https://swayphics.co.za";
const PROOF_BUCKET = "swayphics-payment-proofs";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
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

function createUserClient(token: string) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY") ||
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ||
    (() => { try { return JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}").default || ""; } catch { return ""; } })();
  if (!url || !key) throw new Error("Server configuration is unavailable.");
  return createClient(url, key, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validProofPath(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/proof\.(pdf|jpg|png|webp)$/i.test(value);
}

async function processPendingProofCleanup(admin: any) {
  const { data: rows, error: queryError, count } = await admin
    .from("client_deletion_storage_cleanup")
    .select("id,bucket_id,object_path,attempts", { count: "exact" })
    .order("created_at", { ascending: true })
    .limit(200);

  if (queryError) {
    throw new Error("Pending proof-file cleanup could not be loaded.");
  }

  let removed = 0;
  let pending = 0;

  const grouped = new Map<string, any[]>();
  for (const row of rows || []) {
    if (row.bucket_id !== PROOF_BUCKET || !validProofPath(row.object_path)) {
      await admin.from("client_deletion_storage_cleanup")
        .update({
          attempts: Number(row.attempts || 0) + 1,
          last_error: "Unsupported bucket or invalid proof object path.",
        }).eq("id", row.id);
      pending += 1;
      continue;
    }
    if (!grouped.has(row.bucket_id)) grouped.set(row.bucket_id, []);
    grouped.get(row.bucket_id)!.push(row);
  }

  for (const [bucket, items] of grouped.entries()) {
    const paths = items.map((item) => item.object_path);
    const ids = items.map((item) => item.id);
    const { error: storageError } = await admin.storage.from(bucket).remove(paths);

    if (storageError) {
      await Promise.all(items.map((item) =>
        admin.from("client_deletion_storage_cleanup")
          .update({
            attempts: Number(item.attempts || 0) + 1,
            last_error: String(storageError.message || "Storage removal failed.").slice(0, 500),
          }).eq("id", item.id)
      ));
      pending += items.length;
      continue;
    }

    const { error: queueError } = await admin
      .from("client_deletion_storage_cleanup")
      .delete()
      .in("id", ids);

    if (queueError) {
      await Promise.all(items.map((item) =>
        admin.from("client_deletion_storage_cleanup")
          .update({
            attempts: Number(item.attempts || 0) + 1,
            last_error: "Proof files were removed, but cleanup queue acknowledgement failed.",
          }).eq("id", item.id)
      ));
      pending += items.length;
      continue;
    }

    removed += items.length;
  }

  return {
    removed,
    pending: Math.max(pending, Number(count ?? (rows || []).length) - removed),
    checked: (rows || []).length,
    error: false,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.headers.get("origin") && req.headers.get("origin") !== ALLOWED_ORIGIN) {
    return json({ ok: false, error: "Origin not allowed." }, 403);
  }
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);

  try {
    const authorization = req.headers.get("authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ ok: false, error: "Administrator sign-in is required." }, 401);

    const userClient = createUserClient(token);
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData?.user?.id) {
      return json({ ok: false, error: "Your administrator session has expired. Sign in again." }, 401);
    }

    const { data: allowed, error: permissionError } = await userClient.rpc("is_swayphics_admin");
    if (permissionError) {
      return json({ ok: false, error: "Administrator access could not be verified." }, 503);
    }
    if (allowed !== true) return json({ ok: false, error: "Administrator access required." }, 403);

    let body: { action?: string; client_id?: string } = {};
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "A valid request body is required." }, 400);
    }

    let deleted: any = null;

    if (body.action !== "cleanup_pending") {
      if (!validUuid(body.client_id)) {
        return json({ ok: false, error: "A valid client ID is required." }, 400);
      }

      const { data, error } = await userClient.rpc(
        "admin_delete_client_with_financial_records",
        { p_client_id: body.client_id },
      );
      if (error) {
        console.error("Permanent client deletion RPC failed.", {
          code: error.code || "unknown",
        });
        return json({
          ok: false,
          error: "The client and linked financial records could not be deleted. No partial database deletion was committed.",
        }, 409);
      }
      deleted = data;
    }

    let storageCleanup = { removed: 0, pending: 0, checked: 0, error: false };
    try {
      storageCleanup = await processPendingProofCleanup(createServiceClient());
    } catch (cleanupError) {
      console.error("Client deletion proof-file cleanup is pending.", cleanupError);
      if (!deleted && body.action === "cleanup_pending") {
        throw cleanupError;
      }
      storageCleanup = {
        removed: 0,
        pending: Number(deleted?.payment_proof_files_queued_for_deletion || 0),
        checked: 0,
        error: true,
      };
    }
    return json({ ok: true, deleted, storage_cleanup: storageCleanup });
  } catch (error) {
    console.error("Client deletion or proof cleanup failed.", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Client deletion could not be completed.",
    }, 500);
  }
});
