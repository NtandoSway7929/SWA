import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import {
  checkOrigin,
  getAdminClient,
  json,
  optionsResponse,
  readLimitedTextBody,
} from "../_shared/yoco.ts";

type JsonObject = Record<string, unknown>;

type Dependencies = {
  env: (name: string) => string | undefined;
  createAdmin: () => any;
  authorizeAdmin: (req: Request) => Promise<boolean>;
  request: typeof fetch;
  originAllowed: (req: Request) => boolean;
  readBody: typeof readLimitedTextBody;
  respond: typeof json;
  options: typeof optionsResponse;
  logError: (...values: unknown[]) => void;
};

const MAX_BODY_BYTES = 8_192;
const REFUND_STATUSES = [
  "pending",
  "processing",
  "needs-attention",
  "failed",
  "processed",
] as const;

function asRecord(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function publishableKey(env: (name: string) => string | undefined) {
  const legacy = env("SUPABASE_ANON_KEY");
  if (legacy) return legacy;
  try {
    const values = JSON.parse(env("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    return typeof values.default === "string" ? values.default : "";
  } catch {
    return "";
  }
}

async function authorizeAdmin(req: Request): Promise<boolean> {
  const match = (req.headers.get("authorization") || "").match(
    /^Bearer\\s+(.+)$/i,
  );
  const token = match?.[1] || "";
  const url = Deno.env.get("SUPABASE_URL");
  const key = publishableKey((name) => Deno.env.get(name));
  if (!token || !url || !key) return false;

  const userClient = createClient(url, key, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(
    token,
  );
  if (userError || !userData?.user) return false;

  const { data: isAdmin, error: adminError } = await userClient.rpc(
    "is_swayphics_admin",
  );
  return !adminError && isAdmin === true;
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}

function parseRefundRequest(value: unknown) {
  const body = asRecord(value);
  if (!body) return null;
  const paymentId = body.payment_id;
  const amountCents = body.amount_cents;
  const idempotencyKey = body.idempotency_key;
  const reason = body.reason === undefined || body.reason === null
    ? ""
    : typeof body.reason === "string"
    ? body.reason.trim()
    : null;

  if (
    !validUuid(paymentId) ||
    !Number.isSafeInteger(amountCents) ||
    Number(amountCents) < 1 ||
    Number(amountCents) > 100_000_000 ||
    !validUuid(idempotencyKey) ||
    reason === null ||
    reason.length > 500
  ) return null;

  return {
    paymentId,
    amountCents: Number(amountCents),
    idempotencyKey,
    reason,
  };
}

function parseRefundProviderResponse(
  value: unknown,
  expected: {
    transactionReference: string;
    refundReference: string;
    amountCents: number;
  },
) {
  const root = asRecord(value);
  const data = asRecord(root?.data);
  const transaction = asRecord(data?.transaction);
  const status = typeof data?.status === "string"
    ? data.status.toLowerCase().replaceAll("_", "-")
    : "";
  const transactionReference = typeof transaction?.reference === "string"
    ? transaction.reference
    : "";
  const providerRefundId = (typeof data?.id === "number" ||
      typeof data?.id === "string") && /^\\d+$/.test(String(data.id))
    ? String(data.id)
    : null;
  const returnedReference = typeof data?.reference === "string"
    ? data.reference
    : null;

  if (
    root?.status !== true ||
    !data ||
    !providerRefundId ||
    data.domain !== "test" ||
    transactionReference !== expected.transactionReference ||
    !Number.isSafeInteger(data.amount) ||
    data.amount !== expected.amountCents ||
    data.currency !== "ZAR" ||
    !REFUND_STATUSES.includes(status as typeof REFUND_STATUSES[number]) ||
    (returnedReference !== null && returnedReference !== expected.refundReference)
  ) return null;

  return {
    providerRefundId,
    providerStatus: status,
    failureMessage: status === "failed"
      ? "Paystack reported that the refund failed."
      : status === "needs-attention"
      ? "Paystack requires additional information to complete the refund."
      : null,
  };
}

async function reserveOrReviewUnknown(
  admin: any,
  refundId: string,
  refundReference: string,
  message: string,
) {
  const { data, error } = await admin.rpc(
    "paystack_record_refund_initialization",
    {
      p_refund_id: refundId,
      p_refund_reference: refundReference,
      p_provider_refund_id: null,
      p_provider_status: "unknown",
      p_failure_message: message,
    },
  );
  return !error && !!data;
}

const defaults: Dependencies = {
  env: (name) => Deno.env.get(name),
  createAdmin: getAdminClient,
  authorizeAdmin,
  request: fetch,
  originAllowed: checkOrigin,
  readBody: readLimitedTextBody,
  respond: json,
  options: optionsResponse,
  logError: (...values) => console.error(...values),
};

export function createPaystackRefundHandler(
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
      if (!await deps.authorizeAdmin(req)) {
        return deps.respond({
          ok: false,
          error: "Active Swayphics administrator access is required.",
        }, 403);
      }

      const limited = await deps.readBody(req, MAX_BODY_BYTES);
      if (!limited.ok) {
        return deps.respond({
          ok: false,
          error: limited.reason === "too_large"
            ? "Request is too large."
            : "Request must be valid UTF-8.",
        }, limited.reason === "too_large" ? 413 : 400);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(limited.body);
      } catch {
        return deps.respond({ ok: false, error: "Invalid JSON request." }, 400);
      }
      const input = parseRefundRequest(parsed);
      if (!input) {
        return deps.respond({
          ok: false,
          error: "A valid payment, refund amount and idempotency key are required.",
        }, 400);
      }

      const secretKey = deps.env("PAYSTACK_SECRET_KEY");
      const environment = deps.env("PAYSTACK_ENVIRONMENT");
      if (
        !secretKey || !secretKey.startsWith("sk_test_") ||
        environment !== "test"
      ) {
        return deps.respond({
          ok: false,
          error: "Paystack test refunds are not configured. No refund was initiated.",
        }, 503);
      }

      const admin = deps.createAdmin();
      const { data: reservation, error: reserveError } = await admin.rpc(
        "paystack_create_refund_request",
        {
          p_payment_id: input.paymentId,
          p_amount_cents: input.amountCents,
          p_idempotency_key: input.idempotencyKey,
          p_reason: input.reason || null,
        },
      );
      if (
        reserveError || !reservation?.refund_id ||
        !reservation?.refund_reference || !reservation?.transaction_reference
      ) {
        deps.logError(
          "Paystack refund reservation rejected:",
          reserveError?.message || "No refund reservation returned.",
        );
        return deps.respond({
          ok: false,
          error: "The payment is not currently eligible for this refund.",
        }, 409);
      }

      // An idempotent retry never issues another POST. This also means an
      // uncertain prior request remains fenced for manual review.
      if (reservation.reused === true) {
        return deps.respond({
          ok: true,
          refund: {
            id: reservation.refund_id,
            reference: reservation.refund_reference,
            amount_cents: reservation.amount_cents,
            currency: reservation.currency,
            status: reservation.status,
            provider_refund_id: reservation.provider_refund_id || null,
          },
          reused: true,
          manual_check_required: reservation.status === "requires_review",
        });
      }

      const requestBody = {
        transaction: reservation.transaction_reference,
        amount: input.amountCents,
        currency: "ZAR",
        reference: reservation.refund_reference,
        merchant_note: input.reason || "Refund issued by Swayphics.",
        customer_note: "A refund has been initiated by Swayphics.",
      };

      let providerPayload: unknown = null;
      let providerHttpStatus = 0;
      try {
        const response = await deps.request(
          "https://api.paystack.co/refund",
          {
            method: "POST",
            headers: {
              Authorization: "Bearer " + secretKey,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(15_000),
          },
        );
        providerHttpStatus = response.status;
        providerPayload = await response.json();
      } catch (error) {
        deps.logError(
          "Paystack refund initialization outcome is unknown:",
          error instanceof Error ? error.name : "Unknown error.",
        );
        await reserveOrReviewUnknown(
          admin,
          reservation.refund_id,
          reservation.refund_reference,
          "Paystack did not return a definitive response. Check the refund reference before taking further action.",
        );
        return deps.respond({
          ok: false,
          error: "Paystack's response could not be confirmed. The refund is reserved for manual review; do not submit it again.",
          refund_reference: reservation.refund_reference,
        }, 503);
      }

      let duplicateRefundLookupSucceeded = false;
      if (providerHttpStatus === 409) {
        try {
          const lookup = await deps.request(
            "https://api.paystack.co/refund?reference=" +
              encodeURIComponent(reservation.refund_reference),
            {
              method: "GET",
              headers: {
                Authorization: "Bearer " + secretKey,
                Accept: "application/json",
              },
              cache: "no-store",
              signal: AbortSignal.timeout(12_000),
            },
          );
          if (lookup.ok) {
            const lookupPayload = await lookup.json();
            const lookupRoot = asRecord(lookupPayload);
            const list = Array.isArray(lookupRoot?.data) ? lookupRoot.data : [];
            const match = list.find((item) =>
              asRecord(item)?.reference === reservation.refund_reference
            );
            if (lookupRoot?.status === true && match) {
              providerPayload = { status: true, data: match };
              duplicateRefundLookupSucceeded = true;
            }
          }
        } catch (error) {
          deps.logError(
            "Paystack duplicate refund lookup failed:",
            error instanceof Error ? error.name : "Unknown error.",
          );
        }
      }

      const successfulHttpResponse =
        providerHttpStatus >= 200 && providerHttpStatus < 300;
      const validated = (successfulHttpResponse || duplicateRefundLookupSucceeded)
        ? parseRefundProviderResponse(providerPayload, {
        transactionReference: reservation.transaction_reference,
        refundReference: reservation.refund_reference,
        amountCents: input.amountCents,
      })
        : null;
      if (!validated) {
        await reserveOrReviewUnknown(
          admin,
          reservation.refund_id,
          reservation.refund_reference,
          "Paystack returned an unverified refund response. Check the refund reference before taking further action.",
        );
        deps.logError(
          "Paystack refund response could not be matched safely. HTTP",
          providerHttpStatus,
        );
        return deps.respond({
          ok: false,
          error: "Paystack's refund response could not be verified. The request is reserved for manual review; do not submit it again.",
          refund_reference: reservation.refund_reference,
        }, 503);
      }

      const { data: saved, error: saveError } = await admin.rpc(
        "paystack_record_refund_initialization",
        {
          p_refund_id: reservation.refund_id,
          p_refund_reference: reservation.refund_reference,
          p_provider_refund_id: validated.providerRefundId,
          p_provider_status: validated.providerStatus,
          p_failure_message: validated.failureMessage,
        },
      );
      if (saveError || !saved?.refund_id) {
        deps.logError(
          "Paystack refund provider response could not be recorded:",
          saveError?.message || "No refund record returned.",
        );
        await reserveOrReviewUnknown(
          admin,
          reservation.refund_id,
          reservation.refund_reference,
          "Paystack accepted the refund request but local status recording needs reconciliation.",
        );
        return deps.respond({
          ok: false,
          error: "Paystack received the refund request, but Swayphics could not save its status. The request is reserved for manual review; do not submit it again.",
          refund_reference: reservation.refund_reference,
        }, 503);
      }

      return deps.respond({
        ok: true,
        refund: {
          id: reservation.refund_id,
          reference: reservation.refund_reference,
          amount_cents: input.amountCents,
          currency: "ZAR",
          status: saved.status,
          provider_refund_id: saved.provider_refund_id || null,
          provider_status: saved.provider_status || null,
        },
        reused: false,
        message: saved.status === "succeeded"
          ? "Paystack reported the refund as processed."
          : "Paystack accepted the refund request. Its final status will be recorded from the signed webhook.",
      });
    } catch (error) {
      deps.logError(
        "Create Paystack refund failed:",
        error instanceof Error ? error.name : "Unknown error.",
      );
      return deps.respond({
        ok: false,
        error: "The Paystack refund service is temporarily unavailable.",
      }, 500);
    }
  };
}

if (import.meta.main) Deno.serve(createPaystackRefundHandler());
