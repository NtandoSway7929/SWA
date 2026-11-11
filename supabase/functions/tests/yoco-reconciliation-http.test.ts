import { createReconciliationHandler } from "../reconcile-payment/index.ts";

const caseId = "123e4567-e89b-42d3-a456-426614174000";

function harness(options: Record<string, unknown> = {}) {
  const calls: { table: string; filters: Record<string, unknown>; range?: [number, number] }[] = [];
  const caseRow = {
    id: caseId,
    payment_attempt_id: "attempt-test",
    payment_id: null,
    refund_id: null,
    discrepancy_type: "unmatched_event",
    status: "open",
    summary: "Disposable test reconciliation case",
    resolution: null,
    created_at: "2026-11-11T10:00:00.000Z",
    updated_at: "2026-11-11T10:00:00.000Z",
  };
  const admin = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let range: [number, number] | undefined;
      const query = {
        select(_columns: string) { return query; },
        eq(column: string, value: unknown) { filters[column] = value; return query; },
        in(column: string, value: unknown) { filters[column] = value; return query; },
        order(_column: string, _options: unknown) { return query; },
        limit(_limit: number) { return query; },
        range(from: number, to: number) { range = [from, to]; return query; },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          calls.push({ table, filters: { ...filters }, range });
          let data: unknown[] = [];
          if (table === "payment_reconciliation") data = options.noCase ? [] : [caseRow];
          if (table === "payment_reconciliation_evidence") data = (options.evidenceRows as unknown[] | undefined) || [];
          if (table === "payment_reconciliation_actions") data = (options.actionRows as unknown[] | undefined) || [];
          const error = options.failTable === table ? { message: "disposable database failure" } : null;
          return Promise.resolve({ data, error }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const handler = createReconciliationHandler({
    authorize: async () => options.authorized !== false,
    getAdmin: () => admin as never,
    now: () => Date.parse("2026-11-11T12:00:00.000Z"),
  });
  return { handler, calls };
}

function post(body: unknown = {}, origin = "https://swayphics.co.za") {
  return new Request("https://functions.example.test/reconcile-payment", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

async function responseBody(response: Response) {
  return await response.json();
}

Deno.test("reconciliation endpoint rejects unsupported methods before authorization or database access", async () => {
  const h = harness();
  const response = await h.handler(new Request("https://functions.example.test/reconcile-payment", { method: "GET" }));
  if (response.status !== 405 || h.calls.length !== 0) throw new Error("Unsupported method reached the reconciliation data layer.");
});

Deno.test("reconciliation endpoint rejects disallowed origins and non-admin sessions before database access", async () => {
  const originHarness = harness();
  const originResponse = await originHarness.handler(post({}, "https://attacker.example"));
  if (originResponse.status !== 403 || originHarness.calls.length !== 0) throw new Error("Disallowed origin reached the database.");

  const authHarness = harness({ authorized: false });
  const authResponse = await authHarness.handler(post());
  if (authResponse.status !== 403 || authHarness.calls.length !== 0) throw new Error("Non-admin session reached the database.");
});

Deno.test("reconciliation queue response is test-scoped, read-only and deterministic", async () => {
  const h = harness();
  const response = await h.handler(post({ limit: 100 }));
  const result = await responseBody(response);
  const caseQuery = h.calls.find((call) => call.table === "payment_reconciliation");
  if (response.status !== 200 || result.ok !== true || result.environment !== "test" ||
      result.mode !== "read_only_manual_reconciliation" || result.generated_at !== "2026-11-11T12:00:00.000Z" ||
      result.open_cases?.[0]?.id !== caseId ||
      caseQuery?.filters.provider !== "yoco" || caseQuery.filters.environment !== "test") {
    throw new Error("Queue response did not preserve the expected test-only read model.");
  }
  if (h.calls.some((call) => call.table === "payments" || call.table === "invoices" || call.table === "payment_refunds" && call.filters.provider !== "yoco")) {
    throw new Error("Reconciliation read model queried an unexpected financial scope.");
  }
});

Deno.test("history pagination is restricted to a case in the current Yoco test queue", async () => {
  const h = harness();
  const response = await h.handler(post({ history_case_id: caseId, evidence_offset: 20, action_offset: 40 }));
  const result = await responseBody(response);
  const evidence = h.calls.find((call) => call.table === "payment_reconciliation_evidence");
  const actions = h.calls.find((call) => call.table === "payment_reconciliation_actions");
  if (response.status !== 200 || result.history_page?.case_id !== caseId ||
      result.history_page.evidence_offset !== 20 || result.history_page.action_offset !== 40 ||
      evidence?.range?.[0] !== 20 || evidence.range[1] !== 120 ||
      actions?.range?.[0] !== 40 || actions.range[1] !== 140) {
    throw new Error("Case history offsets were not applied to the requested queued case.");
  }

  const invalid = harness({ noCase: true });
  const invalidResponse = await invalid.handler(post({ history_case_id: caseId }));
  if (invalidResponse.status !== 400 || invalid.calls.some((call) =>
    call.table === "payment_reconciliation_evidence" || call.table === "payment_reconciliation_actions")) {
    throw new Error("History for a case outside the current queue was queried.");
  }
});

Deno.test("reconciliation endpoint fails closed when queue or history reads fail", async () => {
  const queueFailure = harness({ failTable: "payment_attempts" });
  const failedQueue = await queueFailure.handler(post());
  if (failedQueue.status !== 503) throw new Error("Queue database failure did not fail closed.");

  const historyFailure = harness({ failTable: "payment_reconciliation_evidence" });
  const failedHistory = await historyFailure.handler(post({ history_case_id: caseId }));
  if (failedHistory.status !== 503) throw new Error("History database failure did not fail closed.");
});

Deno.test("reconciliation endpoint rejects malformed JSON objects", async () => {
  const h = harness();
  const response = await h.handler(new Request("https://functions.example.test/reconcile-payment", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://swayphics.co.za" },
    body: "{",
  }));
  if (response.status !== 400 || h.calls.length !== 0) throw new Error("Malformed JSON reached the data layer.");
});
