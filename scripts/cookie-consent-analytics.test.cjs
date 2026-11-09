"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const consentScriptMatch = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .find(match => match[1].includes('const SESSION_KEY = "swayphics_cookie_analytics_session";'));

assert.ok(consentScriptMatch, "the public homepage must include the cookie consent analytics script");
const consentScript = consentScriptMatch[1];

function createStorage(initialValues) {
  const values = new Map(Object.entries(initialValues || {}));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

function createElement() {
  const listeners = new Map();
  const classes = new Set();
  return {
    hidden: false,
    listeners,
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); }
    },
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    },
    dispatch(type, event) {
      for (const callback of listeners.get(type) || []) callback(event || {});
    }
  };
}

function createBrowser(options) {
  const settings = options || {};
  const localStorage = createStorage(
    settings.consent ? { swayphics_cookie_consent: settings.consent } : {}
  );
  const sessionStorage = createStorage();
  const banner = createElement();
  const acceptButton = createElement();
  const rejectButton = createElement();
  const elements = {
    "sway-cookie-banner": banner,
    "sway-cookie-accept": acceptButton,
    "sway-cookie-reject": rejectButton
  };
  const documentListeners = new Map();
  const appendedScripts = [];
  const cookieWrites = [];
  const fetchCalls = [];
  const replacements = [];
  const warnings = [];
  let cookieString = "_ga=GA1.2.123.456; _gid=GA1.2.987.654; session=abc";

  const document = {
    getElementById(id) {
      return elements[id] || null;
    },
    addEventListener(type, callback) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(callback);
    },
    createElement(name) {
      return { tagName: String(name).toUpperCase() };
    },
    head: {
      appendChild(element) {
        appendedScripts.push(element);
      }
    },
    get cookie() {
      return cookieString;
    },
    set cookie(value) {
      cookieWrites.push(String(value));
    },
    dispatch(type, event) {
      for (const callback of documentListeners.get(type) || []) callback(event || {});
    }
  };

  const window = {
    location: {
      hostname: settings.hostname || "swayphics.co.za",
      pathname: settings.pathname || "/services/web-design/",
      search: settings.search || "",
      hash: settings.hash || ""
    },
    crypto: {
      randomUUID() {
        return "11111111-1111-4111-8111-111111111111";
      }
    },
    setTimeout(callback) {
      callback();
      return 1;
    }
  };

  const history = {
    replaceState(_state, _title, url) {
      replacements.push(String(url));
    }
  };

  const fetch = (url, init) => {
    fetchCalls.push({ url: String(url), init });
    return Promise.resolve({ ok: true, status: 201 });
  };

  const context = {
    window,
    document,
    localStorage,
    sessionStorage,
    requestAnimationFrame(callback) { callback(); },
    fetch,
    URLSearchParams,
    history,
    console: {
      warn(...args) { warnings.push(args); }
    }
  };

  vm.runInNewContext(consentScript, context, {
    filename: "index.html#cookie-consent-analytics"
  });

  return {
    window,
    document,
    banner,
    acceptButton,
    rejectButton,
    localStorage,
    sessionStorage,
    appendedScripts,
    cookieWrites,
    fetchCalls,
    replacements,
    warnings,
    clickAccept() { acceptButton.dispatch("click"); },
    clickReject() { rejectButton.dispatch("click"); },
    clickFooterPreferences() {
      let prevented = false;
      document.dispatch("click", {
        target: {
          closest(selector) {
            return selector === "#sway-cookie-preferences" ? {} : null;
          }
        },
        preventDefault() { prevented = true; }
      });
      return prevented;
    }
  };
}

function eventPayload(browser, index) {
  const call = browser.fetchCalls[index];
  assert.ok(call, "expected a consent event request at index " + index);
  assert.equal(
    call.url,
    "https://sqifhribgsqfaxgtobsa.supabase.co/rest/v1/swayphics_cookie_consent_events"
  );
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.keepalive, true);
  assert.equal(call.init.headers.Prefer, "return=minimal");
  assert.equal(call.init.headers["Content-Type"], "application/json");
  assert.match(call.init.headers.Authorization, /^Bearer sb_publishable_/);
  return JSON.parse(call.init.body);
}

function assertConsentEvent(browser, index, expected) {
  const payload = eventPayload(browser, index);
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(payload[key], value, "unexpected consent event field: " + key);
  }
  assert.equal(payload.session_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(payload.policy_version, "2026-11-09");
  assert.equal(payload.page_path, "/services/web-design/");
  return payload;
}

// A first-time visitor sees the banner, and acceptance enables Google Analytics.
{
  const browser = createBrowser();
  assert.equal(browser.banner.hidden, false);
  assert.equal(browser.banner.classList.contains("is-visible"), true);
  assert.equal(browser.window.swayphicsAnalyticsLoaded, undefined);
  assert.equal(browser.appendedScripts.length, 0);

  browser.clickAccept();

  assert.equal(browser.localStorage.getItem("swayphics_cookie_consent"), "accepted");
  assertConsentEvent(browser, 0, {
    event_type: "accepted",
    analytics_consent: true,
    source: "banner"
  });
  assert.equal(browser.sessionStorage.getItem("swayphics_cookie_analytics_session"),
    "11111111-1111-4111-8111-111111111111");
  assert.equal(browser.window.swayphicsAnalyticsLoaded, true);
  assert.equal(browser.window["ga-disable-G-YNVEVHGFTZ"], false);
  assert.equal(browser.appendedScripts.length, 1);
  assert.match(browser.appendedScripts[0].src, /googletagmanager\.com\/gtag\/js\?id=G-YNVEVHGFTZ/);
  assert.equal(browser.banner.hidden, true);
}

// A first-time rejection is recorded and never loads the Google Analytics script.
{
  const browser = createBrowser();
  browser.clickReject();

  assert.equal(browser.localStorage.getItem("swayphics_cookie_consent"), "rejected");
  assertConsentEvent(browser, 0, {
    event_type: "rejected",
    analytics_consent: false,
    source: "banner"
  });
  assert.equal(browser.window["ga-disable-G-YNVEVHGFTZ"], true);
  assert.equal(browser.window.swayphicsAnalyticsLoaded, undefined);
  assert.equal(browser.appendedScripts.length, 0);
  assert.equal(browser.banner.hidden, true);
}

// Reopening preferences and changing reject to accept is recorded as a change.
{
  const browser = createBrowser({ consent: "rejected" });
  assert.equal(browser.banner.hidden, true);
  assert.equal(browser.window["ga-disable-G-YNVEVHGFTZ"], true);

  assert.equal(browser.clickFooterPreferences(), true);
  assert.equal(browser.banner.hidden, false);
  assert.equal(browser.banner.classList.contains("is-visible"), true);
  browser.clickAccept();

  assert.equal(browser.localStorage.getItem("swayphics_cookie_consent"), "accepted");
  assertConsentEvent(browser, 0, {
    event_type: "changed",
    analytics_consent: true,
    source: "preferences"
  });
  assert.equal(browser.appendedScripts.length, 1);
}

// Withdrawing a previous acceptance disables tracking and records a withdrawal.
{
  const browser = createBrowser();
  browser.clickAccept();
  browser.clickFooterPreferences();
  browser.clickReject();

  assert.equal(browser.localStorage.getItem("swayphics_cookie_consent"), "rejected");
  assertConsentEvent(browser, 0, {
    event_type: "accepted",
    analytics_consent: true,
    source: "banner"
  });
  assertConsentEvent(browser, 1, {
    event_type: "withdrawn",
    analytics_consent: false,
    source: "preferences"
  });
  assert.equal(browser.window["ga-disable-G-YNVEVHGFTZ"], true);
  const deniedUpdate = browser.window.dataLayer.some(args =>
    args[0] === "consent" &&
    args[1] === "update" &&
    args[2] &&
    args[2].analytics_storage === "denied"
  );
  assert.equal(deniedUpdate, true, "withdrawal must update Google consent to denied");
  assert.ok(browser.cookieWrites.some(value => /^_ga=;/.test(value)),
    "withdrawal should attempt to clear the accessible _ga cookie");
  assert.equal(browser.appendedScripts.length, 1,
    "withdrawing consent must not inject a second analytics script");
}

// Re-selecting the same preference should not create duplicate decision events.
{
  const browser = createBrowser({ consent: "accepted" });
  assert.equal(browser.appendedScripts.length, 1);
  browser.clickFooterPreferences();
  browser.clickAccept();
  assert.equal(browser.fetchCalls.length, 0);
  assert.equal(browser.appendedScripts.length, 1);
}

// A visitor who previously rejected remains opted out on a later page load.
{
  const browser = createBrowser({ consent: "rejected" });
  assert.equal(browser.banner.hidden, true);
  assert.equal(browser.window["ga-disable-G-YNVEVHGFTZ"], true);
  assert.equal(browser.appendedScripts.length, 0);
  assert.equal(browser.fetchCalls.length, 0);
}

// The direct Cookie Policy URL reopens preferences and removes the management query.
{
  const browser = createBrowser({
    pathname: "/",
    search: "?manage-cookies=1&source=cookie-policy",
    hash: "#privacy"
  });
  assert.equal(browser.banner.hidden, false);
  assert.equal(browser.banner.classList.contains("is-visible"), true);
  assert.deepEqual(browser.replacements, ["/?source=cookie-policy#privacy"]);
}

console.log("Cookie consent analytics tests passed (7 scenarios).");
