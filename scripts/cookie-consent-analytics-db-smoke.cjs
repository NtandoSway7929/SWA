"use strict";

// Cookie-consent analytics database smoke test.
// This test must only target the disposable local Supabase instance started by CI.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const API_URL = process.env.SUPABASE_LOCAL_API_URL || process.env.API_URL || "";
const ANON_KEY = process.env.ANON_KEY || "";
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY || "";
const parsedApiUrl = API_URL ? new URL(API_URL) : null;

if (!parsedApiUrl || !["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsedApiUrl.hostname)) {
  throw new Error("Refusing to run cookie analytics database test: API_URL must point to loopback-only local Supabase.");
}
if (!ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error("Local Supabase environment is incomplete: ANON_KEY and SERVICE_ROLE_KEY are required.");
}

async function request(pathname, options = {}) {
  const {
    method = "GET",
    key = ANON_KEY,
    bearer,
    body,
    prefer,
    allowError = false
  } = options;
  const headers = { apikey: key, Accept: "application/json" };
  if (bearer) headers.Authorization = "Bearer " + bearer;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;

  const response = await fetch(API_URL.replace(/\/$/, "") + pathname, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await response.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch { data = raw; }
  }
  if (!response.ok && !allowError) {
    throw new Error(method + " " + pathname + " returned HTTP " + response.status + ": " +
      (typeof data === "string" ? data : JSON.stringify(data)));
  }
  return { status: response.status, data };
}

async function createAuthUser(email, password) {
  const result = await request("/auth/v1/admin/users", {
    method: "POST",
    key: SERVICE_ROLE_KEY,
    bearer: SERVICE_ROLE_KEY,
    body: { email, password, email_confirm: true, user_metadata: { full_name: "Cookie Analytics CI" } }
  });
  assert.ok(result.data && result.data.id, "local Supabase Auth should create a test user");
  return result.data;
}

async function signIn(email, password) {
  const result = await request("/auth/v1/token?grant_type=password", {
    method: "POST",
    key: ANON_KEY,
    body: { email, password }
  });
  assert.ok(result.data && result.data.access_token, "local Supabase Auth should return a user JWT");
  return result.data.access_token;
}

async function main() {
  const runId = Date.now();
  const password = "Local-CI-CookieAnalytics-7!x";
  const adminEmail = "cookie-analytics-admin-" + runId + "@example.invalid";
  const nonAdminEmail = "cookie-analytics-nonadmin-" + runId + "@example.invalid";
  const users = [];
  const sessionId = "11111111-1111-4111-8111-111111111111";
  let summary;

  try {
    const admin = await createAuthUser(adminEmail, password);
    users.push(admin.id);
    const adminToken = await signIn(adminEmail, password);

    await request("/rest/v1/admin_users", {
      method: "POST",
      key: SERVICE_ROLE_KEY,
      bearer: SERVICE_ROLE_KEY,
      body: [{
        user_id: admin.id,
        full_name: "Cookie Analytics CI",
        email: adminEmail,
        role: "owner",
        active: true
      }],
      prefer: "return=minimal"
    });

    const nonAdmin = await createAuthUser(nonAdminEmail, password);
    users.push(nonAdmin.id);
    const nonAdminToken = await signIn(nonAdminEmail, password);

    const eventRows = [
      { session_id: sessionId, event_type: "accepted", analytics_consent: true, source: "banner", policy_version: "ci-test", page_path: "/" },
      { session_id: sessionId, event_type: "rejected", analytics_consent: false, source: "banner", policy_version: "ci-test", page_path: "/services/" },
      { session_id: sessionId, event_type: "changed", analytics_consent: true, source: "preferences", policy_version: "ci-test", page_path: "/services/" },
      { session_id: sessionId, event_type: "withdrawn", analytics_consent: false, source: "preferences", policy_version: "ci-test", page_path: "/services/" }
    ];

    const insert = await request("/rest/v1/swayphics_cookie_consent_events", {
      method: "POST",
      key: ANON_KEY,
      body: eventRows,
      prefer: "return=minimal"
    });
    assert.ok(insert.status === 201 || insert.status === 204,
      "anonymous visitors should be able to submit validated consent decisions");

    const anonRead = await request(
      "/rest/v1/swayphics_cookie_consent_events?select=id",
      { key: ANON_KEY, allowError: true }
    );
    assert.ok(anonRead.status >= 400,
      "anonymous visitors must not be able to read raw consent-event rows");

    const adminRawRead = await request(
      "/rest/v1/swayphics_cookie_consent_events?select=id",
      { key: ANON_KEY, bearer: adminToken, allowError: true }
    );
    assert.ok(adminRawRead.status >= 400,
      "authenticated admins must use aggregate reporting rather than reading raw event rows");

    const nonAdminRawRead = await request(
      "/rest/v1/swayphics_cookie_consent_events?select=id",
      { key: ANON_KEY, bearer: nonAdminToken, allowError: true }
    );
    assert.ok(nonAdminRawRead.status >= 400,
      "authenticated non-admins must not be able to read raw consent-event rows");

    const anonReport = await request(
      "/rest/v1/rpc/get_swayphics_cookie_analytics",
      { method: "POST", key: ANON_KEY, body: { p_days: 7 }, allowError: true }
    );
    assert.ok(anonReport.status >= 400,
      "anonymous visitors must not be able to execute the aggregate analytics RPC");

    const nonAdminReport = await request(
      "/rest/v1/rpc/get_swayphics_cookie_analytics",
      { method: "POST", key: ANON_KEY, bearer: nonAdminToken, body: { p_days: 7 }, allowError: true }
    );
    assert.ok(nonAdminReport.status >= 400,
      "authenticated users without an active admin record must be denied by the aggregate RPC");
    assert.equal(nonAdminReport.data && nonAdminReport.data.code, "42501",
      "non-admin denial should use SQLSTATE 42501");

    const report = await request(
      "/rest/v1/rpc/get_swayphics_cookie_analytics",
      { method: "POST", key: ANON_KEY, bearer: adminToken, body: { p_days: 7 } }
    );
    assert.ok(Array.isArray(report.data), "active admins should receive daily aggregate rows");
    assert.equal(report.data.length, 1, "all four CI events should group into one South African calendar date");
    const totals = report.data[0];
    assert.equal(Number(totals.accepted), 1);
    assert.equal(Number(totals.rejected), 1);
    assert.equal(Number(totals.changed), 1);
    assert.equal(Number(totals.withdrawn), 1);
    assert.equal(Number(totals.total_decisions), 4);
    assert.equal(Number(totals.decision_sessions), 1,
      "the aggregate should count the shared tab-session identifier once");

    const invalidWindow = await request(
      "/rest/v1/rpc/get_swayphics_cookie_analytics",
      { method: "POST", key: ANON_KEY, bearer: adminToken, body: { p_days: 14 }, allowError: true }
    );
    assert.ok(invalidWindow.status >= 400,
      "the aggregate RPC must reject reporting windows outside 7, 30 or 90 days");
    assert.equal(invalidWindow.data && invalidWindow.data.code, "22023");

    summary = {
      result: "PASS",
      environment: "disposable local Supabase only",
      apiHost: parsedApiUrl.hostname,
      anonymousEventInsert: "four valid event types accepted",
      rawEventReads: "denied to anon, active admin and non-admin",
      aggregateRpc: "active admin allowed; anon and non-admin denied",
      aggregateTotals: {
        accepted: Number(totals.accepted),
        rejected: Number(totals.rejected),
        changed: Number(totals.changed),
        withdrawn: Number(totals.withdrawn),
        totalDecisions: Number(totals.total_decisions),
        uniqueSessions: Number(totals.decision_sessions)
      },
      invalidReportingWindow: "rejected with SQLSTATE 22023",
      remoteRequests: 0,
      productionOrCloudWrites: 0
    };
  } finally {
    for (const userId of users.slice().reverse()) {
      try {
        await request("/auth/v1/admin/users/" + userId, {
          method: "DELETE",
          key: SERVICE_ROLE_KEY,
          bearer: SERVICE_ROLE_KEY,
          allowError: true
        });
      } catch {
        // The entire Supabase stack is disposable and is stopped by the workflow.
      }
    }
  }

  const artifactDir = path.resolve("artifacts/cookie-consent-analytics-db");
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, "db-smoke-summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
