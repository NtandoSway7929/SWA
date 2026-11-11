import { createCheckoutHandler } from "../create-payment-checkout/index.ts";

const attemptId = "123e4567-e89b-42d3-a456-426614174000";
const invoiceId = "123e4567-e89b-42d3-a456-426614174001";
const portalToken = "portal-token-for-http-test-12345678901234567890";
const checkoutUrl = "https://payments.yoco.com/checkout/test-session";

function makeRequest(body: unknown = {
  token: portalToken,
  invoice_id: invoiceId,
  amount_cents: 2_500,
  idempotency_key: "http-test-key-0001",
}, origin = "https://swayphics.co.za") {
  return new Request("https://functions.example.test/create-payment-checkout", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

function makeHarness(options: Record<string, unknown> = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const config: Record<string, string> = {
    YOCO_SECRET_KEY: "sk_test_http_harness",
    YOCO_ENVIRONMENT: "test",
    YOCO_SUCCESS_URL: "https://swayphics.co.za/client-portal/?payment=success",
    YOCO_CANCEL_URL: "https://swayphics.co.za/client-portal/?payment=cancel",
    YOCO_FAILURE_URL: "https://swayphics.co.za/client-portal/?payment=failure",
  };
  let providerCalls = 0;
  let capturedProviderBody: Record<string, unknown> | null = null;
  let capturedProviderHeaders: Headers | null = null;

  const admin = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "yoco_create_payment_attempt") {
        if (options.attemptError) return { data: null, error: { message: "rejected" } };
        if (options.reuse) {
          return {
            data: {
              attempt_id: attemptId,
              status: "pending",
              checkout_url: checkoutUrl,
              provider_checkout_id: "ch_test_existing",
            },
            error: null,
          };
        }
        return {
          data: { attempt_id: attemptId, status: "created", checkout_url: null, provider_checkout_id: null },
          error: null,
        };
      }
      if (name === "yoco_attach_checkout") {
        if (options.attachError) return { data: null, error: { message: "attach failed" } };
        return {
          data: { status: "pending", checkout_url: checkoutUrl },
          error: null,
        };
      }
      throw new Error("Unexpected RPC: " + name);
    },
  };

  const handler = createCheckoutHandler({
    env: (name: string) => config[name],
    createAdmin: () => admin,
    resolveToken: async () => options.invalidPortal ? null : { client_id: "client-http-test" },
    request: async (_input: RequestInfo | URL, init?: RequestInit) => {
      providerCalls++;
      capturedProviderBody = JSON.parse(String(init?.body));
      capturedProviderHeaders = new Headers(init?.headers);
      if (options.providerThrows) throw new Error("provider timeout");
      if (options.providerFailure) return new Response("provider unavailable", { status: 503 });
      return Response.json({
        id: "ch_test_http_001",
        amount: 2_500,
        currency: "ZAR",
        processingMode: "test",
        redirectUrl: checkoutUrl,
      });
    },
    originAllowed: (req: Request) => req.headers.get("origin") === "https://swayphics.co.za",
    logError: () => {},
  } as any);

  return {
    handler,
    calls,
    config,
    get providerCalls() { return providerCalls; },
    get providerBody() { return capturedProviderBody; },
    get providerHeaders() { return capturedProviderHeaders; },
  };
}

async function responseJson(response: Response) {
  return await response.json();
}

Deno.test("checkout HTTP handler creates a hosted test checkout and attaches it to the attempt", async () => {
  const harness = makeHarness();
  const response = await harness.handler(makeRequest());
  const body = await responseJson(response);

  if (response.status !== 200 || body.ok !== true || body.reused !== false ||
      body.attempt_id !== attemptId || body.checkout_url !== checkoutUrl) {
    throw new Error("Valid checkout request did not complete successfully.");
  }
  if (harness.providerCalls !== 1 ||
      harness.calls.map((call) => call.name).join(",") !== "yoco_create_payment_attempt,yoco_attach_checkout") {
    throw new Error("Expected one provider request and ordered attempt/attachment RPCs.");
  }
  const providerBody = harness.providerBody!;
  const successUrl = new URL(String(providerBody.successUrl));
  if (successUrl.searchParams.get("payment_attempt") !== attemptId ||
      successUrl.searchParams.has("token") ||
      JSON.stringify(providerBody).includes(portalToken)) {
    throw new Error("Private portal token leaked into the provider checkout request.");
  }
  if (providerBody.amount !== 2_500 || providerBody.currency !== "ZAR") {
    throw new Error("Provider request amount/currency did not match the invoice payment.");
  }
  if (harness.providerHeaders?.get("Idempotency-Key") !== "http-test-key-0001") {
    throw new Error("Provider request omitted the stable idempotency key.");
  }
});

Deno.test("checkout handler rejects invalid portal tokens without creating attempts or calling Yoco", async () => {
  const harness = makeHarness({ invalidPortal: true });
  const response = await harness.handler(makeRequest());
  const body = await responseJson(response);
  if (response.status !== 403 || body.ok !== false ||
      harness.providerCalls !== 0 || harness.calls.length !== 0) {
    throw new Error("Invalid portal token reached payment creation.");
  }
});

Deno.test("checkout handler reuses an existing hosted checkout without calling Yoco again", async () => {
  const harness = makeHarness({ reuse: true });
  const response = await harness.handler(makeRequest());
  const body = await responseJson(response);
  if (response.status !== 200 || body.reused !== true ||
      body.checkout_url !== checkoutUrl || harness.providerCalls !== 0 ||
      harness.calls.length !== 1) {
    throw new Error("Existing checkout was not safely reused.");
  }
});

Deno.test("checkout handler never redirects when provider creation fails or times out", async () => {
  for (const options of [{ providerFailure: true }, { providerThrows: true }]) {
    const harness = makeHarness(options);
    const response = await harness.handler(makeRequest());
    const body = await responseJson(response);
    if (response.status !== 502 && response.status !== 500) {
      throw new Error("Provider failure did not produce a safe server error.");
    }
    if (body.checkout_url || harness.calls.some((call) => call.name === "yoco_attach_checkout")) {
      throw new Error("Failed provider request was exposed as a checkout.");
    }
  }
});

Deno.test("checkout handler routes provider-created but unattached sessions to manual intervention", async () => {
  const harness = makeHarness({ attachError: true });
  const response = await harness.handler(makeRequest());
  const body = await responseJson(response);
  if (response.status !== 503 || body.checkout_url ||
      harness.providerCalls !== 1 ||
      !harness.calls.some((call) => call.name === "yoco_attach_checkout")) {
    throw new Error("Unattached provider checkout was returned as usable.");
  }
});

Deno.test("checkout handler rejects invalid origins, malformed JSON and live-key configuration", async () => {
  const originHarness = makeHarness();
  const badOrigin = await originHarness.handler(makeRequest(undefined, "https://attacker.example"));
  if (badOrigin.status !== 403 || originHarness.providerCalls !== 0) {
    throw new Error("Disallowed browser origin was accepted.");
  }

  const jsonHarness = makeHarness();
  const malformed = await jsonHarness.handler(new Request("https://functions.example.test/checkout", {
    method: "POST",
    headers: { origin: "https://swayphics.co.za" },
    body: "{",
  }));
  if (malformed.status !== 400 || jsonHarness.providerCalls !== 0) {
    throw new Error("Malformed JSON reached payment creation.");
  }

  const liveHarness = makeHarness();
  liveHarness.config.YOCO_SECRET_KEY = "sk_live_must_not_run";
  const liveConfig = await liveHarness.handler(makeRequest());
  if (liveConfig.status !== 503 || liveHarness.providerCalls !== 0) {
    throw new Error("Live Yoco key was accepted by the test-only checkout handler.");
  }
});
