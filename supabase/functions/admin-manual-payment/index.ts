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

function createServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Server configuration is unavailable.");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
}

function createUserClient(token: string) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
  if (!url || !key) throw new Error("Server configuration is unavailable.");
  return createClient(url, key, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function authorize(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false as const, status: 401, error: "Administrator session required." };
  const userClient = createUserClient(token);
  const { data, error } = await userClient.auth.getUser(token);
  const userId = String(data?.user?.id || "");
  if (error || !userId) return { ok: false as const, status: 401, error: "Administrator session expired. Sign in again." };
  const { data: allowed, error: adminError } = await userClient.rpc("is_swayphics_admin");
  if (adminError) return { ok: false as const, status: 503, error: "Administrator access could not be verified." };
  if (allowed !== true) return { ok: false as const, status: 403, error: "Administrator access required." };
  return { ok: true as const, userId };
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseAmount(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(raw)) return null;
  const amount = Number(raw);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null;
}

async function listInvoices(admin: any) {
  const { data: invoices, error } = await admin.from("invoices")
    .select("id,invoice_number,client_id,status,currency,total,amount_paid,amount_outstanding,due_date,partial_payment_enabled")
    .in("status", ["sent", "partially paid", "overdue"])
    .eq("archived", false).gt("amount_outstanding", 0)
    .order("due_date", { ascending: true, nullsFirst: false }).limit(100);
  if (error) return json({ ok: false, error: "Outstanding invoices could not be loaded." }, 503);
  const clientIds = [...new Set((invoices || []).map((row: any) => row.client_id))];
  const { data: clients, error: clientError } = clientIds.length
    ? await admin.from("clients").select("id,business_name,contact_name,email").in("id", clientIds)
    : { data: [], error: null };
  if (clientError) return json({ ok: false, error: "Invoice client details could not be loaded." }, 503);
  const clientMap = new Map((clients || []).map((row: any) => [row.id, row]));
  return json({
    ok: true,
    invoices: (invoices || []).map((row: any) => ({
      ...row,
      client: clientMap.get(row.client_id) || null,
      amount_outstanding: Number(row.amount_outstanding || 0),
    })),
  });
}

async function dispatchReceipt(paymentId: string, admin: any) {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) return "pending";
  try {
    const response = await fetch(url.replace(/\/$/, "") + "/functions/v1/deliver-payment-receipt", {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": key },
      body: JSON.stringify({ action: "send", payment_id: paymentId }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) console.error("Manual payment receipt email remains queued for retry.", response.status);
  } catch (error) {
    console.error("Manual payment receipt dispatch failed.", error instanceof Error ? error.message : "Unknown error.");
  }
  const { data: receipt } = await admin.from("payment_receipts").select("id").eq("payment_id", paymentId).maybeSingle();
  if (!receipt) return "pending";
  const { data: delivery } = await admin.from("payment_receipt_deliveries").select("status,last_error").eq("receipt_id", receipt.id).maybeSingle();
  return delivery?.status || "pending";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  const origin = req.headers.get("origin");
  if (origin && origin !== ORIGIN) return json({ ok: false, error: "Origin not allowed." }, 403);

  const auth = await authorize(req);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid request body." }, 400); }
  const admin = createServiceClient();

  if (body?.action === "list") return await listInvoices(admin);
  if (body?.action !== "record") return json({ ok: false, error: "Unsupported action." }, 400);

  const invoiceId = body.invoice_id;
  const amount = parseAmount(body.amount);
  const method = String(body.method || "");
  const reference = String(body.reference || "").trim();
  const notes = String(body.notes || "").trim();
  const paymentDate = String(body.payment_date || "");
  const requestKey = body.idempotency_key;

  if (!validUuid(invoiceId) || amount === null || !["EFT", "Cash", "Other"].includes(method) ||
      !validUuid(requestKey) || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) ||
      reference.length > 120 || notes.length > 1000 || (method === "EFT" && !reference)) {
    return json({ ok: false, error: "Check the invoice, amount, payment method, date and required EFT reference." }, 400);
  }

  const { data: result, error } = await admin.rpc("admin_record_manual_payment", {
    p_invoice_id: invoiceId,
    p_amount: amount,
    p_method: method,
    p_reference: reference || null,
    p_notes: notes || null,
    p_payment_date: paymentDate,
    p_admin_user_id: auth.userId,
    p_idempotency_key: requestKey,
  });
  if (error || !result?.ok || !result?.payment_id) {
    console.error("Manual payment recording failed.", error?.message || "RPC returned an incomplete result.");
    const message = String(error?.message || "");
    const conflict = /exceeds the current outstanding|not eligible|already associated|cannot be in the future/i.test(message);
    return json({ ok: false, error: conflict ? message : "The payment could not be recorded. Refresh the invoice list and try again." }, conflict ? 409 : 503);
  }

  const emailStatus = await dispatchReceipt(String(result.payment_id), admin);
  return json({
    ok: true,
    duplicate: result.duplicate === true,
    payment_id: result.payment_id,
    receipt_number: result.receipt_number,
    amount: result.amount,
    currency: result.currency,
    email_status: emailStatus,
  }, result.duplicate ? 200 : 201);
});
