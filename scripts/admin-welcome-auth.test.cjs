"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const MARKER_KEY = "swayphics_admin_welcome_pending";
const MARKER_TTL_MS = 120000;

const loginHtml = fs.readFileSync(path.join(root, "admin/index.html"), "utf8");
const dashboardHtml = fs.readFileSync(path.join(root, "admin-dashboard/index.html"), "utf8");
const workspaceSource = fs.readFileSync(path.join(root, "admin-dashboard/admin-workspace.js"), "utf8");

function extractFunction(source, name) {
  const signature = new RegExp("\\b(?:async\\s+)?function\\s+" + name + "\\s*\\(");
  const match = signature.exec(source);
  assert.ok(match, "Could not find function " + name);

  const start = match.index;
  const openingBrace = source.indexOf("{", match.index + match[0].length);
  assert.notEqual(openingBrace, -1, "Missing function body for " + name);

  let depth = 0;
  let state = "code";
  for (let i = openingBrace; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (state === "line-comment") {
      if (ch === "\n") state = "code";
      continue;
    }
    if (state === "block-comment") {
      if (ch === "*" && next === "/") {
        state = "code";
        i += 1;
      }
      continue;
    }
    if (state === "single" || state === "double" || state === "template") {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (
        (state === "single" && ch === "'") ||
        (state === "double" && ch === '"') ||
        (state === "template" && ch.charCodeAt(0) === 96)
      ) {
        state = "code";
      }
      continue;
    }

    if (ch === "/" && next === "/") {
      state = "line-comment";
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      state = "block-comment";
      i += 1;
      continue;
    }
    if (ch === "'") {
      state = "single";
      continue;
    }
    if (ch === '"') {
      state = "double";
      continue;
    }
    if (ch.charCodeAt(0) === 96) {
      state = "template";
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }

  throw new Error("Unterminated function body for " + name);
}

function compileFunction(source, name, sandbox) {
  return vm.runInNewContext("(" + extractFunction(source, name) + ")", sandbox, {
    filename: name + ".test-context.js"
  });
}

function makeStorage(seed) {
  const values = new Map(Object.entries(seed || {}));
  return {
    values,
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
    removeItem(key) {
      values.delete(String(key));
    }
  };
}

function fixedDate(now) {
  return class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() {
      return now;
    }
  };
}

function makeMarker(userId, issuedAt) {
  return JSON.stringify({ version: 1, userId, issuedAt });
}

test("successful login creates a marker only after Supabase login succeeds", () => {
  const clearAt = loginHtml.indexOf('sessionStorage.removeItem("' + MARKER_KEY + '")');
  const authRequestAt = loginHtml.indexOf("/auth/v1/token?grant_type=password");
  const responseGuardAt = loginHtml.indexOf("if (!response.ok)");
  const markerWriteAt = loginHtml.indexOf("sessionStorage.setItem(");

  assert.ok(clearAt >= 0, "new login attempts clear stale markers");
  assert.ok(authRequestAt > clearAt, "stale marker clears before auth request");
  assert.ok(responseGuardAt > authRequestAt, "login response is checked");
  assert.ok(markerWriteAt > responseGuardAt, "marker is written after login succeeds");
  assert.match(loginHtml, /data\.user\s*&&\s*data\.user\.id/);
  assert.match(loginHtml, /version:\s*1/);
  assert.match(loginHtml, /userId:\s*authenticatedUserId/);
  assert.match(loginHtml, /issuedAt:\s*Date\.now\(\)/);
  assert.match(loginHtml, /Welcome marker unavailable; continuing login without the greeting/);
});

test("claim accepts a valid marker, consumes it immediately and prevents replay", () => {
  const now = 1800000000000;
  const storage = makeStorage({ [MARKER_KEY]: makeMarker("admin-123", now - 1000) });
  const claim = compileFunction(workspaceSource, "claimSwayphicsAdminWelcomeMarker", {
    window: { sessionStorage: storage },
    Date: fixedDate(now)
  });

  const marker = claim();
  assert.deepEqual(JSON.parse(JSON.stringify(marker)), {
    version: 1,
    userId: "admin-123",
    issuedAt: now - 1000
  });
  assert.equal(storage.getItem(MARKER_KEY), null);
  assert.equal(claim(), null, "a second claim cannot replay the marker");
});

test("claim accepts the exact two-minute expiry boundary", () => {
  const now = 1800000000000;
  const storage = makeStorage({ [MARKER_KEY]: makeMarker("admin-123", now - MARKER_TTL_MS) });
  const claim = compileFunction(workspaceSource, "claimSwayphicsAdminWelcomeMarker", {
    window: { sessionStorage: storage },
    Date: fixedDate(now)
  });

  assert.equal(claim().userId, "admin-123");
  assert.equal(storage.getItem(MARKER_KEY), null);
});

test("claim rejects expired, future-dated, malformed and structurally invalid markers", async (t) => {
  const now = 1800000000000;
  const cases = [
    ["expired marker", makeMarker("admin-123", now - MARKER_TTL_MS - 1)],
    ["future-dated marker", makeMarker("admin-123", now + 1)],
    ["malformed JSON", "{not-json"],
    ["unsupported version", JSON.stringify({ version: 2, userId: "admin-123", issuedAt: now })],
    ["missing identity", JSON.stringify({ version: 1, issuedAt: now })],
    ["blank identity", JSON.stringify({ version: 1, userId: "  ", issuedAt: now })],
    ["non-numeric timestamp", JSON.stringify({ version: 1, userId: "admin-123", issuedAt: "now" })]
  ];

  for (const [label, raw] of cases) {
    await t.test(label, () => {
      const storage = makeStorage({ [MARKER_KEY]: raw });
      const claim = compileFunction(workspaceSource, "claimSwayphicsAdminWelcomeMarker", {
        window: { sessionStorage: storage },
        Date: fixedDate(now)
      });
      assert.equal(claim(), null);
      assert.equal(storage.getItem(MARKER_KEY), null, "invalid markers are consumed");
    });
  }
});

test("claim safely skips when session storage access throws", () => {
  const storage = {
    getItem() { throw new Error("storage blocked"); },
    removeItem() { throw new Error("storage blocked"); }
  };
  const claim = compileFunction(workspaceSource, "claimSwayphicsAdminWelcomeMarker", {
    window: { sessionStorage: storage },
    Date: fixedDate(1800000000000)
  });
  assert.equal(claim(), null);
});

test("welcome event requires the matching server-verified active admin identity", async (t) => {
  const baseState = {
    currentUser: { id: "admin-123" },
    currentAdmin: { user_id: "admin-123", active: true, full_name: "  Alex Admin  " }
  };

  function runPublisher(overrides) {
    const events = [];
    const state = {
      currentUser: { ...baseState.currentUser },
      currentAdmin: { ...baseState.currentAdmin },
      ...(overrides.state || {})
    };
    const window = {
      swayphicsVerifiedAdminUserId: "admin-123",
      dispatchEvent(event) { events.push(event); },
      ...(overrides.window || {})
    };
    class TestCustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init && init.detail;
      }
    }
    const publish = compileFunction(workspaceSource, "publishAuthorizedSwayphicsAdminWelcome", {
      state, window, CustomEvent: TestCustomEvent
    });
    publish(overrides.marker || {
      version: 1, userId: "admin-123", issuedAt: 1800000000000
    });
    return events;
  }

  await t.test("valid identity emits one event with the trimmed name", () => {
    const events = runPublisher({});
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "swayphics:admin-welcome-authorized");
    assert.deepEqual(JSON.parse(JSON.stringify(events[0].detail)), { fullName: "Alex Admin" });
  });

  for (const [label, overrides] of [
    ["wrong marker user", { marker: { version: 1, userId: "other-user", issuedAt: 1 } }],
    ["wrong verified identity", { window: { swayphicsVerifiedAdminUserId: "other-user" } }],
    ["inactive admin", { state: { currentAdmin: { ...baseState.currentAdmin, active: false } } }],
    ["missing admin", { state: { currentAdmin: null } }],
    ["missing current user", { state: { currentUser: null } }],
    ["missing verified identity", { window: { swayphicsVerifiedAdminUserId: null } }]
  ]) {
    await t.test(label + " cannot emit the event", () => {
      assert.equal(runPublisher(overrides).length, 0);
    });
  }

  await t.test("missing full name emits a neutral empty name", () => {
    const events = runPublisher({
      state: { currentAdmin: { ...baseState.currentAdmin, full_name: null } }
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].detail.fullName, "");
  });
});

test("session verification records the server-returned user ID", async () => {
  const storage = makeStorage({ [MARKER_KEY]: "pending" });
  const removed = [];
  const window = {
    sessionStorage: storage,
    location: { href: "" },
    swayphicsVerifiedAdminUserId: "stale-user"
  };
  const sandbox = {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    SUPABASE_URL: "https://supabase.example.invalid",
    SUPABASE_PUBLISHABLE_KEY: "test-key",
    window,
    localStorage: { removeItem(key) { removed.push(key); } },
    refreshAdminSession: async () => true,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ id: "server-user-123" }) }),
    console: { error() {}, warn() {} }
  };
  sandbox.clearSwayphicsAdminWelcomeMarker = compileFunction(
    dashboardHtml, "clearSwayphicsAdminWelcomeMarker", { window }
  );

  const verify = compileFunction(dashboardHtml, "verifyAdminSession", sandbox);
  assert.equal(await verify(), true);
  assert.equal(window.swayphicsVerifiedAdminUserId, "server-user-123");
  assert.equal(removed.length, 0);
});

test("failed session verification clears marker, tokens and verified identity", async () => {
  const storage = makeStorage({ [MARKER_KEY]: "pending" });
  const removed = [];
  const window = {
    sessionStorage: storage,
    location: { href: "" },
    swayphicsVerifiedAdminUserId: "stale-user"
  };
  const sandbox = {
    accessToken: "expired-token",
    refreshToken: "bad-refresh-token",
    SUPABASE_URL: "https://supabase.example.invalid",
    SUPABASE_PUBLISHABLE_KEY: "test-key",
    window,
    localStorage: { removeItem(key) { removed.push(key); } },
    refreshAdminSession: async () => false,
    fetch: async () => ({ ok: false, status: 401, json: async () => ({}) }),
    console: { error() {}, warn() {} }
  };
  sandbox.clearSwayphicsAdminWelcomeMarker = compileFunction(
    dashboardHtml, "clearSwayphicsAdminWelcomeMarker", { window }
  );

  const verify = compileFunction(dashboardHtml, "verifyAdminSession", sandbox);
  assert.equal(await verify(), false);
  assert.equal(window.swayphicsVerifiedAdminUserId, null);
  assert.equal(storage.getItem(MARKER_KEY), null);
  assert.deepEqual(removed.sort(), ["swayphics_admin_access_token", "swayphics_admin_refresh_token"]);
  assert.equal(window.location.href, "../admin/");
});

test("missing server user ID fails verification", async () => {
  const storage = makeStorage({ [MARKER_KEY]: "pending" });
  const window = {
    sessionStorage: storage,
    location: { href: "" },
    swayphicsVerifiedAdminUserId: "stale-user"
  };
  const sandbox = {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    SUPABASE_URL: "https://supabase.example.invalid",
    SUPABASE_PUBLISHABLE_KEY: "test-key",
    window,
    localStorage: { removeItem() {} },
    refreshAdminSession: async () => true,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ email: "no-id@example.invalid" }) }),
    console: { error() {}, warn() {} }
  };
  sandbox.clearSwayphicsAdminWelcomeMarker = compileFunction(
    dashboardHtml, "clearSwayphicsAdminWelcomeMarker", { window }
  );

  const verify = compileFunction(dashboardHtml, "verifyAdminSession", sandbox);
  assert.equal(await verify(), false);
  assert.equal(window.swayphicsVerifiedAdminUserId, null);
  assert.equal(storage.getItem(MARKER_KEY), null);
});

test("workspace startup orders session verification and identity checks before event emission", () => {
  const boot = extractFunction(workspaceSource, "boot");
  const claimAt = boot.indexOf("claimSwayphicsAdminWelcomeMarker()");
  const waitAt = boot.indexOf("await sessionReady");
  const initializeAt = boot.indexOf("initialiseSwayButtonLoadingObserver()");
  const loadStateAt = boot.indexOf("loadState()");
  const identityCheckAt = boot.indexOf("String(state.currentUser.id) !== verifiedSessionUserId");
  const eventAt = boot.indexOf("publishAuthorizedSwayphicsAdminWelcome(welcomeMarker)");

  assert.ok(claimAt >= 0 && claimAt < waitAt, "marker is claimed before awaiting auth");
  assert.ok(waitAt < initializeAt, "session verification precedes workspace initialization");
  assert.ok(initializeAt < loadStateAt, "workspace initializes after verification");
  assert.ok(loadStateAt < identityCheckAt, "loaded user is checked against verified identity");
  assert.ok(identityCheckAt < eventAt, "event is emitted after identity match");
});

test("startup failure helper renders a visible error without leaking internals", () => {
  const state = { initialDataLoading: true, initialDataError: null };
  const main = { innerHTML: "" };
  const helper = compileFunction(
    workspaceSource,
    "showSwayphicsWorkspaceStartupFailure",
    {
      state,
      document: { getElementById: () => main },
      esc: value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;"),
      console: { error() {} }
    }
  );

  helper("Please sign in again.", new Error("test detail"));
  assert.equal(state.initialDataLoading, false);
  assert.equal(state.initialDataError, "Please sign in again.");
  assert.match(main.innerHTML, /Please sign in again/);
});

console.log("Admin welcome authentication tests registered.");
