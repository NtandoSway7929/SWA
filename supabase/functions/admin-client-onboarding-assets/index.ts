import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "https://swayphics.co.za",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin"
};
const BUCKET = "swayphics-client-files";
const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUBLIC_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.headers.get("origin") && req.headers.get("origin") !== "https://swayphics.co.za") return json({ ok: false, error: "Origin not allowed." }, 403);
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);

  try {
    const authorization = req.headers.get("authorization") || "";
    const jwt = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json({ ok: false, error: "Admin sign-in is required." }, 401);

    const authClient = createClient(URL, PUBLIC_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: "Bearer " + jwt } } });
    const { data: authData, error: authError } = await authClient.auth.getUser(jwt);
    if (authError || !authData.user) return json({ ok: false, error: "Your admin session has expired. Please sign in again." }, 401);

    const admin = createClient(URL, SERVICE_KEY);
    const { data: adminRecord, error: adminError } = await admin.from("admin_users")
      .select("user_id,active,role").eq("user_id", authData.user.id).eq("active", true).maybeSingle();
    if (adminError || !adminRecord) return json({ ok: false, error: "You do not have permission to view client assets." }, 403);

    let body: { client_id?: string; limit?: number } = {};
    try { body = await req.json(); } catch { body = {}; }
    const limit = Math.min(Math.max(Number(body.limit) || 150, 1), 300);
    let query = admin.from("client_onboarding_assets")
      .select("id,client_id,onboarding_id,file_path,original_name,mime_type,size_bytes,created_at")
      .order("created_at", { ascending: false }).limit(limit);
    if (body.client_id) query = query.eq("client_id", body.client_id);
    const { data: assets, error: assetError } = await query;
    if (assetError) throw new Error("Unable to retrieve client onboarding assets.");

    const clientIds = [...new Set((assets || []).map((asset: any) => asset.client_id))];
    const { data: clients, error: clientsError } = clientIds.length
      ? await admin.from("clients").select("id,business_name,contact_name,email").in("id", clientIds)
      : { data: [], error: null };
    if (clientsError) throw new Error("Unable to retrieve client details.");
    const clientMap = new Map((clients || []).map((client: any) => [client.id, client]));

    const files = await Promise.all((assets || []).map(async (asset: any) => {
      const [preview, download] = await Promise.all([
        admin.storage.from(BUCKET).createSignedUrl(asset.file_path, 600),
        admin.storage.from(BUCKET).createSignedUrl(asset.file_path, 600, { download: asset.original_name })
      ]);
      return {
        id: asset.id,
        client_id: asset.client_id,
        client: clientMap.get(asset.client_id) || null,
        original_name: asset.original_name,
        mime_type: asset.mime_type,
        size_bytes: asset.size_bytes,
        created_at: asset.created_at,
        preview_url: preview.error ? null : preview.data.signedUrl,
        download_url: download.error ? null : download.data.signedUrl
      };
    }));

    return json({ ok: true, files, count: files.length, admin_role: adminRecord.role });
  } catch (error) {
    console.error("Admin onboarding asset retrieval failed.", error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Unable to load client assets." }, 500);
  }
});
