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
      // Return metric groups for the health probe's full operational collection set.
      return jsonResponse(200, {
        generated_date_johannesburg: "2026-10-15",
        timezone: "Africa/Johannesburg",
        summary_source: "database_aggregate",
        metric_scope: "Synthetic aggregate fixture for the authenticated health probe.",
        lead_counts: { total: 2, open_pipeline: 2, won: 0, lost: 0 },
        lead_value_zar: { open_pipeline: 4000, active_excluding_follow_up: 4000, won_value: 0 },
        followup_counts: { pending_total: 1, pending_due_today: 0 },
        quote_summary: { open_count: 1, open_value_zar: 500 },
        invoice_summary: { total: 2, outstanding_value_zar: 250 },
        payment_summary: { total_paid_value_zar: 100 },
        enquiry_summary: { total: 1, new: 1 },
        task_summary: { total: 3, open: 2 },
        project_summary: { total: 1, active: 1 },
        client_summary: { total: 1 },
        portal_request_summary: { total: 0, new: 0 },
        communication_summary: { total: 2 },
        activity_summary: { total: 4 },
        email_summary: { total: 3, unread: 1, inbound: 2, outbound: 1 },
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

Deno.test("InnerMe authenticated health probe validates all workspace queries without provider calls", async () => {
  const result = await invoke(
    "admin-missing-proposal",
    true,
    "innerme_workspace_read_health",
    "Read-only preflight for the isolated structured-answer evaluation.",
  );
  assertEqual(result.status, 200, "Workspace health status");
  assertEqual(result.body.ok, true, "Workspace health result");
  assertEqual(result.body.read_only, true, "Workspace health must be read-only");
  assertEqual(result.body.summary_source, "database_aggregate", "Aggregate source");
  assertEqual(result.body.summary_query_failed, false, "Aggregate RPC failure flag");
  assertEqual(result.body.queried_collection_count, 13, "Health probe should query all operational collections");
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
  assertEqual(result.body.workspace_data_read_call_count, 14, "Health probe should make 13 operational reads and one aggregate RPC call");
  assert(
    typeof result.body.progressive_workspace_json_bytes === "number" &&
      result.body.progressive_workspace_json_bytes > 0 &&
      result.body.progressive_workspace_json_bytes < 50000,
    "Compacted workspace JSON size should be measured and remain bounded in this fixture.",
  );
  assertEqual(result.body.progressive_detail_collection_count, 0, "Health probe should not expand unrelated business detail");
  const collections = result.body.queried_collections as string[];
  assert(
    JSON.stringify(collections) === JSON.stringify(["leads", "followups", "clients", "projects", "tasks", "quotes", "invoices", "payments", "enquiries", "portal_requests", "communications", "email_messages", "activities"]),
    "Health probe should validate all operational collection queries in deterministic order.",
  );
  const groups = result.body.summary_metric_groups as string[];
  for (const group of ["lead_counts", "lead_value_zar", "followup_counts", "quote_summary", "invoice_summary", "payment_summary", "enquiry_summary", "task_summary", "project_summary", "client_summary", "portal_request_summary", "communication_summary", "activity_summary", "email_summary"]) {
    assert(groups.includes(group), "Aggregate output must include " + group);
  }
  assertEqual(result.body.workspace_query_failure_count, 0, "Successful health probe should have no workspace query failures");
  assertEqual(result.body.aggregate_ready, true, "Database aggregate should be ready");
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

  await t.step("fails closed when the Gemini key is missing before any outbound request", async () => {
    const result = await invokePublicBoundary(
      "https://swayphics.co.za",
      "synthetic-session-id-12345",
    );
    assertEqual(result.status, 503, "Missing public-chat Gemini key status");
    assertEqual(
      result.body.error,
      "InnerMe is temporarily unavailable.",
      "Missing public-chat Gemini key message",
    );
    assertEqual(result.outboundRequests, 0, "Missing Gemini key outbound request count");
  });
});

async function invokeMockedPublicSuccess(options: { simulatePrimaryUnavailable?: boolean; blockQuota?: boolean } = {}): Promise<{
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
      return jsonResponse(200, options.blockQuota
        ? {
            allowed: false,
            used: 40,
            daily_limit: 40,
            reason: "daily_quota_reached",
          }
        : {
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
      if (options.simulatePrimaryUnavailable && providerCalls === 1) {
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
  const result = await invokeMockedPublicSuccess({ simulatePrimaryUnavailable: true });
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

Deno.test("InnerMe public website chat stops before Gemini when quota reservation is denied", async () => {
  const result = await invokeMockedPublicSuccess({ blockQuota: true });
  assertEqual(result.status, 502, "Quota-blocked public-chat response status");
  assertEqual(result.body.provider_status, 403, "Quota guard status surfaced by public handler");
  assertEqual(
    result.body.error,
    "InnerMe is unavailable right now. Please try again in a moment.",
    "Quota-blocked public-chat message",
  );
  assert(
    result.requests.some((request) => request.path === "/rest/v1/rpc/consume_public_innerme_rate_limit"),
    "Public rate limiting should still run before provider checks.",
  );
  assert(
    result.requests.some((request) => request.path === "/rest/v1/rpc/innerme_reserve_provider_quota"),
    "The server-side provider quota must be checked.",
  );
  assertEqual(
    result.requests.filter((request) => request.host === "generativelanguage.googleapis.com").length,
    0,
    "A denied quota reservation must block every Gemini request.",
  );
  assertEqual(
    result.requests.filter((request) => request.path === "/rest/v1/innerme_provider_usage").length,
    0,
    "A guard-blocked request must not be misreported as a provider attempt.",
  );
});


type ProposalContractMockResult = {
  status: number;
  body: Record<string, unknown>;
  requests: Array<{
    host: string;
    path: string;
    method: string;
    providerPayload?: Record<string, unknown>;
    telemetryPayload?: Record<string, unknown>;
  }>;
};

async function invokeDraftProposalWithMockedProvider(
  generatedText: string,
  options: { simulatePrimaryUnavailable?: boolean; blockQuota?: boolean } = {},
): Promise<ProposalContractMockResult> {
  const envKeys = [
    "GEMINI_API_KEY",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  const savedEnv = new Map(envKeys.map((key) => [key, Deno.env.get(key)]));
  Deno.env.set("GEMINI_API_KEY", "synthetic-gemini-key");
  Deno.env.set("SUPABASE_SECRET_KEY", "synthetic-supabase-secret-key");
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");

  const requests: ProposalContractMockResult["requests"] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request
      ? new URL(input.url)
      : new URL(String(input));
    const method = (init?.method ||
      (input instanceof Request ? input.method : "GET")).toUpperCase();
    let providerPayload: Record<string, unknown> | undefined;
    let telemetryPayload: Record<string, unknown> | undefined;

    if (typeof init?.body === "string") {
      try {
        const parsedBody = JSON.parse(init.body) as Record<string, unknown>;
        if (url.host === "generativelanguage.googleapis.com") {
          providerPayload = parsedBody;
        } else if (url.pathname === "/rest/v1/innerme_provider_usage") {
          telemetryPayload = parsedBody;
        }
      } catch {
        providerPayload = undefined;
        telemetryPayload = undefined;
      }
    }

    requests.push({
      host: url.host,
      path: url.pathname,
      method,
      ...(providerPayload ? { providerPayload } : {}),
      ...(telemetryPayload ? { telemetryPayload } : {}),
    });

    if (url.pathname === "/auth/v1/user") {
      return jsonResponse(200, {
        id: "11111111-1111-4111-8111-111111111111",
        aud: "authenticated",
        role: "authenticated",
        email: "synthetic-innerme-admin@example.invalid",
        app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: {},
        identities: [],
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
    }

    if (url.pathname === "/rest/v1/rpc/is_swayphics_admin") {
      return jsonResponse(200, true);
    }

    if (url.pathname === "/rest/v1/rpc/innerme_reserve_provider_quota") {
      return jsonResponse(200, options.blockQuota
        ? {
            allowed: false,
            used: 40,
            daily_limit: 40,
            reason: "daily_quota_reached",
          }
        : {
            allowed: true,
            used: 1,
            daily_limit: 40,
            reason: null,
          });
    }

    if (url.pathname === "/rest/v1/rpc/get_innerme_workspace_summary") {
      return jsonResponse(200, {
        generated_date_johannesburg: "2026-10-16",
        timezone: "Africa/Johannesburg",
        summary_source: "database_aggregate",
        metric_scope: "Synthetic fixture for provider-free contract testing.",
      });
    }

    if (url.pathname === "/rest/v1/innerme_provider_usage" && method === "POST") {
      return jsonResponse(201, {});
    }

    if (
      url.host === "generativelanguage.googleapis.com" &&
      url.pathname.endsWith(":generateContent")
    ) {
      const model = url.pathname.match(/\/models\/([^/]+):generateContent/)?.[1] || "";
      const providerCallNumber = requests.filter((request) =>
        request.host === "generativelanguage.googleapis.com" &&
        request.path.endsWith(":generateContent")
      ).length;

      if (options.simulatePrimaryUnavailable && providerCallNumber === 1) {
        return jsonResponse(503, { error: { status: "UNAVAILABLE" } });
      }

      return jsonResponse(200, {
        model,
        candidates: [{
          content: {
            parts: [{ text: generatedText }],
          },
        }],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 120,
          totalTokenCount: 220,
        },
      });
    }

    if (url.host === "mock-supabase.invalid" &&
      url.pathname.startsWith("/rest/v1/") &&
      method === "GET") {
      return jsonResponse(200, []);
    }

    return jsonResponse(500, {
      message: "Unexpected request in the mocked proposal contract test.",
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
          Authorization: "Bearer synthetic-test-token",
        },
        body: JSON.stringify({
          action: "draft_proposal",
          lead_id: "synthetic-lead-123",
          lead: {
            business_name: "Example Business",
            contact_name: "Example Owner",
            service_interest: "Website design",
            estimated_value: 1500,
          },
          assessment: {
            business_assessment: "The current customer journey needs clearer service information and a stronger enquiry path.",
            research_findings: "The supplied assessment identifies avoidable friction before a prospective customer makes contact.",
            swayphics_solution: "We can structure the website around the customer's next useful action.",
            recommended_services: "Website design and enquiry-flow improvements",
            research_sources: "Synthetic test fixture only",
          },
        }),
      }),
    );

    return {
      status: response.status,
      body: await response.json() as Record<string, unknown>,
      requests,
    };
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of savedEnv.entries()) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

Deno.test("InnerMe proposal drafting preserves the proposal.title/subject/content response contract", async () => {
  const modelProposal = {
    title: "Website and enquiry journey proposal",
    subject: "Swayphics | Proposal for Example Business",
    content: "We can help your business present its services more clearly and make the next step easier for prospective customers. The proposed scope focuses on the website structure, useful service information, and a straightforward enquiry path. We can confirm final pricing and delivery details separately after agreeing the scope. The next step is to review the proposed scope and tell us which priorities matter most to your business.",
  };
  const result = await invokeDraftProposalWithMockedProvider(JSON.stringify(modelProposal));

  assertEqual(result.status, 200, "Valid proposal response status");
  const proposal = result.body.proposal as Record<string, unknown> | undefined;
  assert(!!proposal && typeof proposal === "object", "Successful response must include a proposal object.");
  assertEqual(proposal.title, modelProposal.title, "Proposal title contract");
  assertEqual(proposal.subject, modelProposal.subject, "Proposal subject contract");
  assertEqual(proposal.content, modelProposal.content, "Proposal content contract");
  assertEqual(result.body.lead_id, "synthetic-lead-123", "Proposal must preserve the requested lead ID");
  assertEqual(result.body.approval_required, true, "Proposal must remain subject to admin approval");
  assertEqual(result.body.provider_model, "gemini-3.8-flash", "Proposal provider attribution");

  const providerRequests = result.requests.filter((request) =>
    request.host === "generativelanguage.googleapis.com" &&
    request.path.endsWith(":generateContent")
  );
  assertEqual(providerRequests.length, 1, "Mocked provider call count");
  assertEqual(
    (providerRequests[0].providerPayload?.generationConfig as Record<string, unknown>)?.responseMimeType,
    "application/json",
    "Proposal generation must request JSON output",
  );

  const telemetryEvents = result.requests
    .filter((request) =>
      request.path === "/rest/v1/innerme_provider_usage" &&
      request.method === "POST"
    )
    .map((request) => request.telemetryPayload)
    .filter((event): event is Record<string, unknown> => Boolean(event));
  assertEqual(telemetryEvents.length, 1, "Successful proposal provider attempt telemetry count");
  assertEqual(telemetryEvents[0].task_category, "proposal_draft", "Proposal telemetry category");
  assertEqual(telemetryEvents[0].provider, "gemini", "Proposal telemetry provider");
  assertEqual(telemetryEvents[0].model, "gemini-3.8-flash", "Proposal telemetry model");
  assertEqual(telemetryEvents[0].outcome, "success", "Proposal telemetry outcome");
  assertEqual(telemetryEvents[0].http_status, 200, "Proposal provider HTTP status");
  assertEqual(telemetryEvents[0].attempt_number, 1, "Proposal provider attempt number");
  assertEqual(telemetryEvents[0].input_tokens, 100, "Proposal reported prompt tokens");
  assertEqual(telemetryEvents[0].output_tokens, 120, "Proposal reported output tokens");
  assertEqual(telemetryEvents[0].total_tokens, 220, "Proposal reported total tokens");
  assert(
    typeof telemetryEvents[0].request_id === "string" &&
      /^[0-9a-f-]{36}$/i.test(String(telemetryEvents[0].request_id)),
    "Proposal telemetry must include a UUID request correlation ID",
  );
  const telemetryJson = JSON.stringify(telemetryEvents[0]);
  for (const privateValue of [
    "Example Business",
    "Example Owner",
    "customer journey",
    modelProposal.content,
  ]) {
    assert(!telemetryJson.includes(privateValue), "Telemetry must not store proposal or lead content.");
  }
  for (const privateField of ["prompt", "message", "answer", "content", "business_name", "assessment"]) {
    assert(!(privateField in telemetryEvents[0]), "Telemetry must not have a " + privateField + " field.");
  }
  assert(
    result.requests.some((request) =>
      request.path === "/rest/v1/rpc/innerme_reserve_provider_quota" &&
      request.method === "POST"
    ),
    "The provider-free test must still exercise the server quota reservation gate.",
  );
  assert(
    result.requests.every((request) =>
      request.host === "mock-supabase.invalid" ||
      request.host === "generativelanguage.googleapis.com"
    ),
    "The test must not make any real outbound requests.",
  );
});

Deno.test("InnerMe proposal drafting rejects malformed provider JSON instead of returning a broken contract", async () => {
  const result = await invokeDraftProposalWithMockedProvider("not valid JSON");

  assertEqual(result.status, 502, "Malformed proposal status");
  assertEqual(
    result.body.error,
    "InnerMe returned an incomplete proposal draft.",
    "Malformed proposal should fail closed with a stable error",
  );
  assert(
    !("proposal" in result.body),
    "Malformed provider output must not return a partial proposal object.",
  );
  assertEqual(
    result.requests.filter((request) =>
      request.host === "generativelanguage.googleapis.com" &&
      request.path.endsWith(":generateContent")
    ).length,
    1,
    "Malformed-output test provider call count",
  );
  const telemetryEvents = result.requests
    .filter((request) =>
      request.path === "/rest/v1/innerme_provider_usage" &&
      request.method === "POST"
    )
    .map((request) => request.telemetryPayload)
    .filter((event): event is Record<string, unknown> => Boolean(event));
  assertEqual(telemetryEvents.length, 1, "Malformed proposal attempt telemetry count");
  assertEqual(telemetryEvents[0].task_category, "proposal_draft", "Malformed proposal telemetry category");
  assertEqual(telemetryEvents[0].outcome, "error", "Malformed proposal telemetry outcome");
  assertEqual(telemetryEvents[0].error_code, "invalid_proposal_json", "Malformed proposal telemetry attribution");
  assertEqual(telemetryEvents[0].http_status, 200, "Malformed response still records the successful provider HTTP status");
  assert(
    !JSON.stringify(telemetryEvents[0]).includes("not valid JSON"),
    "Telemetry must not capture provider response content.",
  );
  assert(
    result.requests.every((request) =>
      request.host === "mock-supabase.invalid" ||
      request.host === "generativelanguage.googleapis.com"
    ),
    "Malformed-output testing must not make any real outbound requests.",
  );
});

Deno.test("InnerMe proposal drafting records both primary failure and fallback success", async () => {
  const modelProposal = {
    title: "Website and enquiry journey proposal",
    subject: "Swayphics | Proposal for Example Business",
    content: "We can help your business present its services more clearly and make the next step easier for prospective customers. The proposed scope focuses on the website structure, useful service information, and a straightforward enquiry path. We can confirm final pricing and delivery details separately after agreeing the scope. The next step is to review the proposed scope and tell us which priorities matter most to your business.",
  };
  const result = await invokeDraftProposalWithMockedProvider(
    JSON.stringify(modelProposal),
    { simulatePrimaryUnavailable: true },
  );

  assertEqual(result.status, 200, "Fallback proposal response status");
  assertEqual(
    result.requests.filter((request) =>
      request.host === "generativelanguage.googleapis.com" &&
      request.path.endsWith(":generateContent")
    ).length,
    2,
    "Proposal primary and fallback provider request count",
  );

  const telemetryEvents = result.requests
    .filter((request) =>
      request.path === "/rest/v1/innerme_provider_usage" &&
      request.method === "POST"
    )
    .map((request) => request.telemetryPayload)
    .filter((event): event is Record<string, unknown> => Boolean(event))
    .sort((a, b) => Number(a.attempt_number) - Number(b.attempt_number));

  assertEqual(telemetryEvents.length, 2, "Both proposal provider attempts must be recorded");
  assertEqual(telemetryEvents[0].attempt_number, 1, "Primary proposal attempt number");
  assertEqual(telemetryEvents[0].model, "gemini-3.8-flash", "Primary proposal model");
  assertEqual(telemetryEvents[0].outcome, "error", "Primary proposal outcome");
  assertEqual(telemetryEvents[0].http_status, 503, "Primary provider-unavailable status");
  assertEqual(telemetryEvents[0].error_code, "provider_unavailable", "Primary provider error attribution");
  assertEqual(telemetryEvents[1].attempt_number, 2, "Fallback proposal attempt number");
  assertEqual(telemetryEvents[1].model, "gemini-3.5-flash-lite", "Fallback proposal model");
  assertEqual(telemetryEvents[1].outcome, "success", "Fallback proposal outcome");
  assertEqual(telemetryEvents[1].fallback_reason, "gemini_primary_http_503", "Proposal fallback reason");
  assertEqual(telemetryEvents[0].request_id, telemetryEvents[1].request_id, "Proposal attempts must share a request ID");
  assert(
    telemetryEvents.every((event) =>
      !JSON.stringify(event).includes("Example Business") &&
      !JSON.stringify(event).includes(modelProposal.content)
    ),
    "Fallback telemetry must remain free of proposal content.",
  );
});

Deno.test("InnerMe proposal drafting does not record a guard-blocked request as a provider attempt", async () => {
  const result = await invokeDraftProposalWithMockedProvider(
    "not used because quota is denied",
    { blockQuota: true },
  );

  assertEqual(result.status, 502, "Quota-guarded proposal response status");
  assertEqual(
    result.requests.filter((request) =>
      request.host === "generativelanguage.googleapis.com" &&
      request.path.endsWith(":generateContent")
    ).length,
    0,
    "A guard-blocked proposal must not call Gemini",
  );
  assertEqual(
    result.requests.filter((request) =>
      request.path === "/rest/v1/innerme_provider_usage" &&
      request.method === "POST"
    ).length,
    0,
    "A guard-blocked proposal must not be reported as a provider attempt",
  );
});
