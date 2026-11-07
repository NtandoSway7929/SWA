"use strict";

// End-to-end database test for first-contact tasks. This script refuses to run
// against a hosted Supabase URL and uses only disposable local test records.

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const API_URL = process.env.SUPABASE_LOCAL_API_URL || process.env.API_URL || "";
const ANON_KEY = process.env.ANON_KEY || "";
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY || "";

const parsedUrl = API_URL ? new URL(API_URL) : null;
if (!parsedUrl || !["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsedUrl.hostname)) {
  throw new Error("Refusing to run first-contact automation test: Supabase URL must be loopback-only.");
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

async function createAuthUser(email, password) {
  const result = await request("/auth/v1/admin/users", {
    method: "POST",
    body: { email, password, email_confirm: true, user_metadata: { full_name: "First Contact Automation CI" } }
  });
  assert.ok(result.data && result.data.id, "Supabase Auth must create a local test user");
  return result.data;
}

async function rest(method, table, params, body, options = {}) {
  const query = params ? "?" + params : "";
  return request("/rest/v1/" + table + query, {
    method, body, prefer: options.prefer || "return=representation", allowError: options.allowError
  });
}

async function cleanup(userIds, leadIds) {
  if (leadIds.length) {
    const filter = encodeURIComponent("in.(" + leadIds.join(",") + ")");
    try { await rest("DELETE", "follow_ups", "lead_id=" + filter, undefined, { prefer: "return=minimal" }); } catch {}
    try { await rest("DELETE", "leads", "id=" + filter, undefined, { prefer: "return=minimal" }); } catch {}
  }
  for (const userId of userIds.slice().reverse()) {
    try {
      await request("/auth/v1/admin/users/" + userId, { method: "DELETE" });
    } catch {}
  }
}

async function main() {
  const runId = Date.now();
  const password = "First-Contact-CI-7!Local";
  const createdAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const recentAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const oldContactAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const ownerEmail = "first-contact-owner-" + runId + "@example.invalid";
  const assignedEmail = "first-contact-assigned-" + runId + "@example.invalid";
  const authUserIds = [];
  const leadIds = Array.from({ length: 9 }, () => randomUUID());
  const [
    emailLeadId, phoneLeadId, otherLeadId, contactLeadId, lostLeadId,
    notInterestedLeadId, recentLeadId, priorTaskLeadId, stageLeadId
  ] = leadIds;

  try {
    const owner = await createAuthUser(ownerEmail, password);
    authUserIds.push(owner.id);
    const assigned = await createAuthUser(assignedEmail, password);
    authUserIds.push(assigned.id);

    await rest("POST", "admin_users", "", [
      { user_id: owner.id, full_name: "CI Owner", email: ownerEmail, role: "owner", active: true },
      { user_id: assigned.id, full_name: "CI Assigned Admin", email: assignedEmail, role: "team_member", active: true }
    ]);

    await rest("PATCH", "workflow_settings", "id=eq.1", {
      new_lead_response_hours: 24,
      lead_no_response_days: 3,
      followup_stage_days: {},
      max_followup_attempts: 1
    });

    const leads = [
      { id: emailLeadId, business_name: "CI First Contact Email", email: "email@example.invalid", status: "new", assigned_to: assigned.id, created_at: createdAt },
      { id: phoneLeadId, business_name: "CI First Contact Phone", phone: "+27110000001", status: "new", assigned_to: null, created_at: createdAt },
      { id: otherLeadId, business_name: "CI First Contact Other", status: "new", assigned_to: null, created_at: createdAt },
      { id: contactLeadId, business_name: "CI First Contact Completed", email: "contact@example.invalid", status: "new", assigned_to: owner.id, created_at: createdAt },
      { id: lostLeadId, business_name: "CI First Contact Lost", phone: "+27110000002", status: "new", assigned_to: owner.id, created_at: createdAt },
      { id: notInterestedLeadId, business_name: "CI First Contact Not Interested", status: "new", assigned_to: owner.id, created_at: createdAt },
      { id: recentLeadId, business_name: "CI Recent Lead", email: "recent@example.invalid", status: "new", assigned_to: owner.id, created_at: recentAt },
      { id: priorTaskLeadId, business_name: "CI Lead With Prior Follow-up", email: "prior@example.invalid", status: "new", assigned_to: owner.id, created_at: createdAt },
      { id: stageLeadId, business_name: "CI Later Stage Lead", email: "stage@example.invalid", status: "contacted", assigned_to: assigned.id, created_at: createdAt, last_contacted_at: oldContactAt }
    ];
    await rest("POST", "leads", "", leads);
    await rest("POST", "follow_ups", "", [{
      lead_id: priorTaskLeadId,
      assigned_to: owner.id,
      scheduled_for: new Date().toISOString().slice(0, 10),
      channel: "Email",
      status: "completed",
      completed_at: new Date().toISOString(),
      note: "Previously handled manually; do not recreate."
    }]);

    const firstRun = await request("/rest/v1/rpc/run_swayphics_first_contact_automation_test", {
      method: "POST", body: {}
    });
    assert.equal(firstRun.data, 7,
      "the first scan should create six SLA-triggered first-contact tasks and one existing stage follow-up");

    const followupQuery = "select=id,lead_id,assigned_to,scheduled_for,channel,status,note,completed_at&lead_id=in.(" +
      leadIds.join(",") + ")&order=created_at.asc";
    const allFollowups = (await rest("GET", "follow_ups", followupQuery)).data;
    const forLead = id => allFollowups.filter(row => row.lead_id === id);
    const taskFor = id => forLead(id).find(row => row.note && row.note.startsWith("Automatic first-contact task:"));

    for (const id of [emailLeadId, phoneLeadId, otherLeadId, contactLeadId, lostLeadId, notInterestedLeadId]) {
      assert.equal(forLead(id).length, 1, "each overdue New lead should receive only one first-contact task");
      assert.ok(taskFor(id), "the generated task should have the explicit first-contact marker");
      assert.equal(taskFor(id).status, "pending");
      assert.ok(taskFor(id).note.includes("Verify the contact channel before outreach."));
    }
    assert.equal(taskFor(emailLeadId).channel, "Email");
    assert.equal(taskFor(phoneLeadId).channel, "Phone");
    assert.equal(taskFor(otherLeadId).channel, "Other");
    assert.equal(taskFor(phoneLeadId).assigned_to, owner.id,
      "an unassigned lead should fall back to an active owner");
    assert.equal(taskFor(emailLeadId).assigned_to, assigned.id,
      "an existing lead assignee should be preserved");
    assert.equal(taskFor(contactLeadId).assigned_to, owner.id);
    assert.equal(taskFor(emailLeadId).scheduled_for,
      new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" }),
      "first-contact tasks should use the South African local date");

    const untouchedLeads = (await rest("GET", "leads",
      "select=id,status&id=in.(" + [
        emailLeadId, phoneLeadId, otherLeadId, contactLeadId, lostLeadId, notInterestedLeadId, recentLeadId, priorTaskLeadId
      ].join(",") + ")")).data;
    assert.ok(untouchedLeads.filter(row => row.id !== recentLeadId && row.id !== priorTaskLeadId)
      .every(row => row.status === "new"),
      "creating a first-contact task must leave the lead in New until a real status change");
    assert.equal(forLead(recentLeadId).length, 0, "leads still within the response SLA must not receive a task");
    assert.equal(forLead(priorTaskLeadId).length, 1,
      "a lead with an existing completed follow-up must not receive another first-contact task");

    const secondRun = await request("/rest/v1/rpc/run_swayphics_first_contact_automation_test", {
      method: "POST", body: {}
    });
    assert.equal(secondRun.data, 0, "re-running the worker must not duplicate first-contact or stage follow-ups");

    await rest("PATCH", "leads", "id=eq." + contactLeadId, {
      status: "contacted", last_contacted_at: oldContactAt
    });
    let updatedTasks = (await rest("GET", "follow_ups",
      "select=id,lead_id,status,note,completed_at&lead_id=eq." + contactLeadId)).data;
    assert.equal(taskForStatus(updatedTasks, "Automatic first-contact task:").status, "completed",
      "moving a New lead to Contacted should complete its pending first-contact task");
    assert.ok(taskForStatus(updatedTasks, "Automatic first-contact task:").completed_at,
      "completed first-contact tasks should record the completion timestamp");

    const stageAfterContact = await request("/rest/v1/rpc/run_swayphics_first_contact_automation_test", {
      method: "POST", body: {}
    });
    assert.equal(stageAfterContact.data, 1,
      "a completed first-contact task must not consume the configured later-stage attempt limit");
    updatedTasks = (await rest("GET", "follow_ups",
      "select=id,lead_id,status,note,completed_at&lead_id=eq." + contactLeadId)).data;
    assert.ok(updatedTasks.some(row => row.note && row.note.startsWith("Automatic follow-up:")),
      "later-stage follow-up automation should resume after first contact");
    const contactLead = (await rest("GET", "leads", "select=status&id=eq." + contactLeadId)).data[0];
    assert.equal(contactLead.status, "follow-up");

    await rest("PATCH", "leads", "id=eq." + lostLeadId, { status: "lost" });
    const lostTask = (await rest("GET", "follow_ups",
      "select=status,completed_at,note&lead_id=eq." + lostLeadId)).data
      .find(row => row.note && row.note.startsWith("Automatic first-contact task:"));
    assert.equal(lostTask.status, "skipped", "lost leads should skip pending first-contact tasks");
    assert.equal(lostTask.completed_at, null, "skipped tasks must not be marked completed");

    await rest("PATCH", "leads", "id=eq." + notInterestedLeadId, { status: "not interested" });
    const notInterestedTask = (await rest("GET", "follow_ups",
      "select=status,completed_at,note&lead_id=eq." + notInterestedLeadId)).data
      .find(row => row.note && row.note.startsWith("Automatic first-contact task:"));
    assert.equal(notInterestedTask.status, "skipped",
      "leads marked Not Interested should skip pending first-contact tasks");

    const summary = {
      result: "PASS",
      first_scan_created: firstRun.data,
      repeat_scan_created: secondRun.data,
      stage_scan_after_contact_created: stageAfterContact.data,
      verified: [
        "response SLA boundary",
        "Email / Phone / Other selection",
        "lead assignee and active-owner fallback",
        "task creation leaves lead status New",
        "existing follow-up deduplication",
        "repeat-run idempotency",
        "automatic task completion after contact",
        "automatic skip on lost / not-interested",
        "first-contact task excluded from later-stage attempt limit",
        "existing stage-based follow-up behavior preserved"
      ]
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await cleanup(authUserIds, leadIds);
  }
}

function taskForStatus(rows, prefix) {
  return rows.find(row => row.note && row.note.startsWith(prefix));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
