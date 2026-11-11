import { verifyYocoWebhookSignature } from "../_shared/yoco-signature.ts";
import {
  getYocoCheckoutId,
  getYocoPaymentSuccessDetails,
  getYocoRefundSuccessDetails,
  normalizeYocoWebhookEvent,
} from "../_shared/yoco-webhook-validation.ts";
import {
  getAdminClient,
  json,
  sha256Hex,
} from "../_shared/yoco.ts";

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

async function readLimitedRawBody(req: Request, maxBytes: number): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);

  try {
    const declaredLength = Number(req.headers.get("content-length") || 0);
    if (declaredLength > 256_000) {
      return json({ ok: false, error: "Webhook payload too large." }, 413);
    }
    let rawBody: string | null;
    try {
      rawBody = await readLimitedRawBody(req, 256_000);
    } catch {
      return json({ ok: false, error: "Webhook payload must be valid UTF-8." }, 400);
    }
    if (rawBody === null) return json({ ok: false, error: "Webhook payload too large." }, 413);

    const verified = await verifyYocoWebhookSignature(req, rawBody);
    if (!verified) {
      console.warn("Rejected Yoco webhook with invalid signature or stale timestamp.");
      return json({ ok: false, error: "Invalid webhook signature." }, 401);
    }

    const webhookId = req.headers.get("webhook-id")!;
    let parsedEvent: unknown;
    try {
      parsedEvent = JSON.parse(rawBody);
    } catch {
      return json({ ok: false, error: "Invalid webhook JSON." }, 400);
    }
    const event = normalizeYocoWebhookEvent(parsedEvent);
    if (!event) return json({ ok: false, error: "Webhook event identity is invalid." }, 400);
    const eventType = event.type;

    const admin = getAdminClient();
    const digest = await sha256Hex(rawBody);
    const { data: recorded, error: recordError } = await admin.rpc("yoco_record_verified_webhook", {
      p_provider_event_id: event.id,
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

    const payload = event.payload;
    if (eventType === "payment.succeeded") {
      const details = getYocoPaymentSuccessDetails(payload);
      if (!details) {
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
        .eq("provider_checkout_id", details.checkoutId)
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

      const { data: settlement, error: settlementError } = await admin.rpc("yoco_settle_payment", {
        p_attempt_id: attempt.id,
        p_event_id: recorded.event_id,
        p_provider_checkout_id: details.checkoutId,
        p_amount_cents: details.amount,
        p_currency: details.currency,
        p_processing_mode: details.mode,
        p_provider_transaction_id: details.transactionId,
      });

      if (settlementError) {
        console.error("Yoco settlement requires retry or review:", settlementError.message);
        return json({ ok: false, error: "Verified event could not be settled yet." }, 503);
      }
      return json({ ok: true, received: true, settlement });
    }

    if (eventType === "payment.failed") {
      const checkoutId = getYocoCheckoutId(payload);
      if (!checkoutId) {
        await admin.from("payment_webhook_events")
          .update({
            processing_status: "requires_review",
            failure_code: "failed_event_unmatched",
            failure_message: "Payment failure event did not include a checkout reference.",
            processed_at: new Date().toISOString(),
          })
          .eq("id", recorded.event_id);
        return json({ ok: true, received: true, requires_review: true });
      }

      const { data: attempt, error: attemptError } = await admin
        .from("payment_attempts")
        .select("id,status")
        .eq("provider", "yoco")
        .eq("environment", "test")
        .eq("provider_checkout_id", checkoutId)
        .maybeSingle();

      if (attemptError || !attempt) {
        await admin.from("payment_webhook_events")
          .update({
            processing_status: "requires_review",
            failure_code: "unmatched_failed_checkout",
            failure_message: "Payment failure event did not match a local attempt.",
            processed_at: new Date().toISOString(),
          })
          .eq("id", recorded.event_id);
        return json({ ok: true, received: true, requires_review: true });
      }

      if (attempt.status === "succeeded") {
        await admin.from("payment_webhook_events")
          .update({
            payment_attempt_id: attempt.id,
            processing_status: "requires_review",
            failure_code: "conflicting_payment_events",
            failure_message: "A failure event arrived after the attempt had already settled.",
            processed_at: new Date().toISOString(),
          })
          .eq("id", recorded.event_id);
        return json({ ok: true, received: true, requires_review: true });
      }

      const { error: updateError } = await admin
        .from("payment_attempts")
        .update({
          status: "failed",
          failure_code: "provider_payment_failed",
          failure_message: "Yoco reported that the payment failed.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", attempt.id)
        .in("status", ["created", "pending", "requires_review"]);

      if (updateError) {
        console.error("Could not update failed Yoco payment attempt:", updateError.message);
        return json({ ok: false, error: "Payment failure could not be recorded yet." }, 503);
      }

      await admin.from("payment_webhook_events")
        .update({
          payment_attempt_id: attempt.id,
          processing_status: "processed",
          processed_at: new Date().toISOString(),
        })
        .eq("id", recorded.event_id);

      return json({ ok: true, received: true, payment_failed: true });
    }

    if (eventType === "refund.succeeded") {
      const details = getYocoRefundSuccessDetails(payload);
      // Do not guess which local payment a provider refund belongs to. If the
      // event does not contain a known attempt ID, keep it for admin review.
      const attemptId = details?.paymentAttemptId ?? "";
      const { data: attempt } = attemptId
        ? await admin.from("payment_attempts")
          .select("id,payment_id")
          .eq("id", attemptId)
          .eq("provider", "yoco")
          .eq("environment", "test")
          .maybeSingle()
        : { data: null };

      if (!attempt?.payment_id || !details) {
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

      const { error: associateError } = await admin
        .from("payment_webhook_events")
        .update({ payment_attempt_id: attempt.id })
        .eq("id", recorded.event_id)
        .is("payment_attempt_id", null);
      if (associateError) {
        console.error("Could not bind Yoco refund event to its payment attempt:", associateError.message);
        return json({ ok: false, error: "Verified refund requires manual review." }, 503);
      }

      const { data: refund, error: refundError } = await admin.rpc("yoco_record_refund_success", {
        p_event_id: recorded.event_id,
        p_payment_id: attempt.payment_id,
        p_provider_refund_id: details.providerRefundId,
        p_amount_cents: details.amount,
        p_currency: details.currency,
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
