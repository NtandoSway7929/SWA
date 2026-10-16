import assert from "node:assert/strict";
import test from "node:test";
import { extractBearerToken } from "../supabase/functions/innerme-retrieval-smoke-test/auth-header.mjs";

test("extracts a signed-in bearer token from the GitHub Actions Authorization header", () => {
  assert.equal(extractBearerToken("Bearer test-access-token"), "test-access-token");
});

test("accepts lowercase bearer scheme", () => {
  assert.equal(extractBearerToken("bearer test-access-token"), "test-access-token");
});

test("accepts mixed-case bearer scheme and normalizes whitespace", () => {
  assert.equal(extractBearerToken("BeArEr    test-access-token  "), "test-access-token");
});

test("rejects a missing or non-bearer Authorization header", () => {
  assert.equal(extractBearerToken(null), "");
  assert.equal(extractBearerToken(undefined), "");
  assert.equal(extractBearerToken(""), "");
  assert.equal(extractBearerToken("Basic test-access-token"), "");
});

test("rejects a Bearer scheme with no token", () => {
  assert.equal(extractBearerToken("Bearer "), "");
  assert.equal(extractBearerToken("Bearer"), "");
});
