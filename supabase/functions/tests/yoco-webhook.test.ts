import { verifyYocoWebhookSignature } from "../_shared/yoco.ts";

Deno.test("Yoco webhook signature verification accepts valid v1 and rejects tampering or stale deliveries", async () => {
  const previousSecret = Deno.env.get("YOCO_WEBHOOK_SECRET");
  const secretBytes = new TextEncoder().encode("swayphics-yoco-webhook-test-secret");
  const secret = "whsec_" + btoa(String.fromCharCode(...secretBytes));
  Deno.env.set("YOCO_WEBHOOK_SECRET", secret);

  try {
    const nowMs = 1_800_000_000_000;
    const timestamp = String(Math.floor(nowMs / 1000));
    const webhookId = "wh_test_123";
    const rawBody = '{"id":"evt_test_123","type":"payment.succeeded","payload":{"amount":1000,"currency":"ZAR","mode":"test"}}';
    const key = await crypto.subtle.importKey(
      "raw",
      secretBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signed = webhookId + "." + timestamp + "." + rawBody;
    const digest = new Uint8Array(await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(signed),
    ));
    const validSignature = btoa(String.fromCharCode(...digest));

    const makeRequest = (bodySignature: string, time = timestamp) =>
      new Request("https://example.test/webhook", {
        method: "POST",
        headers: {
          "webhook-id": webhookId,
          "webhook-timestamp": time,
          "webhook-signature": bodySignature,
        },
      });

    const valid = await verifyYocoWebhookSignature(
      makeRequest("v1,invalid v1," + validSignature),
      rawBody,
      nowMs,
    );
    if (!valid) throw new Error("A valid v1 signature among multiple candidates was rejected.");

    const alteredBody = await verifyYocoWebhookSignature(
      makeRequest("v1," + validSignature),
      rawBody + " ",
      nowMs,
    );
    if (alteredBody) throw new Error("A modified raw body was accepted.");

    const stale = await verifyYocoWebhookSignature(
      makeRequest("v1," + validSignature, String(Number(timestamp) - 181)),
      rawBody,
      nowMs,
    );
    if (stale) throw new Error("A webhook outside the 180-second tolerance was accepted.");

    const wrongId = await verifyYocoWebhookSignature(
      new Request("https://example.test/webhook", {
        method: "POST",
        headers: {
          "webhook-id": "wh_different",
          "webhook-timestamp": timestamp,
          "webhook-signature": "v1," + validSignature,
        },
      }),
      rawBody,
      nowMs,
    );
    if (wrongId) throw new Error("A signature for a different webhook ID was accepted.");
  } finally {
    if (previousSecret === undefined) Deno.env.delete("YOCO_WEBHOOK_SECRET");
    else Deno.env.set("YOCO_WEBHOOK_SECRET", previousSecret);
  }
});
