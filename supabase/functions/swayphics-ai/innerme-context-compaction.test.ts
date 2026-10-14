import { compactInnerMeContextForModel } from "./innerme-context-compaction.mjs";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("all retrieved leads and due-sorted follow-ups survive normal workspace compaction", () => {
  const source = {
    business_date_johannesburg: "2026-10-14",
    workspace_source_record_counts: { leads: 17, followups: 22, communications: 40 },
    leads: Array.from({ length: 17 }, (_, index) => ({
      id: "lead-" + index,
      business_name: "Prospect " + index,
      status: index === 0 ? "new" : "contacted",
      estimated_value: 1500 + index,
    })),
    followups: Array.from({ length: 22 }, (_, index) => ({
      id: "follow-up-" + index,
      status: "pending",
      scheduled_for: "2026-10-" + String(14 + Math.min(index, 17)).padStart(2, "0"),
      lead_id: "lead-" + index,
    })),
    communications: Array.from({ length: 40 }, (_, index) => ({
      id: "communication-" + index,
      message: "Message " + index,
    })),
  };

  const result = compactInnerMeContextForModel(source);
  assert(result.leads.length === 17, "all 17 retrieved leads must remain available");
  assert(result.followups.length === 22, "all 22 retrieved follow-ups must remain available");
  assert(result.communications.length === 6, "only a bounded recent communication sample should be sent");
  assert(result.workspace_source_record_counts.leads === 17, "the exact source count must survive compaction");
  assert(result.workspace_source_record_counts.followups === 22, "the follow-up source count must survive compaction");
  assert(result.business_date_johannesburg === "2026-10-14", "the business timezone date must survive compaction");
  assert(source.leads.length === 17 && source.followups.length === 22, "compaction must not mutate source context");
});

Deno.test("aggressive size compaction preserves critical pipeline records and counts", () => {
  const source = {
    workspace_source_record_counts: { leads: 17, followups: 22, communications: 40 },
    leads: Array.from({ length: 17 }, (_, index) => ({ id: "lead-" + index, business_name: "Prospect " + index })),
    followups: Array.from({ length: 22 }, (_, index) => ({ id: "follow-up-" + index, status: "pending" })),
    communications: Array.from({ length: 40 }, (_, index) => ({ id: "communication-" + index, message: "x".repeat(200) })),
  };

  const result = compactInnerMeContextForModel(source, {
    maxArrayItems: 1,
    maxStringChars: 60,
    maxObjectKeys: 18,
    maxDepth: 3,
    aggressive: true,
  });
  assert(result.leads.length === 17, "aggressive compaction must preserve all retrieved leads below its critical limit");
  assert(result.followups.length === 22, "aggressive compaction must preserve all retrieved follow-ups below its critical limit");
  assert(result.communications.length === 2, "aggressive compaction must bound high-volume communications");
  assert(result.workspace_source_record_counts.leads === 17, "source counts must survive aggressive compaction");
});

Deno.test("collections exceeding the critical budget remain explicitly countable", () => {
  const source = {
    workspace_source_record_counts: { leads: 40 },
    leads: Array.from({ length: 40 }, (_, index) => ({ id: "lead-" + index })),
  };
  const result = compactInnerMeContextForModel(source, { aggressive: true });
  assert(result.leads.length === 24, "aggressive compaction must enforce a bounded critical collection size");
  assert(result.workspace_source_record_counts.leads === 40, "the model must be told the source collection exceeded the transmitted sample");
});
