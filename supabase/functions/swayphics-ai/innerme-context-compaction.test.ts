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


Deno.test("ultra-compaction keeps workspace context under the 24 KB provider request budget", () => {
  const leadFields = {
    contact_name: "Contact Name",
    service_interest: "Website design and setup",
    status: "contacted",
    estimated_value: 3950,
    next_follow_up: "2026-10-18",
    last_contacted_at: "2026-10-07T10:00:00.000Z",
    created_at: "2026-09-01T10:00:00.000Z",
    updated_at: "2026-10-07T10:00:00.000Z",
    source: "email",
    notes: "Long note ".repeat(45),
    business_assessment: "Assessment detail ".repeat(60),
    research_findings: "Research detail ".repeat(60),
    swayphics_solution: "Solution detail ".repeat(60),
  };
  const followupFields = {
    status: "pending",
    scheduled_for: "2026-10-15",
    channel: "WhatsApp",
    note: "Automatic reminder detail ".repeat(25),
    created_at: "2026-10-01T10:00:00.000Z",
    completed_at: null,
    provider_metadata: "metadata ".repeat(50),
  };
  const source = {
    generated_at: "2026-10-14T10:00:00.000Z",
    business_date_johannesburg: "2026-10-14",
    user_email: "admin@example.invalid",
    query_failures: [],
    workspace_source_record_counts: {
      leads: 19, followups: 27, clients: 50, projects: 50, tasks: 50,
      quotes: 50, payments: 50, enquiries: 5, invoices: 50, portal_requests: 50,
      communications: 100, activities: 60, email_messages: 100,
    },
    workspace_model_context_record_counts: {
      leads: 19, followups: 27, clients: 50, projects: 50, tasks: 50,
      quotes: 50, payments: 50, enquiries: 5, invoices: 50, portal_requests: 50,
      communications: 100, activities: 60, email_messages: 100,
    },
    leads: Array.from({ length: 19 }, (_, index) => ({
      id: "00000000-0000-0000-0000-" + String(index).padStart(12, "0"),
      business_name: "Prospect Business " + index,
      ...leadFields,
    })),
    followups: Array.from({ length: 27 }, (_, index) => ({
      id: "10000000-0000-0000-0000-" + String(index).padStart(12, "0"),
      lead_id: "00000000-0000-0000-0000-" + String(index % 19).padStart(12, "0"),
      client_id: null,
      ...followupFields,
    })),
    enquiries: Array.from({ length: 5 }, (_, index) => ({
      id: "20000000-0000-0000-0000-" + String(index).padStart(12, "0"),
      name: "Test contact " + index,
      service: "Website Design",
      status: "new",
      message: "Gibberish and sample text ".repeat(25),
      created_at: "2026-09-01T10:00:00.000Z",
    })),
    clients: Array.from({ length: 50 }, (_, index) => ({
      id: "60000000-0000-0000-0000-" + String(index).padStart(12, "0"),
      business_name: "Client Business " + index,
      contact_name: "Contact " + index,
      status: "active",
      source_lead_id: "00000000-0000-0000-0000-" + String(index % 19).padStart(12, "0"),
      created_at: "2026-09-01T10:00:00.000Z",
      updated_at: "2026-10-01T10:00:00.000Z",
    })),
    projects: Array.from({ length: 50 }, (_, index) => ({
      id: "70000000-0000-0000-0000-" + String(index).padStart(12, "0"),
      client_id: "60000000-0000-0000-0000-" + String(index).padStart(12, "0"),
      name: "Client Website Project " + index,
      service: "Website design",
      description: "Project description ".repeat(60),
      status: "in progress",
      value: 3950,
      due_date: "2026-10-20",
      payment_status: "unpaid",
      created_at: "2026-09-01T10:00:00.000Z",
      completed_at: null,
    })),
    tasks: Array.from({ length: 50 }, (_, index) => ({
      id: "80000000-0000-0000-0000-" + String(index).padStart(12, "0"),
      title: "Urgent delivery task " + index,
      description: "Task description ".repeat(60),
      status: "open",
      priority: "high",
      due_date: "2026-10-15",
      lead_id: "00000000-0000-0000-0000-" + String(index % 19).padStart(12, "0"),
      client_id: null,
      project_id: "70000000-0000-0000-0000-" + String(index).padStart(12, "0"),
      created_at: "2026-09-01T10:00:00.000Z",
      completed_at: null,
    })),
    quotes: Array.from({ length: 50 }, (_, index) => ({
      id: "90000000-0000-0000-0000-" + String(index).padStart(12, "0"),
      quote_number: "Q-" + index,
      title: "Website proposal " + index,
      lead_id: "00000000-0000-0000-0000-" + String(index % 19).padStart(12, "0"),
      client_id: null,
      amount: 3950,
      status: "sent",
      valid_until: "2026-10-20",
      created_at: "2026-10-01T10:00:00.000Z",
    })),
    payments: Array.from({ length: 50 }, (_, index) => ({
      id: "a0000000-0000-0000-0000-" + String(index).padStart(12, "0"),
      invoice_id: "b0000000-0000-0000-0000-" + String(index).padStart(12, "0"),
      client_id: "60000000-0000-0000-0000-" + String(index).padStart(12, "0"),
      amount: 3950,
      status: "pending",
      paid_at: null,
      created_at: "2026-10-01T10:00:00.000Z",
    })),
    invoices: Array.from({ length: 50 }, (_, index) => ({
      id: "b0000000-0000-0000-0000-" + String(index).padStart(12, "0"),
      invoice_number: "INV-" + index,
      client_id: "60000000-0000-0000-0000-" + String(index).padStart(12, "0"),
      project_id: "70000000-0000-0000-0000-" + String(index).padStart(12, "0"),
      issue_date: "2026-10-01",
      due_date: "2026-10-15",
      status: "unpaid",
      total: 3950,
      amount_paid: 0,
      amount_outstanding: 3950,
      created_at: "2026-10-01T10:00:00.000Z",
      archived: false,
    })),
    portal_requests: Array.from({ length: 50 }, (_, index) => ({
      id: "c0000000-0000-0000-0000-" + String(index).padStart(12, "0"),
      client_id: "60000000-0000-0000-0000-" + String(index).padStart(12, "0"),
      request_type: "revision",
      status: "open",
      created_at: "2026-10-01T10:00:00.000Z",
      updated_at: "2026-10-01T10:00:00.000Z",
      due_date: "2026-10-15",
      subject: "Project revision " + index,
      description: "Client revision detail ".repeat(60),
    })),
    communications: Array.from({ length: 100 }, (_, index) => ({
      id: "30000000-0000-0000-0000-" + String(index).padStart(12, "0"),
      message: "Communication history ".repeat(100),
    })),
    activities: Array.from({ length: 60 }, (_, index) => ({
      id: "40000000-0000-0000-0000-" + String(index).padStart(12, "0"),
      description: "Activity details ".repeat(100),
    })),
    email_messages: Array.from({ length: 100 }, (_, index) => ({
      id: "50000000-0000-0000-0000-" + String(index).padStart(12, "0"),
      subject: "Email thread " + index,
      text_body: "Email body text ".repeat(100),
    })),
    innerme_business_brain: {
      agents: Array.from({ length: 30 }, (_, index) => ({
        id: "agent-" + index,
        name: "Specialist agent " + index,
        instructions: "Detailed agent instructions ".repeat(200),
      })),
    },
  };

  const workspace = compactInnerMeContextForModel(source, {
    maxArrayItems: 1,
    maxStringChars: 28,
    maxObjectKeys: 18,
    maxDepth: 3,
    aggressive: true,
    ultraCompact: true,
  });
  const contextBytes = new TextEncoder().encode(JSON.stringify(workspace)).byteLength;
  const requestBody = {
    systemInstruction: { parts: [{ text: "s".repeat(9500) }] },
    contents: [{ role: "user", parts: [{
      text: "Highest-value moves for today. " + "Review the real workspace and rank priorities. ".repeat(25) +
        "\n\nCURRENT SWAYPHICS WORKSPACE DATA (JSON):\n" + JSON.stringify(workspace),
    }] }],
    generationConfig: { maxOutputTokens: 2048 },
  };
  const requestBytes = new TextEncoder().encode(JSON.stringify(requestBody)).byteLength;

  assert(workspace.leads.length === 19, "all leads fit with compact operational fields");
  assert(workspace.followups.length === 11, "nearest scheduled follow-up records are bounded");
  assert(workspace.leads[0].id === "00000000-0000-0000-0000-000000000000", "UUIDs must not be truncated");
  assert(workspace.followups[0].lead_id === "00000000-0000-0000-0000-000000000000", "linked UUIDs must not be truncated");
  assert(workspace.workspace_source_record_counts.followups === 27, "source count must retain all retrieved follow-ups");
  assert(workspace.workspace_compacted_record_counts.followups === 11, "compacted count must show the sampled follow-up records");
  assert(workspace.clients.length === 2 && workspace.projects.length === 2, "client and project details must be sharply bounded");
  assert(workspace.tasks.length === 3 && workspace.quotes.length === 2, "task and quote details must be sharply bounded");
  assert(workspace.payments.length === 2 && workspace.invoices.length === 2, "payment and invoice details must be sharply bounded");
  assert(workspace.portal_requests.length === 1 && workspace.enquiries.length === 3, "other operational collections must be sharply bounded");
  assert(workspace.workspace_source_record_counts.tasks === 50, "counts must remain exact even when task detail is sampled");
  assert(!("innerme_business_brain" in workspace), "oversized optional business-brain details are omitted");
  assert(contextBytes < 14000, "ultra-compacted workspace should remain bounded");
  assert(requestBytes < 24000, "request must fit under 24 KB; actual=" + requestBytes + " bytes, workspace=" + contextBytes + " bytes");
  assert(typeof workspace.context_compaction_note === "string", "the answer generator must know that record details were compacted");
});
