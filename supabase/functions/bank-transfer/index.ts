// Manual bank transfer submission and review endpoint.
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const BUCKET = "swayphics-payment-proofs";
const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const ALLOWED_ORIGIN = "https://swayphics.co.za";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

type Deps = {
  createAdmin: () => any;
  createUserClient: (token: string) => any;
  resolvePortal: (admin: any, token: string) => Promise<any>;
  now: () => Date;
  logError: (...values: unknown[]) => void;
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

function safeFileName(value: unknown) {
  const raw = String(value || "proof-of-payment").replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._ -]+/g, "_").trim().slice(0, 150);
  return raw && raw !== "." && raw !== ".." ? raw : "proof-of-payment";
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}

export function parseBankTransferAmount(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isFinite(number) && number > 0
    ? Math.round(number * 100) / 100
    : null;
}

function validProofType(type: string) {
  return ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(
    type.toLowerCase(),
  );
}

function proofExtension(type: string) {
  return ({
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  } as Record<string, string>)[type.toLowerCase()] || "";
}

export function bankTransferProofMatchesMime(type: string, bytes: Uint8Array) {
  const mimeType = type.toLowerCase();
  if (mimeType === "application/pdf") {
    return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  }
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 &&
      bytes[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return bytes.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) =>
        bytes[index] === value
      );
  }
  if (mimeType === "image/webp") {
    return bytes.length >= 12 &&
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  }
  return false;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest)).map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function resolvePortalToken(admin: any, rawToken: string) {
  if (rawToken.length < 32 || rawToken.length > 512) return null;
  const tokenHash = await sha256Hex(rawToken);
  const { data, error } = await admin.from("client_portal_tokens")
    .select("id,client_id,active,expires_at")
    .eq("token_hash", tokenHash).eq("active", true).maybeSingle();
  if (error) {
    console.error("bank-transfer portal token lookup failed", {
      code: error.code || "unknown",
    });
    return null;
  }
  if (!data) {
    console.warn("bank-transfer portal token was not found or inactive");
    return null;
  }
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    console.warn("bank-transfer portal token was expired");
    return null;
  }
  await admin.from("client_portal_tokens").update({
    last_used_at: new Date().toISOString(),
  }).eq("id", data.id);
  return data;
}

function createServiceClient() {
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

function publishableKey() {
  const legacy = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacy) return legacy;
  try {
    const parsed = JSON.parse(
      Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}",
    );
    return typeof parsed.default === "string" ? parsed.default : "";
  } catch {
    return "";
  }
}

function createUserClient(token: string) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = publishableKey();
  if (!url || !key) throw new Error("Server configuration is unavailable.");
  return createClient(url, key, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

type AdminAuthorization =
  | { ok: true; reviewerId: string }
  | { ok: false; status: 401 | 403 | 503; message: string };

async function authorizeAdmin(
  req: Request,
  deps: Deps,
): Promise<AdminAuthorization> {
  const match = (req.headers.get("authorization") || "").match(
    /^Bearer\s+(.+)$/i,
  );
  const token = match?.[1] || "";
  if (!token) {
    return {
      ok: false,
      status: 401,
      message: "Administrator session required. Sign in again.",
    };
  }

  const userClient = deps.createUserClient(token);
  const { data: authData, error: authError } = await userClient.auth.getUser(
    token,
  );
  const userId = String(authData?.user?.id || "");
  if (authError || !userId) {
    return {
      ok: false,
      status: 401,
      message: "Administrator session expired or invalid. Sign in again.",
    };
  }

  const { data: allowed, error: adminError } = await userClient.rpc(
    "is_swayphics_admin",
  );
  if (adminError) {
    return {
      ok: false,
      status: 503,
      message: "Administrator access could not be verified. Please try again.",
    };
  }
  if (allowed !== true) {
    return {
      ok: false,
      status: 403,
      message: "Administrator access required.",
    };
  }

  return { ok: true, reviewerId: userId };
}

const defaults: Deps = {
  createAdmin: createServiceClient,
  createUserClient,
  resolvePortal: resolvePortalToken,
  now: () => new Date(),
  logError: (...values) => console.error(...values),
};

async function invoiceForClient(
  admin: any,
  invoiceId: string,
  clientId: string,
) {
  const { data, error } = await admin.from("invoices")
    .select(
      "id,invoice_number,issue_date,due_date,status,currency,total,amount_outstanding",
    )
    .eq("id", invoiceId).eq("client_id", clientId).maybeSingle();
  if (error || !data) return null;
  if (
    !["sent", "partially paid", "overdue"].includes(
      String(data.status || "").toLowerCase(),
    )
  ) return null;
  if (String(data.currency || "ZAR").toUpperCase() !== "ZAR") return null;
  return data;
}

async function clientDetails(admin: any, clientId: string, invoiceId: string) {
  if (!validUuid(invoiceId)) {
    return json({ ok: false, error: "A valid invoice is required." }, 400);
  }
  const [invoice, settingsResult, submissionsResult] = await Promise.all([
    invoiceForClient(admin, invoiceId, clientId),
    admin.from("invoice_settings").select(
      "bank_name,account_name,account_type,account_number,branch_code,swift_bic,payment_instructions",
    ).eq("id", 1).maybeSingle(),
    admin.from("bank_transfer_submissions").select(
      "id,invoice_id,amount,bank_reference,status,submitted_at,reviewed_at,rejection_reason,payment_id",
    ).eq("client_id", clientId).eq("invoice_id", invoiceId).order(
      "submitted_at",
      { ascending: false },
    ).limit(10),
  ]);
  if (!invoice) {
    return json({
      ok: false,
      error: "This invoice is not currently available for a bank transfer.",
    }, 404);
  }
  if (settingsResult.error || !settingsResult.data || submissionsResult.error) {
    return json({
      ok: false,
      error: "Bank transfer instructions are temporarily unavailable.",
    }, 503);
  }
  const bank = settingsResult.data;
  const hasRequired = Boolean(
    bank.bank_name && bank.account_name && bank.account_number &&
      bank.account_type && bank.branch_code,
  );
  if (!hasRequired) {
    return json({
      ok: false,
      error: "Swayphics bank transfer details have not been configured.",
    }, 503);
  }
  return json({
    ok: true,
    invoice: {
      id: invoice.id,
      invoice_number: invoice.invoice_number,
      issue_date: invoice.issue_date,
      due_date: invoice.due_date,
      status: invoice.status,
      currency: invoice.currency,
      total: invoice.total,
      amount_outstanding: invoice.amount_outstanding,
      payment_reference: invoice.invoice_number,
    },
    bank_details: {
      bank_name: bank.bank_name,
      account_name: bank.account_name,
      account_type: bank.account_type,
      account_number: bank.account_number,
      branch_code: bank.branch_code,
      swift_bic: bank.swift_bic || null,
      payment_instructions: bank.payment_instructions || null,
    },
    submissions: (submissionsResult.data || []).map((row: any) => ({
      id: row.id,
      amount: row.amount,
      bank_reference: row.bank_reference,
      status: row.status,
      submitted_at: row.submitted_at,
      reviewed_at: row.reviewed_at,
      rejection_reason: row.rejection_reason,
      payment_id: row.payment_id,
    })),
  });
}

async function readLimitedMultipart(req: Request) {
  const chunks: Uint8Array[] = [];
  const reader = req.body?.getReader();
  if (!reader) return { ok: false as const, reason: "empty" as const };
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_PROOF_BYTES + 32_768) {
        await reader.cancel();
        return { ok: false as const, reason: "too_large" as const };
      }
      chunks.push(part.value);
    }
  } catch {
    return { ok: false as const, reason: "invalid" as const };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(req.headers);
  headers.delete("content-length");
  try {
    const bounded = new Request(req.url, {
      method: "POST",
      headers,
      body: bytes,
    });
    return { ok: true as const, form: await bounded.formData() };
  } catch {
    return { ok: false as const, reason: "invalid" as const };
  }
}

async function submitProof(
  form: FormData,
  admin: any,
  clientId: string,
  now: Date,
) {
  const invoiceId = String(form.get("invoice_id") || "");
  const amount = parseBankTransferAmount(form.get("amount"));
  const reference = String(form.get("bank_reference") || "").trim();
  const proof = form.get("proof");
  if (
    !validUuid(invoiceId) || amount === null || reference.length < 1 ||
    reference.length > 120 || !(proof instanceof File)
  ) {
    return json({
      ok: false,
      error:
        "Enter a valid invoice, amount, bank transaction reference and proof file.",
    }, 400);
  }
  if (
    proof.size < 1 || proof.size > MAX_PROOF_BYTES ||
    !validProofType(proof.type)
  ) {
    return json({
      ok: false,
      error: "Upload a PDF, JPG, PNG or WEBP proof file no larger than 5 MB.",
    }, 400);
  }
  const invoice = await invoiceForClient(admin, invoiceId, clientId);
  if (!invoice) {
    return json({
      ok: false,
      error: "This invoice is not currently eligible for a bank transfer.",
    }, 409);
  }
  const outstanding = Math.max(0, Number(invoice.amount_outstanding || 0));
  if (amount > outstanding + 0.000001) {
    return json({
      ok: false,
      error:
        "The amount cannot exceed the current outstanding invoice balance.",
    }, 409);
  }
  const bytes = new Uint8Array(await proof.arrayBuffer());
  if (
    bytes.byteLength !== proof.size ||
    !bankTransferProofMatchesMime(proof.type, bytes)
  ) {
    return json({
      ok: false,
      error:
        "The uploaded file does not match its declared PDF or image format.",
    }, 400);
  }

  const submissionId = crypto.randomUUID();
  const fileName = safeFileName(proof.name);
  const extension = proofExtension(proof.type);
  const storagePath = clientId + "/" + submissionId + "/proof." + extension;
  const { error: uploadError } = await admin.storage.from(BUCKET).upload(
    storagePath,
    bytes,
    {
      contentType: proof.type,
      cacheControl: "3600",
      upsert: false,
    },
  );
  if (uploadError) {
    return json({
      ok: false,
      error: "The proof file could not be stored securely. Please try again.",
    }, 503);
  }

  const { error: insertError } = await admin.from("bank_transfer_submissions")
    .insert({
      id: submissionId,
      invoice_id: invoiceId,
      client_id: clientId,
      amount,
      bank_reference: reference,
      proof_storage_path: storagePath,
      proof_file_name: fileName,
      proof_mime_type: proof.type,
      proof_size_bytes: bytes.byteLength,
      status: "pending_review",
      submitted_at: now.toISOString(),
    });
  if (insertError) {
    await admin.storage.from(BUCKET).remove([storagePath]);
    if (insertError.code === "23505") {
      return json({
        ok: false,
        error:
          "This bank transaction reference has already been submitted for this account.",
      }, 409);
    }
    return json({
      ok: false,
      error: "The payment submission could not be saved. Please try again.",
    }, 503);
  }
  return json({
    ok: true,
    submission: {
      id: submissionId,
      amount,
      bank_reference: reference,
      status: "pending_review",
      submitted_at: now.toISOString(),
    },
    message:
      "Proof received. Your invoice will remain outstanding until Swayphics verifies the deposit in its bank account.",
  }, 201);
}

async function adminQueue(admin: any) {
  const { data: rows, error } = await admin.from("bank_transfer_submissions")
    .select(
      "id,invoice_id,client_id,amount,bank_reference,proof_file_name,proof_mime_type,proof_size_bytes,status,submitted_at",
    )
    .eq("status", "pending_review")
    .order("submitted_at", { ascending: true })
    .limit(100);
  if (error) {
    return json({
      ok: false,
      error: "The bank transfer review queue could not be loaded.",
    }, 503);
  }
  const invoiceIds = Array.from(
    new Set((rows || []).map((row: any) => row.invoice_id)),
  );
  const clientIds = Array.from(
    new Set((rows || []).map((row: any) => row.client_id)),
  );
  const [invoiceResult, clientResult] = await Promise.all([
    invoiceIds.length
      ? admin.from("invoices").select(
        "id,invoice_number,status,total,amount_outstanding",
      ).in("id", invoiceIds)
      : Promise.resolve({ data: [], error: null }),
    clientIds.length
      ? admin.from("clients").select("id,business_name,contact_name,email").in(
        "id",
        clientIds,
      )
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (invoiceResult.error || clientResult.error) {
    return json(
      { ok: false, error: "Review details could not be loaded." },
      503,
    );
  }
  const invoiceMap = new Map(
    (invoiceResult.data || []).map((row: any) => [row.id, row]),
  );
  const clientMap = new Map(
    (clientResult.data || []).map((row: any) => [row.id, row]),
  );
  return json({
    ok: true,
    pending: (rows || []).map((row: any) => ({
      ...row,
      invoice: invoiceMap.get(row.invoice_id) || null,
      client: clientMap.get(row.client_id) || null,
    })),
    count: (rows || []).length,
  });
}

export function createBankTransferHandler(overrides: Partial<Deps> = {}) {
  const deps = { ...defaults, ...overrides };
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
      return json({ ok: false, error: "Method not allowed." }, 405);
    }
    const origin = req.headers.get("origin");
    if (origin && origin !== ALLOWED_ORIGIN) {
      console.warn("bank-transfer request rejected: origin mismatch");
      return json({ ok: false, error: "Origin not allowed." }, 403);
    }

    try {
      const contentType = String(req.headers.get("content-type") || "")
        .toLowerCase();
      if (contentType.startsWith("multipart/form-data")) {
        const multipart = await readLimitedMultipart(req);
        if (!multipart.ok) {
          return json({
            ok: false,
            error: multipart.reason === "too_large"
              ? "The proof file must be 5 MB or smaller."
              : "A valid multipart upload is required.",
          }, multipart.reason === "too_large" ? 413 : 400);
        }
        const form = multipart.form;
        const token = String(form.get("token") || "").trim();
        if (!token) {
          return json(
            { ok: false, error: "Private portal token required." },
            400,
          );
        }
        const admin = deps.createAdmin();
        const portal = await deps.resolvePortal(admin, token);
        if (!portal) {
          return json({
            ok: false,
            error: "This portal link is invalid or has expired.",
          }, 403);
        }
        return await submitProof(
          form,
          admin,
          String(portal.client_id),
          deps.now(),
        );
      }

      const body = await req.json().catch(() => null);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return json({ ok: false, error: "A JSON object is required." }, 400);
      }
      const action = String(body.action || "");
      const admin = deps.createAdmin();

      if (action === "details") {
        const token = String(body.token || "").trim();
        if (!token) {
          return json(
            { ok: false, error: "Private portal token required." },
            400,
          );
        }
        const portal = await deps.resolvePortal(admin, token);
        if (!portal) {
          return json({
            ok: false,
            error: "This portal link is invalid or has expired.",
          }, 403);
        }
        return await clientDetails(
          admin,
          String(portal.client_id),
          String(body.invoice_id || ""),
        );
      }

      const authorization = await authorizeAdmin(req, deps);
      if (!authorization.ok) {
        return json(
          { ok: false, error: authorization.message },
          authorization.status,
        );
      }
      const reviewerId = authorization.reviewerId;

      if (action === "list") return await adminQueue(admin);
      if (action === "proof") {
        const id = String(body.submission_id || "");
        if (!validUuid(id)) {
          return json(
            { ok: false, error: "A valid submission is required." },
            400,
          );
        }
        const { data, error } = await admin.from("bank_transfer_submissions")
          .select("proof_storage_path,proof_file_name")
          .eq("id", id).maybeSingle();
        if (error || !data) {
          return json({ ok: false, error: "Proof file not found." }, 404);
        }
        const { data: signed, error: signedError } = await admin.storage.from(
          BUCKET,
        )
          .createSignedUrl(data.proof_storage_path, 300);
        if (signedError || !signed?.signedUrl) {
          return json(
            { ok: false, error: "Proof file could not be opened." },
            503,
          );
        }
        return json({
          ok: true,
          signed_url: signed.signedUrl,
          file_name: data.proof_file_name,
          expires_in: 300,
        });
      }
      if (action === "approve") {
        const id = String(body.submission_id || "");
        if (!validUuid(id)) {
          return json(
            { ok: false, error: "A valid submission is required." },
            400,
          );
        }
        const { data, error } = await admin.rpc(
          "admin_approve_bank_transfer_submission",
          {
            p_submission_id: id,
            p_reviewer_id: reviewerId,
          },
        );
        if (error) {
          deps.logError("Bank transfer approval rejected:", error.message);
          return json({
            ok: false,
            error:
              "This submission could not be approved. Refresh the queue and confirm the invoice balance is still sufficient.",
          }, 409);
        }
        return json({ ok: true, result: data });
      }
      if (action === "reject") {
        const id = String(body.submission_id || "");
        const reason = String(body.reason || "").trim();
        if (!validUuid(id) || reason.length < 1 || reason.length > 1000) {
          return json({
            ok: false,
            error: "A valid submission and rejection reason are required.",
          }, 400);
        }
        const { data, error } = await admin.rpc(
          "admin_reject_bank_transfer_submission",
          {
            p_submission_id: id,
            p_reviewer_id: reviewerId,
            p_reason: reason,
          },
        );
        if (error) {
          deps.logError("Bank transfer rejection rejected:", error.message);
          return json({
            ok: false,
            error:
              "This submission could not be rejected. Refresh the queue and try again.",
          }, 409);
        }
        return json({ ok: true, result: data });
      }
      return json(
        { ok: false, error: "Unsupported bank transfer action." },
        400,
      );
    } catch (error) {
      deps.logError(
        "Bank transfer request failed:",
        error instanceof Error ? error.message : "Unknown error.",
      );
      return json({
        ok: false,
        error: "The bank transfer service is temporarily unavailable.",
      }, 500);
    }
  };
}

if (import.meta.main) Deno.serve(createBankTransferHandler());
