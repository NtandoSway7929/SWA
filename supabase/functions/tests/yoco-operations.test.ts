import { buildYocoOperationalAlerts } from "../_shared/yoco-operations.ts";

const NOW = Date.parse("2026-11-11T12:00:00.000Z");

Deno.test("flags an old created attempt without claiming an orphaned checkout is confirmed", () => {
  const alerts = buildYocoOperationalAlerts(
    [{
      id: "attempt-old",
      status: "created",
      provider_checkout_id: null,
      created_at: "2026-11-11T11:40:00.000Z",
    }],
    [],
    NOW,
  );
  if (
    alerts.length !== 1 || alerts[0].code !== "checkout_attachment_unconfirmed"
  ) {
    throw new Error("Expected a checkout-attachment warning.");
  }
  if (!alerts[0].message.includes("not confirmed")) {
    throw new Error(
      "Warning must not claim an orphaned provider checkout exists.",
    );
  }
});

Deno.test("does not flag a recent created attempt", () => {
  const alerts = buildYocoOperationalAlerts(
    [{
      id: "attempt-new",
      status: "created",
      provider_checkout_id: null,
      created_at: "2026-11-11T11:55:00.000Z",
    }],
    [],
    NOW,
  );
  if (alerts.length !== 0) {
    throw new Error("Recent attempt should not be flagged.");
  }
});

Deno.test("flags an expired pending checkout without mutating its state", () => {
  const alerts = buildYocoOperationalAlerts(
    [{
      id: "attempt-expired",
      status: "pending",
      created_at: "2026-11-11T10:00:00.000Z",
      expires_at: "2026-11-11T11:00:00.000Z",
    }],
    [],
    NOW,
  );
  if (alerts.length !== 1 || alerts[0].code !== "checkout_expired_unresolved") {
    throw new Error("Expected an expired-checkout alert.");
  }
});

Deno.test("flags requires-review attempts and webhook events as high severity", () => {
  const alerts = buildYocoOperationalAlerts([{
    id: "attempt-review",
    status: "requires_review",
    created_at: "2026-11-11T11:59:00.000Z",
  }], [{
    id: "event-review",
    provider_event_id: "evt-review",
    processing_status: "requires_review",
    received_at: "2026-11-11T11:59:00.000Z",
  }], NOW);
  if (
    alerts.length !== 2 || alerts.some((alert) => alert.severity !== "high")
  ) {
    throw new Error("Review cases must be high severity.");
  }
});

Deno.test("flags stale received and processing webhook events", () => {
  const alerts = buildYocoOperationalAlerts([], [
    {
      id: "event-received",
      processing_status: "received",
      received_at: "2026-11-11T11:54:00.000Z",
    },
    {
      id: "event-processing",
      processing_status: "processing",
      received_at: "2026-11-11T11:50:00.000Z",
    },
    {
      id: "event-fresh",
      processing_status: "received",
      received_at: "2026-11-11T11:58:00.000Z",
    },
  ], NOW);
  if (
    alerts.length !== 2 ||
    alerts.some((alert) => alert.code !== "webhook_processing_stale")
  ) {
    throw new Error("Expected only stale received/processing events.");
  }
});

Deno.test("flags retryable webhook failures and sorts high severity first", () => {
  const alerts = buildYocoOperationalAlerts([], [
    {
      id: "event-retry",
      processing_status: "failed_retryable",
      received_at: "2026-11-11T11:59:00.000Z",
    },
    {
      id: "event-review",
      processing_status: "requires_review",
      received_at: "2026-11-11T11:59:00.000Z",
    },
  ], NOW);
  if (
    alerts.length !== 2 || alerts[0].severity !== "high" ||
    alerts[1].severity !== "medium"
  ) {
    throw new Error("Expected review alerts before retry warnings.");
  }
});

Deno.test("does not flag processed webhook events or successful attempts", () => {
  const alerts = buildYocoOperationalAlerts([{
    id: "attempt-success",
    status: "succeeded",
    created_at: "2026-11-11T10:00:00.000Z",
  }], [{
    id: "event-done",
    processing_status: "processed",
    received_at: "2026-11-11T10:00:00.000Z",
  }], NOW);
  if (alerts.length !== 0) {
    throw new Error("Completed transactions must not be flagged.");
  }
});
