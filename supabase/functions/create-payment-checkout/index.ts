import {
  checkOrigin,
  getAdminClient,
  isUuid,
  json,
  optionsResponse,
  resolvePortalToken,
} from "../_shared/yoco.ts";

const MAX_BODY_BYTES = 16_384;

function isSwayphicsReturnUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "swayphics.co.za" || url.hostname.endsWith(".swayphics.co.za"));
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  if (!checkOrigin(req)) return json({ ok: false, error: "Origin not allowed." }, 403);

  const declaredLength = Number(req.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) return json({ ok: false, error: "Request is too large." }, 413);

  try {
    const body = await req.json();
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    const invoiceId = body?.invoice_id;
    const amountCents = body?.amount_cents;
    const suppliedKey = req.headers.get("idempotency-key") || body?.idempotency_key;
    const idempotencyKey = typeof suppliedKey === "string" ? suppliedKey.trim() : "";

    if (!token || !isUuid(invoiceId) || !Number.isSafeInteger(amountCents) ||
        amountCents < 200 || amountCents > 100_000_000 ||
        !idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      return json({ ok: false, error: "A valid portal token, invoice, amount and idempotency key are required." }, 400);
    }

    const yocoKey = Deno.env.get("YOCO_SECRET_KEY");
    const mode = Deno.env.get("YOCO_ENVIRONMENT");
    const successUrl = Deno.env.get("YOCO_SUCCESS_URL");
    const cancelUrl = Deno.env.get("YOCO_CANCEL_URL");
    const failureUrl = Deno.env.get("YOCO_FAILURE_URL");
    if (!yocoKey || !yocoKey.startsWith("sk_test_") || mode !== "test" ||
        !isSwayphicsReturnUrl(successUrl) || !isSwayphicsReturnUrl(cancelUrl) ||
        !isSwayphicsReturnUrl(failureUrl)) {
      return json({ ok: false, error: "Test checkout is not configured. No payment has been initiated." }, 503);
    }

    const admin = getAdminClient();
    const portal = await resolvePortalToken(admin, token);
    if (!portal) return json({ ok: false, error: "This portal link is invalid or has expired." }, 403);

    const { data: attempt, error: attemptError } = await admin.rpc("yoco_create_payment_attempt", {
      p_invoice_id: invoiceId,
      p_client_id: portal.client_id,
      p_amount_cents: amountCents,
      p_idempotency_key: idempotencyKey,
    });
    if (attemptError || !attempt?.attempt_id) {
      console.error("Payment attempt creation rejected:", attemptError?.message || "No attempt returned.");
      return json({ ok: false, error: "The invoice is not currently eligible for this payment." }, 409);
    }

    if (attempt.checkout_url && attempt.provider_checkout_id) {
      return json({
        ok: true,
        attempt_id: attempt.attempt_id,
        status: attempt.status,
        checkout_url: attempt.checkout_url,
        reused: true,
      });
    }

    const checkoutSuccessUrl = new URL(successUrl);
    checkoutSuccessUrl.searchParams.set("token", token);
    checkoutSuccessUrl.searchParams.set("payment_attempt", attempt.attempt_id);

    const response = await fetch("https://payments.yoco.com/api/checkouts", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + yocoKey,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        amount: amountCents,
        currency: "ZAR",
        successUrl: checkoutSuccessUrl.toString(),
        cancelUrl,
        failureUrl,
        metadata: {
          paymentAttemptId: attempt.attempt_id,
          invoiceId,
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      // Keep the attempt in 'created'. A retry with the same idempotency key
      // can safely resume without inventing a failed payment.
      console.error("Yoco checkout creation failed with HTTP", response.status);
      return json({ ok: false, error: "Yoco could not create the checkout. You can safely retry this request." }, 502);
    }

    const checkout = await response.json();
    const checkoutId = typeof checkout?.id === "string" ? checkout.id : "";
    const redirectUrl = typeof checkout?.redirectUrl === "string" ? checkout.redirectUrl : "";
    let redirect: URL | null = null;
    try { redirect = new URL(redirectUrl); } catch { redirect = null; }

    if (!checkoutId || checkout.amount !== amountCents || checkout.currency !== "ZAR" || checkout.processingMode !== "test" || !redirect || redirect.protocol !== "https:" ||
        !(redirect.hostname === "yoco.com" || redirect.hostname.endsWith(".yoco.com"))) {
      console.error("Yoco returned an invalid hosted checkout response.");
      return json({ ok: false, error: "The payment provider returned an invalid checkout response." }, 502);
    }

    const { data: attached, error: attachError } = await admin.rpc("yoco_attach_checkout", {
      p_attempt_id: attempt.attempt_id,
      p_provider_checkout_id: checkoutId,
      p_checkout_url: redirect.toString(),
      p_expires_at: null,
    });
    if (attachError || !attached?.checkout_url) {
      console.error("Could not attach Yoco checkout:", attachError?.message || "No checkout returned.");
      return json({ ok: false, error: "The checkout was created but could not be safely linked. Contact Swayphics before retrying." }, 503);
    }

    return json({
      ok: true,
      attempt_id: attempt.attempt_id,
      status: attached.status,
      checkout_url: attached.checkout_url,
      reused: false,
    });
  } catch (error) {
    console.error("Create checkout request failed:", error instanceof Error ? error.message : "Unknown error.");
    return json({ ok: false, error: "The payment service is temporarily unavailable." }, 500);
  }
});
