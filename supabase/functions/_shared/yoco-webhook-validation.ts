type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export type NormalizedYocoWebhookEvent = {
  id: string;
  type: string;
  payload: JsonObject;
};

export function normalizeYocoWebhookEvent(value: unknown): NormalizedYocoWebhookEvent | null {
  const event = asObject(value);
  const id = nonEmptyString(event.id);
  const type = nonEmptyString(event.type);
  if (!id || !type) return null;
  return {
    id,
    type,
    payload: asObject(event.payload ?? event.data),
  };
}

export function getYocoCheckoutId(payload: JsonObject): string | null {
  return nonEmptyString(
    payload.checkoutId ??
      payload.checkout_id ??
      asObject(payload.metadata).checkoutId,
  );
}

export function getYocoPaymentSuccessDetails(payload: JsonObject) {
  const checkoutId = getYocoCheckoutId(payload);
  const amount = payload.amount as number;
  const currency = nonEmptyString(payload.currency);
  const mode = nonEmptyString(
    payload.mode ?? payload.processingMode ?? payload.processing_mode,
  );
  const transactionId = nonEmptyString(
    payload.transactionId ?? payload.paymentId,
  );

  if (!checkoutId || !Number.isSafeInteger(amount) || amount < 1 || !currency || !mode) {
    return null;
  }

  return { checkoutId, amount, currency, mode, transactionId };
}

export function getYocoRefundSuccessDetails(payload: JsonObject) {
  const providerRefundId = nonEmptyString(payload.refundId ?? payload.refund_id);
  const amount = Number(payload.amount);
  const currency = nonEmptyString(payload.currency);
  const paymentAttemptId = nonEmptyString(asObject(payload.metadata).paymentAttemptId);

  if (!providerRefundId || !Number.isSafeInteger(amount) || amount < 1 || !currency) {
    return null;
  }

  return { providerRefundId, amount, currency, paymentAttemptId };
}
