const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const BASE_URL = "http://127.0.0.1:4173/admin-dashboard/index.html";
const SUPABASE_ORIGIN = "https://sqifhribgsqfaxgtobsa.supabase.co";
const TEST_USER_ID = "11111111-1111-4111-8111-111111111111";
const ARTIFACT_DIR = path.resolve("artifacts/innerme-chat-browser-smoke");

const markdownAnswer = [
  "## Browser smoke answer",
  "",
  "A **bold** result and a [safe link](https://example.com/docs).",
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
  mockedProviderRequests: 0,
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

function sseFrame(name, payload) {
  return "event: " + name + "\ndata: " + JSON.stringify(payload) + "\n\n";
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

async function configureIsolatedContext(context, initialView, theme) {
  await context.addInitScript(({ testUserId, view, storedTheme }) => {
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
    localStorage.setItem("swayphics_admin_access_token", header + "." + encoded + ".ui-smoke-signature");
    localStorage.setItem("swayphics_admin_current_view", view);
    localStorage.setItem("swayphics_admin_theme", storedTheme);
    localStorage.removeItem("swayphics_admin_workspace_snapshot_" + testUserId);
    localStorage.removeItem("swayphics_admin_innerme_conversation_" + testUserId);
    localStorage.removeItem("swayphics_admin_innerme_sessions_" + testUserId);
  }, {
    testUserId: TEST_USER_ID,
    view: initialView,
    storedTheme: theme
  });

  await context.route(SUPABASE_ORIGIN + "/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();

    if (url.pathname === "/functions/v1/swayphics-ai" && method === "POST") {
      const postData = request.postDataJSON() || {};
      if (postData.stream_response === true) {
        metrics.mockedProviderRequests += 1;
        return route.fulfill({
          status: 200,
          contentType: "text/event-stream; charset=utf-8",
          headers: {
            "Cache-Control": "no-cache, no-transform",
            "X-InnerMe-Request-ID": "ui-smoke-mocked-request"
          },
          body: buildSseResponse()
        });
      }
      return route.fulfill(responseJson({ answer: markdownAnswer, read_only: true }));
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
        active: true,
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

  return {
    renderedHeading: true,
    renderedListItems: 2,
    renderedSafeLink: true,
    renderedCodeBlock: true,
    renderedTable: true,
    untrustedHtmlEscaped: true,
    unsafeLinkBlocked: true,
    codeCopyPreservedWhitespace: true
  };
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
    const mobileSize = await assertNoHorizontalOverflow(mobilePage, "Mobile");
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
      overflow: mobileSize,
      layout: mobileLayout,
      interactions: mobileInteractions,
      composerStatus: composerStatusLayout,
      reducedMotionPreference: reducedMotion
    });
    await mobileContext.close();

    assert.equal(metrics.pageErrors.length, 0, "Browser must not produce uncaught page errors: " + metrics.pageErrors.join("; "));
    assert.equal(metrics.unexpectedExternalRequests.length, 0, "Browser attempted an unapproved external request: " + metrics.unexpectedExternalRequests.join(", "));
    assert.ok(metrics.mockedProviderRequests >= 2, "Desktop and mobile should both exercise mocked streaming");

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
