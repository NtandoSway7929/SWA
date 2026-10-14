import { buildInnerMeWorkspaceContextForModel, isBroadBusinessPlanningRequest } from "./innerme-workspace-intelligence.mjs";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("broad planning requests are detected", () => {
  assert(isBroadBusinessPlanningRequest("What are my highest-value moves for today?"), "today priorities should be detected");
  assert(isBroadBusinessPlanningRequest("Give me daily recommendations"), "daily recommendations should be detected");
  assert(!isBroadBusinessPlanningRequest("Show me the Swayphics website lead"), "specific record questions should not be broad planning");
});

Deno.test("self-owned Swayphics lead is excluded from broad sales priorities without mutating source", () => {
  const source = {
    leads: [
      { id: "self-test", business_name: "Swayphics", contact_name: "Ntando", status: "contacted" },
      { id: "real-prospect", business_name: "Maisha's Touch", status: "contacted" },
    ],
  };
  const result = buildInnerMeWorkspaceContextForModel(source, "What are my highest-value moves for today?");
  assert(result.leads.length === 1, "only external prospect should remain");
  assert(result.leads[0].id === "real-prospect", "real prospect should be retained");
  assert(source.leads.length === 2, "source context must remain unchanged");
  assert(result.workspace_intelligence_notes?.length === 1, "the exclusion should be disclosed");
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
