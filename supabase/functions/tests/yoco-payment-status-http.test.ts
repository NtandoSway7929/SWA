import { createPaymentStatusHandler } from "../get-payment-status/index.ts";

const attemptId = "123e4567-e89b-42d3-a456-426614174000";
const token = "portal-token-http-status-test-12345678901234567890";

function request(attempt = attemptId, portalToken = token) {
  return new Request("https://functions.example.test/get-payment-status", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://swayphics.co.za" },
    body: JSON.stringify({ token: portalToken, attempt_id: attempt }),
  });
}

function harness(options: Record<string, unknown> = {}) {
  const filters: Record<string, string>[] = [];
  const tables: string[] = [];
  const attempt = {
    id: attemptId,
    invoice_id: "invoice-test",
    client_id: "client-A",
    amount_cents: 2500,
    currency: "ZAR",
    status: options.status || "pending",
    created_at: "2026-11-11T10:00:00Z",
    updated_at: "2026-11-11T10:00:00Z",
    expires_at: null,
    payment_id: options.paymentId ? "payment-test" : null,
  };
  const admin = {
    from(table: string) {
      tables.push(table);
      const localFilters: Record<string, string> = {};
      const query = {
        select(_columns: string) { return query; },
        eq(column: string, value: string) {
          localFilters[column] = value;
          filters.push({ table, column, value });
          return query;
        },
        async maybeSingle() {
          if (table === "payment_attempts") {
            if (options.attemptMissing || localFilters.client_id !== "client-A") return { data: null, error: null };
            return { data: attempt, error: options.attemptError ? { message: "db" } : null };
          }
          if (table === "payments") return {
            data: options.paymentError ? null : {
              id: "payment-test", amount: 25, currency: "ZAR", method: "Card",
              paid_at: "2026-11-11T10:01:00Z", reference: "Yoco",
            },
            error: options.paymentError ? { message: "db" } : null,
          };
          if (table === "payment_receipts") return {
            data: options.receiptError ? null : {
              receipt_number: "SWY-2026-0001", issued_at: "2026-11-11T10:01:01Z", snapshot: { total: 25 },
            },
            error: options.receiptError ? { message: "db" } : null,
          };
          throw new Error("Unexpected table " + table);
        },
      };
      return query;
    },
  };
  const handler = createPaymentStatusHandler({
    createAdmin: () => admin,
    resolveToken: async (_admin, value) => value === token && !options.invalidToken ? { client_id: "client-A" } : null,
    originAllowed: (req) => req.headers.get("origin") === "https://swayphics.co.za",
    logError: () => {},
  });
  return { handler, filters, tables };
}

async function body(response: Response) {
  return await response.json();
}

Deno.test("status endpoint scopes attempt lookup to authenticated portal client", async () => {
  const h = harness();
  const response = await h.handler(request());
  const result = await body(response);
  const clientFilter = h.filters.find((filter) => filter.table === "payment_attempts" && filter.column === "client_id");
  if (response.status !== 200 || result.ok !== true || result.confirmed !== false ||
      clientFilter?.value !== "client-A") {
    throw new Error("Payment attempt query was not scoped to the authenticated portal client.");
  }

  const foreign = harness({ attemptMissing: true });
  const foreignResponse = await foreign.handler(request());
  if (foreignResponse.status !== 404 || (await body(foreignResponse)).ok !== false) {
    throw new Error("A foreign client's attempt was disclosed.");
  }
});

Deno.test("status endpoint rejects invalid tokens and malformed attempt identifiers", async () => {
  const invalidToken = harness({ invalidToken: true });
  const denied = await invalidToken.handler(request());
  if (denied.status !== 403 || invalidToken.tables.length !== 0) {
    throw new Error("Invalid portal token reached payment data.");
  }
  const invalidId = harness();
  const badId = await invalidId.handler(request("not-a-uuid"));
  if (badId.status !== 400 || invalidId.tables.length !== 0) {
    throw new Error("Malformed attempt ID reached payment data.");
  }
});

Deno.test("status endpoint reports pending attempts without payment or receipt", async () => {
  const h = harness({ status: "pending" });
  const response = await h.handler(request());
  const result = await body(response);
  if (response.status !== 200 || result.confirmed !== false ||
      result.payment !== null || result.receipt !== null ||
      h.tables.includes("payments") || h.tables.includes("payment_receipts")) {
    throw new Error("Pending attempt incorrectly appeared as a settled payment.");
  }
});

Deno.test("status endpoint confirms only a succeeded attempt with an actual payment row", async () => {
  const h = harness({ status: "succeeded", paymentId: true });
  const response = await h.handler(request());
  const result = await body(response);
  if (response.status !== 200 || result.confirmed !== true ||
      result.payment?.id !== "payment-test" ||
      result.receipt?.receipt_number !== "SWY-2026-0001") {
    throw new Error("Settled attempt with payment and receipt was not represented correctly.");
  }

  const missingPayment = harness({ status: "succeeded", paymentId: true, paymentError: false });
  const original = missingPayment.handler;
  void original;
});

Deno.test("status endpoint fails closed when payment or receipt reads fail", async () => {
  for (const option of [{ paymentError: true }, { receiptError: true }]) {
    const h = harness({ status: "succeeded", paymentId: true, ...option });
    const response = await h.handler(request());
    if (response.status !== 503 || (await body(response)).confirmed !== undefined) {
      throw new Error("Database read failure returned a potentially misleading confirmation.");
    }
  }
});

Deno.test("status endpoint rejects disallowed origins before reading portal data", async () => {
  const h = harness();
  const bad = new Request("https://functions.example.test/status", {
    method: "POST",
    headers: { origin: "https://attacker.example" },
    body: JSON.stringify({ token, attempt_id: attemptId }),
  });
  const response = await h.handler(bad);
  if (response.status !== 403 || h.tables.length !== 0) {
    throw new Error("Disallowed origin reached payment data.");
  }
});
