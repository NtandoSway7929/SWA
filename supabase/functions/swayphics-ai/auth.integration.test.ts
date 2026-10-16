// Tests the real handler with mocked Supabase Auth/PostgREST responses.
// It does not contact Supabase or permit workspace mutations.
type Handler = (request: Request) => Response | Promise<Response>;

let capturedHandler: Handler | undefined;
const originalServe = Deno.serve;

const interceptServe = ((handler: Handler) => {
  capturedHandler = handler;
  return {} as ReturnType<typeof Deno.serve>;
}) as typeof Deno.serve;

Object.defineProperty(Deno, "serve", {
  configurable: true,
  writable: true,
  value: interceptServe,
});

try {
  await import("./index.ts");
} finally {
  Object.defineProperty(Deno, "serve", {
    configurable: true,
    writable: true,
    value: originalServe,
  });
}

if (!capturedHandler) {
  throw new Error("The Edge Function handler was not captured for testing.");
}

Deno.env.set("SUPABASE_URL", "https://mock-supabase.invalid");
Deno.env.set("SUPABASE_ANON_KEY", "test-publishable-key");
Deno.env.delete("GEMINI_API_KEY");

type Scenario = "invalid-token" | "non-admin" | "admin-missing-proposal";
type RecordedRequest = { path: string; method: string };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function jsonResponse(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function invoke(
  scenario: Scenario | null,
  includeAuthorization = true,
  action = "execute_innerme_action",
  message = "Run the read-only workspace runtime check.",
): Promise<{
  status: number;
  body: Record<string, unknown>;
  requests: RecordedRequest[];
}> {
  const requests: RecordedRequest[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = input instanceof Request
      ? new URL(input.url)
      : new URL(String(input));
    const method = (init?.method ||
      (input instanceof Request ? input.method : "GET")).toUpperCase();
    requests.push({ path: requestUrl.pathname, method });

    if (requestUrl.pathname === "/auth/v1/user") {
      if (scenario === "invalid-token") {
        return jsonResponse(401, {
          message: "Invalid JWT",
          code: "bad_jwt",
        });
      }

      return jsonResponse(200, {
        id: "11111111-1111-4111-8111-111111111111",
        aud: "authenticated",
        role: "authenticated",
        email: "innerme-phase30-admin@example.invalid",
        app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: {},
        identities: [],
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
    }

    if (requestUrl.pathname === "/rest/v1/rpc/is_swayphics_admin") {
      return jsonResponse(200, scenario === "admin-missing-proposal");
    }

    if (
      requestUrl.pathname === "/rest/v1/rpc/get_innerme_workspace_summary" &&
      method === "POST"
    ) {
      // Match the requested finance domains, as the real RPC does.
      return jsonResponse(200, {
        generated_date_johannesburg: "2026-10-15",
        timezone: "Africa/Johannesburg",
        summary_source: "database_aggregate",
        metric_scope: "Synthetic aggregate fixture for the authenticated health probe.",
        client_summary: { total: 1 },
        invoice_summary: { total: 2, outstanding_value_zar: 250 },
        payment_summary: { total_paid_value_zar: 100 },
      });
    }

    if (
      requestUrl.pathname === "/rest/v1/innerme_action_proposals" &&
      method === "GET"
    ) {
      // The requested proposal deliberately does not exist. This prevents
      // the handler from reaching any execution, audit-write, task, or email path.
      return jsonResponse(200, []);
    }

    // The handler preloads workspace records before dispatching the requested
    // action. Return empty results for those read-only GETs.
    if (requestUrl.pathname.startsWith("/rest/v1/") && method === "GET") {
      return jsonResponse(200, []);
    }

    return jsonResponse(500, {
      message: "Unexpected request in non-mutating auth test.",
      path: requestUrl.pathname,
      method,
    });
  }) as typeof globalThis.fetch;

  try {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (includeAuthorization) headers.set("Authorization", "Bearer synthetic-test-token");

    const response = await capturedHandler!(
      new Request("http://localhost/functions/v1/swayphics-ai", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action,
          message,
          proposal_id: "00000000-0000-0000-0000-000000000000",
        }),
      }),
    );

    const body = await response.json() as Record<string, unknown>;
    return { status: response.status, body, requests };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

Deno.test("InnerMe authenticated read-only runtime probe follows focused retrieval", async () => {
  const result = await invoke(
    "admin-missing-proposal",
    true,
    "innerme_workspace_read_health",
    "Show overdue invoices and payments in a read-only runtime check.",
  );
  assertEqual(result.status, 200, "Workspace health status");
  assertEqual(result.body.ok, true, "Workspace health result");
  assertEqual(result.body.read_only, true, "Workspace health must be read-only");
  assertEqual(result.body.summary_source, "database_aggregate", "Aggregate source");
  assertEqual(result.body.summary_query_failed, false, "Aggregate RPC failure flag");
  assertEqual(result.body.queried_collection_count, 3, "Invoice/payment intent should use three linked domains");
  const providerConfiguration = (result.body as Record<string, unknown>).provider_configuration as
    | Record<string, unknown>
    | undefined;
  assert(
    typeof providerConfiguration?.gemini_key_configured === "boolean",
    "Authenticated health probe should expose only whether Gemini is configured, never the key.",
  );
  assert(
    typeof result.body.request_id === "string" && /^[0-9a-f-]{36}$/i.test(result.body.request_id),
    "Workspace health probe should expose a request ID that can correlate timing and provider telemetry.",
  );
  for (const metric of [
    "server_elapsed_ms",
    "workspace_retrieval_ms",
    "workspace_context_assembly_ms",
    "progressive_context_assembly_ms",
  ]) {
    assert(
      typeof result.body[metric] === "number" &&
        Number.isFinite(result.body[metric]) &&
        result.body[metric] >= 0,
      "Workspace health probe should provide a non-negative numeric " + metric + ".",
    );
  }
  assertEqual(result.body.workspace_data_read_call_count, 5, "Focused request should make three domain reads, one preference read, and one aggregate RPC call");
  assert(
    typeof result.body.progressive_workspace_json_bytes === "number" &&
      result.body.progressive_workspace_json_bytes > 0 &&
      result.body.progressive_workspace_json_bytes < 50000,
    "Compacted workspace JSON size should be measured and remain bounded in this fixture.",
  );
  assertEqual(result.body.progressive_detail_collection_count, 3, "Only three relevant detail collections should be expanded");
  const collections = result.body.queried_collections as string[];
  assert(
    JSON.stringify(collections) === JSON.stringify(["clients", "invoices", "payments"]),
    "Finance-focused retrieval should load only clients, invoices, and payments.",
  );
  const groups = result.body.summary_metric_groups as string[];
  for (const group of ["invoice_summary", "payment_summary", "client_summary"]) {
    assert(groups.includes(group), "Aggregate output must include " + group);
  }
  assert(!groups.includes("lead_counts"), "Unrequested lead metrics must not be reported as zero or loaded.");
  assert(!groups.includes("task_summary"), "Unrequested task metrics must not be reported as zero or loaded.");
  assert(
    result.requests.every((request) =>
      request.method === "GET" ||
      (request.method === "POST" && [
        "/rest/v1/rpc/is_swayphics_admin",
        "/rest/v1/rpc/get_innerme_workspace_summary",
      ].includes(request.path))
    ),
    "The runtime probe may issue only read-only workspace reads and read-only admin RPCs.",
  );
  assert(
    !result.requests.some((request) =>
      request.path.includes("generativelanguage.googleapis.com") ||
      request.path.includes("innerme_action_execution_logs") ||
      request.path.includes("innerme_action_proposals")
    ),
    "The read-only runtime probe must not call a model provider or controlled action endpoint.",
  );
});

Deno.test("InnerMe authenticated action guard rejects unsafe requests before side effects", async (t) => {
  await t.step("missing bearer token returns 401 before upstream requests", async () => {
    const result = await invoke(null, false);
    assertEqual(result.status, 401, "Missing-token status");
    assertEqual(result.body.error, "Authentication is required.", "Missing-token message");
    assertEqual(result.requests.length, 0, "Missing-token upstream request count");
  });

  await t.step("invalid bearer token returns 401", async () => {
    const result = await invoke("invalid-token");
    assertEqual(result.status, 401, "Invalid-token status");
    assertEqual(result.body.error, "Your session is no longer valid.", "Invalid-token message");
    assertEqual(result.requests.length, 1, "Invalid-token upstream request count");
    assertEqual(result.requests[0].path, "/auth/v1/user", "Invalid-token request path");
  });

  await t.step("authenticated non-admin returns 403", async () => {
    const result = await invoke("non-admin");
    assertEqual(result.status, 403, "Non-admin status");
    assertEqual(result.body.error, "You are not an active Swayphics admin.", "Non-admin message");
    assertEqual(result.requests.length, 2, "Non-admin upstream request count");
    assertEqual(result.requests[1].path, "/rest/v1/rpc/is_swayphics_admin", "Admin-gate RPC path");
  });

  await t.step("authenticated admin with missing proposal stops with 404 and no mutations", async () => {
    const result = await invoke("admin-missing-proposal");
    assertEqual(result.status, 404, "Missing-proposal status");
    assertEqual(
      result.body.error,
      "The InnerMe controlled action proposal could not be found.",
      "Missing-proposal message",
    );

    assertEqual(result.requests[0].path, "/auth/v1/user", "Auth lookup path");
    assertEqual(result.requests[1].path, "/rest/v1/rpc/is_swayphics_admin", "Admin-gate RPC path");
    assertEqual(result.requests[1].method, "POST", "Admin-gate RPC method");
    assert(
      result.requests.some((request) =>
        request.path === "/rest/v1/innerme_action_proposals" && request.method === "GET"
      ),
      "The handler must read the requested proposal before returning 404.",
    );

    assert(
      result.requests.every((request) =>
        request.method === "GET" ||
        (request.method === "POST" && [
          "/rest/v1/rpc/is_swayphics_admin",
          "/rest/v1/rpc/get_innerme_workspace_summary",
        ].includes(request.path))
      ),
      "Only GET reads and the read-only admin RPC are allowed in this path.",
    );
    assert(
      !result.requests.some((request) =>
        request.path.includes("innerme_action_execution_logs") ||
        request.path.includes("evaluate_innerme_action_policy")
      ),
      "The authenticated missing-proposal path must not call execution, audit-write, or task endpoints.",
    );
  });
});

// Public website chat has a deliberately separate, unauthenticated entry path.
// These tests protect its origin/session perimeter without calling Gemini or Supabase.
async function invokePublicBoundary(
  origin: string,
  session: string,
): Promise<{ status: number; body: Record<string, unknown>; outboundRequests: number }> {
  const originalFetch = globalThis.fetch;
  let outboundRequests = 0;
  globalThis.fetch = (async () => {
    outboundRequests += 1;
    return jsonResponse(500, { message: "Unexpected outbound request in public boundary test." });
  }) as typeof globalThis.fetch;

  try {
    const response = await capturedHandler!(
      new Request("http://localhost/functions/v1/swayphics-ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          "x-innerme-session": session,
        },
        body: JSON.stringify({
          action: "public_chat",
          message: "I need help deciding what my business needs.",
        }),
      }),
    );
    const body = await response.json() as Record<string, unknown>;
    return { status: response.status, body, outboundRequests };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

Deno.test("InnerMe public website chat boundary is checked before authentication and outbound calls", async (t) => {
  await t.step("rejects unapproved origins before any outbound request", async () => {
    const result = await invokePublicBoundary(
      "https://attacker.example",
      "synthetic-session-id-12345",
    );
    assertEqual(result.status, 403, "Unapproved public-chat origin status");
    assertEqual(
      result.body.error,
      "Public InnerMe is available through the Swayphics website only.",
      "Unapproved public-chat origin message",
    );
    assertEqual(result.outboundRequests, 0, "Unapproved origin outbound request count");
  });

  await t.step("rejects malformed session identifiers on an allowed origin before rate-limit or provider calls", async () => {
    const result = await invokePublicBoundary(
      "https://swayphics.co.za",
      "short",
    );
    assertEqual(result.status, 400, "Malformed public-chat session status");
    assertEqual(
      result.body.error,
      "Please refresh the page and try again.",
      "Malformed public-chat session message",
    );
    assertEqual(result.outboundRequests, 0, "Malformed session outbound request count");
  });
});

async function invokeMockedPublicSuccess(simulatePrimaryUnavailable = false): Promise<{
  status: number;
  body: Record<string, unknown>;
  requests: Array<{ host: string; path: string; method: string; payload?: Record<string, unknown> }>;
}> {
  const envKeys = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
    "GEMINI_API_KEY",
  ];
  const savedEnv = new Map(envKeys.map((key) => [key, Deno.env.get(key)]));
  for (const key of envKeys) Deno.env.delete(key);
  Deno.env.set("SUPABASE_URL", "https://mock-supabase.invalid");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
  Deno.env.set("GEMINI_API_KEY", "test-gemini-key");

  const requests: Array<{ host: string; path: string; method: string; payload?: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  const mockedAnswer = {
    answer: "Start by identifying the one outcome you most want customers to take next.",
    visitor_goal: "Clarify the next customer outcome.",
    problem_area: null,
    business_stage: "unsure",
    recommended_service: null,
    recommendation_reason: null,
    recommendation_confidence: null,
    ready_for_enquiry: false,
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request
      ? new URL(input.url)
      : new URL(String(input));
    const method = (init?.method ||
      (input instanceof Request ? input.method : "GET")).toUpperCase();
    let payload: Record<string, unknown> | undefined;
    if (url.pathname === "/rest/v1/innerme_provider_usage" && typeof init?.body === "string") {
      try {
        payload = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        payload = undefined;
      }
    }
    requests.push({ host: url.host, path: url.pathname, method, ...(payload ? { payload } : {}) });

    if (url.pathname === "/rest/v1/rpc/consume_public_innerme_rate_limit") {
      return jsonResponse(200, [{ allowed: true, retry_after_seconds: 60 }]);
    }
    if (url.pathname === "/rest/v1/rpc/innerme_reserve_provider_quota") {
      return jsonResponse(200, {
        allowed: true,
        used: 1,
        daily_limit: 40,
        reason: null,
      });
    }
    if (url.pathname === "/rest/v1/innerme_provider_usage") {
      return jsonResponse(201, {});
    }
    if (url.host === "generativelanguage.googleapis.com" &&
      url.pathname.endsWith(":generateContent")) {
      providerCalls += 1;
      if (simulatePrimaryUnavailable && providerCalls === 1) {
        return jsonResponse(503, { error: { status: "UNAVAILABLE" } });
      }
      return jsonResponse(200, {
        candidates: [{
          content: {
            parts: [{ text: JSON.stringify(mockedAnswer) }],
          },
        }],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 20,
          totalTokenCount: 120,
        },
      });
    }

    return jsonResponse(500, {
      message: "Unexpected outbound request in mocked public-chat success test.",
      host: url.host,
      path: url.pathname,
      method,
    });
  }) as typeof globalThis.fetch;

  try {
    const response = await capturedHandler!(
      new Request("http://localhost/functions/v1/swayphics-ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://swayphics.co.za",
          "x-innerme-session": "synthetic-session-id-12345",
        },
        body: JSON.stringify({
          action: "public_chat",
          message: "I need help deciding what my business needs.",
        }),
      }),
    );
    const body = await response.json() as Record<string, unknown>;
    return { status: response.status, body, requests };
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of savedEnv.entries()) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

Deno.test("InnerMe public website chat completes the guarded flow without workspace access", async () => {
  const result = await invokeMockedPublicSuccess();
  assertEqual(result.status, 200, "Public-chat success status");
  assertEqual(result.body.public, true, "Public-chat response marker");
  assertEqual(
    result.body.answer,
    "Start by identifying the one outcome you most want customers to take next.",
    "Public-chat answer",
  );
  assertEqual(result.body.ready_for_enquiry, false, "Exploratory chat must not force enquiry handoff");
  assertEqual(result.body.recommended_service, null, "Exploratory chat must not force a service recommendation");

  const rateLimitIndex = result.requests.findIndex((request) =>
    request.path === "/rest/v1/rpc/consume_public_innerme_rate_limit"
  );
  const quotaIndex = result.requests.findIndex((request) =>
    request.path === "/rest/v1/rpc/innerme_reserve_provider_quota"
  );
  const providerIndex = result.requests.findIndex((request) =>
    request.host === "generativelanguage.googleapis.com"
  );
  assert(rateLimitIndex >= 0, "Public chat must call the server-side rate limiter.");
  assert(quotaIndex > rateLimitIndex, "The free-tier quota reservation must follow public rate limiting.");
  assert(providerIndex > quotaIndex, "The provider request must follow a successful quota reservation.");
  assertEqual(
    result.requests.filter((request) => request.host === "generativelanguage.googleapis.com").length,
    1,
    "Mocked provider request count",
  );
  const usageEvents = result.requests
    .filter((request) => request.path === "/rest/v1/innerme_provider_usage")
    .map((request) => request.payload)
    .filter((event): event is Record<string, unknown> => Boolean(event));
  assertEqual(usageEvents.length, 1, "Successful public-chat provider attempt should be recorded");
  assertEqual(usageEvents[0].task_category, "assistant_chat", "Public-chat telemetry category");
  assertEqual(usageEvents[0].provider, "gemini", "Public-chat telemetry provider");
  assertEqual(usageEvents[0].outcome, "success", "Public-chat telemetry outcome");
  assertEqual(usageEvents[0].input_tokens, 100, "Public-chat reported prompt tokens");
  assertEqual(usageEvents[0].output_tokens, 20, "Public-chat reported output tokens");
  assertEqual(usageEvents[0].total_tokens, 120, "Public-chat reported total tokens");
  assert(!("answer" in usageEvents[0]) && !("message" in usageEvents[0]), "Telemetry must not persist prompts or answers");
  assert(
    result.requests.every((request) =>
      (request.host === "mock-supabase.invalid" && [
        "/rest/v1/rpc/consume_public_innerme_rate_limit",
        "/rest/v1/rpc/innerme_reserve_provider_quota",
      ].includes(request.path)) ||
      (request.host === "mock-supabase.invalid" && request.path === "/rest/v1/innerme_provider_usage") ||
      (request.host === "generativelanguage.googleapis.com" &&
        request.path.endsWith(":generateContent"))
    ),
    "Public chat must not fetch admin workspace tables, internal knowledge, or other private records.",
  );
});


Deno.test("InnerMe public website chat attributes fallback failures and successes", async () => {
  const result = await invokeMockedPublicSuccess(true);
  assertEqual(result.status, 200, "Fallback public-chat response status");
  assertEqual(
    result.requests.filter((request) => request.host === "generativelanguage.googleapis.com").length,
    2,
    "Primary and fallback provider request count",
  );
  const usageEvents = result.requests
    .filter((request) => request.path === "/rest/v1/innerme_provider_usage")
    .map((request) => request.payload)
    .filter((event): event is Record<string, unknown> => Boolean(event))
    .sort((a, b) => Number(a.attempt_number) - Number(b.attempt_number));
  assertEqual(usageEvents.length, 2, "Both public-chat provider attempts should be recorded");
  assertEqual(usageEvents[0].attempt_number, 1, "Primary attempt number");
  assertEqual(usageEvents[0].model, "gemini-3.8-flash", "Primary model telemetry");
  assertEqual(usageEvents[0].outcome, "error", "Primary unavailable outcome");
  assertEqual(usageEvents[0].http_status, 503, "Primary unavailable HTTP status");
  assertEqual(usageEvents[0].error_code, "provider_unavailable", "Primary unavailable error code");
  assertEqual(usageEvents[1].attempt_number, 2, "Fallback attempt number");
  assertEqual(usageEvents[1].model, "gemini-3.5-flash-lite", "Fallback model telemetry");
  assertEqual(usageEvents[1].outcome, "success", "Fallback success outcome");
  assertEqual(usageEvents[1].fallback_reason, "gemini_primary_http_503", "Fallback attribution");
  assertEqual(usageEvents[0].request_id, usageEvents[1].request_id, "Attempts from one public message share a correlation ID");
});
