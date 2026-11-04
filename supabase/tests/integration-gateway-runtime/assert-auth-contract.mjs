import assert from "node:assert/strict";

const gatewayUrl = process.env.GATEWAY_URL ?? "http://127.0.0.1:9000/integration-gateway";
const mockStateUrl = process.env.MOCK_STATE_URL ?? "http://127.0.0.1:54321/__test/state";
const apiKey = "innerme-runtime-test-public-key";

const validRequest = {
  capability: "za.municipal_money.income_expenditure.read",
  parameters: {
    municipality_code: "JHB",
    financial_year: 2026,
    financial_period: 3,
    amount_type_code: "ACT",
    item_code: "0200",
    page: 1,
    page_size: 25,
  },
};

async function invoke({ token, origin, body = validRequest } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (origin) headers.origin = origin;

  const response = await fetch(gatewayUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Gateway returned a non-JSON response (HTTP ${response.status})`);
  }
  return { response, payload };
}

const missingToken = await invoke({ token: "" });
assert.equal(missingToken.response.status, 401);
assert.equal(missingToken.payload.error.code, "authentication_required");

const invalidSession = await invoke({ token: "invalid-session-token" });
assert.equal(invalidSession.response.status, 401);
assert.equal(invalidSession.payload.error.code, "invalid_session");

const nonAdmin = await invoke({ token: "non-admin-token" });
assert.equal(nonAdmin.response.status, 403);
assert.equal(nonAdmin.payload.error.code, "admin_required");

const invalidParameters = await invoke({
  token: "admin-invalid-token",
  body: {
    ...validRequest,
    parameters: { ...validRequest.parameters, municipality_code: "jhb" },
  },
});
assert.equal(invalidParameters.response.status, 400);
assert.equal(invalidParameters.payload.error.code, "invalid_parameter");

const quotaDenied = await invoke({ token: "quota-denied-token" });
assert.equal(quotaDenied.response.status, 429);
assert.equal(quotaDenied.response.headers.get("retry-after"), "17");
assert.equal(quotaDenied.payload.retry_after_seconds, 17);
assert.equal(quotaDenied.payload.error.code, "integration_quota_exceeded");

const quotaUnavailable = await invoke({ token: "quota-error-token" });
assert.equal(quotaUnavailable.response.status, 503);
assert.equal(quotaUnavailable.payload.error.code, "integration_quota_unavailable");

const forbiddenOrigin = await invoke({
  token: "admin-invalid-token",
  origin: "https://attacker.example",
});
assert.equal(forbiddenOrigin.response.status, 403);
assert.equal(forbiddenOrigin.payload.error, "Origin is not allowed.");

const stateResponse = await fetch(mockStateUrl);
assert.equal(stateResponse.status, 200);
const state = await stateResponse.json();
const requests = state.requests;

assert.ok(Array.isArray(requests), "mock Supabase request log must be an array");
assert.ok(requests.length > 0, "the Edge Function must call the mock Supabase service");
assert.ok(
  requests.every((item) => item.apiKey === apiKey),
  "all Supabase Auth/PostgREST calls must use the configured public API key",
);

const authTokens = requests
  .filter((item) => item.path === "/auth/v1/user")
  .map((item) => item.token)
  .sort();
assert.deepEqual(authTokens, [
  "admin-invalid-token",
  "invalid-session-token",
  "non-admin-token",
  "quota-denied-token",
  "quota-error-token",
].sort());

const adminTokens = requests
  .filter((item) => item.path === "/rest/v1/rpc/is_swayphics_admin")
  .map((item) => item.token)
  .sort();
assert.deepEqual(adminTokens, [
  "admin-invalid-token",
  "non-admin-token",
  "quota-denied-token",
  "quota-error-token",
].sort());

const quotaTokens = requests
  .filter((item) => item.path === "/rest/v1/rpc/innerme_reserve_integration_quota")
  .map((item) => item.token)
  .sort();
assert.deepEqual(quotaTokens, ["quota-denied-token", "quota-error-token"].sort());

assert.ok(
  requests.every((item) =>
    item.path === "/auth/v1/user" ||
    item.path === "/rest/v1/rpc/is_swayphics_admin" ||
    item.path === "/rest/v1/rpc/innerme_reserve_integration_quota"
  ),
  "the provider-free test must not invoke other Supabase routes",
);

console.log(JSON.stringify({
  status: "ok",
  cases: {
    missingBearerRejected: true,
    invalidSessionRejected: true,
    nonAdminRejected: true,
    invalidParametersRejectedBeforeQuota: true,
    quotaDenialReturns429AndRetryAfter: true,
    quotaBackendFailureReturns503: true,
    disallowedOriginRejectedBeforeAuthentication: true,
  },
  authUserCalls: authTokens.length,
  adminRpcCalls: adminTokens.length,
  quotaReserveCalls: quotaTokens.length,
  callerBearerTokenForwarded: true,
  publicApiKeyForwarded: true,
  providerCalls: 0,
}));
