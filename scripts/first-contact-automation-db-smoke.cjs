"use strict";

// End-to-end database test for the fixed two-stage lead follow-up sequence.
// This script refuses hosted Supabase URLs and creates disposable local records.

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const API_URL = process.env.SUPABASE_LOCAL_API_URL || process.env.API_URL || "";
const ANON_KEY = process.env.ANON_KEY || "";
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY || "";
const parsedUrl = API_URL ? new URL(API_URL) : null;

if (!parsedUrl || !["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsedUrl.hostname)) {
  throw new Error("Refusing to run follow-up sequence test: Supabase URL must be loopback-only.");
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
    body: { email, password, email_confirm: true, user_metadata: { full_name: "Follow-up Sequence CI" } }
  });
  assert.ok(result.data && result.data.id, "Supabase Auth must create a local test user");
  return result.data;
}

async function rest(method, table, params, body, options = {}) {
  const query = params ? "?" + params : "";
  return request("/rest/v1/" + table + query, {
    method,
    body,
    prefer: options.prefer || "return=representation",
    allowError: options.allowError
  });
}

function localDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const part = type => parts.find(item => item.type === type).value;
  return part("year") + "-" + part("month") + "-" + part("day");
}

function addBusinessDays(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  let remaining = days;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return date.toISOString().slice(0, 10);
}

function subtractBusinessDays(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  let remaining = days;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() - 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return date.toISOString().slice(0, 10);
}

function sastTimestamp(dateString, hour = 12) {
  return new Date(dateString + "T" + String(hour).padStart(2, "0") + ":00:00+02:00").toISOString();
}

async function cleanup(userIds, leadIds) {
  if (leadIds.length) {
    const filter = encodeURIComponent("in.(" + leadIds.join(",") + ")");
    try { await rest("DELETE", "follow_ups", "lead_id=" + filter, undefined, { prefer: "return=minimal" }); } catch {}
    try { await rest("DELETE", "leads", "id=" + filter, undefined, { prefer: "return=minimal" }); } catch {}
  }
  for (const userId of userIds.slice().reverse()) {
    try { await request("/auth/v1/admin/users/" + userId, { method: "DELETE" }); } catch {}
  }
}

async function main() {
  const runId = Date.now();
  const password = "Followup-Sequence-CI-8!Local";
  const today = localDate();
  const contactDate = subtractBusinessDays(today, 5);
  const firstCompletionRecentDate = subtractBusinessDays(today, 1);
  const firstCompletionDueDate = subtractBusinessDays(today, 4);
  const ownerEmail = "followup-owner-" + runId + "@example.invalid";
  const assignedEmail = "followup-assigned-" + runId + "@example.invalid";
  const authUserIds = [];
  const leadIds = Array.from({ length: 4 }, () => randomUUID());
  const [untouchedLeadId, dueLeadId, recentLeadId, notInterestedLeadId] = leadIds;

  try {
    const owner = await createAuthUser(ownerEmail, password);
    authUserIds.push(owner.id);
    const assigned = await createAuthUser(assignedEmail, password);
    authUserIds.push(assigned.id);

    await rest("POST", "admin_users", "", [
      { user_id: owner.id, full_name: "CI Owner", email: ownerEmail, role: "owner", active: true },
      { user_id: assigned.id, full_name: "CI Assigned Admin", email: assignedEmail, role: "team_member", active: true }
    ]);

    const oldCreated = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    const leads = [
      { id: untouchedLeadId, business_name: "CI Untouched Lead", email: "untouched@example.invalid", status: "new", created_at: oldCreated, last_contacted_at: null },
      { id: dueLeadId, business_name: "CI Contacted Lead", email: "contacted@example.invalid", status: "contacted", assigned_to: assigned.id, created_at: oldCreated, last_contacted_at: sastTimestamp(contactDate) },
      { id: recentLeadId, business_name: "CI Recently Contacted Lead", email: "recent@example.invalid", status: "contacted", assigned_to: owner.id, created_at: oldCreated, last_contacted_at: new Date().toISOString() },
      { id: notInterestedLeadId, business_name: "CI Disqualified Lead", email: null, status: "not interested", assigned_to: owner.id, created_at: oldCreated, last_contacted_at: sastTimestamp(contactDate) }
    ];
    await rest("POST", "leads", "", leads);

    // Pipeline progression must not restart the initial contact timestamp.
    await rest("PATCH", "leads", "id=eq." + dueLeadId, { status: "interested" });
    const progressed = (await rest("GET", "leads", "select=status,last_contacted_at&id=eq." + dueLeadId)).data[0];
    assert.equal(progressed.status, "interested");
    assert.equal(progressed.last_contacted_at, sastTimestamp(contactDate),
      "moving from Contacted to Interested must not restart the follow-up timer");

    const firstScan = await request("/rest/v1/rpc/run_swayphics_first_contact_automation_test", {
      method: "POST", body: {}
    });
    assert.equal(firstScan.data, 1, "the first scan should create only the overdue first attempt");

    const query = "select=id,lead_id,assigned_to,scheduled_for,channel,status,note,completed_at,automation_sequence&lead_id=in.(" +
      leadIds.join(",") + ")&order=created_at.asc";
    let followups = (await rest("GET", "follow_ups", query)).data;
    const forLead = id => followups.filter(item => item.lead_id === id);
    assert.equal(forLead(untouchedLeadId).length, 0, "old untouched New leads must not receive follow-ups");
    assert.equal(forLead(recentLeadId).length, 0, "recently contacted leads must wait two business days");
    assert.equal(forLead(notInterestedLeadId).length, 0, "terminal leads must not receive follow-ups");
    assert.equal(forLead(dueLeadId).length, 1, "the contacted lead should receive one first attempt");

    const first = forLead(dueLeadId)[0];
    assert.equal(first.automation_sequence, 1);
    assert.equal(first.status, "pending");
    assert.equal(first.scheduled_for, addBusinessDays(contactDate, 2),
      "the first attempt should be due two business days after contact");
    assert.equal(first.assigned_to, assigned.id, "the lead's active assignee should be preserved");
    assert.equal(first.channel, "Email");

    const repeatScan = await request("/rest/v1/rpc/run_swayphics_first_contact_automation_test", {
      method: "POST", body: {}
    });
    assert.equal(repeatScan.data, 0, "repeated scans must not create duplicate pending attempts");

    await rest("PATCH", "follow_ups", "id=eq." + first.id, {
      status: "completed",
      completed_at: sastTimestamp(firstCompletionRecentDate)
    });
    const leadAfterFirst = (await rest("GET", "leads", "select=status,next_follow_up&id=eq." + dueLeadId)).data[0];
    assert.equal(leadAfterFirst.status, "interested", "the first attempt must not disqualify the lead");
    assert.equal(leadAfterFirst.next_follow_up, addBusinessDays(firstCompletionRecentDate, 2),
      "the second due date must be two business days after follow-up one was completed");

    const earlySecondScan = await request("/rest/v1/rpc/run_swayphics_first_contact_automation_test", {
      method: "POST", body: {}
    });
    assert.equal(earlySecondScan.data, 0, "the second attempt must not be created before the second interval elapses");

    await rest("PATCH", "follow_ups", "id=eq." + first.id, {
      completed_at: sastTimestamp(firstCompletionDueDate)
    });
    const dueSecondScan = await request("/rest/v1/rpc/run_swayphics_first_contact_automation_test", {
      method: "POST", body: {}
    });
    assert.equal(dueSecondScan.data, 1, "the second attempt should be created once its interval has elapsed");

    followups = (await rest("GET", "follow_ups", query)).data;
    const attempts = forLead(dueLeadId).sort((a, b) => a.automation_sequence - b.automation_sequence);
    assert.equal(attempts.length, 2);
    const second = attempts.find(item => item.automation_sequence === 2);
    assert.ok(second, "the second follow-up must be explicitly sequenced as attempt two");
    assert.equal(second.scheduled_for, addBusinessDays(firstCompletionDueDate, 2));
    assert.equal(second.status, "pending");

    const thirdAttempt = await rest("POST", "follow_ups", "", [{
      lead_id: dueLeadId,
      assigned_to: owner.id,
      scheduled_for: today,
      channel: "Email",
      status: "pending",
      note: "This should be rejected by the two-attempt limit."
    }], { allowError: true });
    assert.ok(thirdAttempt.status >= 400,
      "the database must reject a third follow-up while the lead is still active");

    await rest("PATCH", "follow_ups", "id=eq." + second.id, {
      status: "completed",
      completed_at: new Date().toISOString()
    });
    const disqualified = (await rest("GET", "leads", "select=status,next_follow_up&id=eq." + dueLeadId)).data[0];
    assert.equal(disqualified.status, "lost", "completion of attempt two must disqualify the lead");
    assert.equal(disqualified.next_follow_up, null, "a disqualified lead must have no next follow-up date");

    const finalScan = await request("/rest/v1/rpc/run_swayphics_first_contact_automation_test", {
      method: "POST", body: {}
    });
    assert.equal(finalScan.data, 0, "disqualified leads must never receive further automatic follow-ups");

    console.log(JSON.stringify({
      result: "PASS",
      first_scan_created: firstScan.data,
      repeated_scan_created: repeatScan.data,
      early_second_scan_created: earlySecondScan.data,
      due_second_scan_created: dueSecondScan.data,
      final_scan_created: finalScan.data,
      verified: [
        "untouched New leads are excluded",
        "two-business-day initial timing",
        "later pipeline stages do not reset contact time",
        "one pending reminder per lead and idempotent scans",
        "second timer starts at completion of follow-up one",
        "weekend-aware due dates",
        "two follow-up attempts maximum",
        "completion of attempt two moves the lead to Lost",
        "database rejects a third attempt"
      ]
    }, null, 2));
  } finally {
    await cleanup(authUserIds, leadIds);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
