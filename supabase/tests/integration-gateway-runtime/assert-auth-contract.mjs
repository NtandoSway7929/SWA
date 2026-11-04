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

async function invoke({
  token,
  origin,
  body = validRequest,
  method = "POST",
  rawBody,
} = {}) {
  const headers = {};
  if (method === "POST") headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  if (origin) headers.origin = origin;

  const init = { method, headers };
  if (method !== "GET" && method !== "OPTIONS") {
    init.body = rawBody ?? JSON.stringify(body);
  }

  const response = await fetch(gatewayUrl, init);
  if (response.status === 204) return { response, payload: null };
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Gateway returned a non-JSON response (HTTP ${response.status})`);
  }
  return { response, payload };
}

const allowedOrigin = "https://swayphics.co.za";
const disallowedOrigin = "https://attacker.example";

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

const unsupportedBodyField = await invoke({
  token: "unsupported-body-token",
  body: { ...validRequest, url: "https://attacker.example" },
});
assert.equal(unsupportedBodyField.response.status, 400);
assert.equal(unsupportedBodyField.payload.error, "Request contains unsupported fields.");

const unknownCapability = await invoke({
  token: "unknown-capability-token",
  body: { ...validRequest, capability: "za.unknown.capability" },
});
assert.equal(unknownCapability.response.status, 404);
assert.equal(unknownCapability.payload.error, "Unknown integration capability.");

const invalidJson = await invoke({
  token: "invalid-json-token",
  rawBody: "{",
});
assert.equal(invalidJson.response.status, 400);
assert.equal(invalidJson.payload.error, "Invalid JSON body.");

const methodRejected = await invoke({ method: "GET" });
assert.equal(methodRejected.response.status, 405);
assert.equal(methodRejected.payload.error, "Method not allowed.");

const oversizedBody = await invoke({
  rawBody: "x".repeat(5000),
});
assert.equal(oversizedBody.response.status, 413);
assert.equal(oversizedBody.payload.error, "Request body is too large.");

const allowedPreflight = await invoke({
  method: "OPTIONS",
  origin: allowedOrigin,
});
assert.equal(allowedPreflight.response.status, 204);
assert.equal(allowedPreflight.response.headers.get("access-control-allow-origin"), allowedOrigin);

const quotaDenied = await invoke({ token: "quota-denied-token" });
assert.equal(quotaDenied.response.status, 429);
assert.equal(quotaDenied.response.headers.get("retry-after"), "17");
assert.equal(quotaDenied.payload.retry_after_seconds, 17);
assert.equal(quotaDenied.payload.error.code, "integration_quota_exceeded");

const quotaUnavailable = await invoke({ token: "quota-error-token" });
assert.equal(quotaUnavailable.response.status, 503);
assert.equal(quotaUnavailable.payload.error.code, "integration_quota_unavailable");

const malformedQuotaDecision = await invoke({ token: "quota-malformed-token" });
assert.equal(malformedQuotaDecision.response.status, 503);
assert.equal(malformedQuotaDecision.payload.error.code, "integration_quota_unavailable");

const invalidRetryAfter = await invoke({ token: "quota-retry-invalid-token" });
assert.equal(invalidRetryAfter.response.status, 503);
assert.equal(invalidRetryAfter.payload.error.code, "integration_quota_unavailable");

const invalidReservationId = await invoke({ token: "quota-reservation-invalid-token" });
assert.equal(invalidReservationId.response.status, 503);
assert.equal(invalidReservationId.payload.error.code, "integration_quota_unavailable");

const forbiddenOrigin = await invoke({
  token: "admin-invalid-token",
  origin: disallowedOrigin,
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

const expectedAuthTokens = [
  "invalid-session-token",
  "non-admin-token",
  "admin-invalid-token",
  "unsupported-body-token",
  "unknown-capability-token",
  "invalid-json-token",
  "quota-denied-token",
  "quota-error-token",
  "quota-malformed-token",
  "quota-retry-invalid-token",
  "quota-reservation-invalid-token",
].sort();
const authTokens = requests
  .filter((item) => item.path === "/auth/v1/user")
  .map((item) => item.token)
  .sort();
assert.deepEqual(authTokens, expectedAuthTokens);

const expectedAdminTokens = [
  "non-admin-token",
  "admin-invalid-token",
  "unsupported-body-token",
  "unknown-capability-token",
  "invalid-json-token",
  "quota-denied-token",
  "quota-error-token",
  "quota-malformed-token",
  "quota-retry-invalid-token",
  "quota-reservation-invalid-token",
].sort();
const adminTokens = requests
  .filter((item) => item.path === "/rest/v1/rpc/is_swayphics_admin")
  .map((item) => item.token)
  .sort();
assert.deepEqual(adminTokens, expectedAdminTokens);

const expectedQuotaTokens = [
  "quota-denied-token",
  "quota-error-token",
  "quota-malformed-token",
  "quota-retry-invalid-token",
  "quota-reservation-invalid-token",
].sort();
const quotaTokens = requests
  .filter((item) => item.path === "/rest/v1/rpc/innerme_reserve_integration_quota")
  .map((item) => item.token)
  .sort();
assert.deepEqual(quotaTokens, expectedQuotaTokens);

for (const token of expectedAdminTokens) {
  const authIndex = requests.findIndex((item) => item.path === "/auth/v1/user" && item.token === token);
  const adminIndex = requests.findIndex((item) => item.path === "/rest/v1/rpc/is_swayphics_admin" && item.token === token);
  assert.ok(authIndex >= 0 && adminIndex > authIndex, `Auth must precede admin RPC for ${token}`);
}
for (const token of expectedQuotaTokens) {
  const adminIndex = requests.findIndex((item) => item.path === "/rest/v1/rpc/is_swayphics_admin" && item.token === token);
  const quotaIndex = requests.findIndex((item) => item.path === "/rest/v1/rpc/innerme_reserve_integration_quota" && item.token === token);
  assert.ok(quotaIndex > adminIndex, `Admin check must precede quota reservation for ${token}`);
}

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
    unsupportedBodyFieldRejectedBeforeQuota: true,
    unknownCapabilityRejectedBeforeQuota: true,
    invalidJsonRejected: true,
    nonPostMethodRejected: true,
    oversizedRequestRejected: true,
    allowedPreflightAnsweredWithoutAuth: true,
    quotaDenialReturns429AndRetryAfter: true,
    quotaBackendFailureReturns503: true,
    malformedQuotaDecisionReturns503: true,
    invalidRetryAfterReturns503: true,
    invalidReservationIdReturns503: true,
    disallowedOriginRejectedBeforeAuthentication: true,
    authAdminAndQuotaOrderingVerified: true,
  },
  authUserCalls: authTokens.length,
  adminRpcCalls: adminTokens.length,
  quotaReserveCalls: quotaTokens.length,
  callerBearerTokenForwarded: true,
  publicApiKeyForwarded: true,
  providerCalls: 0,
}));
