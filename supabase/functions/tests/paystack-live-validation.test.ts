import { createPaystackWebhookHandler } from "../paystack-payment-webhook/index.ts";
import {
  isPaystackCheckoutUrl,
  isSwayphicsCallbackUrl,
  validatePaystackInitializeResponse,
  validatePaystackTransactionObservation,
  validatePaystackVerifiedTransaction,
  verifyPaystackWebhookSignature,
} from "../_shared/paystack.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function hmacSha512(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(signed))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

Deno.test("Paystack hosted checkout response is constrained to the expected reference and host", () => {
  const valid = validatePaystackInitializeResponse({
    status: true,
    data: {
      authorization_url: "https://checkout.paystack.com/abc123",
      access_code: "abc123",
      reference: "SWP-2026-0001",
    },
  }, "SWP-2026-0001");
  assert(valid.ok, "Valid Paystack initialization response was rejected.");

  const rejected = [
    { status: true, data: { authorization_url: "https://checkout.paystack.com/a", reference: "wrong" } },
    { status: false, data: { authorization_url: "https://checkout.paystack.com/a", reference: "SWP-2026-0001" } },
    { status: true, data: { authorization_url: "https://checkout.paystack.com.attacker.example/a", reference: "SWP-2026-0001" } },
    { status: true, data: { authorization_url: "http://checkout.paystack.com/a", reference: "SWP-2026-0001" } },
    { status: true, data: { authorization_url: "https://user:pass@checkout.paystack.com/a", reference: "SWP-2026-0001" } },
  ];
  for (const candidate of rejected) {
    assert(
      !validatePaystackInitializeResponse(candidate, "SWP-2026-0001").ok,
      "An unsafe Paystack checkout URL or mismatched response was accepted.",
    );
  }
  assert(isPaystackCheckoutUrl("https://checkout.paystack.com/a"), "Expected Paystack checkout host was rejected.");
  assert(!isPaystackCheckoutUrl("https://paystack.com.attacker.example/a"), "Lookalike Paystack host was accepted.");
});

Deno.test("Paystack live transaction observation checks domain, amount, currency and reference", () => {
  const payload = {
    status: true,
    data: {
      id: 987654321,
      domain: "live",
      status: "success",
      reference: "SWP-2026-0001",
      amount: 125000,
      currency: "ZAR",
      channel: "card",
      gateway_response: "Approved",
    },
  };
  const observed = validatePaystackTransactionObservation(payload, {
    reference: "SWP-2026-0001",
    amountCents: 125000,
  });
  assert(observed?.domain === "live", "Valid live transaction observation was rejected.");
  assert(observed.transactionId === "987654321", "Transaction ID was not normalized.");

  const invalid = [
    { ...payload, data: { ...payload.data, domain: "test" } },
    { ...payload, data: { ...payload.data, amount: 124999 } },
    { ...payload, data: { ...payload.data, currency: "USD" } },
    { ...payload, data: { ...payload.data, reference: "another-reference" } },
    { ...payload, data: { ...payload.data, status: "unknown" } },
  ];
  for (const candidate of invalid) {
    assert(
      validatePaystackTransactionObservation(candidate, {
        reference: "SWP-2026-0001",
        amountCents: 125000,
      }) === null,
      "An invalid live transaction observation was accepted.",
    );
  }

  assert(
    validatePaystackVerifiedTransaction(payload, {
      reference: "SWP-2026-0001",
      amountCents: 125000,
    }) !== null,
    "Valid verified live payment was rejected.",
  );
  assert(
    validatePaystackVerifiedTransaction({
      ...payload,
      data: { ...payload.data, status: "pending" },
    }, {
      reference: "SWP-2026-0001",
      amountCents: 125000,
    }) === null,
    "A non-successful transaction was accepted for settlement.",
  );
});

Deno.test("Paystack callback URL allow-list rejects external and insecure URLs", () => {
  assert(isSwayphicsCallbackUrl("https://swayphics.co.za/client-portal/"), "Swayphics callback URL was rejected.");
  assert(isSwayphicsCallbackUrl("https://portal.swayphics.co.za/return"), "Swayphics subdomain callback URL was rejected.");
  for (const url of [
    "http://swayphics.co.za/return",
    "https://swayphics.co.za.attacker.example/return",
    "https://user:pass@swayphics.co.za/return",
    "javascript:alert(1)",
  ]) {
    assert(!isSwayphicsCallbackUrl(url), "Unsafe callback URL was accepted: " + url);
  }
});

Deno.test("Paystack webhook signature verification accepts timestamped and legacy live signatures", async () => {
  const rawBody = '{"event":"charge.success","data":{"reference":"SWP-2026-0001"}}';
  const signingSecret = "whsec_live_unit_test_secret";
  const secretKey = "sk_live_unit_test_secret";
  const now = Math.floor(Date.now() / 1000);

  const modernDigest = await hmacSha512(signingSecret, String(now) + "." + rawBody);
  const modernRequest = new Request("https://swayphics.co.za/webhook", {
    method: "POST",
    headers: { "paystack-signature": "t=" + now + ",v1=whk_test_id:" + modernDigest },
  });
  assert(
    await verifyPaystackWebhookSignature(modernRequest, rawBody, signingSecret, secretKey, now),
    "Valid timestamped Paystack webhook signature was rejected.",
  );

  const staleRequest = new Request("https://swayphics.co.za/webhook", {
    method: "POST",
    headers: { "paystack-signature": "t=" + (now - 301) + ",v1=whk_test_id:" + modernDigest },
  });
  assert(
    !(await verifyPaystackWebhookSignature(staleRequest, rawBody, signingSecret, secretKey, now)),
    "Stale Paystack webhook signature was accepted.",
  );

  const legacyDigest = await hmacSha512(secretKey, rawBody);
  const legacyRequest = new Request("https://swayphics.co.za/webhook", {
    method: "POST",
    headers: { "x-paystack-signature": legacyDigest },
  });
  assert(
    await verifyPaystackWebhookSignature(legacyRequest, rawBody, undefined, secretKey, now),
    "Valid legacy live Paystack webhook signature was rejected.",
  );

  assert(
    !(await verifyPaystackWebhookSignature(legacyRequest, rawBody + " ", undefined, secretKey, now)),
    "Tampered raw webhook body was accepted.",
  );
  assert(
    !(await verifyPaystackWebhookSignature(legacyRequest, rawBody, undefined, "sk_test_unit_test_secret", now)),
    "Legacy test-mode secret key was accepted by live webhook verification.",
  );
});


Deno.test("Paystack signed ping is acknowledged without requiring a data payload or touching financial records", async () => {
  const rawBody = '{"event":"ping"}';
  const handler = createPaystackWebhookHandler({
    env: (name) => ({
      PAYSTACK_SECRET_KEY: "sk_live_unit_test_secret",
      PAYSTACK_ENVIRONMENT: "live",
    } as Record<string, string>)[name],
    verifySignature: async () => true,
    readBody: async () => rawBody,
    createAdmin: () => {
      throw new Error("A ping must not create an admin client or touch financial records.");
    },
  });

  const response = await handler(new Request("https://example.supabase.co/functions/v1/paystack-payment-webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: rawBody,
  }));
  const payload = await response.json();

  assert(response.status === 200, "Signed Paystack ping did not receive HTTP 200.");
  assert(payload.ok === true && payload.received === true && payload.ping === true, "Signed Paystack ping was not acknowledged.");
});
