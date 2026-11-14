// Paystack-specific validation and signing helpers for the client payment integration.
export function isPaystackCheckoutUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "checkout.paystack.com" &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (!/^[0-9a-f]{128}$/i.test(left) || !/^[0-9a-f]{128}$/i.test(right)) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < 128; i++) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacSha512Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Prefer Paystack's timestamped Paystack-Signature when its webhook signing
 * secret is configured. Before that secret is configured, fall back to the
 * documented x-paystack-signature when the test secret key is still active.
 * Paystack may send both headers during migration. Always use the exact raw
 * request body; never re-serialize parsed JSON.
 */
export async function verifyPaystackWebhookSignature(
  req: Request,
  rawBody: string,
  webhookSecret: string | undefined,
  secretKey: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const modern = req.headers.get("paystack-signature");
  if (modern && webhookSecret?.startsWith("whsec_")) {
    const parts = modern.split(",").map((part) => part.trim());
    const timestampPart = parts.find((part) => part.startsWith("t="));
    const timestamp = timestampPart ? Number(timestampPart.slice(2)) : NaN;
    if (
      !Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > 300
    ) {
      return false;
    }
    const signatures = parts
      .filter((part) => part.startsWith("v1="))
      .map((part) => part.slice(3).split(":").slice(1).join(":"))
      .filter((value) => /^[0-9a-f]{128}$/i.test(value));
    if (!signatures.length) return false;
    const expected = await hmacSha512Hex(
      webhookSecret,
      String(timestamp) + "." + rawBody,
    );
    return signatures.some((signature) =>
      constantTimeHexEqual(expected, signature)
    );
  }

  // The legacy header remains available while the Paystack secret key is
  // active, including during migration to the timestamped signing secret.
  const legacy = req.headers.get("x-paystack-signature") || "";
  if (!secretKey || !secretKey.startsWith("sk_test_")) return false;
  if (!/^[0-9a-f]{128}$/i.test(legacy)) return false;
  const expected = await hmacSha512Hex(secretKey, rawBody);
  return constantTimeHexEqual(expected, legacy);
}

export function isSwayphicsCallbackUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "swayphics.co.za" ||
        url.hostname.endsWith(".swayphics.co.za")) &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}

export function validatePaystackInitializeResponse(
  value: unknown,
  expectedReference: string,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false as const };
  }
  const root = value as Record<string, unknown>;
  const data = root.data && typeof root.data === "object" &&
      !Array.isArray(root.data)
    ? root.data as Record<string, unknown>
    : null;
  const url = data?.authorization_url;
  const reference = data?.reference;
  if (
    root.status !== true ||
    typeof reference !== "string" ||
    reference !== expectedReference ||
    !isPaystackCheckoutUrl(url)
  ) {
    return { ok: false as const };
  }
  return { ok: true as const, authorizationUrl: url, reference };
}

export function validatePaystackTransactionObservation(
  value: unknown,
  expected: { reference: string; amountCents: number },
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  const data = root.data && typeof root.data === "object" &&
      !Array.isArray(root.data)
    ? root.data as Record<string, unknown>
    : null;
  const allowedStatuses = [
    "success",
    "failed",
    "abandoned",
    "ongoing",
    "pending",
    "processing",
    "queued",
    "reversed",
  ];
  if (
    root.status !== true || !data ||
    typeof data.status !== "string" ||
    !allowedStatuses.includes(data.status) ||
    data.domain !== "test" ||
    data.reference !== expected.reference ||
    !Number.isSafeInteger(data.amount) ||
    data.amount !== expected.amountCents ||
    data.currency !== "ZAR" ||
    (typeof data.id !== "number" && typeof data.id !== "string") ||
    !/^\d+$/.test(String(data.id))
  ) return null;

  return {
    reference: String(data.reference),
    amountCents: Number(data.amount),
    currency: String(data.currency),
    domain: String(data.domain),
    transactionId: String(data.id),
    status: data.status,
    channel: typeof data.channel === "string" ? data.channel : null,
    gatewayResponse: typeof data.gateway_response === "string"
      ? data.gateway_response.slice(0, 200)
      : null,
  };
}

export function validatePaystackVerifiedTransaction(
  value: unknown,
  expected: { reference: string; amountCents: number },
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  const data = root.data && typeof root.data === "object" &&
      !Array.isArray(root.data)
    ? root.data as Record<string, unknown>
    : null;
  if (
    root.status !== true || !data ||
    data.status !== "success" ||
    data.domain !== "test" ||
    data.reference !== expected.reference ||
    data.amount !== expected.amountCents ||
    data.currency !== "ZAR" ||
    (typeof data.id !== "number" && typeof data.id !== "string") ||
    !/^\d+$/.test(String(data.id))
  ) return null;
  return {
    reference: String(data.reference),
    amountCents: Number(data.amount),
    currency: String(data.currency),
    domain: String(data.domain),
    transactionId: String(data.id),
    channel: typeof data.channel === "string" ? data.channel : null,
  };
}
