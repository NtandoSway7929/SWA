import { buildInnerMeWorkspaceContextForModel, isBroadBusinessPlanningRequest } from "./innerme-workspace-intelligence.mjs";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("broad planning requests are detected", () => {
  assert(isBroadBusinessPlanningRequest("What are my highest-value moves for today?"), "today priorities should be detected");
  assert(isBroadBusinessPlanningRequest("Give me daily recommendations"), "daily recommendations should be detected");
  assert(!isBroadBusinessPlanningRequest("Show me the Swayphics website lead"), "specific record questions should not be broad planning");
});

Deno.test("self-owned Swayphics lead is excluded from broad priorities even when the business is named", () => {
  const source = {
    leads: [
      { id: "self-test", business_name: "Swayphics", contact_name: "Ntando", status: "contacted" },
      { id: "real-prospect", business_name: "Maisha's Touch", status: "contacted" },
    ],
  };
  const result = buildInnerMeWorkspaceContextForModel(source, "What are my highest-value moves for Swayphics today?", Date.parse("2026-10-14T00:00:00Z"));
  assert(result.leads.length === 1, "only external prospect should remain");
  assert(result.leads[0].id === "real-prospect", "real prospect should be retained");
  assert(source.leads.length === 2, "source context must remain unchanged");
  assert(result.workspace_intelligence_notes?.some((note: string) => note.includes("Excluded 1 lead")), "the exclusion should be disclosed");
  assert(result.workspace_temporal_guidance?.business_date_johannesburg === "2026-10-14", "the business date should be explicit");
  assert(result.workspace_intelligence_notes?.some((note: string) => note.includes("Never label an upcoming/future date overdue")), "date classification rules should be explicit");
});

Deno.test("explicit Swayphics record questions preserve the record", () => {
  const source = { leads: [{ id: "self-test", business_name: "Swayphics" }] };
  const result = buildInnerMeWorkspaceContextForModel(source, "Review the Swayphics lead");
  assert(result.leads.length === 1, "explicit record inspection must preserve the record");
});

Deno.test("non-planning requests preserve all leads", () => {
  const source = { leads: [{ id: "self-test", business_name: "Swayphics" }] };
  const result = buildInnerMeWorkspaceContextForModel(source, "How do I improve my website?");
  assert(result === source, "unrelated questions should use original context");
});

Deno.test("distant pending follow-ups are excluded from immediate priorities but source remains unchanged", () => {
  const source = {
    leads: [{ id: "self-test", business_name: "Swayphics" }],
    followups: [
      { id: "due-soon", status: "pending", scheduled_for: "2026-10-16T10:00:00Z" },
      { id: "far-future", status: "pending", scheduled_for: "2027-04-09T10:00:00Z" },
    ],
  };
  const result = buildInnerMeWorkspaceContextForModel(
    source,
    "What are my highest-value moves for today?",
    Date.parse("2026-10-14T00:00:00Z"),
  );
  assert(result.followups.length === 1, "only the follow-up within the next seven days should remain");
  assert(result.followups[0].id === "due-soon", "near-term follow-up should be retained");
  assert(source.followups.length === 2, "source follow-ups must remain unchanged");
  assert(result.workspace_intelligence_notes?.some((note: string) => note.includes("more than seven days")), "deferred follow-ups should be explained");
});

Deno.test("explicit record inspection preserves distant follow-ups", () => {
  const source = {
    leads: [{ id: "self-test", business_name: "Swayphics" }],
    followups: [{ id: "far-future", status: "pending", scheduled_for: "2027-04-09T10:00:00Z" }],
  };
  const result = buildInnerMeWorkspaceContextForModel(source, "Review the Swayphics lead");
  assert(result.followups.length === 1, "specific record inspection should preserve all follow-ups");
});


Deno.test("broad planning filters self/test enquiries and preserves genuine enquiries", () => {
  const source = {
    user_email: "admin@example.invalid",
    business_date_johannesburg: "2026-10-15",
    workspace_source_record_counts: { leads: 2, followups: 2, enquiries: 4 },
    leads: [
      { id: "internal-lead", business_name: "Swayphics", next_follow_up: "2026-10-15" },
      { id: "external-lead", business_name: "GSS Plastering LTD.", next_follow_up: "2026-10-15" },
    ],
    followups: [
      { id: "internal-followup", lead_id: "internal-lead", status: "pending", scheduled_for: "2026-10-15" },
      { id: "external-followup", lead_id: "external-lead", status: "pending", scheduled_for: "2026-10-16" },
    ],
    enquiries: [
      { id: "self-handle", name: "ntando_sway", service: "Company Registration", status: "contacted" },
      { id: "self-email", name: "Ntando", email: "admin@example.invalid", service: "Apparel Design", status: "converted" },
      { id: "test-name", name: "Test Submission", service: "Logo Design", status: "new" },
      { id: "genuine", name: "Sibusisiwe Mtshali", service: "Logo Design", status: "contacted" },
    ],
  };

  const result = buildInnerMeWorkspaceContextForModel(
    source,
    "What are my highest-value moves for today? Exclude test records and self-enquiries.",
    Date.parse("2026-10-15T00:00:00Z"),
  );
  assert(result.enquiries.length === 1, "only the genuine external enquiry should remain");
  assert(result.enquiries[0].id === "genuine", "the real enquiry should be preserved");
  assert(result.leads.length === 1 && result.leads[0].id === "external-lead", "the self-owned lead should be excluded");
  assert(result.followups.length === 1 && result.followups[0].id === "external-followup", "self-lead follow-ups should be excluded");
  assert(result.workspace_model_context_exclusion_counts.self_or_test_enquiries === 3, "excluded enquiries should be counted");
  assert(result.workspace_model_context_exclusion_counts.related_self_lead_followups === 1, "related follow-up exclusion should be counted");
  assert(result.workspace_source_record_counts.enquiries === 4, "source counts should remain auditable");
  assert(source.enquiries.length === 4 && source.followups.length === 2, "source context must not be mutated");
});

Deno.test("lead and scheduled follow-up dates get deterministic timing labels", () => {
  const source = {
    business_date_johannesburg: "2026-10-15",
    leads: [
      { id: "past", business_name: "Past Ltd", next_follow_up: "2026-10-14" },
      { id: "today", business_name: "Today Ltd", next_follow_up: "2026-10-15" },
      { id: "future", business_name: "Future Ltd", next_follow_up: "2026-10-16" },
    ],
    followups: [
      { id: "fu-past", status: "pending", scheduled_for: "2026-10-14" },
      { id: "fu-today", status: "pending", scheduled_for: "2026-10-15" },
      { id: "fu-future", status: "pending", scheduled_for: "2026-10-16" },
    ],
  };
  const result = buildInnerMeWorkspaceContextForModel(
    source,
    "What are my highest-value moves for today?",
    Date.parse("2026-10-15T00:00:00Z"),
  );
  assert(result.leads[0].next_follow_up_timing === "overdue", "past date should be overdue");
  assert(result.leads[1].next_follow_up_timing === "due_today", "same date should be due today");
  assert(result.leads[2].next_follow_up_timing === "upcoming", "future date should be upcoming");
  assert(result.followups[0].scheduled_timing === "overdue", "past scheduled item should be overdue");
  assert(result.followups[1].scheduled_timing === "due_today", "same-day scheduled item should be due today");
  assert(result.followups[2].scheduled_timing === "upcoming", "future scheduled item should be upcoming");
  assert(result.workspace_temporal_guidance.lead_followup_date_counts.overdue === 1, "overdue count should be deterministic");
  assert(result.workspace_temporal_guidance.scheduled_followup_record_counts.upcoming === 1, "upcoming count should be deterministic");
});
