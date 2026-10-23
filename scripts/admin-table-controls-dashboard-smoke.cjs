"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const BASE_URL = "http://127.0.0.1:4173/admin-dashboard/index.html";
const SUPABASE_ORIGIN = "https://sqifhribgsqfaxgtobsa.supabase.co";
const TEST_USER_ID = "11111111-1111-4111-8111-111111111111";
const ARTIFACT_DIR = path.resolve("artifacts/admin-table-controls-dashboard");
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

const leads = [
  {
    id: "lead-alpha", business_name: "Alpha Studio", contact_name: "Sam Dube",
    email: '=HYPERLINK("https://example.invalid","Open")', phone: "0000000000",
    service_interest: "Website", status: "new", source: "Referral",
    estimated_value: 1500, next_follow_up: "2026-11-03",
    created_at: "2026-10-01T12:00:00Z"
  },
  {
    id: "lead-zulu", business_name: "Zulu Market", contact_name: "Lee Mokoena",
    email: "lee@example.invalid", phone: "0000000001", service_interest: "Branding",
    status: "qualified", source: "Website", estimated_value: 4500,
    next_follow_up: "2026-10-25", created_at: "2026-10-02T12:00:00Z"
  },
  {
    id: "lead-bravo", business_name: "Bravo Cafe", contact_name: "Ana Ndlovu",
    email: "ana@example.invalid", phone: "0000000002", service_interest: "Logo",
    status: "new", source: "Instagram", estimated_value: 900,
    next_follow_up: "2026-10-27", created_at: "2026-10-03T12:00:00Z"
  }
];

const tasks = [
  {
    id: "task-low", title: "Prepare proposal", description: "Draft a website proposal",
    status: "pending", priority: "low", due_date: "2026-11-01",
    assigned_to: TEST_USER_ID, client_id: null, created_at: "2026-10-01T12:00:00Z"
  },
  {
    id: "task-urgent", title: "Confirm scope", description: "Confirm project scope",
    status: "pending", priority: "urgent", due_date: "2026-10-26",
    assigned_to: TEST_USER_ID, client_id: null, created_at: "2026-10-02T12:00:00Z"
  },
  {
    id: "task-done", title: "Send invoice", description: "Prepare invoice draft",
    status: "completed", priority: "high", due_date: "2026-10-24",
    assigned_to: TEST_USER_ID, client_id: null, created_at: "2026-10-03T12:00:00Z"
  }
];

const followups = [
  {
    id: "follow-later", lead_id: "lead-alpha", client_id: null, channel: "Email",
    status: "pending", scheduled_for: "2026-11-02", assigned_to: TEST_USER_ID,
    notes: "Send follow-up"
  },
  {
    id: "follow-sooner", lead_id: "lead-bravo", client_id: null, channel: "WhatsApp",
    status: "pending", scheduled_for: "2026-10-24", assigned_to: TEST_USER_ID,
    notes: "Check interest"
  },
  {
    id: "follow-done", lead_id: "lead-zulu", client_id: null, channel: "Email",
    status: "completed", scheduled_for: "2026-10-23", assigned_to: TEST_USER_ID,
    notes: "Already contacted"
  }
];

const metrics = {
  apiReads: 0,
  apiMutationsBlocked: [],
  mockedStartupCalls: [],
  unexpectedExternalRequests: [],
  pageErrors: [],
  consoleErrors: []
};

const defaultServiceNames = [
  "Logo", "Flyer / Poster", "Letterhead", "Company Registration",
  "Business Identity Kit", "Packaging", "Apparel", "Business Card",
  "Social Media Management", "Google Business Profile Setup",
  "Professional Email Setup", "Appointment / Booking Setup", "Website Design"
];

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return {
    status,
    contentType: "application/json; charset=utf-8",
    headers: {
      "Access-Control-Allow-Origin": "http://127.0.0.1:4173",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "apikey,authorization,content-type,prefer,x-client-info",
      "Access-Control-Max-Age": "600",
      ...extraHeaders
    },
    body: JSON.stringify(body)
  };
}

function testToken() {
  const base64url = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  return base64url({ alg: "HS256", typ: "JWT" }) + "." +
    base64url({
      sub: TEST_USER_ID, email: "admin-ui-test@example.invalid",
      role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600
    }) + ".isolated-test-signature";
}

function dataFor(url) {
  if (url.pathname === "/auth/v1/user") {
    return { id: TEST_USER_ID, email: "admin-ui-test@example.invalid", role: "authenticated" };
  }
  if (url.pathname === "/rest/v1/admin_users") {
    return [{
      user_id: TEST_USER_ID, full_name: "Isolated Dashboard Test",
      email: "admin-ui-test@example.invalid", role: "owner", active: true,
      created_at: "2026-01-01T00:00:00Z"
    }];
  }
  if (url.pathname === "/rest/v1/leads") return leads;
  if (url.pathname === "/rest/v1/tasks") return tasks;
  if (url.pathname === "/rest/v1/follow_ups") return followups;
  if (url.pathname === "/rest/v1/clients") return [];
  if (url.pathname === "/rest/v1/client_projects") return [];
  if (url.pathname === "/rest/v1/quotes") return [];
  if (url.pathname === "/rest/v1/payments") return [];
  if (url.pathname === "/rest/v1/website_enquiries") return [];
  if (url.pathname === "/rest/v1/activity_log") return [];
  if (url.pathname === "/rest/v1/site_announcements") return [];
  if (url.pathname === "/rest/v1/invoices") return [];
  if (url.pathname === "/rest/v1/services") {
    // Supply the dashboard's existing catalogue so startup does not try to
    // create default services against any real backend.
    return defaultServiceNames.map((name, index) => ({
      id: "service-ui-test-" + (index + 1), name, active: true,
      category: "Synthetic test data", pricing_type: "fixed",
      default_price: 0, minimum_price: 0, maximum_price: 0,
      price_label: "Test only", recurring_interval: "none"
    }));
  }
  if (url.pathname === "/rest/v1/invoice_settings") return [];
  if (url.pathname === "/rest/v1/client_portal_requests") return [];
  if (url.pathname === "/rest/v1/lead_proposals") return [];
  if (url.pathname === "/rest/v1/client_documents") return [];
  if (url.pathname === "/rest/v1/communication_logs") return [];
  if (url.pathname === "/rest/v1/lead_stage_history") return [];
  if (url.pathname === "/rest/v1/client_portal_tokens") return [];
  if (url.pathname === "/rest/v1/admin_notifications") return [];
  if (url.pathname.startsWith("/rest/v1/")) return [];
  if (url.pathname.startsWith("/functions/v1/")) return { ok: true, items: [] };
  if (url.pathname.startsWith("/storage/v1/")) return [];
  if (url.pathname.startsWith("/auth/v1/")) return {};
  return {};
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1365, height: 1000 },
    acceptDownloads: true
  });

  await context.addInitScript(({ token }) => {
    localStorage.setItem("swayphics_admin_access_token", token);
    localStorage.setItem("swayphics_admin_current_view", "overview");
    localStorage.setItem("swayphics_admin_theme", "light");
    localStorage.removeItem("swayphics_admin_workspace_snapshot_" + "11111111-1111-4111-8111-111111111111");
  }, { token: testToken() });

  // Route all requests before they can leave the test browser. Only the local
  // static branch and the explicit Supabase mock below are allowed to respond.
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();

    if (url.origin === "http://127.0.0.1:4173") {
      return route.continue();
    }

    if (url.origin !== SUPABASE_ORIGIN) {
      // The admin shell references these static providers for fonts and the
      // optional Supabase browser bundle. Block them rather than fetching.
      const knownStaticOrigins = new Set([
        "https://fonts.googleapis.com",
        "https://fonts.gstatic.com",
        "https://cdn.jsdelivr.net"
      ]);
      if (!knownStaticOrigins.has(url.origin)) {
        metrics.unexpectedExternalRequests.push({ method, url: request.url() });
      }
      return route.abort();
    }

    if (method === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "http://127.0.0.1:4173",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "apikey,authorization,content-type,prefer,x-client-info",
          "Access-Control-Max-Age": "600"
        },
        body: ""
      });
    }

    if (method !== "GET" && method !== "HEAD") {
      // These three dashboard startup routines normally make a POST call.
      // Intercept and stub them before the request can reach Supabase. They
      // are not part of table-control interactions and must never touch data
      // in this isolated browser run.
      if (method === "POST" && url.pathname === "/rest/v1/rpc/generate_admin_due_notifications") {
        metrics.mockedStartupCalls.push({ method, path: url.pathname });
        return route.fulfill({
          status: 204,
          headers: { "Access-Control-Allow-Origin": "http://127.0.0.1:4173" },
          body: ""
        });
      }
      if (method === "POST" && url.pathname === "/rest/v1/rpc/process_swayphics_stale_leads") {
        metrics.mockedStartupCalls.push({ method, path: url.pathname });
        return route.fulfill(jsonResponse([]));
      }
      if (method === "POST" && url.pathname === "/rest/v1/services") {
        metrics.mockedStartupCalls.push({ method, path: url.pathname });
        return route.fulfill({
          status: 204,
          headers: { "Access-Control-Allow-Origin": "http://127.0.0.1:4173" },
          body: ""
        });
      }
      metrics.apiMutationsBlocked.push({ method, path: url.pathname });
      return route.fulfill(jsonResponse({ error: "Read-only dashboard browser test: unexpected mutations are disabled." }, 405));
    }

    metrics.apiReads += 1;
    return route.fulfill(jsonResponse(dataFor(url)));
  });

  const page = await context.newPage();
  page.on("pageerror", error => metrics.pageErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") metrics.consoleErrors.push(message.text());
  });

  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.locator("#sway-admin-workspace .sway-workspace-shell").waitFor({ timeout: 30000 });
    await page.locator("#sway-workspace-main").waitFor({ timeout: 30000 });

    async function navigate(view, group) {
      const toggle = page.locator('[data-nav-group-toggle="' + group + '"]').first();
      if (await toggle.count()) {
        await toggle.waitFor({ state: "visible", timeout: 10000 });
        if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
      }
      const button = page.locator('[data-view="' + view + '"]').first();
      await button.waitFor({ state: "visible", timeout: 15000 });
      await button.click();
      await page.locator('[data-admin-table-search-input="' + view + '"]').waitFor({
        state: "visible", timeout: 20000
      });
      await page.locator('[data-admin-table-row="' + view + '"]').first().waitFor({ timeout: 10000 });
    }

    await navigate("leads", "crm");
    const leadView = page.locator("#sway-workspace-main");
    const leadRows = leadView.locator('[data-admin-table-row="leads"]');
    assert.equal(await leadRows.count(), 3, "the actual Leads view should render all synthetic lead records");

    await leadView.locator('[data-admin-table-search-input="leads"]').fill("lee@example.invalid");
    const visibleLeadRows = leadView.locator('[data-admin-table-row="leads"]:visible');
    assert.equal(await visibleLeadRows.count(), 1,
      "the actual dashboard should show only one lead after email search");
    assert.equal(await visibleLeadRows.filter({ hasText: "Zulu Market" }).count(), 1,
      "the actual dashboard should search lead emails");
    assert.equal(await visibleLeadRows.filter({ hasText: "Alpha Studio" }).count(), 0,
      "the actual dashboard should hide non-matching lead rows");

    await leadView.locator('[data-admin-table-search-input="leads"]').fill("");
    await leadView.locator('[data-admin-table-filter="leads"]').selectOption("new");
    assert.equal(await leadRows.filter({ visible: true }).count(), 2,
      "the actual dashboard should filter leads by status");
    await leadView.locator('[data-admin-table-filter="leads"]').selectOption("all");
    await leadView.locator('[data-admin-table-sort="leads"]').selectOption("business_asc");
    assert.ok((await leadRows.first().innerText()).includes("Alpha Studio"),
      "the actual dashboard should sort lead rows by business name");

    await leadView.locator('[data-admin-table-search-input="leads"]').fill("alpha");
    await leadView.locator('[data-admin-table-select-all="leads"]').check();
    assert.ok((await leadView.locator('[data-admin-table-selected-count="leads"]').innerText()).includes("1 selected"),
      "select-all should select only currently visible rows");

    const [csvDownload] = await Promise.all([
      page.waitForEvent("download"),
      leadView.locator('[data-admin-table-bulk-action="export"]').click()
    ]);
    const csvPath = await csvDownload.path();
    assert.ok(csvPath, "selected lead export should create a file");
    const csv = fs.readFileSync(csvPath, "utf8");
    assert.ok(csv.includes('"\'=HYPERLINK(""https://example.invalid"",""Open"")"'),
      "CSV export should neutralise formula-like values in the actual dashboard flow");

    await leadView.locator('[data-admin-table-clear-selection="leads"]').click();
    assert.equal(await leadView.locator('[data-admin-table-bulk-toolbar="leads"]').isVisible(), false,
      "clear selection should hide the bulk toolbar");
    await leadView.locator('[data-admin-table-search-input="leads"]').fill("");
    // Allow the dashboard's initial visual intro to finish before saving screenshots.
    await page.waitForTimeout(11000);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "dashboard-leads-desktop.png"), fullPage: true });

    await navigate("followups", "crm");
    const followupRows = page.locator('#sway-workspace-main [data-admin-table-row="followups"]');
    assert.equal(await followupRows.count(), 3, "the actual Follow-ups view should render synthetic follow-ups");
    await page.locator('[data-admin-table-filter="followups"]').selectOption("pending");
    assert.equal(await followupRows.filter({ visible: true }).count(), 2,
      "the actual Follow-ups view should filter pending records");

    await navigate("tasks", "delivery");
    const taskRows = page.locator('#sway-workspace-main [data-admin-table-row="tasks"]');
    assert.equal(await taskRows.count(), 3, "the actual Tasks view should render synthetic tasks");
    await page.locator('[data-admin-table-sort="tasks"]').selectOption("priority_desc");
    assert.ok((await taskRows.first().innerText()).includes("Confirm scope"),
      "the actual Tasks view should sort urgent priority first");
    await page.locator('[data-admin-table-filter="tasks"]').selectOption("pending");
    assert.equal(await taskRows.filter({ visible: true }).count(), 2,
      "the actual Tasks view should filter pending tasks");
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "dashboard-tasks-desktop.png"), fullPage: true });

    // Keep the real Tasks view open while shrinking the viewport. The dashboard
    // sidebar intentionally becomes off-canvas on mobile, so this isolates the
    // table-control layout without forcing navigation behind the mobile menu.
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileWorkspace = page.locator("#sway-admin-workspace");
    const mobileSidebar = page.locator("#sway-admin-workspace .sway-workspace-sidebar");
    const mobileToggle = page.locator(".admin-mobile-sidebar-toggle").first();
    await mobileToggle.waitFor({ state: "visible" });
    const mobileMenuIsOpen = await page.evaluate(() => {
      const workspace = document.getElementById("sway-admin-workspace");
      const sidebar = workspace && workspace.querySelector(".sway-workspace-sidebar");
      const toggle = document.querySelector(".admin-mobile-sidebar-toggle");
      return Boolean(
        workspace && workspace.classList.contains("nav-open") ||
        sidebar && sidebar.classList.contains("mobile-open") ||
        document.body.classList.contains("sway-mobile-nav-open") ||
        toggle && toggle.getAttribute("aria-expanded") === "true"
      );
    });
    if (mobileMenuIsOpen) {
      await mobileToggle.click();
      await page.waitForFunction(() => {
        const workspace = document.getElementById("sway-admin-workspace");
        const sidebar = workspace && workspace.querySelector(".sway-workspace-sidebar");
        const toggle = document.querySelector(".admin-mobile-sidebar-toggle");
        return !(
          workspace && workspace.classList.contains("nav-open") ||
          sidebar && sidebar.classList.contains("mobile-open") ||
          document.body.classList.contains("sway-mobile-nav-open") ||
          toggle && toggle.getAttribute("aria-expanded") === "true"
        );
      });
    }
    const controls = page.locator('#sway-workspace-main .sway-admin-table-control-grid');
    await controls.waitFor({ state: "visible" });
    const bounds = await controls.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 392,
      "table controls should fit within the mobile viewport: " + JSON.stringify(bounds));
    const gridColumns = await controls.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    assert.equal(gridColumns, 1, "mobile table controls should stack in one column");
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "dashboard-tasks-mobile.png"), fullPage: true });

    assert.equal(metrics.apiMutationsBlocked.length, 0,
      "dashboard interactions must not attempt API writes during this read-only test: " +
      JSON.stringify(metrics.apiMutationsBlocked));
    assert.equal(metrics.unexpectedExternalRequests.length, 0,
      "unexpected outbound requests were blocked: " + JSON.stringify(metrics.unexpectedExternalRequests));
    assert.equal(metrics.pageErrors.length, 0,
      "uncaught browser errors were observed: " + JSON.stringify(metrics.pageErrors));

    const summary = {
      result: "PASS",
      actualDashboard: true,
      authentication: "mocked test admin identity; no live credentials",
      data: "synthetic records only",
      apiReadsMocked: metrics.apiReads,
      unexpectedApiWritesBlocked: metrics.apiMutationsBlocked.length,
      startupCallsInterceptedBeforeNetwork: metrics.mockedStartupCalls,
      externalRequestsBlocked: metrics.unexpectedExternalRequests.length,
      pageErrors: metrics.pageErrors.length,
      checks: [
        "admin session accepted by mocked auth endpoint",
        "actual Leads, Follow-ups and Tasks views render synthetic records",
        "lead email search, status filter and business-name sort",
        "visible-row selection, clear selection and formula-safe CSV download",
        "follow-up status filter and task priority sort/status filter",
        "mobile controls use a single-column layout and fit in viewport"
      ]
    };
    fs.writeFileSync(path.join(ARTIFACT_DIR, "dashboard-smoke-summary.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
