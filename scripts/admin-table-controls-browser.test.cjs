"use strict";
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1365, height: 1000 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto("http://127.0.0.1:4173/tests/admin-table-controls-preview/", { waitUntil: "networkidle" });
    await page.getByText("Isolated UI preview only.").waitFor();

    const leads = page.locator('[data-preview-view="leads"]');
    await leads.locator('[data-admin-table-search-input="leads"]').fill("lee@example.test");
    if (await leads.locator('[data-admin-table-row="leads"]:visible').count() !== 1) throw new Error("Lead search did not narrow to the matching synthetic record.");
    if (!(await leads.locator('[data-admin-table-row="leads"]:visible').first().innerText()).includes("Zulu Market")) throw new Error("Lead search returned the wrong record.");

    await leads.locator('[data-admin-table-search-input="leads"]').fill("");
    await leads.locator('[data-admin-table-filter="leads"]').selectOption("new");
    if (await leads.locator('[data-admin-table-row="leads"]:visible').count() !== 2) throw new Error("Lead status filter did not return two new leads.");
    await leads.locator('[data-admin-table-filter="leads"]').selectOption("all");
    await leads.locator('[data-admin-table-sort="leads"]').selectOption("business_asc");
    const leadFirst = await leads.locator('[data-admin-table-row="leads"]:visible').first().innerText();
    if (!leadFirst.includes("Alpha Studio")) throw new Error("Lead sorting did not put Alpha Studio first.");

    await leads.locator('[data-admin-table-search-input="leads"]').fill("alpha");
    await leads.locator('[data-admin-table-select-all="leads"]').check();
    if (!(await leads.locator('[data-admin-table-selected-count="leads"]').innerText()).includes("1 selected")) throw new Error("Select-all did not select only the visible search result.");
    await leads.locator('[data-admin-table-clear-selection="leads"]').click();
    if (await leads.locator('[data-admin-table-bulk-toolbar="leads"]').isVisible()) throw new Error("Clear selection did not hide the bulk toolbar.");
    await leads.locator('[data-admin-table-search-input="leads"]').fill("");

    const followups = page.locator('[data-preview-view="followups"]');
    await followups.locator('[data-admin-table-filter="followups"]').selectOption("pending");
    if (await followups.locator('[data-admin-table-row="followups"]:visible').count() !== 2) throw new Error("Follow-up pending filter failed.");

    const tasks = page.locator('[data-preview-view="tasks"]');
    await tasks.locator('[data-admin-table-sort="tasks"]').selectOption("priority_desc");
    if (!(await tasks.locator('[data-admin-table-row="tasks"]:visible').first().innerText()).includes("Confirm scope")) throw new Error("Task priority sort failed.");
    await tasks.locator('[data-admin-table-filter="tasks"]').selectOption("pending");
    if (await tasks.locator('[data-admin-table-row="tasks"]:visible').count() !== 2) throw new Error("Task pending filter failed.");

    await page.screenshot({ path: "artifacts/admin-table-controls-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "artifacts/admin-table-controls-mobile.png", fullPage: true });
    const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
    if (widths.document > widths.viewport + 2) throw new Error("Mobile preview has document-level horizontal overflow: " + JSON.stringify(widths));
    if (errors.length) throw new Error("Browser console errors: " + errors.join(" | "));

    console.log("PASS: isolated Phase 2 browser preview passed search, status filters, sorting, visible-row select-all, clear-selection, and desktop/mobile rendering.");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
