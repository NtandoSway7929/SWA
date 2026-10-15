import {
  buildInnerMeProgressiveContext,
  planInnerMeWorkspaceRetrieval,
  resolveInnerMeFocusedRecordDescriptor,
} from "./innerme-context-manifest.mjs";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function fixture() {
  return {
    generated_at: "2026-10-15T00:00:00.000Z",
    business_date_johannesburg: "2026-10-15",
    query_failures: [],
    workspace_source_record_counts: { leads: 60, followups: 100, invoices: 100 },
    workspace_model_context_record_counts: {},
    leads: [
      { id: "lead-1", business_name: "Maisha's Touch", status: "contacted", estimated_value: 1500 },
      { id: "lead-2", business_name: "GSS Plastering LTD", status: "new", estimated_value: 2500 },
      { id: "lead-3", business_name: "HMS Car Radio", status: "contacted", estimated_value: 1800 },
    ],
    followups: [
      { id: "fu-1", lead_id: "lead-1", status: "pending", scheduled_for: "2026-10-15" },
    ],
    clients: [{ id: "client-1", business_name: "Example Client", status: "active" }],
    projects: [{ id: "project-1", name: "Client website", status: "in progress" }],
    tasks: [{ id: "task-1", title: "Prepare project handover", status: "open" }],
    quotes: [{ id: "quote-1", quote_number: "Q-001", status: "sent" }],
    invoices: [{ id: "invoice-1", invoice_number: "INV-001", status: "overdue", amount_outstanding: 1800 }],
    payments: [{ id: "payment-1", invoice_id: "invoice-1", status: "pending" }],
    enquiries: [{ id: "enquiry-1", name: "New web enquiry", status: "new" }],
    portal_requests: [{ id: "request-1", subject: "Homepage update", status: "new" }],
    communications: [{ id: "comm-1", subject: "Discovery call", lead_id: "lead-1" }],
    activities: [{ id: "activity-1", action: "lead contacted", entity_id: "lead-1" }],
    email_messages: [{ id: "email-1", subject: "Website proposal", lead_id: "lead-1" }],
    operational_summary: {
      generated_date_johannesburg: "2026-10-15",
      lead_counts: { total: 3, open_pipeline: 3 },
      invoice_summary: { total: 1, outstanding_value_zar: 1800 },
      followups_due: [{ id: "fu-1", lead_id: "lead-1" }],
      followup_attention_today: { overdue: [], due_today: [{ id: "fu-1" }] },
    },
    workspace_temporal_guidance: { business_date_johannesburg: "2026-10-15" },
    workspace_model_context_exclusion_counts: {},
    workspace_intelligence_notes: [],
    innerme_business_brain: {
      playbooks: [
        { id: "pb-1", name: "Lead follow-up", purpose: "Review and prepare follow-up", status: "active", definition_of_done: "Outcome recorded", steps: ["Read lead", "Check schedule", "Draft follow-up"] },
        { id: "pb-2", name: "Website QA", purpose: "Quality check a website", status: "active", definition_of_done: "QA evidence exists", steps: ["Review page", "Record defects"] },
      ],
      agents: [{ id: "agent-1", slug: "revenue-operator", name: "Revenue Operator", purpose: "Pipeline analysis", trust_stage: 1, permissions: ["read"], status: "active", instructions: "Detailed agent notes" }],
      preferences: [{ category: "global", preference_key: "tone", value: "Direct and human", source: "admin" }],
    },
  };
}

Deno.test("query planning skips unrelated tables for routine chat", () => {
  const plan = planInnerMeWorkspaceRetrieval({
    action: "assistant_chat",
    message: "Explain what caching means.",
  });
  assert(plan.profile === "manifest_only", "general knowledge questions should avoid workspace reads");
  assert(plan.collections.length === 0, "unrelated workspace collections should not be queried");
  assert(
    JSON.stringify(plan.businessBrainCollections) === JSON.stringify(["preferences"]),
    "only global preferences should be loaded for an unrelated routine turn",
  );
});

Deno.test("query planning loads only an invoice topic and its linked evidence", () => {
  const plan = planInnerMeWorkspaceRetrieval({
    action: "assistant_chat",
    message: "Which invoices are overdue and what payments are outstanding?",
  });
  for (const collection of ["invoices", "payments", "clients"]) {
    assert(plan.collections.includes(collection), "invoice request must load " + collection);
  }
  assert(!plan.collections.includes("communications"), "unrelated communications should not be loaded");
  assert(!plan.collections.includes("activities"), "unrelated activity history should not be loaded");
});

Deno.test("query planning preserves lead context for entity-only follow-up questions", () => {
  const plan = planInnerMeWorkspaceRetrieval({
    action: "assistant_chat",
    message: "What about Maisha's Touch?",
  });
  for (const collection of ["leads", "clients", "tasks", "projects"]) {
    assert(plan.collections.includes(collection), "name-only follow-up must query " + collection);
  }
});

Deno.test("query planning preserves broad evidence for daily priorities", () => {
  const plan = planInnerMeWorkspaceRetrieval({
    action: "assistant_chat",
    message: "What are my highest-value moves for today?",
  });
  assert(plan.profile === "broad_operations", "daily priorities must retain broad evidence");
  assert(plan.collections.length === 13, "broad operational requests should load every core workspace collection");
  assert(plan.businessBrainCollections.length === 7, "broad operational requests should retain business-brain evidence");
});

Deno.test("explicit focused records load allowlisted relationship collections", () => {
  const plan = planInnerMeWorkspaceRetrieval({
    action: "assistant_chat",
    message: "Tell me about this record.",
    focusedRecord: { type: "lead", id: "lead-1" },
  });
  assert(plan.profile === "focused_record", "explicit UI focus must take precedence");
  for (const collection of ["leads", "followups", "communications", "quotes", "email_messages", "clients"]) {
    assert(plan.collections.includes(collection), "focused lead must preserve linked " + collection);
  }
  assert(!plan.collections.includes("invoices"), "focused lead must not load unrelated invoices");
});

Deno.test("unqueried collection counts and summary metrics are not represented as zero", () => {
  const source: any = fixture();
  source.workspace_loaded_collections = [];
  source.workspace_loaded_business_brain_collections = ["preferences"];
  const selected: any = buildInnerMeProgressiveContext(source, "Explain what caching means.");
  const leadManifest = selected.workspace_manifest.collections.leads;
  assert(leadManifest.query_executed === false, "unqueried lead table must be explicitly marked");
  assert(leadManifest.loaded_records === null, "unqueried rows must not appear as zero rows");
  assert(leadManifest.record_index === undefined, "unqueried rows must not create an empty-looking index");
  assert(selected.operational_summary.lead_counts === undefined, "unloaded lead metrics must be omitted");
  assert(selected.operational_summary.task_summary === undefined, "unloaded task metrics must be omitted");
  assert(typeof selected.operational_summary.metric_scope === "string", "remaining metrics must state their bounded sample scope");
  assert(selected.innerme_business_brain.playbook_index === undefined, "unqueried playbooks must not appear as an empty registry");
  assert(selected.innerme_business_brain.agent_index === undefined, "unqueried agents must not appear as an empty registry");
  assert(selected.innerme_business_brain_manifest.playbooks.query_executed === false, "unqueried registry status must be explicit");
  assert(selected.innerme_business_brain_manifest.preferences.query_executed === true, "loaded preference query must be marked");
});

Deno.test("database aggregate provenance is retained without overstating bounded detail", () => {
  const source: any = fixture();
  source.workspace_loaded_collections = ["leads"];
  source.workspace_loaded_business_brain_collections = ["preferences"];
  source.operational_summary = {
    generated_date_johannesburg: "2026-10-15",
    summary_source: "database_aggregate",
    metric_scope: "Exact aggregate counts from PostgreSQL; detailed rows remain bounded.",
    lead_counts: { total: 17, open_pipeline: 8 },
    followup_counts: {
      pending_total: 12,
      lead_next_followups_due_today: 2,
    },
    task_summary: { total: 44, open: 20 },
    activity_summary: { total: 99 },
  };
  const selected: any = buildInnerMeProgressiveContext(source, "Explain lead totals.");
  assert(selected.operational_summary.summary_source === "database_aggregate", "aggregate provenance must survive context compaction");
  assert(selected.operational_summary.lead_counts.total === 17, "authoritative lead aggregate must survive");
  assert(selected.operational_summary.followup_counts.pending_total === undefined, "follow-up row counts must be omitted when follow-ups were not queried");
  assert(selected.operational_summary.followup_counts.lead_next_followups_due_today === 2, "lead-based follow-up counts may remain when the lead domain was queried");
  assert(selected.operational_summary.task_summary === undefined, "unloaded task metrics must be omitted");
  assert(selected.operational_summary.activity_summary === undefined, "unloaded activity metrics must be omitted");
  assert(selected.operational_summary.metric_scope === "Exact aggregate counts from PostgreSQL; detailed rows remain bounded.", "database metric scope must not be replaced by bounded-sample wording");
});

Deno.test("manifest-only questions do not expand unrelated workspace rows", () => {
  const selected: any = buildInnerMeProgressiveContext(fixture(), "Explain what caching means.");
  assert(selected.workspace_manifest.profile === "manifest_only", "generic question should use manifest-only profile");
  assert(!Array.isArray(selected.leads), "unrelated lead details should not be included");
  assert(selected.workspace_manifest.collections.leads.detail_loaded === false, "manifest should mark lead details as unloaded");
  assert(selected.workspace_manifest.collections.leads.loaded_count_is_database_total === false, "bounded query counts must not be misrepresented as global totals");
  assert(selected.workspace_manifest.collections.leads.record_index.length <= 2, "manifest record index must be bounded");
  assert(selected.operational_summary.followups_due === undefined, "large follow-up detail arrays should be omitted when unrelated");
  assert(selected.operational_summary.lead_counts.total === 3, "compact authoritative operational metrics should remain available");
});

Deno.test("invoice questions expand invoices and their related payment/client evidence only", () => {
  const selected: any = buildInnerMeProgressiveContext(fixture(), "Which invoices are overdue and what payments are outstanding?");
  assert(selected.workspace_manifest.profile === "topic_focused", "invoice request should be topic-focused");
  assert(Array.isArray(selected.invoices), "invoice detail should be included");
  assert(Array.isArray(selected.payments), "related payment detail should be included");
  assert(Array.isArray(selected.clients), "client evidence should be included for financial follow-up");
  assert(!Array.isArray(selected.communications), "unrelated communication details should be omitted");
});

Deno.test("broad priorities expand cross-domain operational context and keep follow-up evidence", () => {
  const selected: any = buildInnerMeProgressiveContext(fixture(), "What are my highest-value moves for today?");
  assert(selected.workspace_manifest.profile === "broad_operations", "broad planning should use broad operations profile");
  assert(Array.isArray(selected.leads) && Array.isArray(selected.invoices), "cross-domain records should be present");
  assert(Array.isArray(selected.operational_summary.followup_attention_today.due_today), "daily priority requests retain due follow-up details");
});

Deno.test("a named record can trigger its domain even when the question omits the record type", () => {
  const selected: any = buildInnerMeProgressiveContext(fixture(), "What about Maisha's Touch?");
  assert(Array.isArray(selected.leads), "mention of a loaded lead name should expand the lead collection");
  assert(selected.workspace_manifest.detail_collections.includes("leads"), "manifest should disclose which collection is expanded");
});

Deno.test("explicit focused records take precedence and preserve connected context", () => {
  const source: any = fixture();
  source.focused_record = {
    type: "lead",
    id: "lead-1",
    label: "Lead",
    record: { id: "lead-1", business_name: "Maisha's Touch", status: "contacted" },
  };
  source.connected_context = { primary_type: "lead", primary_id: "lead-1", connected: { invoices: [] } };
  const selected: any = buildInnerMeProgressiveContext(source, "Did they reply?");
  assert(selected.workspace_manifest.profile === "focused_record", "explicit focus should override generic intent");
  assert(selected.focused_record.id === "lead-1", "focused record must remain present");
  assert(selected.connected_context.primary_id === "lead-1", "connected context must remain present");
  assert(selected.workspace_manifest.detail_collections.includes("followups"), "lead relationships should include follow-ups");
});

Deno.test("active playbook steps are disclosed only when the query matches the playbook", () => {
  const general: any = buildInnerMeProgressiveContext(fixture(), "Explain what caching means.");
  assert(general.innerme_business_brain.playbook_index.length === 2, "compact playbook index should be available");
  assert(!general.innerme_business_brain.matching_playbooks, "unmatched playbook steps should not be disclosed");
  const requested: any = buildInnerMeProgressiveContext(fixture(), "Use the Lead follow-up playbook.");
  assert(Array.isArray(requested.innerme_business_brain.matching_playbooks), "matching playbook details should be disclosed on demand");
  assert(requested.innerme_business_brain.matching_playbooks[0].steps.length > 0, "selected playbook steps should survive progressive disclosure");
});

Deno.test("focused-record descriptor only returns allowlisted table names", () => {
  const descriptor = resolveInnerMeFocusedRecordDescriptor({ type: "lead", id: "lead-1" });
  assert(descriptor?.table === "leads" && descriptor.collection === "leads", "lead should map to its allowlisted table");
  assert(resolveInnerMeFocusedRecordDescriptor({ type: "unknown_table", id: "x" }) === null, "unknown focus type must be rejected");
  assert(resolveInnerMeFocusedRecordDescriptor({ type: "invoice", id: "" }) === null, "empty ID must be rejected");
  assert(resolveInnerMeFocusedRecordDescriptor({ type: "invoice", id: "x".repeat(101) }) === null, "oversized ID must be rejected");
});
