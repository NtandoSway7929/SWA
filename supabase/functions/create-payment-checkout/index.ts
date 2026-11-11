import { isSwayphicsReturnUrl, validateCheckoutRequest, validateYocoCheckoutResponse } from "../_shared/yoco-validation.ts";
import {
  checkOrigin,
  getAdminClient,
  json,
  optionsResponse,
  readLimitedTextBody,
  resolvePortalToken,
} from "../_shared/yoco.ts";

const MAX_BODY_BYTES = 16_384;
const genericFailure = "The payment service is temporarily unavailable.";

type CheckoutDependencies = {
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

const defaultDependencies: CheckoutDependencies = {
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

export function createCheckoutHandler(overrides: Partial<CheckoutDependencies> = {}) {
  const deps = { ...defaultDependencies, ...overrides };

  return async (req: Request): Promise<Response> => {
    const respond = deps.respond;
    if (req.method === "OPTIONS") return deps.options();
    if (req.method !== "POST") return respond({ ok: false, error: "Method not allowed." }, 405);
    if (!deps.originAllowed(req)) return respond({ ok: false, error: "Origin not allowed." }, 403);

    try {
      const limitedBody = await deps.readBody(req, MAX_BODY_BYTES);
      if (!limitedBody.ok) {
        return respond({
          ok: false,
          error: limitedBody.reason === "too_large" ? "Request is too large." : "Request must be valid UTF-8.",
        }, limitedBody.reason === "too_large" ? 413 : 400);
      }
      let body: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(limitedBody.body);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return respond({ ok: false, error: "A JSON object is required." }, 400);
        }
        body = parsed as Record<string, unknown>;
      } catch {
        return respond({ ok: false, error: "Invalid JSON request." }, 400);
      }
      const validated = validateCheckoutRequest(body, req.headers.get("idempotency-key"));
      if (!validated.ok) {
        return respond({ ok: false, error: "A valid portal token, invoice, amount and idempotency key are required." }, 400);
      }
      const { token, invoiceId, amountCents, idempotencyKey } = validated;

      const yocoKey = deps.env("YOCO_SECRET_KEY");
      const mode = deps.env("YOCO_ENVIRONMENT");
      const successUrl = deps.env("YOCO_SUCCESS_URL");
      const cancelUrl = deps.env("YOCO_CANCEL_URL");
      const failureUrl = deps.env("YOCO_FAILURE_URL");
      if (!yocoKey || !yocoKey.startsWith("sk_test_") || mode !== "test" ||
          !isSwayphicsReturnUrl(successUrl) || !isSwayphicsReturnUrl(cancelUrl) ||
          !isSwayphicsReturnUrl(failureUrl)) {
        return respond({ ok: false, error: "Test checkout is not configured. No payment has been initiated." }, 503);
      }

      const admin = deps.createAdmin();
      const portal = await deps.resolveToken(admin, token);
      if (!portal) return respond({ ok: false, error: "This portal link is invalid or has expired." }, 403);

      const { data: attempt, error: attemptError } = await admin.rpc("yoco_create_payment_attempt", {
        p_invoice_id: invoiceId,
        p_client_id: portal.client_id,
        p_amount_cents: amountCents,
        p_idempotency_key: idempotencyKey,
      });
      if (attemptError || !attempt?.attempt_id) {
        deps.logError("Payment attempt creation rejected:", attemptError?.message || "No attempt returned.");
        return respond({ ok: false, error: "The invoice is not currently eligible for this payment." }, 409);
      }

      if (attempt.checkout_url && attempt.provider_checkout_id) {
        return respond({
          ok: true,
          attempt_id: attempt.attempt_id,
          status: attempt.status,
          checkout_url: attempt.checkout_url,
          reused: true,
        });
      }

      const portalReturnUrl = (value: string) => {
        const url = new URL(value);
        // Never disclose the private portal token to Yoco or place it in a
        // third-party redirect URL. The browser retains it in session storage.
        url.searchParams.set("payment_attempt", attempt.attempt_id);
        return url.toString();
      };

      const providerResponse = await deps.request("https://payments.yoco.com/api/checkouts", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + yocoKey,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          amount: amountCents,
          currency: "ZAR",
          successUrl: portalReturnUrl(successUrl),
          cancelUrl: portalReturnUrl(cancelUrl),
          failureUrl: portalReturnUrl(failureUrl),
          metadata: { paymentAttemptId: attempt.attempt_id, invoiceId },
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!providerResponse.ok) {
        deps.logError("Yoco checkout creation failed with HTTP", providerResponse.status);
        return respond({ ok: false, error: "Yoco could not create the checkout. You can safely retry this request." }, 502);
      }

      const checkout = await providerResponse.json();
      const validatedCheckout = validateYocoCheckoutResponse(checkout, amountCents);
      if (!validatedCheckout.ok) {
        deps.logError("Yoco returned an invalid hosted checkout response.");
        return respond({ ok: false, error: "The payment provider returned an invalid checkout response." }, 502);
      }

      const { checkoutId, redirectUrl } = validatedCheckout;
      const { data: attached, error: attachError } = await admin.rpc("yoco_attach_checkout", {
        p_attempt_id: attempt.attempt_id,
        p_provider_checkout_id: checkoutId,
        p_checkout_url: new URL(redirectUrl).toString(),
        p_expires_at: null,
      });
      if (attachError || !attached?.checkout_url) {
        deps.logError("Could not attach Yoco checkout:", attachError?.message || "No checkout returned.");
        return respond({ ok: false, error: "The checkout was created but could not be safely linked. Contact Swayphics before retrying." }, 503);
      }

      return respond({
        ok: true,
        attempt_id: attempt.attempt_id,
        status: attached.status,
        checkout_url: attached.checkout_url,
        reused: false,
      });
    } catch (error) {
      deps.logError("Create checkout request failed:", error instanceof Error ? error.message : "Unknown error.");
      return respond({ ok: false, error: genericFailure }, 500);
    }
  };
}

if (import.meta.main) Deno.serve(createCheckoutHandler());
