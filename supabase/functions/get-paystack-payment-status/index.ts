import {
  checkOrigin,
  getAdminClient,
  isUuid,
  json,
  optionsResponse,
  readLimitedTextBody,
  resolvePortalToken,
} from "../_shared/yoco.ts";
import { validatePaystackTransactionObservation } from "../_shared/paystack.ts";

type Dependencies = {
  env: (name: string) => string | undefined;
  createAdmin: () => any;
  resolveToken: (admin: any, token: string) => Promise<any>;
  request: typeof fetch;
  originAllowed: (req: Request) => boolean;
  readBody: typeof readLimitedTextBody;
  respond: typeof json;
  options: typeof optionsResponse;
  logError: (...values: unknown[]) => void;
};

const defaults: Dependencies = {
  env: (name) => Deno.env.get(name),
  createAdmin: getAdminClient,
  resolveToken: resolvePortalToken,
  request: fetch,
  originAllowed: checkOrigin,
  readBody: readLimitedTextBody,
  respond: json,
  options: optionsResponse,
  logError: (...values) => console.error(...values),
};

export function createPaystackStatusHandler(overrides: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return deps.options();
    if (req.method !== "POST") {
      return deps.respond({ ok: false, error: "Method not allowed." }, 405);
    }
    if (!deps.originAllowed(req)) {
      return deps.respond({ ok: false, error: "Origin not allowed." }, 403);
    }

    try {
      const limited = await deps.readBody(req, 8_192);
      if (!limited.ok) {
        return deps.respond({
          ok: false,
          error: limited.reason === "too_large"
            ? "Request is too large."
            : "Request must be valid UTF-8.",
        }, limited.reason === "too_large" ? 413 : 400);
      }
      let body: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(limited.body);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return deps.respond({ ok: false, error: "A JSON object is required." }, 400);
        }
        body = parsed as Record<string, unknown>;
      } catch {
        return deps.respond({ ok: false, error: "Invalid JSON request." }, 400);
      }

      const token = typeof body.token === "string" ? body.token.trim() : "";
      const attemptId = body.attempt_id;
      if (!token || !isUuid(attemptId)) {
        return deps.respond({
          ok: false,
          error: "A valid portal token and payment attempt are required.",
        }, 400);
      }

      const admin = deps.createAdmin();
      const portal = await deps.resolveToken(admin, token);
      if (!portal) {
        return deps.respond({
          ok: false,
          error: "This portal link is invalid or has expired.",
        }, 403);
      }

      const { data: attempt, error } = await admin
        .from("payment_attempts")
        .select("id,invoice_id,client_id,amount_cents,currency,status,created_at,updated_at,expires_at,payment_id,provider_checkout_id")
        .eq("id", attemptId)
        .eq("client_id", portal.client_id)
        .eq("provider", "paystack")
        .eq("environment", "test")
        .maybeSingle();

      if (error || !attempt) {
        return deps.respond({ ok: false, error: "Payment attempt not found." }, 404);
      }

      // Paystack currently sends transaction webhooks for successful
      // transactions only. Verify pending attempts when the customer returns
      // so failed or abandoned payments do not remain pending indefinitely.
      if (
        attempt.status === "pending" &&
        typeof attempt.provider_checkout_id === "string" &&
        attempt.provider_checkout_id
      ) {
        const secretKey = deps.env("PAYSTACK_SECRET_KEY");
        const environment = deps.env("PAYSTACK_ENVIRONMENT");
        if (!secretKey || !secretKey.startsWith("sk_test_") || environment !== "test") {
          return deps.respond({
            ok: false,
            error: "Paystack test verification is not configured.",
          }, 503);
        }

        const verification = await deps.request(
          "https://api.paystack.co/transaction/verify/" +
            encodeURIComponent(attempt.provider_checkout_id),
          {
            method: "GET",
            headers: {
              "Authorization": "Bearer " + secretKey,
              "Accept": "application/json",
            },
            cache: "no-store",
            signal: AbortSignal.timeout(12_000),
          },
        );
        if (!verification.ok) {
          deps.logError(
            "Paystack status verification returned HTTP",
            verification.status,
          );
          return deps.respond({
            ok: false,
            error: "Paystack transaction status is temporarily unavailable.",
          }, 503);
        }

        const providerPayload = await verification.json();
        const observed = validatePaystackTransactionObservation(
          providerPayload,
          {
            reference: attempt.provider_checkout_id,
            amountCents: Number(attempt.amount_cents),
          },
        );
        if (!observed) {
          deps.logError(
            "Paystack status verification did not match the pending payment attempt.",
          );
          return deps.respond({
            ok: false,
            error: "Paystack transaction details could not be safely matched.",
          }, 503);
        }

        if (observed.status === "failed" || observed.status === "abandoned") {
          const { data: transition, error: transitionError } = await admin.rpc(
            "paystack_record_failed_attempt_status",
            {
              p_attempt_id: attempt.id,
              p_provider_checkout_id: observed.reference,
              p_amount_cents: observed.amountCents,
              p_currency: observed.currency,
              p_processing_mode: observed.domain,
              p_provider_transaction_id: observed.transactionId,
              p_provider_status: observed.status,
            },
          );
          if (transitionError || !transition?.status) {
            deps.logError(
              "Could not persist verified Paystack non-success status:",
              transitionError?.message || "No status returned.",
            );
            return deps.respond({
              ok: false,
              error: "Verified Paystack status could not be saved.",
            }, 503);
          }
          attempt.status = transition.status;
          if (transition.payment_id) attempt.payment_id = transition.payment_id;
        }
      }

      let payment = null;
      let receipt = null;
      if (attempt.payment_id) {
        const [paymentResult, receiptResult] = await Promise.all([
          admin.from("payments")
            .select("id,amount,currency,method,paid_at,reference")
            .eq("id", attempt.payment_id)
            .eq("client_id", portal.client_id)
            .maybeSingle(),
          admin.from("payment_receipts")
            .select("receipt_number,issued_at,snapshot")
            .eq("payment_id", attempt.payment_id)
            .maybeSingle(),
        ]);
        if (paymentResult.error || receiptResult.error) {
          return deps.respond({
            ok: false,
            error: "Payment confirmation is temporarily unavailable.",
          }, 503);
        }
        payment = paymentResult.data;
        receipt = receiptResult.data;
      }

      return deps.respond({
        ok: true,
        attempt: {
          id: attempt.id,
          invoice_id: attempt.invoice_id,
          amount_cents: attempt.amount_cents,
          currency: attempt.currency,
          status: attempt.status,
          created_at: attempt.created_at,
          updated_at: attempt.updated_at,
          expires_at: attempt.expires_at,
        },
        payment,
        receipt,
        confirmed: attempt.status === "succeeded" && !!payment,
      });
    } catch (error) {
      deps.logError(
        "Paystack payment status lookup failed:",
        error instanceof Error ? error.message : "Unknown error.",
      );
      return deps.respond({
        ok: false,
        error: "Payment status is temporarily unavailable.",
      }, 500);
    }
  };
}

if (import.meta.main) Deno.serve(createPaystackStatusHandler());
