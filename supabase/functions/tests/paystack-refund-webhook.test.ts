import { createPaystackWebhookHandler } from "../paystack-payment-webhook/index.ts";

const transactionReference = "SWP-12345678-1234-4234-8234-123456789012";
const refundReference = "SWPR-12345678123442348234123456789012";
const attemptId = "123e4567-e89b-42d3-a456-426614174000";
const paymentId = "223e4567-e89b-42d3-a456-426614174000";
const eventId = "323e4567-e89b-42d3-a456-426614174000";
const leaseToken = "423e4567-e89b-42d3-a456-426614174000";

function refundEvent(
  event: string,
  status: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    event,
    data: {
      status,
      transaction_reference: transactionReference,
      refund_reference: refundReference,
      amount: "2500",
      currency: "ZAR",
      domain: "test",
      ...overrides,
    },
  };
}

function makeHarness(options: Record<string, unknown> = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const lookups: Array<{ table: string; filters: Record<string, unknown> }> =
    [];
  const admin = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "paystack_record_verified_webhook") {
        return {
          data: {
            event_id: eventId,
            processing_status: options.recordedStatus || "received",
            duplicate: !!options.duplicate,
          },
          error: null,
        };
      }
      if (name === "paystack_claim_webhook_event") {
        return {
          data: options.claimDenied
            ? { claimed: false, reason: "lease_active" }
            : { claimed: true, lease_token: leaseToken },
          error: null,
        };
      }
      if (name === "paystack_update_webhook_event") {
        return { data: true, error: null };
      }
      if (name === "paystack_apply_refund_webhook_with_lease") {
        return {
          data: {
            recorded: true,
            duplicate: false,
            refund_id: "refund-test-id",
            status: args.p_provider_status === "processed"
              ? "succeeded"
              : args.p_provider_status === "needs-attention"
              ? "requires_review"
              : args.p_provider_status,
          },
          error: null,
        };
      }
      throw new Error("Unexpected RPC: " + name);
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const query = {
        select() {
          return query;
        },
        eq(key: string, value: unknown) {
          filters[key] = value;
          return query;
        },
        async maybeSingle() {
          lookups.push({ table, filters: { ...filters } });
          if (options.unmatched) return { data: null, error: null };
          if (options.lookupError) {
            return { data: null, error: { message: "lookup failed" } };
          }
          return {
            data: { id: attemptId, payment_id: paymentId },
            error: null,
          };
        },
      };
      return query;
    },
  };

  const handler = createPaystackWebhookHandler({
    env: (name: string) => ({
      PAYSTACK_SECRET_KEY: "sk_test_disposable_key",
      PAYSTACK_WEBHOOK_SECRET: "whsec_disposable_secret",
      PAYSTACK_ENVIRONMENT: "test",
    }[name]),
    createAdmin: () => admin,
    verifySignature: async () => !options.invalidSignature,
    hashBody: async () => "a".repeat(64),
    request: async () => {
      throw new Error("Refund webhook handling must not call a provider API.");
    },
    logError: () => {},
    logWarn: () => {},
  } as any);

  return { handler, calls, lookups };
}

function request(payload: unknown) {
  return new Request(
    "https://functions.example.test/paystack-payment-webhook",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Paystack-Signature": "test-signature",
      },
      body: JSON.stringify(payload),
    },
  );
}

Deno.test("refund.pending is recorded under a lease without treating it as a completed refund", async () => {
  const h = makeHarness();
  const response = await h.handler(
    request(refundEvent("refund.pending", "pending")),
  );
  const body = await response.json();
  const apply = h.calls.find((call) =>
    call.name === "paystack_apply_refund_webhook_with_lease"
  );

  if (
    response.status !== 200 || !body.ok || !apply ||
    apply.args.p_attempt_id !== attemptId ||
    apply.args.p_payment_id !== paymentId ||
    apply.args.p_transaction_reference !== transactionReference ||
    apply.args.p_provider_refund_reference !== refundReference ||
    apply.args.p_provider_refund_id !== null ||
    apply.args.p_amount_cents !== 2500 ||
    apply.args.p_currency !== "ZAR" ||
    apply.args.p_provider_status !== "pending" ||
    apply.args.p_lease_token !== leaseToken
  ) {
    throw new Error("Paystack pending refund was not mapped under the active lease.");
  }
});

Deno.test("refund.processed is passed to the database as the only completed refund event", async () => {
  const h = makeHarness();
  const response = await h.handler(
    request(refundEvent("refund.processed", "processed")),
  );
  const body = await response.json();
  const apply = h.calls.find((call) =>
    call.name === "paystack_apply_refund_webhook_with_lease"
  );

  if (
    response.status !== 200 || !body.ok || !apply ||
    apply.args.p_provider_status !== "processed"
  ) {
    throw new Error("Paystack processed refund was not sent to the success-only ledger transition.");
  }
});

Deno.test("refund.needs-attention is retained as a review state", async () => {
  const h = makeHarness();
  const response = await h.handler(
    request(refundEvent("refund.needs-attention", "needs-attention")),
  );
  const apply = h.calls.find((call) =>
    call.name === "paystack_apply_refund_webhook_with_lease"
  );

  if (
    response.status !== 200 || !apply ||
    apply.args.p_provider_status !== "needs-attention"
  ) {
    throw new Error("Paystack needs-attention refund was not routed to review handling.");
  }
});

Deno.test("refund.failed is recorded as failed and does not masquerade as a completed refund", async () => {
  const h = makeHarness();
  const response = await h.handler(
    request(refundEvent("refund.failed", "failed")),
  );
  const apply = h.calls.find((call) =>
    call.name === "paystack_apply_refund_webhook_with_lease"
  );

  if (
    response.status !== 200 || !apply ||
    apply.args.p_provider_status !== "failed"
  ) {
    throw new Error("Paystack failed refund was not recorded as a failed state.");
  }
});

Deno.test("live refund notifications are ignored before entering the test database", async () => {
  const h = makeHarness();
  const response = await h.handler(request(
    refundEvent("refund.processed", "processed", { domain: "live" }),
  ));
  const body = await response.json();

  if (
    response.status !== 200 || !body.ignored ||
    h.calls.length !== 0 || h.lookups.length !== 0
  ) {
    throw new Error("Live refund notification entered the Paystack test ledger.");
  }
});

Deno.test("invalid signatures are rejected before any refund database access", async () => {
  const h = makeHarness({ invalidSignature: true });
  const response = await h.handler(
    request(refundEvent("refund.processed", "processed")),
  );

  if (response.status !== 401 || h.calls.length || h.lookups.length) {
    throw new Error("Invalid Paystack refund signature reached the database.");
  }
});

Deno.test("unmatched refund transaction is routed to manual review", async () => {
  const h = makeHarness({ unmatched: true });
  const response = await h.handler(
    request(refundEvent("refund.processed", "processed")),
  );
  const body = await response.json();
  const review = h.calls.find((call) =>
    call.name === "paystack_update_webhook_event"
  );

  if (
    response.status !== 200 || !body.requires_review || !review ||
    review.args.p_processing_status !== "requires_review" ||
    review.args.p_failure_code !== "refund_mapping_required"
  ) {
    throw new Error("Unmatched Paystack refund was not fenced into manual review.");
  }
});

Deno.test("refund notification rejects an unexpected status or currency", async () => {
  const badStatus = makeHarness();
  const statusResponse = await badStatus.handler(request(
    refundEvent("refund.processed", "pending"),
  ));
  const badCurrency = makeHarness();
  const currencyResponse = await badCurrency.handler(request(
    refundEvent("refund.processed", "processed", { currency: "USD" }),
  ));

  if (
    statusResponse.status !== 400 ||
    currencyResponse.status !== 400
  ) {
    throw new Error("An inconsistent Paystack refund notification was accepted.");
  }
});
