import { createPaystackStatusHandler } from "../get-paystack-payment-status/index.ts";

const attemptId = "12345678-1234-4234-8234-123456789012";
const clientId = "22345678-1234-4234-8234-123456789012";
const invoiceId = "32345678-1234-4234-8234-123456789012";
const reference = "SWP-" + attemptId;

function makeRequest() {
  return new Request(
    "https://test.supabase.co/functions/v1/get-paystack-payment-status",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: "synthetic-portal-token-for-status-test",
        attempt_id: attemptId,
      }),
    },
  );
}

function makeDependencies(
  providerStatus: string,
  options: { reference?: string; domain?: string; amount?: number } = {},
) {
  const attempt: Record<string, unknown> = {
    id: attemptId,
    invoice_id: invoiceId,
    client_id: clientId,
    amount_cents: 10_000,
    currency: "ZAR",
    status: "pending",
    created_at: "2026-11-14T12:00:00.000Z",
    updated_at: "2026-11-14T12:00:00.000Z",
    expires_at: null,
    payment_id: null,
    provider_checkout_id: reference,
  };
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const admin = {
    from(table: string) {
      if (table !== "payment_attempts") {
        throw new Error("Unexpected table lookup: " + table);
      }
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        async maybeSingle() {
          return { data: attempt, error: null };
        },
      };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      attempt.status = args.p_provider_status;
      return {
        data: { status: attempt.status, updated: true, payment_id: null },
        error: null,
      };
    },
  };
  const handler = createPaystackStatusHandler({
    env: (name) =>
      name === "PAYSTACK_SECRET_KEY" ? "sk_test_unit_test" : "test",
    createAdmin: () => admin,
    resolveToken: async () => ({ client_id: clientId }),
    originAllowed: () => true,
    request: async (url) => {
      if (url !== "https://api.paystack.co/transaction/verify/" + reference) {
        throw new Error("Unexpected Paystack verification URL.");
      }
      return new Response(
        JSON.stringify({
          status: true,
          data: {
            id: 900002,
            domain: options.domain || "test",
            status: providerStatus,
            reference: options.reference || reference,
            amount: options.amount ?? 10_000,
            currency: "ZAR",
            channel: "card",
            gateway_response: providerStatus === "failed"
              ? "Declined"
              : "Approved",
          },
        }),
        { status: 200 },
      );
    },
    logError: () => {},
  });
  return { handler, attempt, rpcCalls };
}

Deno.test("Paystack status endpoint records a provider-verified failure without creating a payment", async () => {
  const { handler, attempt, rpcCalls } = makeDependencies("failed");
  const response = await handler(makeRequest());
  const body = await response.json();

  if (response.status !== 200 || body.attempt?.status !== "failed") {
    throw new Error(
      "A verified failed transaction did not update the attempt status.",
    );
  }
  if (
    body.confirmed !== false || body.payment !== null || body.receipt !== null
  ) {
    throw new Error("A failed transaction was incorrectly reported as paid.");
  }
  if (attempt.status !== "failed" || rpcCalls.length !== 1) {
    throw new Error(
      "The failed attempt transition was not persisted exactly once.",
    );
  }
  if (
    rpcCalls[0].name !== "paystack_record_failed_attempt_status" ||
    rpcCalls[0].args.p_provider_transaction_id !== "900002"
  ) {
    throw new Error(
      "The verified transaction identity was not passed to the database.",
    );
  }
});

Deno.test("Paystack status endpoint does not settle or change an attempt for a successful transaction without its webhook", async () => {
  const { handler, attempt, rpcCalls } = makeDependencies("success");
  const response = await handler(makeRequest());
  const body = await response.json();

  if (response.status !== 200 || body.attempt?.status !== "pending") {
    throw new Error(
      "The status endpoint should wait for the success webhook to settle.",
    );
  }
  if (
    body.confirmed !== false || rpcCalls.length !== 0 ||
    attempt.status !== "pending"
  ) {
    throw new Error(
      "The status endpoint settled a payment outside the webhook path.",
    );
  }
});

Deno.test("Paystack status endpoint rejects a provider verification with a mismatched reference", async () => {
  const { handler, attempt, rpcCalls } = makeDependencies("failed", {
    reference: "different-reference",
  });
  const response = await handler(makeRequest());
  const body = await response.json();

  if (response.status !== 503 || body.ok !== false) {
    throw new Error("Mismatched provider transaction was not rejected.");
  }
  if (attempt.status !== "pending" || rpcCalls.length !== 0) {
    throw new Error("Invalid provider data changed the payment attempt.");
  }
});
