"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const workspace = fs.readFileSync(path.join(root, "admin-dashboard", "admin-workspace.js"), "utf8");
const portal = fs.readFileSync(path.join(root, "client-portal", "index.html"), "utf8");

test("new client portal links always use the canonical public domain and preserve the private token", () => {
  assert.ok(workspace.includes('const CLIENT_PORTAL_ORIGIN = "https://swayphics.co.za";'));
  const start = workspace.indexOf("const portalUrl =");
  const end = workspace.indexOf("openClientPortalLinkModal(", start);
  assert.ok(start >= 0 && end > start, "portal URL generation must be present.");
  const generator = workspace.slice(start, end);
  assert.match(generator, /new URL\("\/client-portal\/", CLIENT_PORTAL_ORIGIN\)/);
  assert.match(generator, /portalUrl\.searchParams\.set\("token", rawToken\)/);
  assert.doesNotMatch(generator, /window\.location\.origin/);
});

test("transient portal RPC errors are retried a bounded number of times", async () => {
  const start = portal.indexOf("async function portalRpcWithRetry(");
  const end = portal.indexOf("\nconst params=", start);
  assert.ok(start >= 0 && end > start, "bounded RPC retry helper must exist.");

  let attempts = 0;
  const context = {
    portalRpc: async () => {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error("Temporary network failure");
        error.retryable = true;
        throw error;
      }
      return { ok: true };
    },
    window: { setTimeout: callback => callback() },
    Promise,
    Number,
    Math
  };
  vm.runInNewContext(portal.slice(start, end) + "\nthis.run=portalRpcWithRetry;", context);
  const result = await context.run("get_client_portal", { p_token: "opaque-token" }, 15000, 2);
  assert.equal(result.ok, true);
  assert.equal(attempts, 3);

  attempts = 0;
  context.portalRpc = async () => {
    attempts += 1;
    const error = new Error("This portal link is invalid or has expired.");
    error.status = 403;
    error.retryable = false;
    throw error;
  };
  await assert.rejects(() => context.run("get_client_portal", { p_token: "invalid-token" }, 15000, 2), /invalid or has expired/);
  assert.equal(attempts, 1, "invalid links must not be retried.");
});

test("transient onboarding lookup failure does not block an otherwise valid client portal", () => {
  const start = portal.indexOf("async function load(){");
  const end = portal.indexOf("\nfunction renderPortalError", start);
  assert.ok(start >= 0 && end > start, "portal bootstrap must exist.");
  const load = portal.slice(start, end);
  assert.match(load, /portalRpcWithRetry\("get_client_portal"/);
  assert.match(load, /portalRpcWithRetry\("get_client_onboarding"/);
  assert.match(load, /catch\(onboardingError\)/);
  assert.match(load, /render\(data,onboarding\)/);
  assert.doesNotMatch(load, /Promise\.all\(\[portalRpc/);
});

test("portal boot uses retryable network and gateway failure signals but not ordinary 4xx responses", () => {
  const start = portal.indexOf("async function portalRpc(");
  const end = portal.indexOf("\nasync function portalRpcWithRetry(", start);
  assert.ok(start >= 0 && end > start, "portal RPC helper must exist.");
  const rpc = portal.slice(start, end);
  assert.match(rpc, /requestError\.retryable=\[429,502,503,504\]\.includes\(response\.status\)/);
  assert.match(rpc, /timeoutError\.retryable=true/);
  assert.match(rpc, /networkError\.retryable=true/);
  assert.match(rpc, /window\.clearTimeout\(timer\)/);
});

console.log("Client portal access reliability tests passed.");
