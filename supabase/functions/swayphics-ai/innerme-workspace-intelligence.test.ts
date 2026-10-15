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


Deno.test("lead timing uses linked active follow-up when lead next_follow_up is blank", () => {
  const source = {
    business_date_johannesburg: "2026-10-15",
    leads: [
      {
        id: "spotless",
        business_name: "Spotless Cleaning Services Garden Route.",
        status: "contacted",
        estimated_value: 3000,
        next_follow_up: null,
      },
      {
        id: "afrisource",
        business_name: "AfriSource Supplies/Services",
        status: "contacted",
        estimated_value: 3300,
        next_follow_up: null,
      },
    ],
    followups: [
      {
        id: "spotless-reminder",
        lead_id: "spotless",
        status: "pending",
        scheduled_for: "2026-10-15",
        channel: "WhatsApp",
      },
    ],
  };

  const result = buildInnerMeWorkspaceContextForModel(
    source,
    "What are my highest-value moves for today?",
    Date.parse("2026-10-15T00:00:00Z"),
  );
  const spotless = result.leads.find((lead: any) => lead.id === "spotless");
  const afrisource = result.leads.find((lead: any) => lead.id === "afrisource");

  assert(spotless?.next_follow_up_timing === "unscheduled_or_unknown", "blank lead-level field should remain distinguishable");
  assert(spotless?.effective_follow_up_date === "2026-10-15", "effective date should use the linked active record");
  assert(spotless?.effective_follow_up_timing === "due_today", "linked reminder means it is not unscheduled");
  assert(spotless?.effective_follow_up_source === "linked_pending_follow_up", "the date's source should be explicit");
  assert(spotless?.linked_pending_followup_count === 1, "linked pending count should be preserved");
  assert(afrisource?.effective_follow_up_timing === "unscheduled_or_unknown", "a lead with no linked active reminder should remain unscheduled");
  assert(result.workspace_temporal_guidance.lead_followup_date_counts.due_today === 1, "effective date totals should count the linked reminder");
  assert(result.workspace_temporal_guidance.lead_followup_date_counts.unscheduled_or_unknown === 1, "effective unscheduled totals should exclude the linked reminder");
  assert(source.leads[0].next_follow_up === null, "source records should not be mutated");
});


Deno.test("email body queries stay off for counts and broad business priorities", () => {
  assert(!shouldLoadInnerMeEmailBodies("How many unread emails are there?"), "counts do not need email bodies");
  assert(!shouldLoadInnerMeEmailBodies("What are my highest-value moves for today?"), "broad priorities do not need email bodies");
  assert(!shouldLoadInnerMeEmailBodies("Draft an email to Maisha about the website proposal"), "email-writing requests do not need the existing body by default");
  assert(shouldLoadInnerMeEmailBodies("Summarize the latest email from Maisha's Touch"), "an email-summary request needs message content");
  assert(shouldLoadInnerMeEmailBodies("Did they reply?"), "a reply-content question needs message content");
});

Deno.test("email body selection is bounded and follows an explicit lead focus", () => {
  const rows = [
    { id: "email-1", lead_id: "lead-1", client_id: null },
    { id: "email-2", lead_id: "lead-2", client_id: null },
    { id: "email-3", lead_id: "lead-1", client_id: null },
    { id: "email-4", lead_id: "lead-1", client_id: null },
  ];
  const ids = selectInnerMeEmailBodyIds({
    message: "Did they reply?",
    focusedRecord: { type: "lead", id: "lead-1" },
    emailRows: rows,
    leads: [],
    clients: [],
    maxRows: 2,
  });
  assert(ids.join(",") === "email-1,email-3", "only newest linked messages should be selected up to the configured cap");
});

Deno.test("named-record email content only selects that record's messages", () => {
  const rows = [
    { id: "email-maisha", lead_id: "lead-1", client_id: null },
    { id: "email-other", lead_id: "lead-2", client_id: null },
  ];
  const ids = selectInnerMeEmailBodyIds({
    message: "Summarize the latest email from Maisha's Touch",
    emailRows: rows,
    leads: [
      { id: "lead-1", business_name: "Maisha's Touch" },
      { id: "lead-2", business_name: "Another Business" },
    ],
    clients: [],
  });
  assert(ids.join(",") === "email-maisha", "named targets must not attach unrelated messages");
});

Deno.test("focused or named records do not fall back to unrelated email bodies", () => {
  const rows = [{ id: "email-other", lead_id: "lead-2", client_id: "client-2" }];
  const focused = selectInnerMeEmailBodyIds({
    message: "Did they reply?",
    focusedRecord: { type: "lead", id: "lead-1" },
    emailRows: rows,
  });
  assert(focused.length === 0, "a focused lead without linked email metadata must not select another lead's message");
  const named = selectInnerMeEmailBodyIds({
    message: "Summarize Maisha's Touch's latest email",
    emailRows: rows,
    leads: [{ id: "lead-1", business_name: "Maisha's Touch" }],
    clients: [],
  });
  assert(named.length === 0, "a named lead without linked email metadata must not fall back to the inbox");
});

Deno.test("unknown explicit recipients never fall back to unrelated inbox content", () => {
  const rows = [
    { id: "email-other", lead_id: "lead-2", client_id: null },
  ];
  const ids = selectInnerMeEmailBodyIds({
    message: "Summarize the latest email from an unlisted business",
    emailRows: rows,
    leads: [{ id: "lead-1", business_name: "Known Business" }],
    clients: [],
  });
  assert(ids.length === 0, "an explicit but unresolved recipient must not attach unrelated email bodies");
});

Deno.test("generic email-content request returns only a small newest-first sample", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    id: "email-" + index,
    lead_id: null,
    client_id: null,
  }));
  const ids = selectInnerMeEmailBodyIds({
    message: "Show me the latest emails and summarize what they say",
    emailRows: rows,
    maxRows: 3,
  });
  assert(ids.join(",") === "email-0,email-1,email-2", "generic email requests must respect the bounded recent-message limit");
});
