import {
  getAdminClient,
  json,
  sha256Hex,
} from "../_shared/yoco.ts";

const SIGNATURE_TOLERANCE_SECONDS = 180;

function decodeBase64(value: string) {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function verifyYocoSignature(req: Request, rawBody: string) {
  const webhookId = req.headers.get("webhook-id") || "";
  const timestamp = req.headers.get("webhook-timestamp") || "";
  const signatureHeader = req.headers.get("webhook-signature") || "";
  const secret = Deno.env.get("YOCO_WEBHOOK_SECRET") || "";

  if (!webhookId || !/^\d+$/.test(timestamp) || !signatureHeader ||
      !secret.startsWith("whsec_")) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) ||
      Math.abs(Date.now() / 1000 - timestampSeconds) > SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }

  const keyBytes = decodeBase64(secret.slice("whsec_".length));
  if (!keyBytes) return false;

  const signedContent = webhookId + "." + timestamp + "." + rawBody;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(signedContent),
  ));

  // Yoco signatures are versioned; compare every supplied v1 signature.
  const candidates = Array.from(
    signatureHeader.matchAll(/(?:^|\\s)v1,([A-Za-z0-9+/=]+)/g),
    (match) => match[1],
  );

  return candidates.some((candidate) => {
    const decoded = decodeBase64(candidate);
    return !!decoded && constantTimeEqual(expected, decoded);
  });
}

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);

  try {
    const rawBody = await req.text();
    if (rawBody.length > 256_000) return json({ ok: false, error: "Webhook payload too large." }, 413);

    const verified = await verifyYocoSignature(req, rawBody);
    if (!verified) {
      console.warn("Rejected Yoco webhook with invalid signature or stale timestamp.");
      return json({ ok: false, error: "Invalid webhook signature." }, 401);
    }

    const webhookId = req.headers.get("webhook-id")!;
    let event: Record<string, any>;
    try {
      event = asObject(JSON.parse(rawBody));
    } catch {
      return json({ ok: false, error: "Invalid webhook JSON." }, 400);
    }

    const eventType = typeof event.type === "string" ? event.type : "";
    if (!eventType || typeof event.id !== "string" || !event.id) {
      return json({ ok: false, error: "Webhook event identity is invalid." }, 400);
    }

    const admin = getAdminClient();
    const digest = await sha256Hex(rawBody);
    const { data: recorded, error: recordError } = await admin.rpc("yoco_record_verified_webhook", {
      p_provider_event_id: String(event.id),
      p_event_type: eventType,
      p_body_sha256: digest,
    });
    if (recordError || !recorded?.event_id) {
      console.error("Could not record verified Yoco webhook:", recordError?.message || "No event record.");
      return json({ ok: false, error: "Webhook could not be recorded." }, 503);
    }

    if (recorded.processing_status === "requires_review") {
      return json({ ok: true, received: true, requires_review: true });
    }

    if (recorded.duplicate && recorded.processing_status === "processed") {
      return json({ ok: true, received: true, duplicate: true });
    }

    const payload = asObject(event.payload ?? event.data);
    if (eventType === "payment.succeeded") {
      const checkoutId = String(
        payload.checkoutId ??
        payload.checkout_id ??
        payload.metadata?.checkoutId ??
        "",
      );
      const amount = Number(payload.amount);
      const currency = String(payload.currency || "");
      const mode = String(payload.mode || payload.processingMode || payload.processing_mode || "");

      if (!checkoutId || !Number.isSafeInteger(amount) || amount < 1 || !currency || !mode) {
        await admin.from("payment_webhook_events")
          .update({
            processing_status: "requires_review",
            failure_code: "incomplete_provider_payload",
            failure_message: "Verified success event did not contain the required checkout, amount, currency and mode fields.",
            processed_at: new Date().toISOString(),
          })
          .eq("id", recorded.event_id);
        return json({ ok: true, received: true, requires_review: true });
      }

      const { data: attempt, error: attemptError } = await admin
        .from("payment_attempts")
        .select("id")
        .eq("provider", "yoco")
        .eq("environment", "test")
        .eq("provider_checkout_id", checkoutId)
        .maybeSingle();

      if (attemptError || !attempt) {
        await admin.from("payment_webhook_events")
          .update({
            processing_status: "requires_review",
            failure_code: "unmatched_checkout",
            failure_message: "Verified provider checkout did not match a local payment attempt.",
            processed_at: new Date().toISOString(),
          })
          .eq("id", recorded.event_id);
        return json({ ok: true, received: true, requires_review: true });
      }

      const transactionId = typeof payload.transactionId === "string"
        ? payload.transactionId
        : typeof payload.paymentId === "string"
        ? payload.paymentId
        : null;

      const { data: settlement, error: settlementError } = await admin.rpc("yoco_settle_payment", {
        p_attempt_id: attempt.id,
        p_event_id: recorded.event_id,
        p_provider_checkout_id: checkoutId,
        p_amount_cents: amount,
        p_currency: currency,
        p_processing_mode: mode,
        p_provider_transaction_id: transactionId,
      });

      if (settlementError) {
        console.error("Yoco settlement requires retry or review:", settlementError.message);
        return json({ ok: false, error: "Verified event could not be settled yet." }, 503);
      }
      return json({ ok: true, received: true, settlement });
    }

    if (eventType === "refund.succeeded") {
      const providerRefundId = String(payload.refundId ?? payload.refund_id ?? "");
      const amount = Number(payload.amount);
      const currency = String(payload.currency || "");

      // Do not guess which local payment a provider refund belongs to. If the
      // event does not contain a known attempt ID, keep it for admin review.
      const attemptId = String(payload.metadata?.paymentAttemptId ?? "");
      const { data: attempt } = attemptId
        ? await admin.from("payment_attempts").select("payment_id").eq("id", attemptId).maybeSingle()
        : { data: null };

      if (!attempt?.payment_id || !providerRefundId || !Number.isSafeInteger(amount) || amount < 1 || !currency) {
        await admin.from("payment_webhook_events")
          .update({
            processing_status: "requires_review",
            failure_code: "refund_mapping_required",
            failure_message: "Verified refund event requires an unambiguous local payment mapping.",
            processed_at: new Date().toISOString(),
          })
          .eq("id", recorded.event_id);
        return json({ ok: true, received: true, requires_review: true });
      }

      const { data: refund, error: refundError } = await admin.rpc("yoco_record_refund_success", {
        p_event_id: recorded.event_id,
        p_payment_id: attempt.payment_id,
        p_provider_refund_id: providerRefundId,
        p_amount_cents: amount,
        p_currency: currency,
      });
      if (refundError) {
        console.error("Yoco refund recording requires review:", refundError.message);
        return json({ ok: false, error: "Verified refund could not be recorded yet." }, 503);
      }
      return json({ ok: true, received: true, refund });
    }

    // Failure notifications are retained for investigation. They never create
    // a payment or change invoice balances.
    await admin.from("payment_webhook_events")
      .update({
        processing_status: "requires_review",
        failure_code: "non_success_event",
        failure_message: "Provider event retained; no financial ledger mutation was performed.",
        processed_at: new Date().toISOString(),
      })
      .eq("id", recorded.event_id);

    return json({ ok: true, received: true, recorded_only: true });
  } catch (error) {
    console.error("Yoco webhook handler failed:", error instanceof Error ? error.message : "Unknown error.");
    return json({ ok: false, error: "Webhook processing is temporarily unavailable." }, 500);
  }
});
