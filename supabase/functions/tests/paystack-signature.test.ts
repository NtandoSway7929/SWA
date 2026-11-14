import { verifyPaystackWebhookSignature } from "../_shared/paystack.ts";

async function signature(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(bytes)).map((x) =>
    x.toString(16).padStart(2, "0")
  ).join("");
}

Deno.test("accepts current timestamped Paystack-Signature using the webhook signing secret", async () => {
  const secret = "whsec_disposable_test_secret";
  const raw = '{"event":"charge.success","data":{"reference":"SWP-1"}}';
  const now = 1_800_000_000;
  const digest = await signature(secret, String(now) + "." + raw);
  const req = new Request("https://example.test", {
    headers: { "Paystack-Signature": "t=" + now + ",v1=whk_test:" + digest },
  });
  if (
    !await verifyPaystackWebhookSignature(
      req,
      raw,
      secret,
      "sk_test_old_key",
      now,
    )
  ) {
    throw new Error("Current Paystack-Signature header was rejected.");
  }
});

Deno.test("rejects timestamped Paystack signatures outside the five-minute window", async () => {
  const secret = "whsec_disposable_test_secret";
  const raw = '{"event":"charge.success"}';
  const now = 1_800_000_000;
  const digest = await signature(secret, String(now - 301) + "." + raw);
  const req = new Request("https://example.test", {
    headers: {
      "Paystack-Signature": "t=" + (now - 301) + ",v1=whk_test:" + digest,
    },
  });
  if (
    await verifyPaystackWebhookSignature(
      req,
      raw,
      secret,
      "sk_test_old_key",
      now,
    )
  ) {
    throw new Error("A stale Paystack webhook signature was accepted.");
  }
});

Deno.test("supports the documented legacy x-paystack-signature during key migration", async () => {
  const secret = "sk_test_disposable_old_key";
  const raw = '{"event":"charge.success"}';
  const digest = await signature(secret, raw);
  const req = new Request("https://example.test", {
    headers: { "x-paystack-signature": digest },
  });
  if (
    !await verifyPaystackWebhookSignature(
      req,
      raw,
      undefined,
      secret,
      1_800_000_000,
    )
  ) {
    throw new Error("Legacy x-paystack-signature header was rejected.");
  }
});

Deno.test("uses the valid legacy signature when both headers are sent before webhook secret setup", async () => {
  const secretKey = "sk_test_disposable_old_key";
  const raw = '{"event":"charge.success"}';
  const now = 1_800_000_000;
  const legacyDigest = await signature(secretKey, raw);
  const req = new Request("https://example.test", {
    headers: {
      "Paystack-Signature": "t=" + now + ",v1=whk_test:" + "0".repeat(128),
      "x-paystack-signature": legacyDigest,
    },
  });
  if (
    !await verifyPaystackWebhookSignature(
      req,
      raw,
      undefined,
      secretKey,
      now,
    )
  ) {
    throw new Error("A valid legacy signature was rejected when both headers were present.");
  }
});

Deno.test("does not downgrade to the legacy signature when webhook signing secret is configured", async () => {
  const secretKey = "sk_test_disposable_old_key";
  const webhookSecret = "whsec_disposable_test_secret";
  const raw = '{"event":"charge.success"}';
  const now = 1_800_000_000;
  const legacyDigest = await signature(secretKey, raw);
  const req = new Request("https://example.test", {
    headers: {
      "Paystack-Signature": "t=" + (now - 301) + ",v1=whk_test:" + "0".repeat(128),
      "x-paystack-signature": legacyDigest,
    },
  });
  if (
    await verifyPaystackWebhookSignature(
      req,
      raw,
      webhookSecret,
      secretKey,
      now,
    )
  ) {
    throw new Error("The verifier downgraded to the legacy signature after modern signing was configured.");
  }
});

Deno.test("rejects altered raw bodies even when the original payload was signed", async () => {
  const secret = "whsec_disposable_test_secret";
  const raw = '{"event":"charge.success"}';
  const digest = await signature(secret, "1800000000." + raw);
  const req = new Request("https://example.test", {
    headers: { "Paystack-Signature": "t=1800000000,v1=whk_test:" + digest },
  });
  if (
    await verifyPaystackWebhookSignature(
      req,
      raw + " ",
      secret,
      undefined,
      1_800_000_000,
    )
  ) {
    throw new Error("An altered webhook body was accepted.");
  }
});
