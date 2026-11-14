import {
  isPaystackCheckoutUrl,
  validatePaystackInitializeResponse,
  validatePaystackVerifiedTransaction,
} from "../_shared/paystack.ts";

Deno.test("Paystack hosted checkout response must use the exact checkout host and expected reference", () => {
  const valid = validatePaystackInitializeResponse({
    status: true,
    data: {
      authorization_url: "https://checkout.paystack.com/session-123",
      reference: "SWP-12345678-1234-4234-8234-123456789012",
    },
  }, "SWP-12345678-1234-4234-8234-123456789012");
  if (!valid.ok || valid.authorizationUrl !== "https://checkout.paystack.com/session-123") {
    throw new Error("Valid Paystack hosted checkout was rejected.");
  }

  if (isPaystackCheckoutUrl("https://checkout.paystack.com.attacker.example/pay")) {
    throw new Error("Lookalike checkout hostname was accepted.");
  }
  if (isPaystackCheckoutUrl("http://checkout.paystack.com/pay")) {
    throw new Error("Non-HTTPS checkout URL was accepted.");
  }
  const wrongRef = validatePaystackInitializeResponse({
    status: true,
    data: {
      authorization_url: "https://checkout.paystack.com/session-123",
      reference: "some-other-reference",
    },
  }, "expected-reference");
  if (wrongRef.ok) throw new Error("Mismatched transaction reference was accepted.");
});

Deno.test("verified Paystack transaction must match reference, amount, ZAR and test domain", () => {
  const response = {
    status: true,
    data: {
      id: 900001,
      domain: "test",
      status: "success",
      reference: "SWP-12345678-1234-4234-8234-123456789012",
      amount: 2500,
      currency: "ZAR",
      channel: "eft",
    },
  };
  const result = validatePaystackVerifiedTransaction(response, {
    reference: "SWP-12345678-1234-4234-8234-123456789012",
    amountCents: 2500,
  });
  if (!result || result.channel !== "eft" || result.transactionId !== "900001") {
    throw new Error("Valid verified Paystack EFT transaction was rejected.");
  }

  for (const altered of [
    { ...response, data: { ...response.data, domain: "live" } },
    { ...response, data: { ...response.data, status: "pending" } },
    { ...response, data: { ...response.data, amount: 2501 } },
    { ...response, data: { ...response.data, currency: "USD" } },
    { ...response, data: { ...response.data, reference: "different" } },
  ]) {
    if (validatePaystackVerifiedTransaction(altered, {
      reference: "SWP-12345678-1234-4234-8234-123456789012",
      amountCents: 2500,
    })) {
      throw new Error("Invalid verified transaction was accepted.");
    }
  }
});
