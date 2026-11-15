import { createPaystackRefundHandler } from "../create-paystack-refund/index.ts";

const paymentId = "12345678-1234-4234-8234-123456789012";
const idempotencyKey = "22345678-1234-4234-8234-123456789012";
const refundId = "32345678-1234-4234-8234-123456789012";
const refundReference = "SWPR-22345678123442348234123456789012";
const transactionReference = "SWP-42345678-1234-4234-8234-123456789012";
const providerRefundId = "7654321";

function validRequest(overrides: Record<string, unknown> = {}) {
  return new Request(
    "https://swayphics.co.za/functions/v1/create-paystack-refund",
    {
      method: "POST",
      headers: {
        origin: "https://swayphics.co.za",
        authorization: "Bearer admin-session-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        payment_id: paymentId,
        amount_cents: 2500,
        idempotency_key: idempotencyKey,
        reason: "Client requested a partial refund.",
        ...overrides,
      }),
    },
  );
}

function providerPayload(overrides: Record<string, unknown> = {}) {
  return {
    status: true,
    message: "Refund has been queued for processing",
    data: {
      id: Number(providerRefundId),
      domain: "test",
      amount: 2500,
      currency: "ZAR",
      status: "pending",
      reference: refundReference,
      transaction: {
        reference: transactionReference,
        domain: "test",
        amount: 10000,
        currency: "ZAR",
      },
      ...overrides,
    },
  };
}

function makeHarness(options: Record<string, unknown> = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  let requestCount = 0;

  const admin = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "paystack_create_refund_request") {
        return {
          data: {
            refund_id: refundId,
            refund_reference: refundReference,
            amount_cents: 2500,
            currency: "ZAR",
            transaction_reference: transactionReference,
            provider_transaction_id: "987654321",
            status: options.reused ? "requires_review" : "pending",
            provider_refund_id: null,
            reused: !!options.reused,
          },
          error: null,
        };
      }
      if (name === "paystack_record_refund_initialization") {
        if (options.saveError) {
          return { data: null, error: { message: "write failed" } };
        }
        return {
          data: {
            refund_id: refundId,
            status: args.p_provider_status === "needs-attention"
              ? "requires_review"
              : args.p_provider_status,
            provider_status: args.p_provider_status,
            provider_refund_id: args.p_provider_refund_id,
          },
          error: null,
        };
      }
      throw new Error("Unexpected RPC: " + name);
    },
  };

  const handler = createPaystackRefundHandler({
    env: (name: string) => ({
      PAYSTACK_SECRET_KEY: "sk_test_disposable_key",
      PAYSTACK_ENVIRONMENT: options.badEnvironment ? "live" : "test",
    }[name]),
    createAdmin: () => admin,
    authorizeAdmin: async () => !options.denied,
    originAllowed: () => true,
    request: async (url: RequestInfo | URL, init?: RequestInit) => {
      requestCount++;
      requests.push({ url: String(url), init });
      if (options.networkError) throw new TypeError("network unavailable");
      if (options.conflict) {
        if (requestCount === 1) return new Response("{}", { status: 409 });
        return Response.json({
          status: true,
          data: [providerPayload().data],
        });
      }
      if (options.badProviderAmount) {
        return Response.json(providerPayload({
          amount: 2501,
        }));
      }
      if (options.badProviderDomain) {
        return Response.json(providerPayload({
          domain: "live",
        }));
      }
      return Response.json(providerPayload());
    },
    logError: () => {},
  });

  return { handler, calls, requests, get requestCount() { return requestCount; } };
}

Deno.test("administrator refund request reserves the amount before calling Paystack", async () => {
  const h = makeHarness();
  const response = await h.handler(validRequest());
  const body = await response.json();
  const reservation = h.calls.find((call) =>
    call.name === "paystack_create_refund_request"
  );
  const saved = h.calls.find((call) =>
    call.name === "paystack_record_refund_initialization"
  );
  const sent = JSON.parse(String(h.requests[0]?.init?.body || "{}"));

  if (
    response.status !== 200 || !body.ok || !reservation || !saved ||
    reservation.args.p_payment_id !== paymentId ||
    reservation.args.p_amount_cents !== 2500 ||
    reservation.args.p_idempotency_key !== idempotencyKey ||
    h.requestCount !== 1 ||
    h.requests[0].url !== "https://api.paystack.co/refund" ||
    new Headers(h.requests[0].init?.headers).get("Authorization") !==
      "Bearer sk_test_disposable_key" ||
    sent.transaction !== transactionReference ||
    sent.amount !== 2500 ||
    sent.currency !== "ZAR" ||
    sent.reference !== refundReference ||
    saved.args.p_provider_refund_id !== providerRefundId ||
    saved.args.p_provider_status !== "pending"
  ) {
    throw new Error("Paystack refund initiation was not reserved, validated and persisted.");
  }
});

Deno.test("idempotent retries never issue another Paystack refund request", async () => {
  const h = makeHarness({ reused: true });
  const response = await h.handler(validRequest());
  const body = await response.json();

  if (
    response.status !== 200 || !body.ok || !body.reused ||
    !body.manual_check_required || h.requestCount !== 0
  ) {
    throw new Error("A reused refund idempotency key initiated a second provider request.");
  }
});

Deno.test("administrator authorization is required before refund reservation or provider calls", async () => {
  const h = makeHarness({ denied: true });
  const response = await h.handler(validRequest());

  if (response.status !== 403 || h.calls.length || h.requestCount) {
    throw new Error("An unauthorised caller reached Paystack refund processing.");
  }
});

Deno.test("refund endpoint refuses non-test provider configuration", async () => {
  const h = makeHarness({ badEnvironment: true });
  const response = await h.handler(validRequest());
  const body = await response.json();

  if (
    response.status !== 503 || !body.ok === true ||
    h.calls.length || h.requestCount
  ) {
    throw new Error("A non-test Paystack refund configuration was accepted.");
  }
});

Deno.test("unknown network outcome is reserved for manual review and never retried", async () => {
  const h = makeHarness({ networkError: true });
  const response = await h.handler(validRequest());
  const body = await response.json();
  const review = h.calls.find((call) =>
    call.name === "paystack_record_refund_initialization"
  );

  if (
    response.status !== 503 || !body.refund_reference ||
    !review || review.args.p_provider_status !== "unknown" ||
    h.requestCount !== 1
  ) {
    throw new Error("An uncertain refund request was not fenced for manual review.");
  }
});

Deno.test("mismatched provider amount is never accepted as a completed reservation", async () => {
  const h = makeHarness({ badProviderAmount: true });
  const response = await h.handler(validRequest());
  const body = await response.json();
  const review = h.calls.find((call) =>
    call.name === "paystack_record_refund_initialization"
  );

  if (
    response.status !== 503 || body.ok !== false ||
    !review || review.args.p_provider_status !== "unknown"
  ) {
    throw new Error("Mismatched Paystack refund response was accepted.");
  }
});

Deno.test("HTTP 409 looks up the existing refund by unique reference instead of retrying", async () => {
  const h = makeHarness({ conflict: true });
  const response = await h.handler(validRequest());
  const body = await response.json();
  const saved = h.calls.find((call) =>
    call.name === "paystack_record_refund_initialization"
  );

  if (
    response.status !== 200 || !body.ok || !saved ||
    h.requestCount !== 2 ||
    h.requests[1].url !==
      "https://api.paystack.co/refund?reference=" + refundReference
  ) {
    throw new Error("Duplicate refund reference was not reconciled safely.");
  }
});
