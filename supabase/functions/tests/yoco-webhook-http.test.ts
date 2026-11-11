import { createYocoWebhookHandler } from "../yoco-payment-webhook/index.ts";

const checkoutId = "ch_test_http_001";
const attemptId = "123e4567-e89b-42d3-a456-426614174000";

function eventRequest(event: Record<string, unknown>) {
  return new Request("https://functions.example.test/yoco-payment-webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": "wh_delivery_http_001",
      "webhook-timestamp": "1800000000",
      "webhook-signature": "v1,test-signature",
    },
    body: JSON.stringify(event),
  });
}

function harness(options: Record<string, unknown> = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
  let attemptLookups = 0;
  const admin = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "yoco_record_verified_webhook") {
        if (options.recordError) return { data: null, error: { message: "database unavailable" } };
        return {
          data: {
            event_id: "local-event-001",
            processing_status: options.processingStatus ?? (options.duplicate ? "processed" : "received"),
            duplicate: !!options.duplicate,
          },
          error: null,
        };
      }
      if (name === "yoco_settle_payment") {
        if (options.settlementError) return { data: null, error: { message: "temporary settlement failure" } };
        return { data: { payment_id: "payment-001", receipt_id: "receipt-001" }, error: null };
      }
      throw new Error("Unexpected RPC " + name);
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const query = {
        select(_columns: string) { return query; },
        update(values: Record<string, unknown>) {
          updates.push({ table, values });
          return query;
        },
        eq(column: string, value: unknown) { filters[column] = value; return query; },
        is(column: string, value: unknown) { filters[column] = value; return query; },
        async maybeSingle() {
          if (table === "payment_attempts") {
            attemptLookups++;
            if (options.unmatchedCheckout) return { data: null, error: null };
            return { data: { id: attemptId, status: "pending", payment_id: "payment-001" }, error: null };
          }
          return { data: null, error: null };
        },
        in(_column: string, _values: unknown[]) { return query; },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          const latestUpdate = updates[updates.length - 1];
          const isProcessingWrite = latestUpdate?.values.processing_status === "processing";
          const error = table === "payment_webhook_events" &&
            ((options.processingWriteError && isProcessingWrite) ||
              (options.eventUpdateError && !isProcessingWrite))
            ? { message: "event state write failed" }
            : null;
          return Promise.resolve({ data: null, error }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const handler = createYocoWebhookHandler({
    verifySignature: async () => options.signatureValid !== false,
    createAdmin: () => admin,
    hashBody: async () => "a".repeat(64),
    logError: () => {},
    logWarn: () => {},
  });
  return { handler, calls, updates, get attemptLookups() { return attemptLookups; } };
}

function paymentSucceededEvent() {
  return {
    id: "evt_payment_succeeded_001",
    type: "payment.succeeded",
    payload: {
      amount: 2500,
      currency: "ZAR",
      status: "successful",
      mode: "test",
      metadata: { checkoutId },
    },
  };
}

async function json(response: Response) {
  return await response.json();
}

Deno.test("webhook HTTP handler rejects invalid signatures before database access", async () => {
  const h = harness({ signatureValid: false });
  const response = await h.handler(eventRequest(paymentSucceededEvent()));
  if (response.status !== 401 || h.calls.length !== 0 || h.attemptLookups !== 0) {
    throw new Error("Invalid webhook signature reached the database.");
  }
});

Deno.test("webhook HTTP handler acknowledges a previously processed duplicate without settling again", async () => {
  const h = harness({ duplicate: true });
  const response = await h.handler(eventRequest(paymentSucceededEvent()));
  const result = await json(response);
  if (response.status !== 200 || result.duplicate !== true ||
      h.calls.filter((call) => call.name === "yoco_settle_payment").length !== 0 ||
      h.attemptLookups !== 0) {
    throw new Error("Processed duplicate webhook was not safely acknowledged.");
  }
});

Deno.test("webhook handler resumes a duplicate event left in received state", async () => {
  const h = harness({ duplicate: true, processingStatus: "received" });
  const response = await h.handler(eventRequest(paymentSucceededEvent()));
  if (response.status !== 200 ||
      !h.updates.some((entry) => entry.values.processing_status === "processing") ||
      h.calls.filter((call) => call.name === "yoco_settle_payment").length !== 1) {
    throw new Error("A recorded but incomplete duplicate was not resumed.");
  }
});

Deno.test("webhook handler retries duplicate processing and failed_retryable events", async () => {
  for (const processingStatus of ["processing", "failed_retryable"]) {
    const h = harness({ duplicate: true, processingStatus });
    const response = await h.handler(eventRequest(paymentSucceededEvent()));
    if (response.status !== 200 ||
        h.calls.filter((call) => call.name === "yoco_settle_payment").length !== 1) {
      throw new Error("Retryable webhook state was not replayed: " + processingStatus);
    }
  }
});

Deno.test("webhook handler acknowledges terminal review and rejected duplicates without financial work", async () => {
  for (const processingStatus of ["requires_review", "rejected"]) {
    const h = harness({ duplicate: true, processingStatus });
    const response = await h.handler(eventRequest(paymentSucceededEvent()));
    if (response.status !== 200 ||
        h.calls.some((call) => call.name === "yoco_settle_payment") ||
        h.attemptLookups !== 0) {
      throw new Error("Terminal webhook state was processed again: " + processingStatus);
    }
  }
});

Deno.test("webhook handler fails closed for unknown event processing states", async () => {
  const h = harness({ duplicate: true, processingStatus: "unexpected_state" });
  const response = await h.handler(eventRequest(paymentSucceededEvent()));
  if (response.status !== 503 || h.attemptLookups !== 0 ||
      h.calls.some((call) => call.name === "yoco_settle_payment")) {
    throw new Error("Unknown webhook processing state was not rejected safely.");
  }
});

Deno.test("webhook handler returns retryable failure if the processing-state write fails", async () => {
  const h = harness({ processingWriteError: true });
  const response = await h.handler(eventRequest(paymentSucceededEvent()));
  if (response.status !== 503 || h.attemptLookups !== 0) {
    throw new Error("Webhook continued without persisting its processing state.");
  }
});

Deno.test("webhook HTTP handler maps verified test success to exactly one settlement RPC", async () => {
  const h = harness();
  const response = await h.handler(eventRequest(paymentSucceededEvent()));
  const result = await json(response);
  const settlement = h.calls.find((call) => call.name === "yoco_settle_payment");
  if (response.status !== 200 || !result.settlement ||
      h.attemptLookups !== 1 ||
      h.calls.filter((call) => call.name === "yoco_settle_payment").length !== 1 ||
      settlement?.args.p_attempt_id !== attemptId ||
      settlement?.args.p_amount_cents !== 2500 ||
      settlement?.args.p_processing_mode !== "test") {
    throw new Error("Verified payment success was not mapped to one correctly scoped settlement call.");
  }
});

Deno.test("webhook HTTP handler returns retryable failure when settlement RPC is unavailable", async () => {
  const h = harness({ settlementError: true });
  const response = await h.handler(eventRequest(paymentSucceededEvent()));
  if (response.status !== 503 ||
      h.calls.filter((call) => call.name === "yoco_settle_payment").length !== 1) {
    throw new Error("Settlement outage was not surfaced as retryable.");
  }
});

Deno.test("webhook HTTP handler retains unmatched verified checkout events for review", async () => {
  const h = harness({ unmatchedCheckout: true });
  const response = await h.handler(eventRequest(paymentSucceededEvent()));
  const result = await json(response);
  if (response.status !== 200 || result.requires_review !== true ||
      h.calls.some((call) => call.name === "yoco_settle_payment") ||
      !h.updates.some((entry) => entry.table === "payment_webhook_events" &&
        entry.values.failure_code === "unmatched_checkout")) {
    throw new Error("Unmatched checkout event was not held for review.");
  }
});

Deno.test("webhook HTTP handler rejects malformed JSON after signature verification", async () => {
  const h = harness();
  const request = new Request("https://functions.example.test/webhook", {
    method: "POST",
    headers: {
      "webhook-id": "wh_delivery",
      "webhook-timestamp": "1800000000",
      "webhook-signature": "v1,test",
    },
    body: "{",
  });
  const response = await h.handler(request);
  if (response.status !== 400 || h.calls.length !== 0) {
    throw new Error("Malformed signed JSON was recorded as a provider event.");
  }
});

Deno.test("webhook handler returns retryable failure when a review-state write fails", async () => {
  const h = harness({ unmatchedCheckout: true, eventUpdateError: true });
  const response = await h.handler(eventRequest(paymentSucceededEvent()));
  const result = await json(response);
  if (response.status !== 503 || result.ok !== false) {
    throw new Error("Webhook acknowledged an event whose review state was not persisted.");
  }
});

Deno.test("webhook handler returns retryable failure when verified event recording fails", async () => {
  const h = harness({ recordError: true });
  const response = await h.handler(eventRequest(paymentSucceededEvent()));
  if (response.status !== 503 || h.attemptLookups !== 0) {
    throw new Error("Webhook continued processing without a durable event record.");
  }
});
