import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors });
}

function readKeyMap(name: string) {
  const raw = Deno.env.get(name) || "";
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return response({ error: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const publishableKeys = readKeyMap("SUPABASE_PUBLISHABLE_KEYS");
    const publishableKey =
      String(publishableKeys.default || Deno.env.get("SUPABASE_ANON_KEY") || "");
    const secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const adminHeaders = {
      apikey: secretKey,
      Authorization: "Bearer " + secretKey,
    };

    if (!supabaseUrl || !publishableKey || !secretKey) {
      return response({ error: "Supabase function keys are not configured." }, 503);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return response({ error: "Unauthorized." }, 401);

    const userResponse = await fetch(supabaseUrl + "/auth/v1/user", {
      headers: {
        apikey: publishableKey,
        Authorization: "Bearer " + token,
      },
    });

    if (!userResponse.ok) return response({ error: "Your session is no longer valid." }, 401);
    const user = await userResponse.json();

    const adminResponse = await fetch(
      supabaseUrl +
        "/rest/v1/admin_users?select=user_id&user_id=eq." +
        encodeURIComponent(String(user.id)) +
        "&active=eq.true&limit=1",
      { headers: adminHeaders },
    );

    if (!adminResponse.ok) {
      return response({ error: "Admin authorization could not be verified." }, 403);
    }

    const adminRows = await adminResponse.json();
    if (!Array.isArray(adminRows) || !adminRows.length) {
      return response({ error: "You are not an active Swayphics admin." }, 403);
    }

    const rowsResponse = await fetch(
      supabaseUrl +
        "/rest/v1/innerme_knowledge?select=id,embedding_text&status=eq.active&embedding_status=in.(pending,error)",
      { headers: { apikey: secretKey } },
    );

    if (!rowsResponse.ok) {
      return response({
        error: "InnerMe could not load the pending knowledge records.",
        detail: (await rowsResponse.text()).slice(0, 500),
      }, 502);
    }

    const rows = await rowsResponse.json();
    if (!Array.isArray(rows)) {
      return response({ error: "Invalid knowledge index response." }, 502);
    }

    const model = new Supabase.ai.Session("gte-small");
    const results = [];

    for (const row of rows) {
      const text = String(row?.embedding_text || "").trim();
      if (!row?.id || !text) continue;

      try {
        const embedding = await model.run(text, {
          mean_pool: true,
          normalize: true,
        });

        const update = await fetch(
          supabaseUrl +
            "/rest/v1/innerme_knowledge?id=eq." +
            encodeURIComponent(String(row.id)),
          {
            method: "PATCH",
            headers: {
              ...adminHeaders,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify({
              embedding: Array.from(embedding),
              embedding_model: "gte-small",
              embedding_version: 1,
              embedding_status: "ready",
              embedding_error: null,
              embedded_at: new Date().toISOString(),
            }),
          },
        );

        if (!update.ok) {
          throw new Error("Knowledge update failed: " + (await update.text()).slice(0, 500));
        }

        results.push({ id: row.id, status: "ready" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        await fetch(
          supabaseUrl +
            "/rest/v1/innerme_knowledge?id=eq." +
            encodeURIComponent(String(row.id)),
          {
            method: "PATCH",
            headers: {
              apikey: secretKey,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify({
              embedding_status: "error",
              embedding_error: message.slice(0, 1000),
            }),
          },
        );

        results.push({
          id: row.id,
          status: "error",
          error: message.slice(0, 500),
        });
      }
    }

    const ready = results.filter(item => item.status === "ready").length;
    const errors = results.filter(item => item.status === "error").length;

    return response({
      ok: errors === 0,
      count: results.length,
      ready,
      errors,
      results,
    }, errors ? 207 : 200);
  } catch (error) {
    return response({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});