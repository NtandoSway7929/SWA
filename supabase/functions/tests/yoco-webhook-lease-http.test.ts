import { createYocoWebhookHandler } from "../yoco-payment-webhook/index.ts";

const attemptId = "123e4567-e89b-42d3-a456-426614174000";
const eventId = "local-event-lease-001";
const leaseToken = "223e4567-e89b-42d3-a456-426614174000";
const checkoutId = "ch_test_lease_001";

function request(event: Record<string, unknown>) {
  return new Request("https://functions.example.test/yoco-payment-webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": "wh_delivery_lease",
      "webhook-timestamp": "1800000000",
      "webhook-signature": "v1,test-signature",
    },
    body: JSON.stringify(event),
  });
}

function successEvent() {
  return {
    id: "evt_payment_succeeded_lease",
    type: "payment.succeeded",
    payload: {
      amount: 2500, currency: "ZAR", status: "successful", mode: "test",
      metadata: { checkoutId },
    },
  };
}

function harness(options: Record<string, unknown> = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const updates: Array<Record<string, unknown>> = [];
  const admin = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "yoco_record_verified_webhook") {
        return { data: {
          event_id: eventId,
          processing_status: options.recordedStatus ?? "received",
          duplicate: true,
        }, error: null };
      }
      if (name === "yoco_claim_webhook_event") {
        if (options.claimError) return { data: null, error: { message: "claim unavailable" } };
        if (options.claimDenied) return { data: { claimed: false, reason: options.claimDenied }, error: null };
        return { data: { claimed: true, lease_token: leaseToken }, error: null };
      }
      if (name === "yoco_settle_payment_with_lease") {
        return options.settlementError
          ? { data: null, error: { message: "settlement unavailable" } }
          : { data: { settled: true }, error: null };
      }
      if (name === "yoco_update_webhook_event") {
        updates.push(args);
        return { data: options.stateWriteError ? false : true, error: null };
      }
      if (name === "yoco_record_payment_failure_with_lease") {
        return { data: { payment_failed: true }, error: null };
      }
      throw new Error("Unexpected RPC " + name);
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const query = {
        select(_columns: string) { return query; },
        eq(column: string, value: unknown) { filters[column] = value; return query; },
        async maybeSingle() {
          if (table === "payment_attempts") return { data: options.unmatched ? null : { id: attemptId }, error: null };
          return { data: null, error: null };
        },
      };
      return query;
    },
  };
  const handler = createYocoWebhookHandler({
    verifySignature: async () => true,
    createAdmin: () => admin,
    hashBody: async () => "b".repeat(64),
    logError: () => {},
    logWarn: () => {},
  });
  return { handler, calls, updates };
}

async function body(response: Response) { return await response.json(); }

Deno.test("lease handler claims an event before any attempt lookup or settlement", async () => {
  const h = harness();
  const response = await h.handler(request(successEvent()));
  const claimIndex = h.calls.findIndex((x) => x.name === "yoco_claim_webhook_event");
  const settleIndex = h.calls.findIndex((x) => x.name === "yoco_settle_payment_with_lease");
  const settle = h.calls[settleIndex];
  if (response.status !== 200 || claimIndex < 0 || settleIndex <= claimIndex ||
      settle.args.p_lease_token !== leaseToken || settle.args.p_event_id !== eventId) {
    throw new Error("Settlement was not fenced by a claimed lease.");
  }
});

Deno.test("active lease is not processed by a concurrent duplicate delivery", async () => {
  const h = harness({ claimDenied: "lease_active" });
  const response = await h.handler(request(successEvent()));
  if (response.status !== 503 ||
      h.calls.some((x) => x.name === "yoco_settle_payment_with_lease")) {
    throw new Error("A second delivery processed an event with an active lease.");
  }
});

Deno.test("lease claim outage fails closed before financial work", async () => {
  const h = harness({ claimError: true });
  const response = await h.handler(request(successEvent()));
  if (response.status !== 503 ||
      h.calls.some((x) => x.name === "yoco_settle_payment_with_lease")) {
    throw new Error("Webhook continued without a successful lease claim.");
  }
});

Deno.test("payment.failed is delegated to the atomic lease-aware database operation", async () => {
  const h = harness();
  const response = await h.handler(request({
    id: "evt_payment_failed_lease",
    type: "payment.failed",
    payload: { metadata: { checkoutId } },
  }));
  const failure = h.calls.find((x) => x.name === "yoco_record_payment_failure_with_lease");
  if (response.status !== 200 || !failure ||
      failure.args.p_lease_token !== leaseToken ||
      failure.args.p_attempt_id !== attemptId) {
    throw new Error("Payment failure was not atomically recorded under the lease.");
  }
});

Deno.test("review transition is token-fenced and releases the lease", async () => {
  const h = harness({ unmatched: true });
  const response = await h.handler(request(successEvent()));
  const write = h.calls.find((x) => x.name === "yoco_update_webhook_event");
  if (response.status !== 200 || !write ||
      write.args.p_lease_token !== leaseToken ||
      write.args.p_processing_status !== "requires_review") {
    throw new Error("Review transition did not use the current lease token.");
  }
});

Deno.test("a rejected stale-token event update is not acknowledged", async () => {
  const h = harness({ unmatched: true, stateWriteError: true });
  const response = await h.handler(request(successEvent()));
  if (response.status !== 503) {
    throw new Error("Webhook acknowledged a review transition rejected by the lease fence.");
  }
});

Deno.test("terminal duplicate event is acknowledged without claiming a lease", async () => {
  const h = harness({ recordedStatus: "processed" });
  const response = await h.handler(request(successEvent()));
  if (response.status !== 200 ||
      h.calls.some((x) => x.name === "yoco_claim_webhook_event")) {
    throw new Error("Terminal duplicate attempted to acquire a new lease.");
  }
});
