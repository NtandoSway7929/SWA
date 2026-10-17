import { createClient } from "npm:@supabase/supabase-js@2";
import {
  createProposalDemoShareHandler,
  PROPOSAL_DEMO_BUCKET,
} from "./handler.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PUBLIC_API_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  "";

const ALLOWED_ORIGINS = new Set([
  "https://swayphics.co.za",
  "https://www.swayphics.co.za",
]);

function corsHeaders(request) {
  const origin = request.headers.get("origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createShareToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

async function hashShareToken(token) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return bytesToHex(new Uint8Array(digest));
}

function failure(error) {
  if (error) throw new Error("The demo-sharing operation failed.");
}

async function authenticateAdmin(request) {
  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();
  const publicApiKey = request.headers.get("apikey") || PUBLIC_API_KEY;
  if (!accessToken) {
    return { ok: false, status: 401, message: "Authentication is required." };
  }
  if (!SUPABASE_URL || !publicApiKey) {
    throw new Error("Admin authentication is unavailable.");
  }

  const authClient = createClient(SUPABASE_URL, publicApiKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await authClient.auth.getUser(accessToken);
  if (error || !data.user) {
    return { ok: false, status: 401, message: "The admin session is no longer valid." };
  }
  const { data: isAdmin, error: adminError } = await authClient.rpc("is_swayphics_admin");
  if (adminError || isAdmin !== true) {
    return { ok: false, status: 403, message: "An active Swayphics admin is required." };
  }
  return { ok: true, userId: data.user.id };
}

function createHandler() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error("Demo-sharing server configuration is missing.");
  }

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return createProposalDemoShareHandler({
    authenticateAdmin,
    corsHeaders,
    publicFunctionUrl: `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/proposal-demo-share`,
    createToken: createShareToken,
    hashToken: hashShareToken,

    async findProposal(proposalId) {
      const { data, error } = await service
        .from("lead_proposals")
        .select("id,lead_id")
        .eq("id", proposalId)
        .maybeSingle();
      failure(error);
      return data;
    },

    async insertDraftVersion(input) {
      const { data, error } = await service
        .from("proposal_demo_versions")
        .insert(input)
        .select("id,lead_id,proposal_id,version_number,title,asset_kind,file_name,entry_path,status,created_by,created_at,published_at")
        .single();
      failure(error);
      return data;
    },

    async findVersion(versionId) {
      const { data, error } = await service
        .from("proposal_demo_versions")
        .select("id,lead_id,proposal_id,version_number,title,asset_kind,file_name,entry_path,status,created_by,created_at,published_at")
        .eq("id", versionId)
        .maybeSingle();
      failure(error);
      return data;
    },

    async privateObjectExists(path) {
      const separator = path.lastIndexOf("/");
      if (separator < 0) return false;
      const folder = path.slice(0, separator);
      const basename = path.slice(separator + 1);
      const { data, error } = await service.storage
        .from(PROPOSAL_DEMO_BUCKET)
        .list(folder, { limit: 100, search: basename });
      if (error) return false;
      return (data ?? []).some((item) => item.name === basename);
    },

    async publishDraftVersion(versionId) {
      const { data, error } = await service
        .from("proposal_demo_versions")
        .update({ status: "published" })
        .eq("id", versionId)
        .eq("status", "draft")
        .select("id,lead_id,proposal_id,version_number,title,asset_kind,file_name,entry_path,status,created_by,created_at,published_at")
        .maybeSingle();
      failure(error);
      return data;
    },

    async insertShare(input) {
      const { data, error } = await service
        .from("proposal_demo_shares")
        .insert(input)
        .select("id,demo_version_id,target_type,expires_at,created_at")
        .single();
      failure(error);
      return data;
    },

    async findShare(shareId) {
      const { data, error } = await service
        .from("proposal_demo_shares")
        .select("id,demo_version_id,target_type,token_hash,expires_at,revoked_at,revoked_by,created_at")
        .eq("id", shareId)
        .maybeSingle();
      failure(error);
      return data;
    },

    async revokeShare(shareId, revokedBy, revokedAt) {
      const { data, error } = await service
        .from("proposal_demo_shares")
        .update({ revoked_at: revokedAt, revoked_by: revokedBy })
        .eq("id", shareId)
        .is("revoked_at", null)
        .select("id,revoked_at")
        .maybeSingle();
      failure(error);
      return data;
    },

    async findShareByTokenHash(tokenHash) {
      const { data, error } = await service
        .from("proposal_demo_shares")
        .select("id,demo_version_id,target_type,expires_at,revoked_at")
        .eq("token_hash", tokenHash)
        .maybeSingle();
      failure(error);
      return data;
    },

    async createSignedFileUrl(bucket, path, expiresIn) {
      if (bucket !== PROPOSAL_DEMO_BUCKET) return null;
      const { data, error } = await service.storage
        .from(bucket)
        .createSignedUrl(path, expiresIn, { download: true });
      if (error || !data?.signedUrl) return null;
      return new URL(data.signedUrl, SUPABASE_URL).toString();
    },

    async downloadPrivateObject(bucket, path) {
      if (bucket !== PROPOSAL_DEMO_BUCKET) return null;
      const { data, error } = await service.storage.from(bucket).download(path);
      if (error || !data) return null;
      return { data };
    },
  });
}

let handler;
try {
  handler = createHandler();
} catch {
  handler = async () => Response.json(
    { error: "Demo-sharing is not configured." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

Deno.serve(handler);
