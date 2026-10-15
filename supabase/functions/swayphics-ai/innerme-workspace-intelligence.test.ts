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
