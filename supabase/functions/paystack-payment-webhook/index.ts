import { getAdminClient, json, sha256Hex } from "../_shared/yoco.ts";
import {
  validatePaystackVerifiedTransaction,
  verifyPaystackWebhookSignature,
} from "../_shared/paystack.ts";

async function readRawBody(
  req: Request,
  maxBytes: number,
): Promise<string | null> {
  const length = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(length) && length > maxBytes) return null;
  const reader = req.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

type Dependencies = {
  env: (name: string) => string | undefined;
  createAdmin: () => any;
  request: typeof fetch;
  verifySignature: typeof verifyPaystackWebhookSignature;
  hashBody: typeof sha256Hex;
  readBody: typeof readRawBody;
  respond: typeof json;
  logError: (...values: unknown[]) => void;
  logWarn: (...values: unknown[]) => void;
};

const defaults: Dependencies = {
  env: (name) => Deno.env.get(name),
  createAdmin: getAdminClient,
  request: fetch,
  verifySignature: verifyPaystackWebhookSignature,
  hashBody: sha256Hex,
  readBody: readRawBody,
  respond: json,
  logError: (...values) => console.error(...values),
  logWarn: (...values) => console.warn(...values),
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeReference(value: unknown): string | null {
  return typeof value === "string" && value.length >= 8 &&
      value.length <= 128 &&
      /^[A-Za-z0-9._-]+$/.test(value)
    ? value
    : null;
}

export function createPaystackWebhookHandler(
  overrides: Partial<Dependencies> = {},
) {
  const deps = { ...defaults, ...overrides };
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") {
      return deps.respond({ ok: false, error: "Method not allowed." }, 405);
    }

    const secretKey = deps.env("PAYSTACK_SECRET_KEY");
    const webhookSecret = deps.env("PAYSTACK_WEBHOOK_SECRET");
    const environment = deps.env("PAYSTACK_ENVIRONMENT");
    if (
      !secretKey || !secretKey.startsWith("sk_test_") || environment !== "test"
    ) {
      return deps.respond({
        ok: false,
        error: "Paystack test webhook is not configured.",
      }, 503);
    }

    let raw: string | null;
    try {
      raw = await deps.readBody(req, 256_000);
    } catch {
      return deps.respond({
        ok: false,
        error: "Webhook body must be valid UTF-8.",
      }, 400);
    }
    if (raw === null) {
      return deps.respond({
        ok: false,
        error: "Webhook body is invalid or too large.",
      }, 413);
    }

    try {
      if (!await deps.verifySignature(req, raw, webhookSecret, secretKey)) {
        deps.logWarn(
          "Rejected Paystack webhook with invalid signature or stale timestamp.",
        );
        return deps.respond(
          { ok: false, error: "Invalid webhook signature." },
          401,
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return deps.respond({ ok: false, error: "Invalid webhook JSON." }, 400);
      }
      const event = record(parsed);
      const data = record(event?.data);
      if (!event || !data || typeof event.event !== "string") {
        return deps.respond({
          ok: false,
          error: "Webhook event structure is invalid.",
        }, 400);
      }

      // The database and payment ledger are deliberately test-only. Signed live
      // notifications are acknowledged but never inserted into the test ledger.
      if (data.domain !== "test") {
        deps.logWarn(
          "Ignored signed Paystack event outside the test environment.",
        );
        return deps.respond({
          ok: true,
          received: true,
          ignored: true,
          reason: "live_mode_not_enabled",
        });
      }

      // Other signed events (including refund events) are not part of the first
      // test integration. They are acknowledged without financial side effects.
      if (event.event !== "charge.success") {
        return deps.respond({
          ok: true,
          received: true,
          ignored: true,
          reason: "event_not_supported",
        });
      }

      const reference = safeReference(data.reference);
      if (!reference) {
        return deps.respond({
          ok: false,
          error: "Paystack transaction reference is invalid.",
        }, 400);
      }

      const transactionId = data.id;
      if (
        (typeof transactionId !== "number" &&
          typeof transactionId !== "string") ||
        !/^\d+$/.test(String(transactionId))
      ) {
        return deps.respond({
          ok: false,
          error: "Paystack transaction identity is invalid.",
        }, 400);
      }

      const verification = await deps.request(
        "https://api.paystack.co/transaction/verify/" +
          encodeURIComponent(reference),
        {
          method: "GET",
          headers: {
            "Authorization": "Bearer " + secretKey,
            "Accept": "application/json",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!verification.ok) {
        deps.logError(
          "Paystack transaction verification returned HTTP",
          verification.status,
        );
        return deps.respond({
          ok: false,
          error:
            "Paystack transaction verification is temporarily unavailable.",
        }, 503);
      }

      const verificationPayload = await verification.json();
      const verifiedData = record(record(verificationPayload)?.data);
      if (!verifiedData || !Number.isSafeInteger(verifiedData.amount)) {
        deps.logWarn(
          "Paystack verification returned incomplete transaction details.",
        );
        return deps.respond({
          ok: false,
          error: "Paystack transaction details are incomplete.",
        }, 503);
      }
      const verified = validatePaystackVerifiedTransaction(
        verificationPayload,
        { reference, amountCents: Number(verifiedData.amount) },
      );
      if (!verified || verified.transactionId !== String(transactionId)) {
        deps.logWarn(
          "Paystack webhook did not match the verified transaction resource.",
        );
        return deps.respond({
          ok: false,
          error:
            "Paystack transaction verification did not match the notification.",
        }, 503);
      }

      const admin = deps.createAdmin();
      const stableEventId = "charge.success:" + verified.transactionId + ":" +
        verified.reference;
      const { data: recorded, error: recordError } = await admin.rpc(
        "paystack_record_verified_webhook",
        {
          p_provider_event_id: stableEventId,
          p_event_type: "charge.success",
          p_body_sha256: await deps.hashBody(raw),
        },
      );
      if (recordError || !recorded?.event_id) {
        deps.logError(
          "Could not persist verified Paystack webhook:",
          recordError?.message || "No event record.",
        );
        return deps.respond({
          ok: false,
          error: "Verified Paystack event could not be recorded.",
        }, 503);
      }

      if (
        ["processed", "requires_review", "rejected"].includes(
          recorded.processing_status,
        )
      ) {
        return deps.respond({
          ok: true,
          received: true,
          duplicate: !!recorded.duplicate,
          requires_review: recorded.processing_status === "requires_review",
        });
      }

      const { data: claim, error: claimError } = await admin.rpc(
        "paystack_claim_webhook_event",
        { p_event_id: recorded.event_id, p_lease_seconds: 120 },
      );
      if (claimError) {
        deps.logError(
          "Could not claim Paystack webhook event:",
          claimError.message,
        );
        return deps.respond({
          ok: false,
          error: "Paystack event processing is temporarily unavailable.",
        }, 503);
      }
      if (!claim?.claimed) {
        if (claim?.reason === "terminal") {
          return deps.respond({ ok: true, received: true, duplicate: true });
        }
        return deps.respond({
          ok: false,
          error: "Paystack event is already being processed.",
        }, 503);
      }
      const leaseToken = claim.lease_token;
      if (typeof leaseToken !== "string" || !leaseToken) {
        deps.logError("Paystack webhook claim returned no lease token.");
        return deps.respond({
          ok: false,
          error: "Paystack event lease could not be established.",
        }, 503);
      }

      const review = async (
        code: string,
        message: string,
        attemptId?: string,
      ) => {
        const { data: saved, error } = await admin.rpc(
          "paystack_update_webhook_event",
          {
            p_event_id: recorded.event_id,
            p_lease_token: leaseToken,
            p_processing_status: "requires_review",
            p_payment_attempt_id: attemptId ?? null,
            p_failure_code: code,
            p_failure_message: message,
          },
        );
        return !error && saved === true
          ? deps.respond({ ok: true, received: true, requires_review: true })
          : deps.respond({
            ok: false,
            error: "Paystack review state could not be saved.",
          }, 503);
      };

      const { data: attempt, error: attemptError } = await admin
        .from("payment_attempts")
        .select("id,amount_cents,currency,status")
        .eq("provider", "paystack")
        .eq("environment", "test")
        .eq("provider_checkout_id", verified.reference)
        .maybeSingle();
      if (attemptError) {
        deps.logError(
          "Could not match Paystack reference to payment attempt:",
          attemptError.message,
        );
        return deps.respond({
          ok: false,
          error: "Paystack payment attempt lookup failed.",
        }, 503);
      }
      if (!attempt) {
        return await review(
          "unmatched_provider_reference",
          "Verified Paystack transaction reference did not match a local payment attempt.",
        );
      }

      const { data: settlement, error: settlementError } = await admin.rpc(
        "paystack_settle_payment_with_lease",
        {
          p_attempt_id: attempt.id,
          p_event_id: recorded.event_id,
          p_lease_token: leaseToken,
          p_provider_checkout_id: verified.reference,
          p_amount_cents: verified.amountCents,
          p_currency: verified.currency,
          p_processing_mode: verified.domain,
          p_provider_transaction_id: verified.transactionId,
          p_payment_channel: verified.channel,
        },
      );
      if (settlementError) {
        deps.logError(
          "Paystack settlement requires retry or review:",
          settlementError.message,
        );
        return deps.respond({
          ok: false,
          error: "Verified Paystack event could not be settled yet.",
        }, 503);
      }
      return deps.respond({
        ok: true,
        received: true,
        settlement,
      });
    } catch (error) {
      deps.logError(
        "Paystack webhook processing failed:",
        error instanceof Error ? error.message : "Unknown error.",
      );
      return deps.respond({
        ok: false,
        error: "Paystack webhook processing is temporarily unavailable.",
      }, 500);
    }
  };
}

if (import.meta.main) Deno.serve(createPaystackWebhookHandler());
