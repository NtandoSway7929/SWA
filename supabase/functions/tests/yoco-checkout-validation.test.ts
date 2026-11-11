import {
  isSwayphicsReturnUrl,
  validateCheckoutRequest,
  validateYocoCheckoutResponse,
} from "../_shared/yoco-validation.ts";
import { checkOrigin, isUuid, json, resolvePortalToken, safeError } from "../_shared/yoco.ts";

Deno.test("checkout request validation rejects malformed, unsafe and out-of-range inputs", () => {
  const valid = {
    token: "t".repeat(48),
    invoice_id: "123e4567-e89b-42d3-a456-426614174000",
    amount_cents: 2_500,
    idempotency_key: "checkout-key-0001",
  };
  const accepted = validateCheckoutRequest(valid, null);
  if (!accepted.ok || accepted.amountCents !== 2_500) {
    throw new Error("A valid checkout request was rejected.");
  }

  const invalidCases: Record<string, unknown>[] = [
    { ...valid, token: "" },
    { ...valid, token: "short" },
    { ...valid, invoice_id: "not-a-uuid" },
    { ...valid, amount_cents: 199 },
    { ...valid, amount_cents: 100_000_001 },
    { ...valid, amount_cents: 2_500.5 },
    { ...valid, idempotency_key: "short" },
    { ...valid, idempotency_key: "x".repeat(129) },
  ];
  for (const candidate of invalidCases) {
    if (validateCheckoutRequest(candidate, null).ok) {
      throw new Error("An invalid checkout request was accepted.");
    }
  }

  const headerWins = validateCheckoutRequest(
    { ...valid, idempotency_key: "body-key-0001" },
    "header-key-0001",
  );
  if (!headerWins.ok || headerWins.idempotencyKey !== "header-key-0001") {
    throw new Error("The explicit Idempotency-Key header did not take precedence.");
  }
});

Deno.test("return URL allow-list rejects lookalike hosts, credentials and non-HTTPS URLs", () => {
  const accepted = [
    "https://swayphics.co.za/client-portal/",
    "https://www.swayphics.co.za/client-portal/",
    "https://portal.swayphics.co.za/return",
  ];
  for (const value of accepted) {
    if (!isSwayphicsReturnUrl(value)) throw new Error("Expected return URL to be accepted: " + value);
  }

  const rejected = [
    "http://swayphics.co.za/return",
    "https://swayphics.co.za.attacker.example/return",
    "https://attacker-swayphics.co.za/return",
    "https://user:pass@swayphics.co.za/return",
    "javascript:alert(1)",
    "https://swayphics.co.za.evil/return",
  ];
  for (const value of rejected) {
    if (isSwayphicsReturnUrl(value)) throw new Error("Unsafe return URL was accepted: " + value);
  }
});

Deno.test("Yoco checkout response must match the expected test amount and hosted URL", () => {
  const valid = {
    id: "yoco_test_checkout_123",
    amount: 2_500,
    currency: "ZAR",
    processingMode: "test",
    redirectUrl: "https://payments.yoco.com/checkout/abc",
  };
  const accepted = validateYocoCheckoutResponse(valid, 2_500);
  if (!accepted.ok || accepted.checkoutId !== valid.id) {
    throw new Error("A valid Yoco test checkout response was rejected.");
  }

  const rejected = [
    { ...valid, amount: 2_499 },
    { ...valid, currency: "USD" },
    { ...valid, processingMode: "live" },
    { ...valid, redirectUrl: "https://payments.yoco.com.attacker.example/checkout" },
    { ...valid, redirectUrl: "http://payments.yoco.com/checkout" },
    { ...valid, redirectUrl: "https://user:pass@payments.yoco.com/checkout" },
    { ...valid, id: "" },
  ];
  for (const candidate of rejected) {
    if (validateYocoCheckoutResponse(candidate, 2_500).ok) {
      throw new Error("An invalid provider checkout response was accepted.");
    }
  }
});

Deno.test("portal token resolver hashes the raw token and enforces active and expiry state", async () => {
  const token = "portal-token-test-value-that-is-long-enough-123456";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const expectedHash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  let selectedHash = "";
  let updated = false;

  let row = {
    id: "token-row-1",
    client_id: "client-row-1",
    active: true,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  };
  const admin = {
    from(table: string) {
      if (table !== "client_portal_tokens") throw new Error("Unexpected table: " + table);
      return {
        select() { return this; },
        eq(column: string, value: unknown) {
          if (column === "token_hash") selectedHash = String(value);
          if (column === "active" && value === true && row.active !== true) return { maybeSingle: async () => ({ data: null, error: null }) };
          return this;
        },
        maybeSingle: async () => ({ data: row, error: null }),
        update() {
          updated = true;
          return {
            eq: async () => ({ error: null }),
          };
        },
      };
    },
  };

  const resolved = await resolvePortalToken(admin, token);
  if (!resolved || selectedHash !== expectedHash || !updated) {
    throw new Error("A valid token was not securely hashed, resolved and touched.");
  }
  if (await resolvePortalToken(admin, "short")) {
    throw new Error("A short portal token was accepted.");
  }

  row = { ...row, expires_at: new Date(Date.now() - 60_000).toISOString() };
  if (await resolvePortalToken(admin, token)) {
    throw new Error("An expired portal token was accepted.");
  }
  row = { ...row, active: false, expires_at: null };
  if (await resolvePortalToken(admin, token)) {
    throw new Error("An inactive portal token was accepted.");
  }
});

Deno.test("UUID helper rejects malformed IDs and safeError does not invent non-error details", () => {
  if (!isUuid("123e4567-e89b-42d3-a456-426614174000")) throw new Error("Valid UUID rejected.");
  if (isUuid("123e4567-e89b-42d3-a456")) throw new Error("Malformed UUID accepted.");
  if (safeError(new Error("test failure")) !== "test failure") throw new Error("Unexpected safeError output.");
  if (safeError("opaque") !== "The payment service is temporarily unavailable.") {
    throw new Error("Non-Error values should receive the generic safe error.");
  }
});


Deno.test("shared HTTP helpers enforce the configured browser origin and no-store responses", async () => {
  const allowed = new Request("https://example.test/function", {
    method: "POST",
    headers: { origin: "https://swayphics.co.za" },
  });
  const denied = new Request("https://example.test/function", {
    method: "POST",
    headers: { origin: "https://swayphics.co.za.attacker.example" },
  });
  const serverToServer = new Request("https://example.test/function", { method: "POST" });

  if (!checkOrigin(allowed)) throw new Error("The configured Swayphics origin was rejected.");
  if (checkOrigin(denied)) throw new Error("A lookalike origin was accepted.");
  if (!checkOrigin(serverToServer)) throw new Error("A server-to-server request without Origin was rejected.");

  const response = json({ ok: true });
  if (response.headers.get("cache-control") !== "no-store") {
    throw new Error("Payment API response is missing no-store cache protection.");
  }
  if (response.headers.get("access-control-allow-origin") !== "https://swayphics.co.za") {
    throw new Error("Payment API response has an unexpected CORS allow-origin value.");
  }
  const payload = await response.json();
  if (payload.ok !== true) throw new Error("JSON response helper did not preserve its payload.");
});
