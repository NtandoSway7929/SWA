import {
  checkOrigin,
  getAdminClient,
  isUuid,
  json,
  optionsResponse,
  readLimitedTextBody,
  resolvePortalToken,
} from "../_shared/yoco.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  if (!checkOrigin(req)) return json({ ok: false, error: "Origin not allowed." }, 403);

  try {
    const limitedBody = await readLimitedTextBody(req, 8_192);
    if (!limitedBody.ok) {
      return json({
        ok: false,
        error: limitedBody.reason === "too_large" ? "Request is too large." : "Request must be valid UTF-8.",
      }, limitedBody.reason === "too_large" ? 413 : 400);
    }
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(limitedBody.body);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json({ ok: false, error: "A JSON object is required." }, 400);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ ok: false, error: "Invalid JSON request." }, 400);
    }
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    const attemptId = body?.attempt_id;
    if (!token || !isUuid(attemptId)) {
      return json({ ok: false, error: "A valid portal token and payment attempt are required." }, 400);
    }

    const admin = getAdminClient();
    const portal = await resolvePortalToken(admin, token);
    if (!portal) return json({ ok: false, error: "This portal link is invalid or has expired." }, 403);

    const { data: attempt, error } = await admin
      .from("payment_attempts")
      .select("id,invoice_id,client_id,amount_cents,currency,status,created_at,updated_at,expires_at,payment_id")
      .eq("id", attemptId)
      .eq("client_id", portal.client_id)
      .eq("provider", "yoco")
      .eq("environment", "test")
      .maybeSingle();

    if (error || !attempt) return json({ ok: false, error: "Payment attempt not found." }, 404);

    let payment = null;
    let receipt = null;
    if (attempt.payment_id) {
      const [paymentResult, receiptResult] = await Promise.all([
        admin.from("payments")
          .select("id,amount,currency,method,paid_at,reference")
          .eq("id", attempt.payment_id)
          .eq("client_id", portal.client_id)
          .maybeSingle(),
        admin.from("payment_receipts")
          .select("receipt_number,issued_at,snapshot")
          .eq("payment_id", attempt.payment_id)
          .maybeSingle(),
      ]);
      if (paymentResult.error || receiptResult.error) {
        return json({ ok: false, error: "Payment confirmation is temporarily unavailable." }, 503);
      }
      payment = paymentResult.data;
      receipt = receiptResult.data;
    }

    return json({
      ok: true,
      attempt: {
        id: attempt.id,
        invoice_id: attempt.invoice_id,
        amount_cents: attempt.amount_cents,
        currency: attempt.currency,
        status: attempt.status,
        created_at: attempt.created_at,
        updated_at: attempt.updated_at,
        expires_at: attempt.expires_at,
      },
      payment,
      receipt,
      confirmed: attempt.status === "succeeded" && !!payment,
    });
  } catch (error) {
    console.error("Payment status lookup failed:", error instanceof Error ? error.message : "Unknown error.");
    return json({ ok: false, error: "Payment status is temporarily unavailable." }, 500);
  }
});
