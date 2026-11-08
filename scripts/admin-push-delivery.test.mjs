import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../supabase/functions/send-admin-push/index.ts", import.meta.url),
  "utf8",
);

test("no registered subscriptions are distinguished from successful delivery", () => {
  assert.match(source, /subscriptions\.length === 0/);
  assert.match(source, /reason: "No registered browser-push subscriptions\."/);
  assert.match(source, /sent: 0,[\s\S]*?removed: 0,[\s\S]*?failed: 0,[\s\S]*?subscriptions: 0/);
});

test("partial push failures are counted and returned as a non-success HTTP response", () => {
  assert.match(source, /let failed = 0/);
  assert.match(source, /deliveryErrors\.push\(/);
  assert.match(source, /const partialFailure = failed > 0/);
  assert.match(source, /ok: !partialFailure/);
  assert.match(source, /status: partialFailure \? 502 : 200/);
  assert.match(source, /sent,[\s\S]*?removed,[\s\S]*?failed,[\s\S]*?subscriptions: subscriptions\.length,[\s\S]*?errors: deliveryErrors/);
});

test("expired subscriptions are removed using the configured backend key and cleanup failures are visible", () => {
  assert.match(source, /statusCode === 404 \|\| statusCode === 410/);
  assert.match(source, /apikey: backendApiKey,[\s\S]*?Authorization: "Bearer " \+ backendApiKey/);
  assert.match(source, /if \(!cleanupResponse\.ok\)/);
  assert.match(source, /operation: "remove_expired_subscription"/);
  assert.match(source, /removed \+= 1/);
});

test("delivery errors expose status metadata, not subscription endpoints or credentials", () => {
  assert.match(source, /statusCode,\s+operation: "send"/);
  assert.doesNotMatch(source, /deliveryErrors\.push\([\s\S]{0,500}endpoint:/);
  assert.doesNotMatch(source, /deliveryErrors\.push\([\s\S]{0,500}auth:/);
});
