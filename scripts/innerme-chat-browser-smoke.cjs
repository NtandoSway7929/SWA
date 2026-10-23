const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const BASE_URL = "http://127.0.0.1:4173/admin-dashboard/index.html";
const SUPABASE_ORIGIN = "https://sqifhribgsqfaxgtobsa.supabase.co";
const TEST_USER_ID = "11111111-1111-4111-8111-111111111111";
const ARTIFACT_DIR = path.resolve("artifacts/innerme-chat-browser-smoke");
const REPO_ROOT = path.resolve(__dirname, "..");
const dashboardHtmlSource = fs.readFileSync(path.join(REPO_ROOT, "admin-dashboard/index.html"), "utf8");
const welcomeCssSource = fs.readFileSync(path.join(REPO_ROOT, "admin-dashboard/admin-welcome.css"), "utf8");

const markdownAnswer = [
  "## Browser smoke answer",
  "",
  "A **bold** result and a [safe link](https://example.com/docs).",
  "Credential-bearing link: [deceptive](https://trusted.example@evil.example/path).",
  "",
  "- First step",
  "- Second step",
  "",
  "\u0060\u0060\u0060js",
  "const ready = true;",
  "\u0060\u0060\u0060",
  "",
  "| Check | Result |",
  "| --- | --- |",
  "| SSE | Pass |",
  "| Markdown | Pass |",
  "",
  "Raw HTML: <img src=x onerror=alert(1)>.",
  "",
  "Unsafe link: [blocked](javascript:alert(1))"
].join("\n");

const metrics = {
  scenarios: [],
  mockedChatRequests: 0,
  cancelledResponses: 0,
  retryRequests: 0,
  unexpectedExternalRequests: [],
  pageErrors: []
};

function responseJson(body, status) {
  return {
    status: status || 200,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(body)
  };
}

function makeTestAccessToken(userId, email) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    sub: userId,
    email: email || "welcome-test@example.invalid",
    role: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600
  });
  return header + "." + payload + ".ui-smoke-signature";
}

function sseFrame(name, payload) {
  return "event: " + name + "\ndata: " + JSON.stringify(payload) + "\n\n";
}

function buildSourceTraceResponse(sourceUrl) {
  const answer = "## Grounded answer\n\nThis answer is supported by a reviewed source [1]. Citation [9] has no matching source and must remain unavailable.";
  const frames = [sseFrame("phase", { status: "Checking reviewed sources…" })];
  for (let offset = 0; offset < answer.length; offset += 64) {
    frames.push(sseFrame("delta", { text: answer.slice(offset, offset + 64) }));
  }
  frames.push(sseFrame("done", {
    answer,
    read_only: true,
    knowledge_retrieval: {
      used: true,
      match_count: 1,
      matches: [{
        id: "ui-smoke-evidence-1",
        title: "Test evidence record",
        source_name: "Department of Example",
        source_publisher: "Example Government",
        source_url: sourceUrl,
        evidence_level: "authoritative",
        similarity: 0.947
      }]
    },
    knowledge_attribution: {
      matches: [{
        id: "ui-smoke-evidence-1",
        confidence: "High confidence",
        reason: "The test source directly supports the answer."
      }]
    }
  }));
  return frames.join("");
}

function buildSseResponse() {
  const frames = [];
  frames.push(sseFrame("phase", { status: "Preparing a read-only answer…" }));
  for (let offset = 0; offset < markdownAnswer.length; offset += 64) {
    frames.push(sseFrame("delta", { text: markdownAnswer.slice(offset, offset + 64) }));
  }
  frames.push(sseFrame("done", {
    answer: markdownAnswer,
    read_only: true,
    knowledge_retrieval: { match_count: 0, retrieval_error: null },
    knowledge_attribution: []
  }));
  return frames.join("");
}

async function configureIsolatedContext(context, initialView, theme, welcomeTest) {
  await context.addInitScript(({ testUserId, view, storedTheme, welcomeTest }) => {
    const payload = {
      sub: testUserId,
      email: "innerme-ui-smoke@example.invalid",
      role: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600
    };
    const encoded = btoa(JSON.stringify(payload))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    // Seed the fake access token only on dashboard documents. If this test
    // navigates to the login screen after logout, do not silently restore it.
    if (window.location.pathname.startsWith("/admin-dashboard/")) {
      localStorage.setItem("swayphics_admin_access_token", header + "." + encoded + ".ui-smoke-signature");
    }
    localStorage.setItem("swayphics_admin_current_view", view);
    localStorage.setItem("swayphics_admin_theme", storedTheme);
    localStorage.removeItem("swayphics_admin_workspace_snapshot_" + testUserId);
    localStorage.removeItem("swayphics_admin_innerme_conversation_" + testUserId);
    localStorage.removeItem("swayphics_admin_innerme_sessions_" + testUserId);

    if (welcomeTest) {
      window.addEventListener("swayphics:admin-welcome-authorized", function (event) {
        const countKey = "__swayphicsWelcomeEventCount";
        const count = Number(sessionStorage.getItem(countKey) || "0") + 1;
        const animationCountKey = "__swayphicsWelcomeAnimationCount";
        const hasReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const animationCount = Number(sessionStorage.getItem(animationCountKey) || "0") +
          (event.detail && event.detail.animate === true && !hasReducedMotion ? 1 : 0);
        sessionStorage.setItem(countKey, String(count));
        sessionStorage.setItem(animationCountKey, String(animationCount));
        sessionStorage.setItem(
          "__swayphicsWelcomeFullName",
          String(event.detail && event.detail.fullName || "")
        );
      });

      if (
        welcomeTest.seedMarker === true &&
        sessionStorage.getItem("__swayphicsWelcomeMarkerSeeded") !== "true"
      ) {
        sessionStorage.setItem(
          "swayphics_admin_welcome_pending",
          JSON.stringify({
            version: 1,
            userId: welcomeTest.markerUserId,
            issuedAt: Date.now()
          })
        );
        sessionStorage.setItem("__swayphicsWelcomeMarkerSeeded", "true");
      }
    }

    // Produce one deterministic, browser-native partial SSE response for the
    // Stop-response test. It never reaches Supabase or an AI provider.
    const originalFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
      const requestUrl = typeof input === "string"
        ? input
        : input && typeof input.url === "string" ? input.url : "";
      const requestOptions = init || {};
      let payload = null;
      if (typeof requestOptions.body === "string") {
        try {
          payload = JSON.parse(requestOptions.body);
        } catch (error) {
          payload = null;
        }
      }

      if (
        requestUrl.includes("/functions/v1/swayphics-ai") &&
        payload &&
        typeof payload.message === "string" &&
        payload.message.includes("[test-partial-stream]")
      ) {
        window.__innerMePartialStreamRequests =
          (window.__innerMePartialStreamRequests || 0) + 1;
        const signal = requestOptions.signal ||
          (typeof Request !== "undefined" && input instanceof Request ? input.signal : null);
        const encoder = new TextEncoder();
        let abortHandler = null;
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(
              "event: delta\ndata: " +
              JSON.stringify({ text: "Partial answer preserved when stopped." }) +
              "\n\n"
            ));
            abortHandler = function () {
              try {
                controller.error(new DOMException("The operation was aborted.", "AbortError"));
              } catch (error) {
                // The stream may already have been cancelled by the consumer.
              }
            };
            if (signal) {
              if (signal.aborted) {
                abortHandler();
              } else {
                signal.addEventListener("abort", abortHandler, { once: true });
              }
            }
          },
          cancel() {
            if (signal && abortHandler) {
              signal.removeEventListener("abort", abortHandler);
            }
          }
        });
        return new Response(body, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform"
          }
        });
      }

      return originalFetch(input, init);
    };
  }, {
    testUserId: TEST_USER_ID,
    view: initialView,
    storedTheme: theme,
    welcomeTest: welcomeTest ? {
      markerUserId: welcomeTest.markerUserId || null,
      seedMarker: welcomeTest.seedMarker === true
    } : null
  });

  await context.route(SUPABASE_ORIGIN + "/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();

    if (url.pathname === "/functions/v1/swayphics-ai" && method === "POST") {
      const postData = request.postDataJSON() || {};
      metrics.mockedChatRequests += 1;
      const message = String(postData.message || "");

      if (message.includes("[test-retry-once]")) {
        metrics.retryRequests += 1;
        if (metrics.retryRequests === 1) {
          return route.fulfill({
            status: 200,
            contentType: "text/event-stream; charset=utf-8",
            headers: { "Cache-Control": "no-cache, no-transform" },
            body: sseFrame("phase", { status: "Preparing a read-only answer…" }) +
              sseFrame("error", { error: "Synthetic retry failure", retryable: true })
          });
        }

        const retryAnswer = "## Retry succeeded\n\nThe original question was retried successfully.";
        return route.fulfill({
          status: 200,
          contentType: "text/event-stream; charset=utf-8",
          headers: { "Cache-Control": "no-cache, no-transform" },
          body: sseFrame("delta", { text: retryAnswer }) +
            sseFrame("done", {
              answer: retryAnswer,
              read_only: true,
              knowledge_retrieval: { match_count: 0, retrieval_error: null },
              knowledge_attribution: []
            })
        });
      }

      // Exercise the existing non-SSE response contract, which must remain
      // available for fallback providers and older function deployments.
      if (message.includes("[test-json-fallback]")) {
        return route.fulfill(responseJson({
          answer: "## JSON fallback answer\n\nThe legacy JSON response path remains compatible.",
          read_only: true,
          knowledge_retrieval: { match_count: 0, retrieval_error: null },
          knowledge_attribution: []
        }));
      }

      if (message.includes("[test-slow-stream]")) {
        await new Promise(resolve => setTimeout(resolve, 1200));
        try {
          return await route.fulfill({
            status: 200,
            contentType: "text/event-stream; charset=utf-8",
            headers: { "Cache-Control": "no-cache, no-transform" },
            body: sseFrame("delta", { text: "This delayed response should be cancelled." }) +
              sseFrame("done", {
                answer: "This delayed response should be cancelled.",
                read_only: true,
                knowledge_retrieval: { match_count: 0, retrieval_error: null },
                knowledge_attribution: []
              })
          });
        } catch (error) {
          // The browser may have already aborted the request; that is expected here.
          return;
        }
      }

      if (message.includes("[test-source-trace]") || message.includes("[test-unsafe-source]")) {
        const sourceUrl = message.includes("[test-unsafe-source]")
          ? "javascript:alert(1)"
          : "https://example.com/reviewed-source";
        return route.fulfill({
          status: 200,
          contentType: "text/event-stream; charset=utf-8",
          headers: { "Cache-Control": "no-cache, no-transform" },
          body: buildSourceTraceResponse(sourceUrl)
        });
      }

      if (postData.stream_response === true) {
        const streamBody = message.includes("[test-stream-error]")
          ? sseFrame("phase", { status: "Preparing an answer…" }) +
            sseFrame("error", { error: "Synthetic stream interruption test", retryable: true })
          : buildSseResponse();
        return route.fulfill({
          status: 200,
          contentType: "text/event-stream; charset=utf-8",
          headers: {
            "Cache-Control": "no-cache, no-transform",
            "X-InnerMe-Request-ID": "ui-smoke-mocked-request"
          },
          body: streamBody
        });
      }
      return route.fulfill(responseJson({ answer: markdownAnswer, read_only: true }));
    }

    if (
      welcomeTest &&
      welcomeTest.simulateLogin === true &&
      url.pathname === "/auth/v1/token" &&
      url.searchParams.get("grant_type") === "password" &&
      method === "POST"
    ) {
      const loginPayload = request.postDataJSON() || {};
      if (loginPayload.email === "invalid-login@example.invalid") {
        return route.fulfill(responseJson({
          message: "Synthetic invalid login for welcome smoke test."
        }, 401));
      }

      return route.fulfill(responseJson({
        access_token: makeTestAccessToken(TEST_USER_ID, loginPayload.email),
        refresh_token: "isolated-welcome-test-refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        user: {
          id: TEST_USER_ID,
          email: loginPayload.email || "welcome-test@example.invalid",
          role: "authenticated"
        }
      }));
    }

    if (
      welcomeTest &&
      welcomeTest.simulateLogin === true &&
      url.pathname === "/auth/v1/token" &&
      url.searchParams.get("grant_type") === "refresh_token" &&
      method === "POST"
    ) {
      const refreshPayload = request.postDataJSON() || {};
      if (!String(refreshPayload.refresh_token || "").startsWith("isolated-welcome-test-refresh-token")) {
        return route.fulfill(responseJson({ message: "Unexpected test refresh token." }, 401));
      }

      return route.fulfill(responseJson({
        access_token: makeTestAccessToken(TEST_USER_ID, "welcome-test@example.invalid"),
        refresh_token: "isolated-welcome-test-refresh-token-refreshed",
        token_type: "bearer",
        expires_in: 3600,
        user: {
          id: TEST_USER_ID,
          email: "welcome-test@example.invalid",
          role: "authenticated"
        }
      }));
    }

    if (url.pathname === "/auth/v1/user") {
      return route.fulfill(responseJson({
        id: TEST_USER_ID,
        email: "innerme-ui-smoke@example.invalid",
        role: "authenticated"
      }));
    }

    if (url.pathname === "/rest/v1/admin_users" && method === "GET") {
      return route.fulfill(responseJson([{
        user_id: TEST_USER_ID,
        full_name: "Isolated UI Test",
        email: "innerme-ui-smoke@example.invalid",
        role: "owner",
        active: !(welcomeTest && welcomeTest.adminActive === false),
        created_at: "2026-01-01T00:00:00Z"
      }]));
    }

    if (url.pathname.startsWith("/realtime/v1/")) {
      return route.abort();
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      return route.fulfill(responseJson([]));
    }
    if (url.pathname.startsWith("/functions/v1/")) {
      return route.fulfill(responseJson({ ok: true, items: [] }));
    }
    if (url.pathname.startsWith("/auth/v1/")) {
      return route.fulfill(responseJson({ access_token: "", token_type: "bearer", expires_in: 3600 }));
    }
    if (url.pathname.startsWith("/storage/v1/")) {
      return route.fulfill(responseJson([]));
    }
    return route.fulfill(responseJson({}));
  });

  await context.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2**", (route) => route.abort());
  await context.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await context.route("https://fonts.gstatic.com/**", (route) => route.abort());
}

async function assertNoHorizontalOverflow(page, scenario) {
  const size = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth
  }));
  assert.ok(size.document <= size.viewport + 2, scenario + " has horizontal document overflow: " + JSON.stringify(size));
  return size;
}

async function openChat(page, initialView) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#sway-admin-workspace .sway-workspace-shell", { timeout: 30000 });
  if (initialView !== "swayphics-ai") {
    const innerMeGroup = page.locator('[data-nav-group-toggle="innerme"]');
    if ((await innerMeGroup.getAttribute("aria-expanded")) !== "true") {
      await innerMeGroup.click();
    }
    const chatNav = page.locator('[data-view="swayphics-ai"]').first();
    await chatNav.waitFor({ state: "visible", timeout: 15000 });
    await chatNav.click();
  }
  await page.locator(".sway-innerme-chat-view").waitFor({ state: "visible", timeout: 20000 });
  await page.locator("#sway-ai-conversation").waitFor({ state: "visible" });
  await page.locator("#sway-ai-input").waitFor({ state: "visible" });
  await page.locator("#sway-ai-send").waitFor({ state: "visible" });
}

async function askMockedQuestion(page) {
  await page.locator("#sway-ai-input").fill("Show a heading, list, safe link, code example and comparison table.");
  await page.locator("#sway-ai-send").click();

  await page.locator(".sway-ai-message-content .sway-ai-answer-heading").filter({
    hasText: "Browser smoke answer"
  }).waitFor({ state: "visible", timeout: 15000 });

  const response = page.locator(".sway-ai-message-content").filter({
    hasText: "Browser smoke answer"
  }).last();

  assert.equal(await response.locator(".sway-ai-answer-heading").count(), 1, "Markdown heading should render");
  assert.equal(await response.locator("ul li").count(), 2, "Markdown list items should render");
  assert.equal(await response.locator('a[href="https://example.com/docs"]').count(), 1, "HTTPS link should render");
  assert.equal(await response.locator('a[href*="evil.example"]').count(), 0, "Credential-bearing URLs must not become clickable links");
  assert.ok((await response.textContent()).includes("https://trusted.example@evil.example/path"), "Rejected destinations should remain visible as inert text");
  assert.equal(await response.locator(".sway-ai-code-block-wrap pre code").count(), 1, "Fenced code should render");
  assert.equal(await response.locator(".sway-ai-table-wrap table").count(), 1, "Markdown table should render accessibly");
  assert.equal(await response.locator("img").count(), 0, "Untrusted HTML must not create an image node");
  assert.equal(await response.locator('a[href^="javascript:"]').count(), 0, "Unsafe javascript links must not become links");

  const copyCode = response.locator("button.sway-ai-code-copy");
  await copyCode.waitFor({ state: "visible" });
  await copyCode.click();
  await page.waitForFunction(() => {
    const button = document.querySelector(".sway-ai-message-content button.sway-ai-code-copy");
    return button && button.textContent.trim() === "Copied code";
  }, { timeout: 5000 });
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(copied, "const ready = true;", "Code copy should preserve exact whitespace/content");

  const assistantMessage = page.locator(".sway-ai-message.sway-ai-assistant").filter({
    hasText: "Browser smoke answer"
  }).last();
  const copyResponse = assistantMessage.locator("button.sway-ai-copy:not(.sway-ai-code-copy)");
  await copyResponse.click();
  await page.waitForFunction(() => {
    const button = document.querySelector(".sway-ai-message.sway-ai-assistant button.sway-ai-copy:not(.sway-ai-code-copy)");
    return button && button.textContent.trim() === "Copied";
  }, { timeout: 5000 });
  const copiedResponse = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(copiedResponse, markdownAnswer.trim(), "Response copy should preserve the original assistant Markdown, not rendered HTML");

  return {
    renderedHeading: true,
    renderedListItems: 2,
    renderedSafeLink: true,
    credentialBearingLinkBlocked: true,
    renderedCodeBlock: true,
    renderedTable: true,
    untrustedHtmlEscaped: true,
    unsafeLinkBlocked: true,
    codeCopyPreservedWhitespace: true
  };
}

async function verifyKeyboardAndFallbackPaths(page, metrics) {
  const input = page.locator("#sway-ai-input");
  const send = page.locator("#sway-ai-send");
  const headings = page.locator(".sway-ai-message-content .sway-ai-answer-heading");

  const beforeShiftEnter = metrics.mockedChatRequests;
  await input.fill("line one");
  await input.press("Shift+Enter");
  assert.equal(await input.inputValue(), "line one\n", "Shift+Enter should insert a newline");
  assert.equal(metrics.mockedChatRequests, beforeShiftEnter, "Shift+Enter must not send a message");

  const beforeEnter = await headings.count();
  await input.fill("Keyboard send test");
  await input.press("Enter");
  await page.waitForFunction((count) =>
    document.querySelectorAll(".sway-ai-message-content .sway-ai-answer-heading").length === count + 1,
    beforeEnter,
    { timeout: 10000 }
  );
  assert.ok(metrics.mockedChatRequests > beforeShiftEnter, "Enter should submit the message");

  await input.fill("[test-json-fallback]");
  await send.click();
  await page.locator(".sway-ai-message-content .sway-ai-answer-heading").filter({
    hasText: "JSON fallback answer"
  }).waitFor({ state: "visible", timeout: 10000 });

  await input.fill("[test-stream-error]");
  await send.click();
  await page.locator(".sway-ai-message-content").filter({
    hasText: "Synthetic stream interruption test"
  }).waitFor({ state: "visible", timeout: 10000 });

  const beforeSafeTraceCount = await page.locator(".sway-ai-knowledge-trace").count();
  await input.fill("[test-source-trace]");
  await send.click();
  await page.waitForFunction(
    (count) => document.querySelectorAll(".sway-ai-knowledge-trace").length === count + 1,
    beforeSafeTraceCount,
    { timeout: 10000 }
  );
  const groundedMessage = page.locator(".sway-ai-message.sway-ai-assistant").filter({
    hasText: "Grounded answer"
  }).last();
  const evidencePanel = groundedMessage.locator("details.sway-ai-knowledge-trace");
  const inlineCitation = groundedMessage.locator('.sway-ai-inline-citation[data-ai-citation-id="ui-smoke-evidence-1"]');
  assert.equal(await inlineCitation.count(), 1, "Supported [1] citation should become an interactive source marker");
  assert.equal((await inlineCitation.textContent()).trim(), "[1]", "Inline citation should retain its numbered marker");
  assert.equal(await inlineCitation.getAttribute("aria-label"), "Open supporting source 1: Test evidence record", "Inline citation should have a descriptive accessible name");
  const unavailableCitation = groundedMessage.locator(".sway-ai-inline-citation-unavailable").filter({ hasText: "[9]" });
  assert.equal(await unavailableCitation.count(), 1, "Unknown citation [9] should be marked unavailable, not linked");
  assert.equal(await unavailableCitation.locator("button").count(), 0, "Unknown citation must not be an interactive source control");
  await inlineCitation.click();
  assert.equal(await evidencePanel.evaluate(el => el.open), true, "Inline citation should open the evidence panel");
  assert.ok((await evidencePanel.locator("summary").textContent()).includes("Evidence used"), "Grounded answer should expose an evidence-used summary");
  const evidenceRow = evidencePanel.locator(".sway-ai-knowledge-trace-row").first();
  assert.equal(await evidenceRow.getAttribute("data-ai-knowledge-id"), "ui-smoke-evidence-1", "Citation target must resolve to the exact retrieved record");
  assert.ok((await evidenceRow.getAttribute("class")).includes("sway-ai-knowledge-trace-row-highlight"), "Citation target row should be highlighted");
  assert.ok((await evidenceRow.textContent()).includes("Test evidence record"), "Evidence title should be visible");
  assert.ok((await evidenceRow.textContent()).includes("High confidence"), "Attribution confidence should be visible");
  assert.ok((await evidenceRow.textContent()).includes("The test source directly supports the answer."), "Attribution reason should be visible");
  assert.ok((await evidenceRow.locator(".sway-ai-knowledge-trace-score").textContent()).includes("94.7%"), "Retrieval similarity should be visible");
  const safeSourceLink = evidenceRow.locator("a.sway-ai-knowledge-trace-link");
  assert.equal(await safeSourceLink.getAttribute("href"), "https://example.com/reviewed-source", "HTTP(S) source links should remain usable");
  assert.equal(await safeSourceLink.getAttribute("aria-label"), "Open source: Test evidence record", "Source link should have a descriptive accessible name");
  assert.ok((await safeSourceLink.getAttribute("rel")).includes("noopener"), "External source link should be isolated from its opener");

  const beforeUnsafeTraceCount = await page.locator(".sway-ai-knowledge-trace").count();
  await input.fill("[test-unsafe-source]");
  await send.click();
  await page.waitForFunction(
    (count) => document.querySelectorAll(".sway-ai-knowledge-trace").length === count + 1,
    beforeUnsafeTraceCount,
    { timeout: 10000 }
  );
  const unsafeMessage = page.locator(".sway-ai-message.sway-ai-assistant").filter({
    hasText: "Grounded answer"
  }).last();
  const unsafeEvidence = unsafeMessage.locator("details.sway-ai-knowledge-trace");
  await unsafeEvidence.locator("summary").click();
  assert.equal(await unsafeEvidence.locator('a[href^="javascript:"]').count(), 0, "JavaScript source URLs must not become clickable links");
  assert.equal(await unsafeEvidence.locator("a.sway-ai-knowledge-trace-link").count(), 0, "Invalid source URLs should be shown as metadata only");
  assert.ok((await unsafeEvidence.textContent()).includes("Test evidence record"), "Invalid source URL must not hide the evidence record");

  const beforeSlowRequest = metrics.mockedChatRequests;
  await input.fill("[test-slow-stream]");
  await send.click();
  const startWait = Date.now();
  while (metrics.mockedChatRequests <= beforeSlowRequest && Date.now() - startWait < 3000) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(metrics.mockedChatRequests > beforeSlowRequest, "Slow mocked chat request should reach the intercepted backend");
  const stop = page.locator('#sway-ai-send[data-ai-stop-generation="true"]');
  await stop.waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await stop.getAttribute("aria-label"), "Stop generating response", "Stop control should have an accessible name");
  await stop.click();

  const stoppedMessage = page.locator(".sway-ai-message.sway-ai-assistant.sway-ai-response-stopped").last();
  await stoppedMessage.waitFor({ state: "visible", timeout: 5000 });
  assert.ok((await stoppedMessage.textContent()).includes("Response stopped before any text was received."), "Cancelled empty response should show a clear stopped state");
  assert.equal(await input.isEnabled(), true, "Composer input should be re-enabled after cancellation");
  assert.equal(await send.getAttribute("type"), "submit", "Send button should return to submit mode after cancellation");
  assert.equal(await send.getAttribute("data-ai-stop-generation"), null, "Stop control state should be removed after cancellation");
  metrics.cancelledResponses += 1;

  // Unlike the empty-response check above, this stream has already delivered a
  // visible delta before Stop is clicked. The stream then remains open until
  // AbortSignal cancels it, proving the partial answer survives cancellation.
  await input.fill("[test-partial-stream]");
  await send.click();
  const partialStop = page.locator('#sway-ai-send[data-ai-stop-generation="true"]');
  await partialStop.waitFor({ state: "visible", timeout: 5000 });
  assert.equal(
    await partialStop.getAttribute("aria-label"),
    "Stop generating response",
    "Stop control should remain accessible while partial text is streaming"
  );
  await page.waitForFunction(() => {
    const messages = document.querySelectorAll(
      ".sway-ai-message.sway-ai-assistant .sway-ai-message-content"
    );
    const latestContent = messages.length ? messages[messages.length - 1] : null;
    return latestContent &&
      latestContent.textContent.includes("Partial answer preserved when stopped.");
  }, null, { timeout: 5000 });
  await partialStop.click();

  const partialStoppedMessage = page.locator(
    ".sway-ai-message.sway-ai-assistant.sway-ai-response-stopped"
  ).last();
  await partialStoppedMessage.waitFor({ state: "visible", timeout: 5000 });
  const partialStoppedText = await partialStoppedMessage.textContent();
  assert.ok(
    partialStoppedText.includes("Partial answer preserved when stopped."),
    "Stop must preserve text already received from the stream"
  );
  assert.ok(
    !partialStoppedText.includes("Response stopped before any text was received."),
    "A partial response must not be replaced by the empty-response message"
  );
  assert.equal(
    (await partialStoppedMessage.locator(".sway-ai-stopped-label").textContent()).trim(),
    "Stopped",
    "Interrupted partial response should be labelled as stopped"
  );
  assert.equal(await input.isEnabled(), true, "Composer input should be re-enabled after partial cancellation");
  assert.equal(await send.getAttribute("type"), "submit", "Send button should return to submit mode after partial cancellation");
  assert.equal(await send.getAttribute("data-ai-stop-generation"), null, "Stop control state should be removed after partial cancellation");
  const partialMockRequests = await page.evaluate(
    () => window.__innerMePartialStreamRequests || 0
  );
  assert.equal(partialMockRequests, 1, "Exactly one local partial stream should be used");
  metrics.cancelledResponses += 1;

  // Simulate a transient failure, then verify Retry replays the same prompt,
  // replaces the failed turn, and renders the successful answer.
  const retryPrompt = "[test-retry-once] retry this read-only question";
  await input.fill(retryPrompt);
  await send.click();
  const failedRetryMessage = page.locator(
    ".sway-ai-message.sway-ai-assistant.sway-ai-response-error"
  ).filter({ hasText: "Synthetic retry failure" }).last();
  await failedRetryMessage.waitFor({ state: "visible", timeout: 5000 });
  const retryButton = failedRetryMessage.locator("button.sway-ai-retry");
  assert.equal(
    await retryButton.getAttribute("aria-label"),
    "Retry last InnerMe request",
    "Retry action should have an accessible name"
  );
  assert.equal(
    await page.locator(".sway-ai-message.sway-ai-user .sway-ai-message-content")
      .filter({ hasText: retryPrompt }).count(),
    1,
    "Initial failed attempt should have exactly one visible user prompt"
  );
  await retryButton.click();

  await page.locator(".sway-ai-message.sway-ai-assistant .sway-ai-answer-heading")
    .filter({ hasText: "Retry succeeded" })
    .waitFor({ state: "visible", timeout: 5000 });
  assert.equal(
    await page.locator(".sway-ai-message.sway-ai-assistant.sway-ai-response-error")
      .filter({ hasText: "Synthetic retry failure" }).count(),
    0,
    "Retry should replace its own error bubble without removing unrelated earlier errors"
  );
  assert.equal(
    await page.locator(".sway-ai-message.sway-ai-user .sway-ai-message-content")
      .filter({ hasText: retryPrompt }).count(),
    1,
    "Retry must not duplicate the user prompt in the transcript"
  );
  assert.equal(metrics.retryRequests, 2, "Retry should issue exactly one second mocked request");
  assert.equal(await input.isEnabled(), true, "Composer should be re-enabled after a successful retry");
  assert.equal(await send.getAttribute("type"), "submit", "Send control should remain in submit mode after retry");

  return {
    enterSubmitsMessage: true,
    shiftEnterAddsNewlineWithoutSending: true,
    nonStreamingJsonFallbackRenders: true,
    streamErrorRendersRecoverableMessage: true,
    stopResponseCancelsRequest: true,
    stopResponsePreservesPartialAnswer: true,
    failedRequestCanBeRetried: true,
    retryReplacesFailedTurnWithoutDuplicatePrompt: true,
    retryRequests: metrics.retryRequests,
    partialMockRequests
  };
}

async function testWelcomeAuthBrowserFlow(browser, metrics) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: "block"
  });
  await configureIsolatedContext(context, "overview", "light", {
    simulateLogin: true,
    markerUserId: TEST_USER_ID,
    seedMarker: false,
    adminActive: true
  });

  const page = await context.newPage();
  page.on("pageerror", error => metrics.pageErrors.push("welcome-auth: " + error.message));
  page.on("request", request => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost", "sqifhribgsqfaxgtobsa.supabase.co", "cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)) {
      metrics.unexpectedExternalRequests.push(request.url());
    }
  });

  try {
    await page.goto("http://127.0.0.1:4173/admin/", { waitUntil: "domcontentloaded" });
    await page.locator("#admin-email").fill("welcome-test@example.invalid");
    await page.locator("#admin-password").fill("mocked-password");

    await Promise.all([
      page.waitForURL(url => url.pathname.startsWith("/admin-dashboard/"), { timeout: 15000 }),
      page.locator("#login-button").click()
    ]);

    await page.waitForSelector("#sway-admin-workspace .sway-workspace-shell", { timeout: 30000 });
    await page.waitForFunction(
      () => Number(sessionStorage.getItem("__swayphicsWelcomeEventCount") || "0") === 1,
      undefined,
      { timeout: 15000 }
    );

    const firstWelcome = await page.evaluate(() => ({
      count: Number(sessionStorage.getItem("__swayphicsWelcomeEventCount") || "0"),
      fullName: sessionStorage.getItem("__swayphicsWelcomeFullName"),
      pendingMarker: sessionStorage.getItem("swayphics_admin_welcome_pending"),
      animationCount: sessionStorage.getItem("__swayphicsWelcomeAnimationCount")
    }));
    assert.equal(firstWelcome.count, 1, "successful login must authorize exactly one welcome event");
    assert.equal(firstWelcome.fullName, "Isolated UI Test", "welcome event must use the active admin full name");
    assert.equal(firstWelcome.pendingMarker, null, "dashboard must consume the marker");
    assert.equal(firstWelcome.animationCount, "1", "new login must authorize one motion sequence");

    const welcomeToast = page.locator("#swayphics-admin-welcome");
    await welcomeToast.waitFor({ state: "attached", timeout: 5000 });
    const welcomeVisual = await welcomeToast.evaluate(node => ({
      headline: node.querySelector(".swayphics-welcome-title")?.textContent || "",
      subtitle: node.querySelector(".swayphics-welcome-subtitle")?.textContent || "",
      particles: node.querySelectorAll(".swayphics-welcome-particle").length,
      trails: node.querySelectorAll(".swayphics-welcome-light-trails span").length,
      pointerEvents: getComputedStyle(node).pointerEvents,
      position: getComputedStyle(node).position,
      isInsideHeader: node.parentElement?.classList.contains("admin-header-inner") === true,
      isAnimated: node.classList.contains("swayphics-welcome-animate"),
      motionState: node.getAttribute("data-motion-state"),
      entryAnimation: getComputedStyle(node).animationName,
      glintAnimation: getComputedStyle(node, "::before").animationName,
      glintDuration: getComputedStyle(node, "::before").animationDuration,
      trailAnimation: getComputedStyle(node.querySelector(".swayphics-welcome-light-trails span")).animationName,
      trailAnimationDuration: getComputedStyle(node.querySelector(".swayphics-welcome-light-trails span")).animationDuration,
      accessibleRole: node.getAttribute("role"),
      ariaLive: node.getAttribute("aria-live")
    }));
    assert.match(welcomeVisual.headline, /Isolated UI Test/, "visual greeting must use the active admin full name");
    assert.ok(welcomeVisual.subtitle.length > 0, "visual greeting must include its time-specific supporting line");
    assert.equal(welcomeVisual.particles, 14, "welcome visual must include the abstract particle layer");
    assert.equal(welcomeVisual.trails, 3, "welcome visual must include three light-trail elements");
    assert.equal(welcomeVisual.pointerEvents, "none", "welcome greeting must not block dashboard controls");
    assert.equal(welcomeVisual.isInsideHeader, true, "welcome greeting must be mounted inside the existing header");
    assert.notEqual(welcomeVisual.position, "fixed", "welcome greeting must not render as a separate viewport overlay");
    assert.equal(welcomeVisual.isAnimated, true, "a new login should animate when reduced motion is not requested");
    assert.equal(welcomeVisual.motionState, "animated", "welcome should report an active motion state");
    assert.notEqual(welcomeVisual.entryAnimation, "none", "welcome entry must have a real CSS animation");
    assert.notEqual(welcomeVisual.glintAnimation, "none", "welcome must include the broad animated glint sweep");
    assert.notEqual(welcomeVisual.glintDuration, "0s", "glint sweep must have a visible duration");
    assert.notEqual(welcomeVisual.trailAnimation, "none", "blue light trails must have a real CSS animation");
    assert.notEqual(welcomeVisual.trailAnimationDuration, "0s", "light-trail animation must have a visible duration");

    const getActiveWelcomeAnimations = () => welcomeToast.evaluate(node =>
      node.getAnimations({ subtree: true }).map(animation => ({
        name: animation.animationName,
        state: animation.playState,
        currentTime: Number(animation.currentTime || 0)
      }))
    );
    const animationsBefore = await getActiveWelcomeAnimations();
    assert.ok(
      animationsBefore.some(animation =>
        animation.name === "swayphics-welcome-glint" &&
        animation.state === "running"
      ),
      "the glint animation must actually be running, not merely declared in CSS"
    );
    await page.waitForTimeout(160);
    const animationsAfter = await getActiveWelcomeAnimations();
    const glintBefore = animationsBefore.find(animation => animation.name === "swayphics-welcome-glint");
    const glintAfter = animationsAfter.find(animation => animation.name === "swayphics-welcome-glint");
    assert.ok(glintBefore && glintAfter && glintAfter.currentTime > glintBefore.currentTime,
      "the glint animation timeline must advance while the greeting is visible");
    assert.equal(welcomeVisual.accessibleRole, "status", "welcome message must expose a status role");
    assert.equal(welcomeVisual.ariaLive, "polite", "welcome message must announce politely to assistive technology");

    // The welcome stylesheet must load after the large inline CSS block, and each
    // visible header item must occupy a deliberate grid area instead of auto-flowing.
    const desktopHeaderLayout = await page.evaluate(() => {
      const header = document.querySelector(".admin-header-inner");
      const rect = node => {
        const r = node.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
      };
      return {
        header: rect(header),
        brand: rect(header.querySelector(".admin-brand")),
        welcome: rect(header.querySelector(".swayphics-welcome-toast")),
        search: rect(header.querySelector(".admin-global-search")),
        controls: rect(header.querySelector(".admin-header-right")),
        toggleDisplay: getComputedStyle(header.querySelector(".admin-mobile-sidebar-toggle")).display,
        gridTemplateAreas: getComputedStyle(header).gridTemplateAreas,
        gridTemplateColumns: getComputedStyle(header).gridTemplateColumns
      };
    });
    const headEndIndex = dashboardHtmlSource.indexOf("</head>");
    const headSource = headEndIndex >= 0
      ? dashboardHtmlSource.slice(0, headEndIndex)
      : "";
    assert.ok(
      headSource.indexOf('admin-welcome.css?v=20261023-admin-welcome-layout-hotfix-1') >
        headSource.lastIndexOf("<style"),
      "welcome stylesheet reference must follow the dashboard inline style blocks in the head"
    );
    assert.equal(desktopHeaderLayout.toggleDisplay, "none",
      "mobile sidebar toggle must not become an extra desktop grid item");
    assert.ok(desktopHeaderLayout.gridTemplateAreas.includes("welcome"),
      "desktop header must reserve an explicit grid area for the greeting");
    const desktopHeaderItems = [
      desktopHeaderLayout.brand,
      desktopHeaderLayout.welcome,
      desktopHeaderLayout.search,
      desktopHeaderLayout.controls
    ].filter(item => item.width > 0).sort((a, b) => a.left - b.left);
    assert.equal(desktopHeaderItems.length, 4, "all four desktop header items must be visible");
    for (let index = 1; index < desktopHeaderItems.length; index += 1) {
      assert.ok(desktopHeaderItems[index - 1].right <= desktopHeaderItems[index].left + 1,
        "desktop header items must not overlap or pile up");
    }
    assert.ok(desktopHeaderItems.every(item =>
      item.left >= desktopHeaderLayout.header.left - 1 &&
      item.right <= desktopHeaderLayout.header.right + 1),
      "desktop header items must fit inside the header container");

    await page.setViewportSize({ width: 1024, height: 900 });
    const tabletHeaderLayout = await page.evaluate(() => {
      const header = document.querySelector(".admin-header-inner");
      const rect = node => {
        const r = node.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
      };
      return {
        header: rect(header),
        toggle: rect(header.querySelector(".admin-mobile-sidebar-toggle")),
        brand: rect(header.querySelector(".admin-brand")),
        welcome: rect(header.querySelector(".swayphics-welcome-toast")),
        search: rect(header.querySelector(".admin-global-search")),
        controls: rect(header.querySelector(".admin-header-right")),
        gridTemplateAreas: getComputedStyle(header).gridTemplateAreas
      };
    });
    assert.ok(tabletHeaderLayout.gridTemplateAreas.includes("toggle"),
      "tablet header must reserve a grid area for its sidebar toggle");
    assert.ok(tabletHeaderLayout.welcome.top >= tabletHeaderLayout.controls.bottom - 1,
      "tablet greeting must occupy a separate row below the controls");
    const tabletTopRow = [
      tabletHeaderLayout.toggle,
      tabletHeaderLayout.brand,
      tabletHeaderLayout.search,
      tabletHeaderLayout.controls
    ].filter(item => item.width > 0).sort((a, b) => a.left - b.left);
    for (let index = 1; index < tabletTopRow.length; index += 1) {
      assert.ok(tabletTopRow[index - 1].right <= tabletTopRow[index].left + 1,
        "tablet controls must not overlap horizontally");
    }

    // Verify readable copy in dark mode without depending on a screenshot.
    await page.locator("#admin-theme-toggle").click();
    await page.waitForFunction(() => document.body.classList.contains("sway-dark-mode"), undefined, { timeout: 5000 });
    const darkWelcomeColors = await welcomeToast.evaluate(node => ({
      title: getComputedStyle(node.querySelector(".swayphics-welcome-title")).color,
      subtitle: getComputedStyle(node.querySelector(".swayphics-welcome-subtitle")).color
    }));
    assert.equal(darkWelcomeColors.title, "rgb(247, 250, 255)", "dark-mode greeting title must stay light and readable");
    assert.equal(darkWelcomeColors.subtitle, "rgb(192, 203, 224)", "dark-mode supporting message must stay readable");
    await page.locator("#admin-theme-toggle").click();
    await page.waitForFunction(() => !document.body.classList.contains("sway-dark-mode"), undefined, { timeout: 5000 });

    // A routine token refresh must not emit or animate the welcome again.
    const refreshOutcome = await page.evaluate(async () => {
      if (typeof window.swayphicsRefreshAdminSession !== "function") {
        return { available: false, ok: false };
      }
      return {
        available: true,
        ok: await window.swayphicsRefreshAdminSession(true)
      };
    });
    assert.equal(refreshOutcome.available, true, "dashboard must expose the existing session refresh function");
    assert.equal(refreshOutcome.ok, true, "mocked refresh-token flow should succeed");
    const afterTokenRefresh = await page.evaluate(() => ({
      eventCount: Number(sessionStorage.getItem("__swayphicsWelcomeEventCount") || "0"),
      animationCount: Number(sessionStorage.getItem("__swayphicsWelcomeAnimationCount") || "0")
    }));
    assert.equal(afterTokenRefresh.eventCount, 1, "token refresh must not emit another welcome event");
    assert.equal(afterTokenRefresh.animationCount, 1, "token refresh must not replay the animation");

    // Routine SPA navigation must preserve the greeting without replaying its effects.
    const innerMeGroup = page.locator('[data-nav-group-toggle="innerme"]');
    if ((await innerMeGroup.getAttribute("aria-expanded")) !== "true") {
      await innerMeGroup.click();
    }
    await page.locator('[data-view="swayphics-ai"]').first().click();
    await page.locator("#sway-admin-workspace .sway-ai-panel").waitFor({ state: "visible", timeout: 15000 });
    const afterSpaNavigation = await page.evaluate(() => ({
      eventCount: Number(sessionStorage.getItem("__swayphicsWelcomeEventCount") || "0"),
      animationCount: Number(sessionStorage.getItem("__swayphicsWelcomeAnimationCount") || "0"),
      greetingVisible: Boolean(document.querySelector("#swayphics-admin-welcome")),
      effectsPresent: Boolean(document.querySelector("#swayphics-admin-welcome .swayphics-welcome-light-trails, #swayphics-admin-welcome .swayphics-welcome-particles"))
    }));
    assert.equal(afterSpaNavigation.eventCount, 1, "SPA navigation must not emit another welcome event");
    assert.equal(afterSpaNavigation.animationCount, 1, "SPA navigation must not replay the animation");
    assert.equal(afterSpaNavigation.greetingVisible, true, "greeting should remain in the persistent dashboard header");
    assert.equal(afterSpaNavigation.animationCount, 1, "SPA navigation must not create another animation even if the original effects have already cleaned up");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#sway-admin-workspace .sway-workspace-shell", { timeout: 30000 });
    await page.waitForTimeout(700);
    const afterRefresh = await page.evaluate(() => ({
      eventCount: Number(sessionStorage.getItem("__swayphicsWelcomeEventCount") || "0"),
      animationCount: Number(sessionStorage.getItem("__swayphicsWelcomeAnimationCount") || "0"),
      headline: document.querySelector("#swayphics-admin-welcome .swayphics-welcome-title")?.textContent || "",
      isInsideHeader: document.querySelector("#swayphics-admin-welcome")?.parentElement?.classList.contains("admin-header-inner") === true,
      motionLayersPresent: Boolean(document.querySelector("#swayphics-admin-welcome .swayphics-welcome-light-trails, #swayphics-admin-welcome .swayphics-welcome-particles"))
    }));
    assert.equal(afterRefresh.eventCount, 2, "a validated refresh may render static greeting copy again");
    assert.equal(afterRefresh.animationCount, 1, "refresh must not replay the welcome animation");
    assert.match(afterRefresh.headline, /Isolated UI Test/, "static greeting remains visible after refresh");
    assert.equal(afterRefresh.isInsideHeader, true, "static greeting remains inside the existing header");
    assert.equal(afterRefresh.motionLayersPresent, false, "refresh should not recreate animation layers without a new login marker");

    await page.evaluate(() => {
      sessionStorage.setItem(
        "swayphics_admin_welcome_pending",
        JSON.stringify({
          version: 1,
          userId: "11111111-1111-4111-8111-111111111111",
          issuedAt: Date.now()
        })
      );
    });
    await page.locator("#logout-button").click();
    await page.waitForURL(url => url.pathname === "/admin/" || url.pathname === "/admin", { timeout: 10000 });

    const afterLogout = await page.evaluate(() => ({
      pendingMarker: sessionStorage.getItem("swayphics_admin_welcome_pending"),
      accessToken: localStorage.getItem("swayphics_admin_access_token"),
      refreshToken: localStorage.getItem("swayphics_admin_refresh_token")
    }));
    assert.equal(afterLogout.pendingMarker, null, "logout must clear any pending marker");
    assert.equal(afterLogout.accessToken, null, "logout must clear the access token");
    assert.equal(afterLogout.refreshToken, null, "logout must clear the refresh token");

    await page.evaluate(() => {
      sessionStorage.setItem("swayphics_admin_welcome_pending", "stale-marker");
    });
    await page.locator("#admin-email").fill("invalid-login@example.invalid");
    await page.locator("#admin-password").fill("bad-password");
    await page.locator("#login-button").click();
    await page.locator("#login-status").waitFor({ state: "visible", timeout: 5000 });

    const failedLogin = await page.evaluate(() => ({
      currentPath: window.location.pathname,
      pendingMarker: sessionStorage.getItem("swayphics_admin_welcome_pending"),
      status: document.getElementById("login-status").textContent
    }));
    assert.equal(failedLogin.currentPath, "/admin/", "failed login must not redirect to dashboard");
    assert.equal(failedLogin.pendingMarker, null, "failed login must not retain a stale marker");
    assert.match(failedLogin.status, /Synthetic invalid login/i);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#admin-email").fill("welcome-test@example.invalid");
    await page.locator("#admin-password").fill("mocked-password");
    await Promise.all([
      page.waitForURL(url => url.pathname.startsWith("/admin-dashboard/"), { timeout: 15000 }),
      page.locator("#login-button").click()
    ]);
    await page.waitForSelector("#sway-admin-workspace .sway-workspace-shell", { timeout: 30000 });
    const reducedMotionGreeting = page.locator("#swayphics-admin-welcome");
    await reducedMotionGreeting.waitFor({ state: "attached", timeout: 5000 });
    const reducedMotionVisual = await reducedMotionGreeting.evaluate(node => ({
      headline: node.querySelector(".swayphics-welcome-title")?.textContent || "",
      isInsideHeader: node.parentElement?.classList.contains("admin-header-inner") === true,
      isAnimated: node.classList.contains("swayphics-welcome-animate"),
      particles: node.querySelectorAll(".swayphics-welcome-particle").length,
      trails: node.querySelectorAll(".swayphics-welcome-light-trails span").length
    }));
    assert.match(reducedMotionVisual.headline, /Isolated UI Test/, "reduced-motion mode still shows greeting copy");
    assert.equal(reducedMotionVisual.isInsideHeader, true, "reduced-motion greeting stays in the header");
    assert.equal(reducedMotionVisual.isAnimated, false, "reduced-motion mode must suppress the animation class");
    assert.equal(reducedMotionVisual.particles, 0, "reduced-motion mode must omit particles");
    assert.equal(reducedMotionVisual.trails, 0, "reduced-motion mode must omit light trails");

    metrics.scenarios.push({
      name: "admin-welcome-authentication",
      status: "passed",
      loginCreatesOneWelcomeEvent: true,
      activeAdminFullName: firstWelcome.fullName,
      markerConsumed: true,
      welcomeAnimationRendered: true,
      greetingUsesActiveAdminName: true,
      particleAndLightTrailLayersPresent: true,
      refreshDoesNotReplay: true,
      staticGreetingPersistsAfterRefresh: true,
      headerPlacementVerified: true,
      reducedMotionSuppressesEffects: true,
      logoutClearsMarkerAndTokens: true,
      failedLoginClearsStaleMarker: true
    });
  } finally {
    await context.close();
  }
}

async function main() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  try {
    const desktopContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      serviceWorkers: "block",
      permissions: ["clipboard-read", "clipboard-write"]
    });
    await configureIsolatedContext(desktopContext, "overview", "light");
    const desktopPage = await desktopContext.newPage();
    desktopPage.on("pageerror", error => metrics.pageErrors.push("desktop: " + error.message));
    desktopPage.on("request", request => {
      const url = new URL(request.url());
      if (!["127.0.0.1", "localhost", "sqifhribgsqfaxgtobsa.supabase.co", "cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)) {
        metrics.unexpectedExternalRequests.push(request.url());
      }
    });

    await openChat(desktopPage, "overview");
    const desktopSize = await assertNoHorizontalOverflow(desktopPage, "Desktop");
    const desktopLayout = await desktopPage.locator(".sway-ai-panel").evaluate(el => {
      const rect = el.getBoundingClientRect();
      const conversation = document.querySelector("#sway-ai-conversation");
      const composer = document.querySelector("#sway-ai-form");
      return {
        panelWidth: Math.round(rect.width),
        panelHeight: Math.round(rect.height),
        panelLeft: Math.round(rect.left),
        panelRight: Math.round(rect.right),
        conversationScrollable: getComputedStyle(conversation).overflowY,
        composerVisible: !!composer && composer.getBoundingClientRect().height > 0
      };
    });
    assert.ok(desktopLayout.panelLeft >= -1 && desktopLayout.panelRight <= 1441, "Desktop chat panel should fit its viewport");
    assert.ok(desktopLayout.composerVisible, "Desktop composer should be visible");
    assert.ok(["auto", "scroll"].includes(desktopLayout.conversationScrollable), "Chat transcript should have independent vertical scrolling");

    const desktopInteractions = await askMockedQuestion(desktopPage);
    const edgeCaseInteractions = await verifyKeyboardAndFallbackPaths(desktopPage, metrics);
    await desktopPage.screenshot({ path: path.join(ARTIFACT_DIR, "desktop-light-response.png") });

    await desktopPage.locator("#sway-ai-more-toggle").click();
    const newChat = desktopPage.locator("#sway-ai-new-chat");
    await newChat.waitFor({ state: "visible" });
    await newChat.click();
    const confirmDialog = desktopPage.locator(".sway-dialog");
    await confirmDialog.waitFor({ state: "visible", timeout: 5000 });
    await confirmDialog.locator("[data-dialog-confirm]").click();
    await assertNoHorizontalOverflow(desktopPage, "Desktop after New chat");
    assert.equal(
      await desktopPage.locator("#sway-ai-conversation").getByText("Browser smoke answer").count(),
      0,
      "New chat should clear the active visible transcript"
    );
    await desktopPage.locator("#admin-theme-toggle").click();
    assert.ok(await desktopPage.locator("body").evaluate(el => el.classList.contains("sway-dark-mode")), "Theme toggle should activate dark mode");
    await desktopPage.screenshot({ path: path.join(ARTIFACT_DIR, "desktop-dark-new-chat.png") });
    metrics.scenarios.push({
      name: "desktop-light-to-dark",
      status: "passed",
      viewport: "1440x900",
      overflow: desktopSize,
      layout: desktopLayout,
      interactions: desktopInteractions,
      edgeCases: edgeCaseInteractions,
      newChatClearsTranscript: true,
      darkModeToggle: true
    });
    await desktopContext.close();

    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      serviceWorkers: "block",
      permissions: ["clipboard-read", "clipboard-write"]
    });
    await configureIsolatedContext(mobileContext, "swayphics-ai", "light");
    const mobilePage = await mobileContext.newPage();
    mobilePage.on("pageerror", error => metrics.pageErrors.push("mobile: " + error.message));
    mobilePage.on("request", request => {
      const url = new URL(request.url());
      if (!["127.0.0.1", "localhost", "sqifhribgsqfaxgtobsa.supabase.co", "cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)) {
        metrics.unexpectedExternalRequests.push(request.url());
      }
    });

    await openChat(mobilePage, "swayphics-ai");
    const mobileWelcome = mobilePage.locator("#swayphics-admin-welcome");
    await mobileWelcome.waitFor({ state: "attached", timeout: 10000 });
    const mobileWelcomeLayout = await mobilePage.evaluate(() => {
      const header = document.querySelector(".admin-header-inner");
      const outerHeader = document.querySelector(".admin-header");
      const main = document.querySelector(".admin-main");
      const greeting = document.querySelector("#swayphics-admin-welcome");
      const search = header && header.querySelector(".admin-global-search");
      const controls = header && header.querySelector(".admin-header-right");
      const rect = node => {
        const r = node.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
      };
      return {
        bodyClass: document.body.className,
        header: rect(header),
        outerHeader: rect(outerHeader),
        main: rect(main),
        outerHeaderPaddingBottom: getComputedStyle(outerHeader).paddingBottom,
        greeting: rect(greeting),
        search: rect(search),
        controls: rect(controls),
        searchDisplay: getComputedStyle(search).display,
        searchPosition: getComputedStyle(search).position,
        searchInputDisplay: getComputedStyle(search.querySelector("#admin-global-search-input")).display,
        insideHeader: greeting.parentElement === header
      };
    });
    assert.equal(mobileWelcomeLayout.insideHeader, true, "mobile greeting must remain in the existing header");
    assert.notEqual(mobileWelcomeLayout.searchDisplay, "none", "global search must remain visible with the welcome greeting on mobile");
    assert.notEqual(mobileWelcomeLayout.searchInputDisplay, "none", "mobile search input must remain visible");
    assert.notEqual(mobileWelcomeLayout.searchPosition, "absolute", "mobile search must participate in the greeting-aware header layout");
    assert.ok(mobileWelcomeLayout.greeting.width > 0, "mobile greeting must have a non-zero layout width");
    assert.ok(mobileWelcomeLayout.search.width > 0, "mobile search must have a non-zero layout width");
    assert.ok(mobileWelcomeLayout.greeting.bottom <= mobileWelcomeLayout.search.top + 1, "mobile greeting and search must occupy separate rows");
    assert.ok(mobileWelcomeLayout.controls.right <= mobileWelcomeLayout.header.right + 1, "mobile header controls must stay inside the header");
    assert.equal(mobileWelcomeLayout.outerHeaderPaddingBottom, "12px", "welcome-aware mobile header must remove the legacy 62px search spacer");
    assert.ok(
      mobileWelcomeLayout.main.top - mobileWelcomeLayout.outerHeader.bottom <= 2,
      "mobile main content must begin directly after the expanded header, without a reserved search spacer: " +
        JSON.stringify({ header: mobileWelcomeLayout.outerHeader, main: mobileWelcomeLayout.main })
    );
    const mobileSize = await assertNoHorizontalOverflow(mobilePage, "Mobile with welcome greeting");
    const mobileLayout = await mobilePage.locator(".sway-ai-panel").evaluate(el => {
      const rect = el.getBoundingClientRect();
      const composer = document.querySelector("#sway-ai-form");
      const input = document.querySelector("#sway-ai-input");
      const send = document.querySelector("#sway-ai-send");
      return {
        panelWidth: Math.round(rect.width),
        panelLeft: Math.round(rect.left),
        panelRight: Math.round(rect.right),
        inputWidth: Math.round(input.getBoundingClientRect().width),
        sendButtonWidth: Math.round(send.getBoundingClientRect().width),
        composerVisible: !!composer && composer.getBoundingClientRect().height > 0
      };
    });
    assert.ok(mobileLayout.panelLeft >= -1 && mobileLayout.panelRight <= 391, "Mobile chat panel should fit its viewport");
    assert.ok(mobileLayout.inputWidth > 100, "Mobile composer input should remain usable");
    assert.ok(mobileLayout.composerVisible, "Mobile composer should remain visible");

    await mobilePage.locator("#admin-theme-toggle").click();
    await mobilePage.waitForFunction(() => document.body.classList.contains("sway-dark-mode"), undefined, { timeout: 5000 });
    const mobileDarkColors = await mobileWelcome.evaluate(node => ({
      title: getComputedStyle(node.querySelector(".swayphics-welcome-title")).color,
      subtitle: getComputedStyle(node.querySelector(".swayphics-welcome-subtitle")).color
    }));
    assert.equal(mobileDarkColors.title, "rgb(247, 250, 255)", "mobile dark-mode greeting title must remain readable");
    assert.equal(mobileDarkColors.subtitle, "rgb(192, 203, 224)", "mobile dark-mode supporting text must remain readable");
    await mobilePage.locator("#admin-theme-toggle").click();
    await mobilePage.waitForFunction(() => !document.body.classList.contains("sway-dark-mode"), undefined, { timeout: 5000 });

    await mobilePage.setViewportSize({ width: 320, height: 780 });
    const narrowMobileSize = await assertNoHorizontalOverflow(mobilePage, "Narrow mobile with welcome greeting");
    const narrowGeometry = await mobilePage.evaluate(() => {
      const header = document.querySelector(".admin-header-inner");
      const outerHeader = document.querySelector(".admin-header");
      const main = document.querySelector(".admin-main");
      const greeting = document.querySelector("#swayphics-admin-welcome");
      const search = header && header.querySelector(".admin-global-search");
      const controls = header && header.querySelector(".admin-header-right");
      const rect = node => {
        const r = node.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
      };
      return {
        header: rect(header),
        outerHeader: rect(outerHeader),
        main: rect(main),
        outerHeaderPaddingBottom: getComputedStyle(outerHeader).paddingBottom,
        greeting: rect(greeting),
        search: rect(search),
        controls: rect(controls)
      };
    });
    assert.ok(narrowGeometry.greeting.width > 0 && narrowGeometry.search.width > 0, "greeting and search must remain visible at 320px");
    assert.ok(narrowGeometry.greeting.bottom <= narrowGeometry.search.top + 1, "greeting and search must not overlap at 320px");
    assert.ok(narrowGeometry.controls.right <= narrowGeometry.header.right + 1, "header controls must stay inside the 320px header");
    assert.equal(narrowGeometry.outerHeaderPaddingBottom, "12px", "320px welcome header must not retain the legacy spacer");
    assert.ok(narrowGeometry.main.top - narrowGeometry.outerHeader.bottom <= 2, "320px content must start directly after the header");

    const mobileInteractions = await askMockedQuestion(mobilePage);
    const composerStatusLayout = await mobilePage.evaluate(() => {
      const form = document.querySelector("#sway-ai-form");
      const row = document.querySelector(".sway-ai-composer-row");
      const status = document.querySelector("#sway-ai-composer-status");
      const rowRect = row.getBoundingClientRect();
      const statusRect = status.getBoundingClientRect();
      return {
        formDirection: getComputedStyle(form).flexDirection,
        rowBottom: Math.round(rowRect.bottom),
        rowWidth: Math.round(rowRect.width),
        statusTop: Math.round(statusRect.top),
        statusHeight: Math.round(statusRect.height),
        statusWidth: Math.round(statusRect.width),
        statusText: String(status.textContent || "").trim()
      };
    });
    assert.equal(composerStatusLayout.formDirection, "column", "Mobile composer status must stack below the input row");
    if (composerStatusLayout.statusText) {
      assert.ok(
        composerStatusLayout.statusTop >= composerStatusLayout.rowBottom - 1,
        "Mobile live status must not overlap the input row: " + JSON.stringify(composerStatusLayout)
      );
      assert.ok(
        composerStatusLayout.statusWidth >= composerStatusLayout.rowWidth - 4,
        "Mobile live status must use the full composer width: " + JSON.stringify(composerStatusLayout)
      );
    }
    await mobilePage.screenshot({ path: path.join(ARTIFACT_DIR, "mobile-light-response.png") });
    await mobilePage.emulateMedia({ reducedMotion: "reduce" });
    const reducedMotion = await mobilePage.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    assert.equal(reducedMotion, true, "Reduced-motion media preference should be available to the UI");
    metrics.scenarios.push({
      name: "mobile-light",
      status: "passed",
      viewport: "390x844",
      welcomeHeaderLayout: mobileWelcomeLayout,
      narrowViewport: { width: 320, overflow: narrowMobileSize, geometry: narrowGeometry },
      darkModeGreetingReadable: true,
      overflow: mobileSize,
      layout: mobileLayout,
      interactions: mobileInteractions,
      composerStatus: composerStatusLayout,
      reducedMotionPreference: reducedMotion
    });
    await mobileContext.close();

    await testWelcomeAuthBrowserFlow(browser, metrics);

    assert.equal(metrics.pageErrors.length, 0, "Browser must not produce uncaught page errors: " + metrics.pageErrors.join("; "));
    assert.equal(metrics.unexpectedExternalRequests.length, 0, "Browser attempted an unapproved external request: " + metrics.unexpectedExternalRequests.join(", "));
    assert.ok(metrics.mockedChatRequests >= 2, "Desktop and mobile should both exercise mocked streaming");

    fs.writeFileSync(path.join(ARTIFACT_DIR, "browser-smoke-results.json"), JSON.stringify(metrics, null, 2));
    process.stdout.write("INNERME_CHAT_BROWSER_SMOKE=PASS\n" + JSON.stringify(metrics, null, 2) + "\n");
  } catch (error) {
    fs.writeFileSync(path.join(ARTIFACT_DIR, "browser-smoke-results.json"), JSON.stringify({
      ...metrics,
      failure: String(error && error.stack || error)
    }, null, 2));
    process.stderr.write("INNERME_CHAT_BROWSER_SMOKE=FAIL\n" + String(error && error.stack || error) + "\n");
    process.stderr.write(JSON.stringify(metrics, null, 2) + "\n");
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
