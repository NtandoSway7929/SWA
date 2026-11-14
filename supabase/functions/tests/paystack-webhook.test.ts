import { createPaystackWebhookHandler } from "../paystack-payment-webhook/index.ts";

const reference = "SWP-12345678-1234-4234-8234-123456789012";
const attemptId = "123e4567-e89b-42d3-a456-426614174000";
const eventId = "123e4567-e89b-42d3-a456-426614174001";
const leaseToken = "123e4567-e89b-42d3-a456-426614174002";

function signedEvent(overrides: Record<string, unknown> = {}) {
  return {
    event: "charge.success",
    data: {
      id: 900001,
      domain: "test",
      status: "success",
      reference,
      amount: 2500,
      currency: "ZAR",
      channel: "eft",
      ...overrides,
    },
  };
}

function makeHarness(options: Record<string, unknown> = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const lookups: Array<{ table: string; filters: Record<string, unknown> }> = [];
  let providerCalls = 0;
  let providerAuthorization = "";

  const admin = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "paystack_record_verified_webhook") {
        if (options.recordError) return { data: null, error: { message: "write failed" } };
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
        if (options.claimError) return { data: null, error: { message: "claim failed" } };
        return {
          data: options.claimDenied
            ? { claimed: false, reason: "lease_active" }
            : { claimed: true, lease_token: leaseToken },
          error: null,
        };
      }
      if (name === "paystack_update_webhook_event") {
        return { data: !options.reviewWriteFails, error: null };
      }
      if (name === "paystack_settle_payment_with_lease") {
        return { data: { settled: true, duplicate: false, payment_id: "payment-test" }, error: null };
      }
      throw new Error("Unexpected RPC: " + name);
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const query = {
        select(_columns: string) { return query; },
        eq(key: string, value: unknown) { filters[key] = value; return query; },
        async maybeSingle() {
          lookups.push({ table, filters: { ...filters } });
          if (options.unmatched) return { data: null, error: null };
          if (options.lookupError) return { data: null, error: { message: "lookup failed" } };
          return {
            data: {
              id: attemptId,
              amount_cents: 2500,
              currency: "ZAR",
              status: "pending",
            },
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
    request: async (_input: RequestInfo | URL, init?: RequestInit) => {
      providerCalls++;
      providerAuthorization = new Headers(init?.headers).get("Authorization") || "";
      if (options.verifyHttpError) return new Response("temporary", { status: 503 });
      return Response.json({
        status: true,
        data: {
          id: 900001,
          domain: options.verifiedLive ? "live" : "test",
          status: "success",
          reference,
          amount: options.verifiedAmount ?? 2500,
          currency: "ZAR",
          channel: "eft",
        },
      });
    },
    logError: () => {},
    logWarn: () => {},
  } as any);

  return {
    handler,
    calls,
    lookups,
    get providerCalls() { return providerCalls; },
    get providerAuthorization() { return providerAuthorization; },
  };
}

function request(payload: unknown = signedEvent()) {
  return new Request("https://functions.example.test/paystack-payment-webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Paystack-Signature": "test-signature",
    },
    body: JSON.stringify(payload),
  });
}

Deno.test("signed charge.success is verified against Paystack before settlement", async () => {
  const h = makeHarness();
  const response = await h.handler(request());
  const body = await response.json();
  const record = h.calls.find((x) => x.name === "paystack_record_verified_webhook");
  const claim = h.calls.find((x) => x.name === "paystack_claim_webhook_event");
  const settle = h.calls.find((x) => x.name === "paystack_settle_payment_with_lease");
  if (
    response.status !== 200 || !body.ok || !record || !claim || !settle ||
    h.providerCalls !== 1 ||
    h.providerAuthorization !== "Bearer sk_test_disposable_key" ||
    record.args.p_provider_event_id !== "charge.success:900001:" + reference ||
    record.args.p_event_type !== "charge.success" ||
    settle.args.p_attempt_id !== attemptId ||
    settle.args.p_lease_token !== leaseToken ||
    settle.args.p_amount_cents !== 2500 ||
    settle.args.p_currency !== "ZAR" ||
    settle.args.p_processing_mode !== "test" ||
    settle.args.p_provider_transaction_id !== "900001" ||
    settle.args.p_payment_channel !== "eft"
  ) {
    throw new Error("Paystack webhook was not independently verified and settled through the leased RPC.");
  }
});

Deno.test("invalid signatures are rejected before database or provider access", async () => {
  const h = makeHarness({ invalidSignature: true });
  const response = await h.handler(request());
  if (response.status !== 401 || h.calls.length || h.providerCalls) {
    throw new Error("Invalid webhook signature reached payment processing.");
  }
});

Deno.test("live-domain event is acknowledged but never enters the test ledger", async () => {
  const h = makeHarness();
  const response = await h.handler(request(signedEvent({ domain: "live" })));
  const body = await response.json();
  if (response.status !== 200 || !body.ignored || h.calls.length || h.providerCalls) {
    throw new Error("Live webhook event entered Paystack test processing.");
  }
});

Deno.test("already-processed duplicate webhook is acknowledged without a second settlement", async () => {
  const h = makeHarness({ recordedStatus: "processed", duplicate: true });
  const response = await h.handler(request());
  const body = await response.json();
  if (
    response.status !== 200 || !body.duplicate ||
    h.calls.some((x) => x.name === "paystack_claim_webhook_event") ||
    h.calls.some((x) => x.name === "paystack_settle_payment_with_lease")
  ) {
    throw new Error("Terminal Paystack webhook duplicate was processed twice.");
  }
});

Deno.test("unmatched verified transaction is routed to manual review under the current lease", async () => {
  const h = makeHarness({ unmatched: true });
  const response = await h.handler(request());
  const review = h.calls.find((x) => x.name === "paystack_update_webhook_event");
  if (
    response.status !== 200 || !review ||
    review.args.p_processing_status !== "requires_review" ||
    review.args.p_failure_code !== "unmatched_provider_reference" ||
    review.args.p_lease_token !== leaseToken
  ) {
    throw new Error("Unmatched Paystack reference was not fenced into manual review.");
  }
});

Deno.test("temporary Paystack verification failure does not create ledger events", async () => {
  const h = makeHarness({ verifyHttpError: true });
  const response = await h.handler(request());
  if (response.status !== 503 || h.calls.length) {
    throw new Error("A temporary verify failure was acknowledged as a settled event.");
  }
});
