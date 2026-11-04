import { createClient } from "npm:@supabase/supabase-js@2";
import {
  MUNICIPAL_MONEY_CAPABILITY,
  MunicipalMoneyError,
  fetchMunicipalMoneyFacts,
} from "./municipal-money.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_API_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ||
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ||
  "";

const ALLOWED_ORIGINS = new Set([
  "https://swayphics.co.za",
  "https://www.swayphics.co.za",
]);

function corsHeaders(origin = "") {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };

  if (ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function json(data: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

async function authenticateAdmin(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  const accessToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";

  if (!accessToken) {
    throw new MunicipalMoneyError("authentication_required", "Authentication is required.", 401);
  }

  if (!SUPABASE_URL || !SUPABASE_API_KEY) {
    throw new MunicipalMoneyError(
      "authentication_unavailable",
      "Integration authentication is temporarily unavailable.",
      503,
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_API_KEY, {
    global: {
      headers: {
        Authorization: "Bearer " + accessToken,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  const { data: userData, error: userError } =
    await supabase.auth.getUser(accessToken);

  if (userError || !userData?.user) {
    throw new MunicipalMoneyError("invalid_session", "A valid authenticated session is required.", 401);
  }

  const { data: isAdmin, error: adminError } =
    await supabase.rpc("is_swayphics_admin");

  if (adminError || isAdmin !== true) {
    throw new MunicipalMoneyError("admin_required", "Active Swayphics admin access is required.", 403);
  }

  return userData.user.id;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";

  if (req.method === "OPTIONS") {
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return json({ error: "Origin is not allowed." }, 403, origin);
    }
    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405, origin);
  }

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json({ error: "Origin is not allowed." }, 403, origin);
  }

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 4096) {
    return json({ error: "Request body is too large." }, 413, origin);
  }

  const startedAt = Date.now();

  try {
    const userId = await authenticateAdmin(req);
    const rawBody = await req.text();

    if (new TextEncoder().encode(rawBody).byteLength > 4096) {
      return json({ error: "Request body is too large." }, 413, origin);
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return json({ error: "Invalid JSON body." }, 400, origin);
    }

    if (!isPlainObject(body)) {
      return json({ error: "Request body must be a JSON object." }, 400, origin);
    }

    const allowedBodyKeys = new Set(["capability", "parameters"]);
    if (Object.keys(body).some((key) => !allowedBodyKeys.has(key))) {
      return json({ error: "Request contains unsupported fields." }, 400, origin);
    }

    if (body.capability !== MUNICIPAL_MONEY_CAPABILITY) {
      return json({ error: "Unknown integration capability." }, 404, origin);
    }

    const result = await fetchMunicipalMoneyFacts(body.parameters);

    console.info("InnerMe integration invocation completed.", {
      capability: MUNICIPAL_MONEY_CAPABILITY,
      provider: result.provider,
      user_id: userId,
      outcome: "success",
      latency_ms: Date.now() - startedAt,
      record_count: result.records.length,
    });

    return json({ ok: true, result }, 200, origin);
  } catch (error) {
    const knownError = error instanceof MunicipalMoneyError;
    const status = knownError ? error.status : 500;
    const code = knownError ? error.code : "integration_internal_error";
    const message = knownError
      ? error.message
      : "The integration request could not be completed.";

    console.warn("InnerMe integration invocation failed.", {
      capability: MUNICIPAL_MONEY_CAPABILITY,
      outcome: "failure",
      error_code: code,
      latency_ms: Date.now() - startedAt,
    });

    return json({
      ok: false,
      error: {
        code,
        message,
      },
    }, status, origin);
  }
});
