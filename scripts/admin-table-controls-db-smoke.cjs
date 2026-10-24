"use strict";

// Authenticated REST persistence smoke test for disposable local Supabase only.
// This is paired with the browser UI's mocked action-path test; it is not a
// staging deployment and must never target a hosted Supabase project.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const API_URL = process.env.SUPABASE_LOCAL_API_URL || process.env.API_URL || "";
const ANON_KEY = process.env.ANON_KEY || "";
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY || "";
const ARTIFACT_DIR = path.resolve("artifacts/admin-table-controls-db");
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

const parsedApiUrl = API_URL ? new URL(API_URL) : null;
if (!parsedApiUrl || !["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsedApiUrl.hostname)) {
  throw new Error("Refusing to run database smoke test: API_URL must point to a loopback-only local Supabase instance.");
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
    body: { email, password, email_confirm: true, user_metadata: { full_name: "Admin Table Controls CI" } }
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
  assert.ok(result.data && result.data.access_token, "local Supabase Auth should return a user access token");
  return result.data.access_token;
}

async function rest(method, table, query, { token, body, key = ANON_KEY, prefer = "return=representation", allowError = false } = {}) {
  const suffix = query ? "?" + query : "";
  return request("/rest/v1/" + table + suffix, { method, key, bearer: token, body, prefer, allowError });
}

async function bestEffortCleanup(userIds, recordIds) {
  const serviceOptions = { token: SERVICE_ROLE_KEY, key: SERVICE_ROLE_KEY, prefer: "return=minimal" };
  const clean = async (table, query) => {
    try { await rest("DELETE", table, query, serviceOptions); } catch { /* local stack is disposable */ }
  };

  for (const id of [recordIds.taskId, recordIds.followupId]) {
    if (id) await clean("activity_log", "entity_id=eq." + id);
  }
  if (recordIds.followupId) await clean("follow_ups", "id=eq." + recordIds.followupId);
  if (recordIds.taskId) await clean("tasks", "id=eq." + recordIds.taskId);
  if (recordIds.communicationId) {
    await clean("activity_log", "entity_id=eq." + recordIds.communicationId);
    await clean("communication_logs", "id=eq." + recordIds.communicationId);
  }
  for (const id of [recordIds.leadAlphaId, recordIds.leadBravoId]) {
    if (id) await clean("leads", "id=eq." + id);
  }
  for (const id of userIds.slice().reverse()) {
    if (!id) continue;
    try {
      await request("/auth/v1/admin/users/" + id, {
        method: "DELETE", key: SERVICE_ROLE_KEY, bearer: SERVICE_ROLE_KEY
      });
    } catch { /* local stack is disposable */ }
  }
}

async function main() {
  const runId = Date.now();
  const password = "Local-CI-TableControls-7!x";
  const adminEmail = "admin-table-controls-" + runId + "@example.invalid";
  const nonAdminEmail = "non-admin-table-controls-" + runId + "@example.invalid";
  const userIds = [];
  const ids = {
    leadAlphaId: randomUUID(),
    leadBravoId: randomUUID(),
    communicationId: randomUUID(),
    taskId: randomUUID(),
    followupId: randomUUID()
  };
  const writes = [];
  let summary;

  try {
    const admin = await createAuthUser(adminEmail, password);
    userIds.push(admin.id);
    const adminToken = await signIn(adminEmail, password);

    // Seed only this run's disposable UUID records using the local service key.
    await rest("POST", "admin_users", "", {
      token: SERVICE_ROLE_KEY, key: SERVICE_ROLE_KEY,
      body: [{ user_id: admin.id, full_name: "Admin Table Controls CI", email: adminEmail, role: "owner", active: true }]
    });

    await rest("POST", "leads", "", {
      token: SERVICE_ROLE_KEY, key: SERVICE_ROLE_KEY,
      body: [
        { id: ids.leadAlphaId, business_name: "CI Alpha Studio", contact_name: "Local Test", email: "alpha@example.invalid", service_interest: "Website", source: "CI Fixture", status: "new", estimated_value: 1500, assigned_to: admin.id, next_follow_up: "2026-11-03" },
        { id: ids.leadBravoId, business_name: "CI Bravo Cafe", contact_name: "Local Test", email: "bravo@example.invalid", service_interest: "Branding", source: "CI Fixture", status: "new", estimated_value: 900, assigned_to: admin.id, next_follow_up: "2026-10-27" }
      ]
    });
    await rest("POST", "communication_logs", "", {
      token: SERVICE_ROLE_KEY, key: SERVICE_ROLE_KEY,
      body: [{
        id: ids.communicationId, lead_id: ids.leadAlphaId, channel: "Email",
        direction: "inbound", outcome: "not_recorded", subject: "CI-only outcome test",
        message: "Synthetic communication outcome persistence fixture.",
        contacted_at: new Date().toISOString(), created_by: admin.id
      }]
    });
    await rest("POST", "tasks", "", {
      token: SERVICE_ROLE_KEY, key: SERVICE_ROLE_KEY,
      body: [{ id: ids.taskId, title: "CI confirm scope", description: "Isolated local persistence test", assigned_to: admin.id, lead_id: ids.leadBravoId, priority: "urgent", status: "todo", due_date: "2026-10-26" }]
    });
    await rest("POST", "follow_ups", "", {
      token: SERVICE_ROLE_KEY, key: SERVICE_ROLE_KEY,
      body: [{ id: ids.followupId, lead_id: ids.leadBravoId, assigned_to: admin.id, scheduled_for: "2026-10-27", channel: "WhatsApp", status: "pending", note: "CI-only follow-up" }]
    });

    const adminCheck = await rest("GET", "admin_users", "select=user_id,role,active&user_id=eq." + admin.id, { token: adminToken });
    assert.equal(adminCheck.data.length, 1, "authenticated admin should read their own admin profile through RLS");
    const leadBefore = await rest("GET", "leads", "select=id,status,next_follow_up&id=eq." + ids.leadBravoId, { token: adminToken });
    assert.equal(leadBefore.data.length, 1, "authenticated admin should read the seeded lead through RLS");
    assert.equal(leadBefore.data[0].status, "new");

    const communicationBefore = await rest("GET", "communication_logs",
      "select=id,outcome,lead_id&id=eq." + ids.communicationId, { token: adminToken });
    assert.equal(communicationBefore.data.length, 1,
      "authenticated admin should read the communication outcome fixture through RLS");
    assert.equal(communicationBefore.data[0].outcome, "not_recorded",
      "new communication records must default to an explicitly unrecorded outcome");

    const communicationWrite = await rest("PATCH", "communication_logs",
      "id=eq." + ids.communicationId, {
        token: adminToken,
        body: { outcome: "opt_out", updated_at: new Date().toISOString() }
      });
    assert.equal(communicationWrite.data.length, 1,
      "authenticated admin should update a structured communication outcome");
    writes.push("PATCH communication_logs (opt_out)");

    const communicationAfter = await rest("GET", "communication_logs",
      "select=id,outcome&id=eq." + ids.communicationId, { token: adminToken });
    assert.equal(communicationAfter.data.length, 1);
    assert.equal(communicationAfter.data[0].outcome, "opt_out",
      "explicit opt-out outcome should persist for the authenticated admin");

    const invalidOutcome = await rest("PATCH", "communication_logs",
      "id=eq." + ids.communicationId, {
        token: adminToken,
        body: { outcome: "qualified" },
        allowError: true
      });
    assert.ok(invalidOutcome.status >= 400,
      "database constraint must reject unsupported communication outcomes");
    const communicationAfterInvalid = await rest("GET", "communication_logs",
      "select=id,outcome&id=eq." + ids.communicationId, { token: adminToken });
    assert.equal(communicationAfterInvalid.data[0].outcome, "opt_out",
      "rejected communication outcome must not overwrite the recorded opt-out");

    // A rejected/cancelled UI confirmation makes no request. The companion UI
    // smoke test checks that cancellation path; here we prove the row is still
    // untouched before exercising the confirmed update path.
    const taskBefore = await rest("GET", "tasks", "select=id,status,completed_at&id=eq." + ids.taskId, { token: adminToken });
    assert.equal(taskBefore.data[0].status, "todo");
    assert.equal(taskBefore.data[0].completed_at, null);

    const taskWrite = await rest("PATCH", "tasks", "id=eq." + ids.taskId, {
      token: adminToken,
      body: { status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    });
    assert.equal(taskWrite.data.length, 1, "confirmed task completion should update one local row");
    writes.push("PATCH tasks (completed)");

    const followupWrite = await rest("PATCH", "follow_ups", "id=eq." + ids.followupId, {
      token: adminToken,
      body: { status: "completed", completed_at: new Date().toISOString() }
    });
    assert.equal(followupWrite.data.length, 1, "confirmed follow-up completion should update one local row");
    writes.push("PATCH follow_ups (completed)");

    const leadWrite = await rest("PATCH", "leads", "id=eq." + ids.leadBravoId, {
      token: adminToken,
      body: { status: "contacted", next_follow_up: null, updated_at: new Date().toISOString() }
    });
    assert.equal(leadWrite.data.length, 1, "follow-up completion should update the linked lead");
    writes.push("PATCH linked leads (contacted; next_follow_up cleared)");

    await rest("POST", "activity_log", "", {
      token: adminToken,
      body: [{ actor_id: admin.id, action: "task_completed", entity_type: "task", entity_id: ids.taskId }]
    });
    writes.push("POST activity_log (task)");
    await rest("POST", "activity_log", "", {
      token: adminToken,
      body: [{ actor_id: admin.id, action: "follow_up_completed", entity_type: "follow_up", entity_id: ids.followupId }]
    });
    writes.push("POST activity_log (follow-up)");

    // Read after write with the authenticated user's JWT, not the service key.
    const taskAfter = await rest("GET", "tasks", "select=id,status,completed_at&id=eq." + ids.taskId, { token: adminToken });
    assert.equal(taskAfter.data.length, 1);
    assert.equal(taskAfter.data[0].status, "completed");
    assert.ok(taskAfter.data[0].completed_at, "task completion timestamp should persist");

    const followupAfter = await rest("GET", "follow_ups", "select=id,status,completed_at&id=eq." + ids.followupId, { token: adminToken });
    assert.equal(followupAfter.data.length, 1);
    assert.equal(followupAfter.data[0].status, "completed");
    assert.ok(followupAfter.data[0].completed_at, "follow-up completion timestamp should persist");

    const leadAfter = await rest("GET", "leads", "select=id,status,next_follow_up&id=eq." + ids.leadBravoId, { token: adminToken });
    assert.equal(leadAfter.data.length, 1);
    assert.equal(leadAfter.data[0].status, "contacted");
    assert.equal(leadAfter.data[0].next_follow_up, null, "linked lead's next follow-up should persist as cleared");

    const activityAfter = await rest("GET", "activity_log", "select=id,entity_type,entity_id&entity_id=in.(" + ids.taskId + "," + ids.followupId + ")", { token: adminToken });
    assert.equal(activityAfter.data.length, 2, "both completion activity-log rows should persist");

    // Unsupported fixture statuses from the older mocked test must be rejected
    // by the real schema contract rather than accidentally accepted.
    const invalidStatus = await rest("PATCH", "leads", "id=eq." + ids.leadAlphaId, {
      token: adminToken,
      body: { status: "qualified" },
      allowError: true
    });
    assert.ok(invalidStatus.status >= 400, "the schema should reject unsupported lead status 'qualified'");
    const leadAlphaAfter = await rest("GET", "leads", "select=id,status&id=eq." + ids.leadAlphaId, { token: adminToken });
    assert.equal(leadAlphaAfter.data[0].status, "new", "rejected invalid status must not change the row");

    const nonAdmin = await createAuthUser(nonAdminEmail, password);
    userIds.push(nonAdmin.id);
    const nonAdminToken = await signIn(nonAdminEmail, password);
    const hiddenLeads = await rest("GET", "leads", "select=id&id=eq." + ids.leadBravoId, { token: nonAdminToken });
    assert.equal(hiddenLeads.data.length, 0, "a signed-in user without an admin row must not read CRM leads through RLS");
    const hiddenCommunications = await rest("GET", "communication_logs",
      "select=id&id=eq." + ids.communicationId, { token: nonAdminToken });
    assert.equal(hiddenCommunications.data.length, 0,
      "a signed-in user without an admin row must not read communication outcomes through RLS");

    summary = {
      result: "PASS",
      environment: "disposable local Supabase only",
      apiHost: parsedApiUrl.hostname,
      authentication: "local Supabase Auth password-grant JWT",
      rls: "admin CRUD succeeded; non-admin lead read returned zero rows",
      seed: "synthetic UUID records only; created in local database and cleaned up",
      authenticatedActionWrites: writes,
      readAfterWrite: [
        "communication outcome default, explicit opt-out update and unsupported outcome rejection persisted",
        "task completion status and timestamp persisted",
        "follow-up completion status and timestamp persisted",
        "linked lead moved to contacted and next_follow_up was cleared",
        "two activity-log rows persisted",
        "unsupported lead status rejected without changing the existing row"
      ],
      remoteRequests: 0,
      productionOrCloudWrites: 0
    };
  } finally {
    await bestEffortCleanup(userIds, ids);
  }

  fs.writeFileSync(path.join(ARTIFACT_DIR, "db-smoke-summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
