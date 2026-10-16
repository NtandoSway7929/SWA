// Provider-free integration tests for the isolated semantic-retrieval suite's
// fail-closed quota preflight. The real handler runs with Supabase HTTP mocked.
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
  throw new Error("The retrieval smoke handler was not captured.");
}

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

type Scenario = {
  quotaStatus?: number;
  quotaUsed?: number;
  geminiKeyConfigured?: boolean;
};

async function invoke(scenario: Scenario) {
  const baselineText = await Deno.readTextFile(
    new URL("./regression-baseline.json", import.meta.url),
  );
  const baseline = JSON.parse(baselineText) as Record<string, unknown>;
  baseline.run_chat_checks = true;

  const requestLog: Array<{ path: string; method: string }> = [];
  const originalFetch = globalThis.fetch;
  const envNames = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "GEMINI_API_KEY",
  ];
  const originalEnv = new Map<string, string | undefined>(
    envNames.map((name) => [name, Deno.env.get(name)]),
  );

  Deno.env.set("SUPABASE_URL", "https://ofqofhnlzbouclvvrmzd.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-role-key");
  Deno.env.set("SUPABASE_ANON_KEY", "synthetic-publishable-key");
  Deno.env.delete("SUPABASE_PUBLISHABLE_KEY");
  if (scenario.geminiKeyConfigured === false) {
    Deno.env.delete("GEMINI_API_KEY");
  } else {
    Deno.env.set("GEMINI_API_KEY", "synthetic-test-provider-key");
  }

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request
      ? new URL(input.url)
      : new URL(String(input));
    const method = (init?.method ||
      (input instanceof Request ? input.method : "GET")).toUpperCase();
    requestLog.push({ path: url.pathname, method });

    if (url.pathname === "/auth/v1/user" && method === "GET") {
      return jsonResponse(200, {
        id: "11111111-1111-4111-8111-111111111111",
        aud: "authenticated",
        role: "authenticated",
        email: "innerme-quota-test@example.invalid",
        app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: {},
        identities: [],
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
    }

    if (url.pathname === "/rest/v1/admin_users" && method === "GET") {
      return jsonResponse(200, [{
        user_id: "11111111-1111-4111-8111-111111111111",
        active: true,
      }]);
    }

    if (url.pathname === "/rest/v1/innerme_provider_quota_daily" && method === "GET") {
      const status = scenario.quotaStatus ?? 200;
      if (status !== 200) {
        return jsonResponse(status, {
          code: "SYNTHETIC_QUOTA_READ_FAILURE",
          message: "Synthetic quota read failure for a provider-free regression test.",
        });
      }
      return jsonResponse(200, [{
        request_count: scenario.quotaUsed ?? 0,
      }]);
    }

    // Any fixture write, search request, function call, or external provider
    // request is unexpected in this test and is deliberately not performed.
    return jsonResponse(500, {
      message: "Unexpected network request in quota-preflight test.",
      path: url.pathname,
      method,
    });
  }) as typeof globalThis.fetch;

  try {
    const response = await capturedHandler!(
      new Request("http://localhost/functions/v1/innerme-retrieval-smoke-test", {
        method: "POST",
        headers: {
          "Authorization": "Bearer synthetic-test-admin-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(baseline),
      }),
    );
    const body = await response.json() as Record<string, any>;
    return { status: response.status, body, requestLog };
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of envNames) {
      const previous = originalEnv.get(name);
      if (previous === undefined) Deno.env.delete(name);
      else Deno.env.set(name, previous);
    }
  }
}

function assertNoFixtureOrProviderRequests(requestLog: Array<{ path: string; method: string }>) {
  const forbiddenRequest = requestLog.find((request) =>
    request.path === "/rest/v1/innerme_knowledge" ||
    request.path.startsWith("/functions/v1/swayphics-ai") ||
    request.path.includes("generativelanguage.googleapis.com")
  );
  assert(
    forbiddenRequest === undefined,
    "Quota preflight must stop before fixture insertion or any chat/provider request.",
  );
}

Deno.test("semantic retrieval full-mode quota preflight fails closed before fixtures or provider calls", async (t) => {
  await t.step("a full daily quota returns HTTP 429 without inserting fixtures", async () => {
    const result = await invoke({ quotaUsed: 40 });

    assertEqual(result.status, 429, "Full-quota status");
    assertEqual(result.body.status, "inconclusive", "Full-quota suite status");
    assertEqual(result.body.failure?.stage, "provider_quota_preflight", "Full-quota failure stage");
    assertEqual(result.body.quota_preflight?.used, 40, "Observed quota reservations");
    assertEqual(result.body.quota_preflight?.remaining, 0, "Remaining quota reservations");
    assertEqual(result.body.provider_chat_requests_attempted, 0, "Provider chat requests attempted");
    assertNoFixtureOrProviderRequests(result.requestLog);
  });

  await t.step("fewer than eight remaining reservations stops before fixture setup", async () => {
    const result = await invoke({ quotaUsed: 33 });

    assertEqual(result.status, 429, "Low-budget status");
    assertEqual(result.body.failure?.stage, "provider_quota_preflight", "Low-budget failure stage");
    assertEqual(result.body.quota_preflight?.remaining, 7, "Remaining quota reservations");
    assertEqual(result.body.quota_preflight?.minimum_required, 8, "Required quota reservations");
    assertEqual(result.body.provider_chat_requests_attempted, 0, "Provider chat requests attempted");
    assertNoFixtureOrProviderRequests(result.requestLog);
  });

  await t.step("an unavailable quota counter fails closed before fixture setup", async () => {
    const result = await invoke({ quotaStatus: 500 });

    assertEqual(result.status, 503, "Quota-read-error status");
    assertEqual(result.body.failure?.stage, "provider_quota_preflight", "Quota-read-error failure stage");
    assertEqual(result.body.provider_chat_requests_attempted, 0, "Provider chat requests attempted");
    assertNoFixtureOrProviderRequests(result.requestLog);
  });

  await t.step("a missing Gemini key is detected before quota reads or fixture setup", async () => {
    const result = await invoke({ geminiKeyConfigured: false });

    assertEqual(result.status, 503, "Missing-key status");
    assertEqual(result.body.failure?.stage, "provider_preflight", "Missing-key failure stage");
    assertEqual(result.body.provider_chat_requests_attempted, 0, "Provider chat requests attempted");
    assert(
      !result.requestLog.some((request) => request.path === "/rest/v1/innerme_provider_quota_daily"),
      "A missing provider key should stop before the quota read.",
    );
    assertNoFixtureOrProviderRequests(result.requestLog);
  });
});
