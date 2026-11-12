import { verifyYocoWebhookSignature } from "../_shared/yoco-signature.ts";
import {
  getYocoCheckoutId,
  getYocoPaymentSuccessDetails,
  getYocoProcessingMode,
  getYocoRefundSuccessDetails,
  normalizeYocoWebhookEvent,
} from "../_shared/yoco-webhook-validation.ts";
import { getAdminClient, json, sha256Hex } from "../_shared/yoco.ts";

async function readLimitedRawBody(
  req: Request,
  maxBytes: number,
): Promise<string | null> {
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

type WebhookDependencies = {
  verifySignature: (req: Request, rawBody: string) => Promise<boolean>;
  createAdmin: () => any;
  hashBody: (value: string) => Promise<string>;
  respond: typeof json;
  logError: (...values: unknown[]) => void;
  logWarn: (...values: unknown[]) => void;
};

const defaults: WebhookDependencies = {
  verifySignature: verifyYocoWebhookSignature,
  createAdmin: getAdminClient,
  hashBody: sha256Hex,
  respond: json,
  logError: (...values) => console.error(...values),
  logWarn: (...values) => console.warn(...values),
};

export function createYocoWebhookHandler(
  overrides: Partial<WebhookDependencies> = {},
) {
  const deps = { ...defaults, ...overrides };
  const respond = deps.respond;

  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") {
      return respond({ ok: false, error: "Method not allowed." }, 405);
    }

    let admin: any;
    let eventId: string | null = null;
    let leaseToken: string | null = null;

    const updateEvent = async (
      status:
        | "processing"
        | "processed"
        | "failed_retryable"
        | "requires_review"
        | "rejected",
      values: {
        attemptId?: string;
        failureCode?: string;
        failureMessage?: string;
      } = {},
    ): Promise<boolean> => {
      if (!admin || !eventId || !leaseToken) return false;
      const { data, error } = await admin.rpc("yoco_update_webhook_event", {
        p_event_id: eventId,
        p_lease_token: leaseToken,
        p_processing_status: status,
        p_payment_attempt_id: values.attemptId ?? null,
        p_failure_code: values.failureCode ?? null,
        p_failure_message: values.failureMessage ?? null,
      });
      if (error) {
        deps.logError(
          "Could not persist fenced Yoco webhook state:",
          error.message,
        );
        return false;
      }
      return data === true;
    };

    try {
      const declaredLength = Number(req.headers.get("content-length") || 0);
      if (declaredLength > 256_000) {
        return respond({ ok: false, error: "Webhook payload too large." }, 413);
      }

      let rawBody: string | null;
      try {
        rawBody = await readLimitedRawBody(req, 256_000);
      } catch {
        return respond({
          ok: false,
          error: "Webhook payload must be valid UTF-8.",
        }, 400);
      }
      if (rawBody === null) {
        return respond({ ok: false, error: "Webhook payload too large." }, 413);
      }

      if (!await deps.verifySignature(req, rawBody)) {
        deps.logWarn(
          "Rejected Yoco webhook with invalid signature or stale timestamp.",
        );
        return respond({ ok: false, error: "Invalid webhook signature." }, 401);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        return respond({ ok: false, error: "Invalid webhook JSON." }, 400);
      }
      const event = normalizeYocoWebhookEvent(parsed);
      if (!event) {
        return respond({
          ok: false,
          error: "Webhook event identity is invalid.",
        }, 400);
      }

      // This endpoint and its database schema are test-environment only.
      // Never persist an explicitly live-mode financial event in the test
      // webhook inbox or test ledger. Acknowledge it without processing so
      // the provider does not retry an unsupported live integration.
      const eventMode = getYocoProcessingMode(event.payload);
      if (eventMode && eventMode !== "test") {
        deps.logWarn(
          "Ignored Yoco webhook outside the enabled test environment:",
          eventMode,
        );
        return respond({
          ok: true,
          received: true,
          ignored: true,
          reason: "live_mode_not_enabled",
        });
      }

      admin = deps.createAdmin();
      const { data: recorded, error: recordError } = await admin.rpc(
        "yoco_record_verified_webhook",
        {
          p_provider_event_id: event.id,
          p_event_type: event.type,
          p_body_sha256: await deps.hashBody(rawBody),
        },
      );
      if (recordError || !recorded?.event_id) {
        deps.logError(
          "Could not record verified Yoco webhook:",
          recordError?.message || "No event record.",
        );
        return respond(
          { ok: false, error: "Webhook could not be recorded." },
          503,
        );
      }
      eventId = recorded.event_id;

      if (
        ["processed", "requires_review", "rejected"].includes(
          recorded.processing_status,
        )
      ) {
        return respond({
          ok: true,
          received: true,
          duplicate: !!recorded.duplicate,
          requires_review: recorded.processing_status === "requires_review",
          rejected: recorded.processing_status === "rejected",
        });
      }
      if (
        !["received", "processing", "failed_retryable"].includes(
          recorded.processing_status,
        )
      ) {
        deps.logError(
          "Yoco webhook has an unknown processing state:",
          recorded.processing_status,
        );
        return respond({
          ok: false,
          error: "Webhook processing state is not recognised.",
        }, 503);
      }

      const { data: claim, error: claimError } = await admin.rpc(
        "yoco_claim_webhook_event",
        {
          p_event_id: eventId,
          p_lease_seconds: 120,
        },
      );
      if (claimError) {
        deps.logError(
          "Could not claim Yoco webhook event:",
          claimError.message,
        );
        return respond({
          ok: false,
          error: "Webhook is temporarily unavailable for processing.",
        }, 503);
      }
      if (!claim?.claimed) {
        if (claim?.reason === "terminal") {
          return respond({
            ok: true,
            received: true,
            duplicate: true,
            requires_review: claim.processing_status === "requires_review",
          });
        }
        if (claim?.reason === "lease_active") {
          return respond({
            ok: false,
            error: "Webhook delivery is already being processed.",
          }, 503);
        }
        deps.logError(
          "Yoco webhook claim was not granted:",
          claim?.reason || "unknown",
        );
        return respond({
          ok: false,
          error: "Webhook could not acquire a processing lease.",
        }, 503);
      }
      leaseToken = claim.lease_token;
      if (typeof leaseToken !== "string" || !leaseToken) {
        deps.logError("Yoco webhook claim returned no lease token.");
        return respond({
          ok: false,
          error: "Webhook lease could not be established.",
        }, 503);
      }

      const review = async (
        code: string,
        message: string,
        attemptId?: string,
      ) => {
        const saved = await updateEvent("requires_review", {
          failureCode: code,
          failureMessage: message,
          attemptId,
        });
        return saved
          ? respond({ ok: true, received: true, requires_review: true })
          : respond({
            ok: false,
            error: "Webhook event state could not be saved yet.",
          }, 503);
      };

      if (event.type === "payment.succeeded") {
        const details = getYocoPaymentSuccessDetails(event.payload);
        if (!details) {
          return await review(
            "incomplete_provider_payload",
            "Verified success event lacked required checkout, amount, currency or mode fields.",
          );
        }

        const { data: attempt, error } = await admin.from("payment_attempts")
          .select("id")
          .eq("provider", "yoco")
          .eq("environment", "test")
          .eq("provider_checkout_id", details.checkoutId)
          .maybeSingle();
        if (error) {
          deps.logError("Could not resolve Yoco checkout:", error.message);
          return respond({
            ok: false,
            error: "Verified payment event could not be matched yet.",
          }, 503);
        }
        if (!attempt) {
          return await review(
            "unmatched_checkout",
            "Verified provider checkout did not match a local payment attempt.",
          );
        }

        const { data: settlement, error: settlementError } = await admin.rpc(
          "yoco_settle_payment_with_lease",
          {
            p_attempt_id: attempt.id,
            p_event_id: eventId,
            p_lease_token: leaseToken,
            p_provider_checkout_id: details.checkoutId,
            p_amount_cents: details.amount,
            p_currency: details.currency,
            p_processing_mode: details.mode,
            p_provider_transaction_id: details.transactionId,
          },
        );
        if (settlementError) {
          deps.logError(
            "Yoco settlement requires retry or review:",
            settlementError.message,
          );
          return respond({
            ok: false,
            error: "Verified event could not be settled yet.",
          }, 503);
        }
        return respond({ ok: true, received: true, settlement });
      }

      if (event.type === "payment.failed") {
        const checkoutId = getYocoCheckoutId(event.payload);
        if (!checkoutId) {
          return await review(
            "failed_event_unmatched",
            "Payment failure event did not include a checkout reference.",
          );
        }
        const { data: attempt, error } = await admin.from("payment_attempts")
          .select("id")
          .eq("provider", "yoco")
          .eq("environment", "test")
          .eq("provider_checkout_id", checkoutId)
          .maybeSingle();
        if (error) {
          deps.logError(
            "Could not resolve failed Yoco checkout:",
            error.message,
          );
          return respond({
            ok: false,
            error: "Verified payment failure could not be matched yet.",
          }, 503);
        }
        if (!attempt) {
          return await review(
            "unmatched_failed_checkout",
            "Payment failure event did not match a local attempt.",
          );
        }
        const { data: failure, error: failureError } = await admin.rpc(
          "yoco_record_payment_failure_with_lease",
          {
            p_event_id: eventId,
            p_lease_token: leaseToken,
            p_attempt_id: attempt.id,
          },
        );
        if (failureError) {
          deps.logError(
            "Yoco payment failure requires retry or review:",
            failureError.message,
          );
          return respond({
            ok: false,
            error: "Payment failure could not be recorded yet.",
          }, 503);
        }
        return respond({ ok: true, received: true, ...failure });
      }

      if (event.type === "refund.succeeded") {
        const details = getYocoRefundSuccessDetails(event.payload);
        if (!details) {
          return await review(
            "incomplete_refund_payload",
            "Verified refund event lacked a provider refund ID, checkout reference, amount, currency or mode.",
          );
        }

        const { data: attempt, error } = await admin.from("payment_attempts")
          .select("id,payment_id")
          .eq("provider", "yoco")
          .eq("environment", "test")
          .eq("provider_checkout_id", details.checkoutId)
          .maybeSingle();
        if (error) {
          deps.logError(
            "Could not resolve Yoco refund checkout:",
            error.message,
          );
          return respond({
            ok: false,
            error: "Verified refund could not be matched yet.",
          }, 503);
        }
        if (!attempt?.payment_id) {
          return await review(
            "refund_mapping_required",
            "Verified refund checkout did not match a settled local test payment.",
          );
        }

        const associated = await updateEvent("processing", {
          attemptId: attempt.id,
        });
        if (!associated) {
          return respond({
            ok: false,
            error: "Refund event association could not be saved yet.",
          }, 503);
        }
        const { data: refund, error: refundError } = await admin.rpc(
          "yoco_record_refund_success_with_lease",
          {
            p_event_id: eventId,
            p_lease_token: leaseToken,
            p_payment_id: attempt.payment_id,
            p_provider_refund_id: details.providerRefundId,
            p_amount_cents: details.amount,
            p_currency: details.currency,
          },
        );
        if (refundError) {
          deps.logError(
            "Yoco refund recording requires retry or review:",
            refundError.message,
          );
          return respond({
            ok: false,
            error: "Verified refund could not be recorded yet.",
          }, 503);
        }
        return respond({ ok: true, received: true, refund });
      }

      return await review(
        "non_success_event",
        "Provider event retained; no financial ledger mutation was performed.",
      );
    } catch (error) {
      deps.logError(
        "Yoco webhook handler failed:",
        error instanceof Error ? error.message : "Unknown error.",
      );
      return respond({
        ok: false,
        error: "Webhook processing is temporarily unavailable.",
      }, 500);
    }
  };
}

if (import.meta.main) Deno.serve(createYocoWebhookHandler());
