import {
  checkOrigin,
  getAdminClient,
  json,
  optionsResponse,
  readLimitedTextBody,
  resolvePortalToken,
} from "../_shared/yoco.ts";
import { validateCheckoutRequest } from "../_shared/yoco-validation.ts";
import {
  isSwayphicsCallbackUrl,
  validatePaystackInitializeResponse,
} from "../_shared/paystack.ts";

const MAX_BODY_BYTES = 16_384;

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

export function createPaystackCheckoutHandler(
  overrides: Partial<Dependencies> = {},
) {
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
      const limited = await deps.readBody(req, MAX_BODY_BYTES);
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

      const validated = validateCheckoutRequest(
        body,
        req.headers.get("idempotency-key"),
      );
      if (!validated.ok) {
        return deps.respond({
          ok: false,
          error: "A valid portal token, invoice, amount and idempotency key are required.",
        }, 400);
      }

      const secretKey = deps.env("PAYSTACK_SECRET_KEY");
      const mode = deps.env("PAYSTACK_ENVIRONMENT");
      const callbackBase = deps.env("PAYSTACK_CALLBACK_URL") ||
        "https://swayphics.co.za/client-portal/";
      if (
        !secretKey || !secretKey.startsWith("sk_test_") ||
        mode !== "test" || !isSwayphicsCallbackUrl(callbackBase)
      ) {
        return deps.respond({
          ok: false,
          error: "Paystack test checkout is not configured. No payment has been initiated.",
        }, 503);
      }

      const admin = deps.createAdmin();
      const portal = await deps.resolveToken(admin, validated.token);
      if (!portal) {
        return deps.respond({
          ok: false,
          error: "This portal link is invalid or has expired.",
        }, 403);
      }

      const { data: customer, error: customerError } = await admin
        .from("clients")
        .select("email")
        .eq("id", portal.client_id)
        .maybeSingle();
      const email = typeof customer?.email === "string"
        ? customer.email.trim()
        : "";
      if (customerError || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return deps.respond({
          ok: false,
          error: "A valid client email address is required before online checkout can be created. Please contact Swayphics.",
        }, 409);
      }

      const { data: attempt, error: attemptError } = await admin.rpc(
        "paystack_create_payment_attempt",
        {
          p_invoice_id: validated.invoiceId,
          p_client_id: portal.client_id,
          p_amount_cents: validated.amountCents,
          p_idempotency_key: validated.idempotencyKey,
        },
      );
      if (attemptError || !attempt?.attempt_id) {
        deps.logError(
          "Paystack attempt creation rejected:",
          attemptError?.message || "No attempt returned.",
        );
        return deps.respond({
          ok: false,
          error: "The invoice is not currently eligible for this payment.",
        }, 409);
      }

      if (attempt.checkout_url && attempt.provider_checkout_id) {
        return deps.respond({
          ok: true,
          attempt_id: attempt.attempt_id,
          status: attempt.status,
          checkout_url: attempt.checkout_url,
          reused: true,
        });
      }

      const reference = "SWP-" + String(attempt.attempt_id);
      const callback = new URL(callbackBase);
      callback.searchParams.set("payment_attempt", String(attempt.attempt_id));

      const providerResponse = await deps.request(
        "https://api.paystack.co/transaction/initialize",
        {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + secretKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email,
            amount: String(validated.amountCents),
            currency: "ZAR",
            reference,
            callback_url: callback.toString(),
            channels: ["card", "eft", "capitec_pay"],
            metadata: JSON.stringify({
              payment_attempt_id: attempt.attempt_id,
              invoice_id: validated.invoiceId,
              source: "swayphics_client_portal",
            }),
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );

      if (!providerResponse.ok) {
        deps.logError(
          "Paystack transaction initialization failed with HTTP",
          providerResponse.status,
        );
        return deps.respond({
          ok: false,
          error: "Paystack could not create the checkout. You can safely retry this request.",
        }, 502);
      }

      const providerPayload = await providerResponse.json();
      const checkout = validatePaystackInitializeResponse(
        providerPayload,
        reference,
      );
      if (!checkout.ok) {
        deps.logError("Paystack returned an invalid hosted checkout response.");
        return deps.respond({
          ok: false,
          error: "The payment provider returned an invalid checkout response.",
        }, 502);
      }

      const { data: attached, error: attachError } = await admin.rpc(
        "paystack_attach_checkout",
        {
          p_attempt_id: attempt.attempt_id,
          p_provider_checkout_id: checkout.reference,
          p_checkout_url: checkout.authorizationUrl,
          p_expires_at: null,
        },
      );
      if (attachError || !attached?.checkout_url) {
        deps.logError(
          "Could not attach Paystack checkout:",
          attachError?.message || "No checkout returned.",
        );
        return deps.respond({
          ok: false,
          error: "Checkout was created but could not be safely linked. Contact Swayphics before retrying.",
        }, 503);
      }

      return deps.respond({
        ok: true,
        attempt_id: attempt.attempt_id,
        status: attached.status,
        checkout_url: attached.checkout_url,
        reused: false,
      });
    } catch (error) {
      deps.logError(
        "Create Paystack checkout failed:",
        error instanceof Error ? error.message : "Unknown error.",
      );
      return deps.respond({
        ok: false,
        error: "The Paystack payment service is temporarily unavailable.",
      }, 500);
    }
  };
}

if (import.meta.main) Deno.serve(createPaystackCheckoutHandler());
