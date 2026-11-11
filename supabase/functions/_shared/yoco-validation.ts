export function isSwayphicsReturnUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "swayphics.co.za" || url.hostname.endsWith(".swayphics.co.za")) &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}

export function validateCheckoutRequest(body: Record<string, unknown>, idempotencyHeader: string | null) {
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const invoiceId = body.invoice_id;
  const amountCents = body.amount_cents;
  const suppliedKey = idempotencyHeader || body.idempotency_key;
  const idempotencyKey = typeof suppliedKey === "string" ? suppliedKey.trim() : "";

  if (token.length < 32 || token.length > 512 ||
      typeof invoiceId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invoiceId) ||
      !Number.isSafeInteger(amountCents) || Number(amountCents) < 200 || Number(amountCents) > 100_000_000 ||
      !idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    return { ok: false as const };
  }

  return { ok: true as const, token, invoiceId, amountCents: Number(amountCents), idempotencyKey };
}

export function validateYocoCheckoutResponse(checkout: Record<string, unknown>, expectedAmountCents: number) {
  const checkoutId = typeof checkout.id === "string" ? checkout.id : "";
  const redirectUrl = typeof checkout.redirectUrl === "string" ? checkout.redirectUrl : "";
  let redirect: URL | null = null;
  try { redirect = new URL(redirectUrl); } catch { redirect = null; }

  const valid = !!checkoutId &&
    checkout.amount === expectedAmountCents &&
    checkout.currency === "ZAR" &&
    checkout.processingMode === "test" &&
    !!redirect &&
    redirect.protocol === "https:" &&
    (redirect.hostname === "yoco.com" || redirect.hostname.endsWith(".yoco.com")) &&
    !redirect.username && !redirect.password;

  return valid ? { ok: true as const, checkoutId, redirectUrl: redirect!.toString() } : { ok: false as const };
}
