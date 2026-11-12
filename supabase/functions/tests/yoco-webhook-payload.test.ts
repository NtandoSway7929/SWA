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

  if (
    !event || event.id !== "evt_test_001" || event.type !== "payment.succeeded"
  ) {
    throw new Error("A valid Yoco event envelope was not normalized.");
  }

  const details = getYocoPaymentSuccessDetails(event.payload);
  if (
    !details || details.checkoutId !== "ch_test_001" ||
    details.amount !== 2_500 || details.currency !== "ZAR" ||
    details.mode !== "test" || details.transactionId !== null
  ) {
    throw new Error(
      "The documented checkout metadata and payment fields were not mapped correctly.",
    );
  }
});

Deno.test("accepts supported checkout and processing-mode field aliases", () => {
  const cases = [
    {
      checkoutId: "ch_1",
      amount: 1000,
      currency: "ZAR",
      processingMode: "test",
    },
    {
      checkout_id: "ch_2",
      amount: 1000,
      currency: "ZAR",
      processing_mode: "test",
    },
    {
      metadata: { checkoutId: "ch_3" },
      amount: 1000,
      currency: "ZAR",
      mode: "test",
    },
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

Deno.test("maps documented Yoco refund checkout metadata without treating event ID as refund ID", () => {
  const documented = getYocoRefundSuccessDetails({
    id: "evt_test_refund_001",
    amount: 500,
    currency: "ZAR",
    mode: "test",
    status: "succeeded",
    metadata: { checkoutId: "ch_test_refund_001" },
  });
  if (
    !documented || documented.providerRefundId !== null ||
    documented.checkoutId !== "ch_test_refund_001" ||
    documented.amount !== 500 || documented.currency !== "ZAR" ||
    documented.mode !== "test"
  ) {
    throw new Error(
      "The documented Yoco refund payload was not mapped to its checkout.",
    );
  }

  const withRefundResourceId = getYocoRefundSuccessDetails({
    id: "evt_test_refund_002",
    refundId: "rf_test_002",
    amount: 500,
    currency: "ZAR",
    mode: "test",
    metadata: { checkoutId: "ch_test_refund_002" },
  });
  if (
    !withRefundResourceId ||
    withRefundResourceId.providerRefundId !== "rf_test_002"
  ) {
    throw new Error(
      "An explicitly supplied refund resource ID was not preserved.",
    );
  }

  const live = getYocoRefundSuccessDetails({
    id: "evt_live_refund_001",
    amount: 500,
    currency: "ZAR",
    mode: "live",
    metadata: { checkoutId: "ch_live_001" },
  });
  if (!live || live.mode !== "live") {
    throw new Error(
      "A live-mode refund event was not identified for safe environment handling.",
    );
  }

  const unmapped = getYocoRefundSuccessDetails({
    id: "evt_test_refund_003",
    amount: 100,
    currency: "ZAR",
    mode: "test",
  });
  if (unmapped !== null) {
    throw new Error("A refund without checkout metadata must not be mapped.");
  }

  const invalid = [
    {
      id: "evt_1",
      amount: "500",
      currency: "ZAR",
      mode: "test",
      metadata: { checkoutId: "ch_1" },
    },
    {
      id: "evt_1",
      amount: 0,
      currency: "ZAR",
      mode: "test",
      metadata: { checkoutId: "ch_1" },
    },
    {
      id: "evt_1",
      amount: 500,
      currency: "",
      mode: "test",
      metadata: { checkoutId: "ch_1" },
    },
    {
      id: "evt_1",
      amount: 500,
      currency: "ZAR",
      mode: "unknown",
      metadata: { checkoutId: "ch_1" },
    },
  ];
  for (const payload of invalid) {
    if (getYocoRefundSuccessDetails(payload)) {
      throw new Error("An invalid refund payload was accepted.");
    }
  }
});
