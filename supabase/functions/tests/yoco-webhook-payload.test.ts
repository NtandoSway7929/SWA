import {
  getYocoCheckoutId,
  getYocoPaymentSuccessDetails,
  getYocoRefundSuccessDetails,
  normalizeYocoWebhookEvent,
} from "../_shared/yoco-webhook-validation.ts";

Deno.test("normalizes documented Yoco event envelope and checkout metadata", () => {
  const event = normalizeYocoWebhookEvent({
    id: "evt_test_001",
    type: "payment.succeeded",
    payload: {
      amount: 2_500,
      currency: "ZAR",
      status: "successful",
      mode: "test",
      metadata: { checkoutId: "ch_test_001" },
    },
  });

  if (!event || event.id !== "evt_test_001" || event.type !== "payment.succeeded") {
    throw new Error("A valid Yoco event envelope was not normalized.");
  }

  const details = getYocoPaymentSuccessDetails(event.payload);
  if (!details || details.checkoutId !== "ch_test_001" ||
      details.amount !== 2_500 || details.currency !== "ZAR" ||
      details.mode !== "test" || details.transactionId !== null) {
    throw new Error("The documented checkout metadata and payment fields were not mapped correctly.");
  }
});

Deno.test("accepts supported checkout and processing-mode field aliases", () => {
  const cases = [
    { checkoutId: "ch_1", amount: 1000, currency: "ZAR", processingMode: "test" },
    { checkout_id: "ch_2", amount: 1000, currency: "ZAR", processing_mode: "test" },
    { metadata: { checkoutId: "ch_3" }, amount: 1000, currency: "ZAR", mode: "test" },
  ];

  const expected = ["ch_1", "ch_2", "ch_3"];
  for (let index = 0; index < cases.length; index++) {
    const details = getYocoPaymentSuccessDetails(cases[index]);
    if (!details || details.checkoutId !== expected[index]) {
      throw new Error("A supported checkout field variant was not mapped.");
    }
  }
});

Deno.test("rejects malformed event envelopes and incomplete or unsafe payment details", () => {
  const invalidEvents = [
    null,
    [],
    {},
    { id: "", type: "payment.succeeded" },
    { id: "evt_1", type: "" },
    { id: "evt_1", type: "payment.succeeded", payload: [] },
  ];
  for (const candidate of invalidEvents) {
    if (normalizeYocoWebhookEvent(candidate)) {
      throw new Error("An invalid Yoco event envelope was accepted.");
    }
  }

  const invalidPayloads = [
    { checkoutId: "ch_1", amount: 0, currency: "ZAR", mode: "test" },
    { checkoutId: "ch_1", amount: -1, currency: "ZAR", mode: "test" },
    { checkoutId: "ch_1", amount: 1.5, currency: "ZAR", mode: "test" },
    { checkoutId: "ch_1", amount: "1000", currency: "ZAR", mode: "test" },
    { checkoutId: "ch_1", amount: 1000, currency: "", mode: "test" },
    { checkoutId: "ch_1", amount: 1000, currency: "USD", mode: "test" },
    { checkoutId: "ch_1", amount: 1000, currency: "ZAR", mode: "" },
    { checkoutId: "ch_1", amount: 1000, currency: "ZAR", mode: "live" },
    { amount: 1000, currency: "ZAR", mode: "test" },
  ];
  for (const payload of invalidPayloads) {
    if (getYocoPaymentSuccessDetails(payload)) {
      throw new Error("An incomplete or unsafe payment payload was accepted.");
    }
  }

  if (getYocoCheckoutId({ metadata: { checkoutId: 123 } }) !== null) {
    throw new Error("A non-string checkout identifier was accepted.");
  }
});

Deno.test("refund mapping is explicit and leaves missing payment-attempt metadata unresolved", () => {
  const valid = getYocoRefundSuccessDetails({
    refundId: "rf_test_001",
    amount: 500,
    currency: "ZAR",
    metadata: { paymentAttemptId: "123e4567-e89b-42d3-a456-426614174000" },
  });
  if (!valid || valid.providerRefundId !== "rf_test_001" ||
      valid.amount !== 500 || valid.currency !== "ZAR" ||
      valid.paymentAttemptId !== "123e4567-e89b-42d3-a456-426614174000") {
    throw new Error("A fully mapped refund payload was not parsed.");
  }

  const unmapped = getYocoRefundSuccessDetails({
    refund_id: "rf_test_002",
    amount: 100,
    currency: "ZAR",
  });
  if (!unmapped || unmapped.paymentAttemptId !== null) {
    throw new Error("A refund without attempt metadata should remain explicitly unmapped.");
  }

  const invalid = [
    { refundId: "rf_1", amount: "500", currency: "ZAR" },
    { refundId: "rf_1", amount: 0, currency: "ZAR" },
    { refundId: "rf_1", amount: 500, currency: "" },
    { refundId: "", amount: 500, currency: "ZAR" },
  ];
  for (const payload of invalid) {
    if (getYocoRefundSuccessDetails(payload)) {
      throw new Error("An invalid refund payload was accepted.");
    }
  }
});
