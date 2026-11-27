import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const ORIGIN = "https://swayphics.co.za";
const BUCKET = "swayphics-payment-receipts";
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

function escapeHtml(value: unknown) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function safePdfText(value: unknown) {
  return String(value ?? "").replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim();
}

function money(value: unknown, currency: string) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency }).format(amount);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

function receiptClientDetails(snapshot: any, client: any) {
  const has = (key: string) => Object.prototype.hasOwnProperty.call(snapshot || {}, key);
  return {
    business_name: has("client_business_name") ? snapshot.client_business_name : client.business_name,
    contact_name: has("client_contact_name") ? snapshot.client_contact_name : client.contact_name,
    email: has("client_email") ? snapshot.client_email : client.email,
  };
}

function createAdmin() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Server configuration is unavailable.");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function authorize(req: Request, admin: any) {
  const apiKey = req.headers.get("apikey") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (serviceKey && apiKey === serviceKey) return { ok: true as const, internal: true };

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false as const, status: 401, error: "Administrator session required." };
  const { data, error } = await admin.auth.getUser(token);
  const userId = data?.user?.id;
  if (error || !userId) return { ok: false as const, status: 401, error: "Administrator session expired. Sign in again." };
  const { data: allowed, error: adminError } = await admin.from("admin_users")
    .select("user_id").eq("user_id", userId).eq("active", true).maybeSingle();
  if (adminError) return { ok: false as const, status: 503, error: "Administrator access could not be verified." };
  if (!allowed) return { ok: false as const, status: 403, error: "Administrator access required." };
  return { ok: true as const, internal: false };
}

async function buildReceiptPdf(receipt: any, payment: any, client: any, invoice: any, settings: any) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(8 / 255, 21 / 255, 51 / 255);
  const blue = rgb(1 / 255, 82 / 255, 244 / 255);
  const muted = rgb(86 / 255, 98 / 255, 122 / 255);
  const pale = rgb(246 / 255, 249 / 255, 255 / 255);
  const white = rgb(1, 1, 1);
  const left = 52;
  const right = 543;
  const snapshot = receipt.snapshot || {};
  const receiptClient = receiptClientDetails(snapshot, client);
  const currency = String(payment.currency || snapshot.currency || "ZAR").toUpperCase();
  const amount = Number(snapshot.amount ?? payment.amount ?? 0);
  const dateValue = snapshot.payment_date || payment.paid_at || receipt.issued_at;
  const date = new Date(dateValue);
  const dateLabel = Number.isNaN(date.getTime()) ? String(dateValue || "—") : date.toLocaleDateString("en-ZA", { day: "2-digit", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" });

  page.drawRectangle({ x: 0, y: 836, width: 595.28, height: 5.3, color: blue });
  page.drawText("SWAYPHICS", { x: left, y: 765, size: 25, font: bold, color: navy, characterSpacing: 1.1 });
  page.drawText("EMPOWERING THROUGH DESIGN", { x: left, y: 748, size: 7, font: bold, color: muted, characterSpacing: 1.3 });
  page.drawText("PAYMENT RECEIPT", { x: 345, y: 765, size: 14, font: bold, color: blue });
  page.drawText(safePdfText(receipt.receipt_number), { x: 345, y: 746, size: 9, font: bold, color: navy });
  page.drawLine({ start: { x: left, y: 720 }, end: { x: right, y: 720 }, thickness: 1, color: rgb(224 / 255, 230 / 255, 240 / 255) });

  page.drawText("RECEIVED FROM", { x: left, y: 680, size: 7, font: bold, color: blue, characterSpacing: 1 });
  page.drawText(safePdfText(receiptClient.business_name || receiptClient.contact_name || "Client").slice(0, 58), { x: left, y: 656, size: 14, font: bold, color: navy });
  if (receiptClient.contact_name && receiptClient.business_name) page.drawText(safePdfText(receiptClient.contact_name).slice(0, 58), { x: left, y: 638, size: 9, font: regular, color: muted });
  if (receiptClient.email) page.drawText(safePdfText(receiptClient.email).slice(0, 70), { x: left, y: 621, size: 9, font: regular, color: muted });

  page.drawText("PAYMENT DETAILS", { x: 325, y: 680, size: 7, font: bold, color: blue, characterSpacing: 1 });
  const details = [
    ["Payment date", dateLabel],
    ["Invoice", invoice?.invoice_number || snapshot.invoice_number || "—"],
    ["Method", payment.method || snapshot.method || "—"],
    ["Reference", payment.reference || snapshot.bank_reference || snapshot.provider_checkout_id || "—"],
  ];
  details.forEach((entry, index) => {
    const y = 656 - index * 19;
    page.drawText(entry[0], { x: 325, y, size: 8, font: regular, color: muted });
    page.drawText(safePdfText(entry[1]).slice(0, 38), { x: 410, y, size: 8, font: bold, color: navy });
  });

  page.drawRectangle({ x: left, y: 510, width: right - left, height: 72, color: pale });
  page.drawRectangle({ x: left, y: 510, width: 4, height: 72, color: blue });
  page.drawText("AMOUNT RECEIVED", { x: left + 20, y: 552, size: 8, font: bold, color: muted, characterSpacing: 1 });
  const total = money(amount, currency);
  page.drawText(total, { x: right - 22 - bold.widthOfTextAtSize(total, 25), y: 525, size: 25, font: bold, color: navy });

  page.drawText("This receipt confirms that Swayphics has recorded the payment shown above.", { x: left, y: 455, size: 9, font: regular, color: muted });
  page.drawText("Thank you for choosing Swayphics.", { x: left, y: 436, size: 9, font: bold, color: navy });
  page.drawLine({ start: { x: left, y: 95 }, end: { x: right, y: 95 }, thickness: 0.7, color: rgb(224 / 255, 230 / 255, 240 / 255) });
  page.drawText(safePdfText(settings.business_name || "Swayphics"), { x: left, y: 75, size: 8, font: bold, color: navy });
  page.drawText(safePdfText(settings.email || "info@swayphics.co.za"), { x: left, y: 60, size: 8, font: regular, color: muted });
  page.drawText("swayphics.co.za", { x: right - 75, y: 60, size: 8, font: regular, color: muted });
  return await doc.save();
}

async function listReceipts(admin: any) {
  const { data: rows, error } = await admin.from("payment_receipts")
    .select("id,payment_id,receipt_number,issued_at,snapshot,voided_at,voided_by,void_reason")
    .order("issued_at", { ascending: false }).limit(100);
  if (error) return json({ ok: false, error: "Receipts could not be loaded." }, 503);
  if (!rows?.length) return json({ ok: true, receipts: [] });
  const paymentIds = [...new Set(rows.map((row: any) => row.payment_id))];
  const { data: deliveries, error: deliveryError } = await admin.from("payment_receipt_deliveries")
    .select("receipt_id,status,recipient_email,provider_message_id,pdf_storage_path,attempt_count,last_attempt_at,sent_at,last_error,provider_delivery_status,provider_delivered_at,provider_event_at")
    .in("receipt_id", rows?.map((row: any) => row.id) || []);
  if (deliveryError) return json({ ok: false, error: "Receipt delivery status could not be loaded." }, 503);
  const { data: payments, error: paymentError } = await admin.from("payments")
    .select("id,client_id,invoice_id,amount,currency,method,paid_at,status").in("id", paymentIds);
  if (paymentError) return json({ ok: false, error: "Payment details could not be loaded." }, 503);
  const clientIds = [...new Set((payments || []).map((row: any) => row.client_id).filter(Boolean))];
  const { data: clients, error: clientError } = await admin.from("clients")
    .select("id,business_name,contact_name,email").in("id", clientIds);
  if (clientError) return json({ ok: false, error: "Client details could not be loaded." }, 503);
  const deliveryMap = new Map((deliveries || []).map((row: any) => [row.receipt_id, row]));
  const paymentMap = new Map((payments || []).map((row: any) => [row.id, row]));
  const clientMap = new Map((clients || []).map((row: any) => [row.id, row]));
  return json({ ok: true, receipts: (rows || []).map((row: any) => {
    const payment = paymentMap.get(row.payment_id);
    return {
      id: row.id,
      payment_id: row.payment_id,
      receipt_number: row.receipt_number,
      issued_at: row.issued_at,
      voided_at: row.voided_at || null,
      voided_by: row.voided_by || null,
      void_reason: row.void_reason || null,
      payment_status: payment?.status ?? null,
      amount: payment?.amount ?? row.snapshot?.amount ?? null,
      currency: payment?.currency ?? row.snapshot?.currency ?? "ZAR",
      method: payment?.method ?? row.snapshot?.method ?? null,
      client: payment ? clientMap.get(payment.client_id) || null : null,
      delivery: deliveryMap.get(row.id) || { status: "pending", attempt_count: 0 },
    };
  }) });
}

async function sendReceipt(admin: any, paymentId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(paymentId)) {
    return json({ ok: false, error: "A valid payment is required." }, 400);
  }
  const { data: payment, error: paymentError } = await admin.from("payments")
    .select("id,client_id,invoice_id,amount,currency,method,reference,paid_at,status,provider")
    .eq("id", paymentId).maybeSingle();
  if (paymentError || !payment || payment.status !== "paid") {
    return json({ ok: false, error: "Only a recorded, paid payment can receive a receipt." }, 409);
  }
  const { data: receipt, error: receiptError } = await admin.from("payment_receipts")
    .select("id,payment_id,receipt_number,issued_at,snapshot,voided_at,void_reason")
    .eq("payment_id", paymentId).maybeSingle();
  if (receiptError || !receipt) return json({ ok: false, error: "A receipt has not been issued for this payment." }, 404);
  if (receipt.voided_at || payment.status === "voided_test") {
    return json({ ok: false, error: "This receipt has been voided as a test transaction and cannot be sent or resent." }, 409);
  }
  const { error: ensureError } = await admin.from("payment_receipt_deliveries")
    .upsert({ receipt_id: receipt.id, status: "pending" }, { onConflict: "receipt_id", ignoreDuplicates: true });
  if (ensureError) return json({ ok: false, error: "Receipt delivery could not be prepared." }, 503);

  const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: claim, error: claimError } = await admin.rpc("claim_payment_receipt_delivery", {
    p_receipt_id: receipt.id,
    p_stale_before: staleBefore,
  });
  if (claimError) return json({ ok: false, error: "Receipt delivery could not be claimed." }, 503);
  if (!claim?.claimed) {
    const { data: current } = await admin.from("payment_receipt_deliveries")
      .select("status,provider_message_id").eq("receipt_id", receipt.id).maybeSingle();
    if (current?.status === "sent") return json({ ok: true, already_sent: true, receipt_number: receipt.receipt_number });
    return json({ ok: false, error: "This receipt is already being processed. Try again shortly." }, 409);
  }

  const { data: client, error: clientError } = await admin.from("clients")
    .select("business_name,contact_name,email").eq("id", payment.client_id).maybeSingle();
  const { data: invoice } = payment.invoice_id
    ? await admin.from("invoices").select("invoice_number").eq("id", payment.invoice_id).maybeSingle()
    : { data: null };
  const { data: settings } = await admin.from("invoice_settings")
    .select("business_name,email,phone,website").eq("id", 1).maybeSingle();

  const recipient = String(client?.email || "").trim();
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (clientError || !client || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || !resendKey) {
    const message = !resendKey ? "Email delivery is not configured." : !recipient ? "The client does not have a valid email address." : "Client details could not be loaded.";
    await admin.from("payment_receipt_deliveries").update({ status: "failed", recipient_email: recipient || null, last_error: message, updated_at: new Date().toISOString() }).eq("receipt_id", receipt.id);
    await admin.from("payment_receipt_delivery_attempts").insert({ receipt_id: receipt.id, status: "failed", recipient_email: recipient || null, error_message: message });
    return json({ ok: false, error: message }, 503);
  }

  try {
    const pdf = await buildReceiptPdf(receipt, payment, client, invoice, settings || {});
    const path = new Date(receipt.issued_at).getUTCFullYear() + "/" + receipt.receipt_number + ".pdf";
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, pdf, {
      contentType: "application/pdf", cacheControl: "3600", upsert: true,
    });
    if (uploadError) throw new Error("Receipt PDF could not be stored securely.");

    const amount = money(receipt.snapshot?.amount ?? payment.amount, String(payment.currency || "ZAR"));
    const receiptClient = receiptClientDetails(receipt.snapshot || {}, client);
    const greeting = receiptClient.contact_name || receiptClient.business_name || "there";
    const html = '<!doctype html><html><body style="margin:0;background:#F4F7FC;padding:32px 12px;font-family:Arial,sans-serif;color:#081533"><div style="max-width:600px;margin:auto;background:#fff;border:1px solid #E4EAF3;border-radius:18px;overflow:hidden"><div style="height:5px;background:#0152F4"></div><div style="padding:34px"><div style="font-size:12px;font-weight:800;letter-spacing:2px;color:#002096">SWAYPHICS</div><h1 style="font-size:24px;margin:24px 0 12px">Payment received.</h1><p style="font-size:14px;line-height:1.7;color:#56627A">Hello ' + escapeHtml(greeting) + ',</p><p style="font-size:14px;line-height:1.7;color:#56627A">We have received your payment of <strong style="color:#081533">' + escapeHtml(amount) + '</strong>. Your receipt is attached for your records.</p><div style="padding:16px;background:#F6F9FF;border-radius:12px"><div style="font-size:10px;color:#8190A5;letter-spacing:1px">RECEIPT NUMBER</div><div style="font-size:16px;font-weight:800;margin-top:6px">' + escapeHtml(receipt.receipt_number) + '</div></div><p style="font-size:13px;color:#56627A;line-height:1.7;margin-top:24px">Thank you for choosing Swayphics.</p><p style="font-size:13px;color:#56627A;margin-top:22px">Kind regards,<br><strong>Lesego Gumede</strong><br>Swayphics</p></div></div></body></html>';
    const from = Deno.env.get("RESEND_FROM_EMAIL") || "Swayphics <info@swayphics.co.za>";
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + resendKey,
        "Content-Type": "application/json",
        "Idempotency-Key": "payment-receipt-" + receipt.id,
      },
      body: JSON.stringify({
        from, to: [recipient], subject: "Payment receipt " + receipt.receipt_number + " from Swayphics",
        html, tags: [{ name: "receipt_id", value: receipt.id }], attachments: [{ filename: receipt.receipt_number + ".pdf", content: bytesToBase64(pdf) }],
      }),
    });
    const responseText = await response.text();
    let result: any = {};
    try { result = responseText ? JSON.parse(responseText) : {}; } catch { result = {}; }
    if (!response.ok) throw new Error(String(result?.message || "Email provider rejected the receipt."));
    const sentAt = new Date().toISOString();
    const providerId = String(result?.id || "");
    await admin.from("payment_receipt_deliveries").update({
      status: "sent", recipient_email: recipient, provider_message_id: providerId || null,
      pdf_storage_path: path, sent_at: sentAt, last_error: null, updated_at: sentAt,
    }).eq("receipt_id", receipt.id);
    await admin.from("payment_receipt_delivery_attempts").insert({
      receipt_id: receipt.id, status: "sent", recipient_email: recipient, provider_message_id: providerId || null,
    });
    return json({ ok: true, receipt_number: receipt.receipt_number, recipient, provider_message_id: providerId || null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Receipt email could not be sent.";
    await admin.from("payment_receipt_deliveries").update({ status: "failed", recipient_email: recipient, last_error: message.slice(0, 1000), updated_at: new Date().toISOString() }).eq("receipt_id", receipt.id);
    await admin.from("payment_receipt_delivery_attempts").insert({ receipt_id: receipt.id, status: "failed", recipient_email: recipient, error_message: message.slice(0, 1000) });
    return json({ ok: false, error: message }, 503);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  const origin = req.headers.get("origin");
  if (origin && origin !== ORIGIN) return json({ ok: false, error: "Origin not allowed." }, 403);
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, error: "A JSON object is required." }, 400);
    const admin = createAdmin();
    const authorization = await authorize(req, admin);
    if (!authorization.ok) return json({ ok: false, error: authorization.error }, authorization.status);
    const action = String(body.action || "send");
    if (action === "list") {
      if (authorization.internal) return json({ ok: false, error: "Administrator access required." }, 403);
      return await listReceipts(admin);
    }
    if (action !== "send") return json({ ok: false, error: "Unsupported receipt action." }, 400);
    return await sendReceipt(admin, String(body.payment_id || ""));
  } catch (error) {
    console.error("Payment receipt delivery failed:", error instanceof Error ? error.message : "Unknown error.");
    return json({ ok: false, error: "Receipt delivery is temporarily unavailable." }, 500);
  }
});
