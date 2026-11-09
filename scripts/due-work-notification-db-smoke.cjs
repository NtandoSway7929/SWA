"use strict";

// Exercises due-task/follow-up notification routing against disposable local Supabase.

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const API_URL = process.env.SUPABASE_LOCAL_API_URL || process.env.API_URL || "";
const ANON_KEY = process.env.ANON_KEY || "";
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY || "";
const parsedUrl = API_URL ? new URL(API_URL) : null;

if (!parsedUrl || !["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsedUrl.hostname)) {
  throw new Error("Refusing to run due-work notification test: Supabase URL must be loopback-only.");
}
if (!ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error("Local Supabase environment is incomplete: ANON_KEY and SERVICE_ROLE_KEY are required.");
}

async function request(pathname, options = {}) {
  const { method = "GET", body, allowError = false } = options;
  const response = await fetch(API_URL.replace(/\/$/, "") + pathname, {
    method,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: "Bearer " + SERVICE_ROLE_KEY,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.prefer ? { Prefer: options.prefer } : {})
    },
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

async function createAuthUser(email) {
  const result = await request("/auth/v1/admin/users", {
    method: "POST",
    body: {
      email,
      password: "Due-Work-CI-7!Local",
      email_confirm: true,
      user_metadata: { full_name: "Due Work Notification CI" }
    }
  });
  assert.ok(result.data && result.data.id, "Supabase Auth must create a local test user");
  return result.data;
}

async function rest(method, table, params, body, options = {}) {
  return request("/rest/v1/" + table + (params ? "?" + params : ""), {
    method,
    body,
    prefer: options.prefer || "return=representation",
    allowError: options.allowError
  });
}

async function cleanup(userIds, taskIds, followupIds, clientId) {
  const inFilter = ids => encodeURIComponent("in.(" + ids.join(",") + ")");
  if (taskIds.length) {
    try { await rest("DELETE", "tasks", "id=" + inFilter(taskIds), undefined, { prefer: "return=minimal" }); } catch {}
  }
  if (followupIds.length) {
    try { await rest("DELETE", "follow_ups", "id=" + inFilter(followupIds), undefined, { prefer: "return=minimal" }); } catch {}
  }
  if (clientId) {
    try { await rest("DELETE", "clients", "id=eq." + clientId, undefined, { prefer: "return=minimal" }); } catch {}
  }
  for (const userId of userIds.slice().reverse()) {
    try { await request("/auth/v1/admin/users/" + userId, { method: "DELETE" }); } catch {}
  }
}

async function main() {
  const runId = Date.now();
  const userIds = [];
  const taskIds = Array.from({ length: 5 }, () => randomUUID());
  const followupIds = Array.from({ length: 4 }, () => randomUUID());
  const clientId = randomUUID();
  const [assignedTaskId, unassignedTaskId, inactiveTaskId, futureTaskId, completedTaskId] = taskIds;
  const [assignedFollowupId, unassignedFollowupId, inactiveFollowupId, skippedFollowupId] = followupIds;
  // The SQL worker compares dates with PostgreSQL current_date. Build fixtures
  // in UTC so the test dates match the disposable database's session date,
  // including when CI runs near midnight in Africa/Johannesburg.
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const ownerEmail = "due-work-owner-" + runId + "@example.invalid";
  const assignedEmail = "due-work-assigned-" + runId + "@example.invalid";
  const inactiveEmail = "due-work-inactive-" + runId + "@example.invalid";

  try {
    const owner = await createAuthUser(ownerEmail);
    userIds.push(owner.id);
    const assigned = await createAuthUser(assignedEmail);
    userIds.push(assigned.id);
    const inactive = await createAuthUser(inactiveEmail);
    userIds.push(inactive.id);

    await rest("POST", "admin_users", "", [
      { user_id: owner.id, full_name: "CI Owner", email: ownerEmail, role: "owner", active: true },
      { user_id: assigned.id, full_name: "CI Assigned Admin", email: assignedEmail, role: "team_member", active: true },
      { user_id: inactive.id, full_name: "CI Inactive Admin", email: inactiveEmail, role: "team_member", active: false }
    ]);
    await rest("POST", "clients", "", [{
      id: clientId, business_name: "CI Due Work Notification Client", status: "active"
    }]);

    await rest("POST", "tasks", "", [
      { id: assignedTaskId, title: "CI Assigned Due Task", assigned_to: assigned.id, due_date: yesterday, status: "todo" },
      { id: unassignedTaskId, title: "CI Unassigned Due Task", assigned_to: null, due_date: today, status: "todo" },
      { id: inactiveTaskId, title: "CI Inactive Assignee Due Task", assigned_to: inactive.id, due_date: yesterday, status: "todo" },
      { id: futureTaskId, title: "CI Future Task", assigned_to: null, due_date: tomorrow, status: "todo" },
      { id: completedTaskId, title: "CI Completed Task", assigned_to: null, due_date: yesterday, status: "completed" }
    ]);

    await rest("POST", "follow_ups", "", [
      { id: assignedFollowupId, client_id: clientId, assigned_to: assigned.id, scheduled_for: yesterday, channel: "Email", status: "pending", note: "CI assigned follow-up" },
      { id: unassignedFollowupId, client_id: clientId, assigned_to: null, scheduled_for: today, channel: "Phone", status: "pending", note: "CI unassigned follow-up" },
      { id: inactiveFollowupId, client_id: clientId, assigned_to: inactive.id, scheduled_for: yesterday, channel: "Other", status: "pending", note: "CI inactive assignee follow-up" },
      { id: skippedFollowupId, client_id: clientId, assigned_to: null, scheduled_for: yesterday, channel: "Other", status: "skipped", note: "CI skipped follow-up" }
    ]);

    const firstRun = await request("/rest/v1/rpc/run_swayphics_due_work_notification_test", {
      method: "POST", body: {}
    });
    assert.equal(firstRun.data, 6, "three due tasks and three pending due follow-ups should be processed");

    const events = (await rest("GET", "test_notification_events",
      "select=recipient_id,event_type,entity_type,entity_id,dedupe_key,title,message")).data;
    const forEntity = (type, id) => events.filter(e => e.entity_type === type && e.entity_id === id);
    const recipients = (type, id) => forEntity(type, id).map(e => e.recipient_id).sort();
    const expectedAdmins = [owner.id, assigned.id].sort();

    assert.deepEqual(recipients("task", assignedTaskId), [assigned.id],
      "an active assignee should receive a personal due-task notification only");
    assert.deepEqual(recipients("task", unassignedTaskId), expectedAdmins,
      "an unassigned due task should notify all active admins");
    assert.deepEqual(recipients("task", inactiveTaskId), expectedAdmins,
      "a due task assigned to an inactive admin should notify all active admins");
    assert.deepEqual(recipients("follow_up", assignedFollowupId), [assigned.id],
      "an active follow-up assignee should receive a personal notification only");
    assert.deepEqual(recipients("follow_up", unassignedFollowupId), expectedAdmins,
      "an unassigned due follow-up should notify all active admins");
    assert.deepEqual(recipients("follow_up", inactiveFollowupId), expectedAdmins,
      "a due follow-up assigned to an inactive admin should notify all active admins");

    for (const event of events) {
      assert.notEqual(event.recipient_id, inactive.id, "inactive admins must never receive escalated notifications");
    }
    assert.equal(forEntity("task", futureTaskId).length, 0, "future tasks must not trigger due notifications");
    assert.equal(forEntity("task", completedTaskId).length, 0, "completed tasks must not trigger due notifications");
    assert.equal(forEntity("follow_up", skippedFollowupId).length, 0, "skipped follow-ups must not trigger due notifications");

    const secondRun = await request("/rest/v1/rpc/run_swayphics_due_work_notification_test", {
      method: "POST", body: {}
    });
    assert.equal(secondRun.data, 6, "the same six due work items remain eligible for daily deduplicated checks");
    const afterSecondRun = (await rest("GET", "test_notification_events",
      "select=recipient_id,event_type,entity_type,entity_id,dedupe_key")).data;
    assert.equal(afterSecondRun.length, events.length,
      "re-running the worker must not create duplicate notifications for the same recipient and due date");

    console.log(JSON.stringify({
      result: "PASS",
      due_work_items_processed: firstRun.data,
      notification_recipients: events.length,
      verified: [
        "active assignees receive personal task/follow-up reminders",
        "unassigned due work is escalated to every active admin",
        "inactive assignees are escalated to every active admin",
        "inactive admins are excluded",
        "future tasks, completed tasks and skipped follow-ups are ignored",
        "daily recipient-level deduplication is preserved"
      ]
    }, null, 2));
  } finally {
    await cleanup(userIds, taskIds, followupIds, clientId);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
