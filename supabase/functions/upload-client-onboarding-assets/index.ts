import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "https://swayphics.co.za",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin"
};
const BUCKET = "swayphics-client-files";
const MAX_FILES = 20;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_BATCH_BYTES = 100 * 1024 * 1024;
const ALLOWED = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml",
  "application/pdf", "application/zip", "application/x-zip-compressed",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword"
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 120) || "file";
}
async function tokenClient(token: string) {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Use the same database-side token validation as the client portal itself.
  // This keeps uploads aligned with get_client_portal and avoids maintaining
  // a second, subtly different token-verification implementation here.
  const { data, error } = await admin.rpc("get_client_portal", { p_token: token });
  const clientId = data?.ok === true ? data.client?.id : null;
  if (error || !clientId) return null;

  return { admin, clientId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.headers.get("origin") && req.headers.get("origin") !== "https://swayphics.co.za") return json({ ok: false, error: "Origin not allowed." }, 403);
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);

  const uploadedPaths: string[] = [];
  try {
    const form = await req.formData();
    const token = String(form.get("token") || "").trim();
    if (!token) return json({ ok: false, error: "Portal token required." }, 400);
    const auth = await tokenClient(token);
    if (!auth) return json({ ok: false, error: "Invalid or expired portal link." }, 403);

    const files = form.getAll("files").filter((value): value is File => value instanceof File);
    if (!files.length) return json({ ok: false, error: "No files selected." }, 400);
    if (files.length > MAX_FILES) return json({ ok: false, error: "You can upload up to 20 files at a time." }, 400);
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (total > MAX_BATCH_BYTES) return json({ ok: false, error: "The selected files exceed the 100 MB batch limit." }, 400);

    for (const file of files) {
      const type = file.type || "application/octet-stream";
      if (!file.size) return json({ ok: false, error: file.name + " is empty." }, 400);
      if (file.size > MAX_FILE_BYTES) return json({ ok: false, error: file.name + " is larger than 15 MB." }, 400);
      if (!ALLOWED.has(type)) return json({ ok: false, error: file.name + " is not a supported file type." }, 400);
    }

    const onboarding = await auth.admin.from("client_onboarding").select("id")
      .eq("client_id", auth.clientId).maybeSingle();
    if (onboarding.error) throw new Error("We could not prepare your onboarding record. Please try again.");

    const { data: client, error: clientError } = await auth.admin.from("clients")
      .select("business_name").eq("id", auth.clientId).single();
    if (clientError || !client) throw new Error("The client record could not be verified.");

    const uploaded = [];
    for (const file of files) {
      const path = auth.clientId + "/" + crypto.randomUUID() + "-" + safeName(file.name);
      const { error: storageError } = await auth.admin.storage.from(BUCKET).upload(path, file, {
        contentType: file.type || "application/octet-stream", cacheControl: "3600", upsert: false
      });
      if (storageError) throw new Error("Could not upload " + file.name + ". " + storageError.message);
      uploadedPaths.push(path);

      const { data: row, error: rowError } = await auth.admin.from("client_onboarding_assets").insert({
        client_id: auth.clientId,
        onboarding_id: onboarding.data?.id ?? null,
        file_path: path,
        original_name: file.name.slice(0, 255),
        mime_type: file.type || "application/octet-stream",
        size_bytes: file.size
      }).select("id,original_name,mime_type,size_bytes,created_at").single();
      if (rowError || !row) throw new Error("The upload could not be registered for " + file.name + ".");
      uploaded.push(row);
    }

    const batchId = crypto.randomUUID();
    const { data: admins } = await auth.admin.from("admin_users").select("user_id").eq("active", true);
    await Promise.all((admins || []).map((admin: { user_id: string }) =>
      auth.admin.rpc("create_admin_notification", {
        p_recipient_id: admin.user_id,
        p_actor_id: null,
        p_type: "info",
        p_event_type: "portal.assets_uploaded",
        p_title: "New client business assets",
        p_message: client.business_name + " uploaded " + uploaded.length + " onboarding asset" + (uploaded.length === 1 ? "" : "s") + ".",
        p_entity_type: "client",
        p_entity_id: auth.clientId,
        p_view: "clients",
        p_dedupe_key: "portal-assets:" + batchId + ":" + admin.user_id
      })
    ));

    return json({ ok: true, files: uploaded, received_count: uploaded.length });
  } catch (error) {
    if (uploadedPaths.length) {
      try {
        const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        await admin.storage.from(BUCKET).remove(uploadedPaths);
        await admin.from("client_onboarding_assets").delete().in("file_path", uploadedPaths);
      } catch (cleanupError) {
        console.error("Onboarding asset rollback failed.", cleanupError);
      }
    }
    console.error("Client onboarding asset upload failed.", error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Upload failed. Please try again." }, 500);
  }
});
