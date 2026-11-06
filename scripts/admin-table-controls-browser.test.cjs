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

    const [csvDownload] = await Promise.all([
      page.waitForEvent("download"),
      leads.locator('[data-admin-table-bulk-action="export"]').click()
    ]);
    const csvPath = await csvDownload.path();
    if (!csvPath) throw new Error("Selected-lead CSV download did not produce a file.");
    const exportedCsv = fs.readFileSync(csvPath, "utf8");
    if (!exportedCsv.includes("\"'=HYPERLINK(\"\"https://example.invalid\"\",\"\"Open\"\")\"")) {
      throw new Error("CSV export did not neutralise a formula-like email value.");
    }

    await leads.locator('[data-admin-table-clear-selection="leads"]').click();
    if (await leads.locator('[data-admin-table-bulk-toolbar="leads"]').isVisible()) throw new Error("Clear selection did not hide the bulk toolbar.");
    await leads.locator('[data-admin-table-search-input="leads"]').fill("");

    // Cancelled permanent deletion must keep the selected lead and make no mutation.
    await leads.locator('[data-admin-table-search-input="leads"]').fill("Bravo Cafe");
    const bravoRow = leads.locator('[data-admin-table-row="leads"]:visible').filter({ hasText: "Bravo Cafe" });
    await bravoRow.locator('[data-admin-table-select="leads"]').check();
    await leads.locator('[data-admin-table-bulk-action="delete"]').click();
    if (!(await page.locator("#preview-root").getAttribute("data-confirmation-message")).includes("Permanently delete 1 selected lead")) {
      throw new Error("Bulk lead deletion did not ask for a count-specific confirmation.");
    }
    if ((await leads.locator('[data-admin-table-selected-count="leads"]').innerText()).trim() !== "1 selected") {
      throw new Error("Cancelling bulk deletion must retain the selected lead.");
    }
    if (await leads.locator('[data-admin-table-row="leads"]:visible').count() !== 1) {
      throw new Error("Cancelling bulk deletion must leave the lead visible.");
    }

    // The confirmed path removes only the selected synthetic lead.
    await page.evaluate(() => window.setPreviewLeadDeleteConfirmation(true));
    await leads.locator('[data-admin-table-bulk-action="delete"]').click();
    if (!(await page.locator("#preview-root").getAttribute("data-deleted-lead-ids")).includes("lead-c")) {
      throw new Error("Confirmed bulk deletion did not call the isolated delete handler for the selected lead.");
    }
    await leads.locator('[data-admin-table-search-input="leads"]').fill("");
    if (await leads.locator('[data-admin-table-row="leads"]').count() !== 2) {
      throw new Error("Confirmed bulk deletion should remove exactly one selected lead from the synthetic list.");
    }
    if (await leads.locator('[data-admin-table-row="leads"]').filter({ hasText: "Bravo Cafe" }).count() !== 0) {
      throw new Error("The selected lead should no longer appear after confirmed deletion.");
    }

    const followups = page.locator('[data-preview-view="followups"]');
    await followups.locator('[data-admin-table-search-input="followups"]').fill("send follow-up");
    if (await followups.locator('[data-admin-table-row="followups"]:visible').count() !== 1) throw new Error("Follow-up note search failed against schema field `note`.");
    await followups.locator('[data-admin-table-search-input="followups"]').fill("");
    await followups.locator('[data-admin-table-filter="followups"]').selectOption("pending");
    if (await followups.locator('[data-admin-table-row="followups"]:visible').count() !== 2) throw new Error("Follow-up pending filter failed.");

    const tasks = page.locator('[data-preview-view="tasks"]');
    await tasks.locator('[data-admin-table-sort="tasks"]').selectOption("priority_desc");
    if (!(await tasks.locator('[data-admin-table-row="tasks"]:visible').first().innerText()).includes("Confirm scope")) throw new Error("Task priority sort failed.");
    await tasks.locator('[data-admin-table-filter="tasks"]').selectOption("todo");
    if (await tasks.locator('[data-admin-table-row="tasks"]:visible').count() !== 2) throw new Error("Task todo filter failed.");

    // Tasks: cancellation must be non-mutating; confirmed deletion removes only the selected task.
    const taskToDelete = tasks.locator('[data-admin-table-row="tasks"]:visible').filter({ hasText: "Prepare proposal" });
    await taskToDelete.locator('[data-admin-table-select="tasks"]').check();
    await tasks.locator('[data-admin-table-bulk-action="delete"]').click();
    if (!(await page.locator("#preview-root").getAttribute("data-confirmation-message")).includes("Permanently delete 1 selected task")) {
      throw new Error("Task bulk deletion did not display a count-specific confirmation.");
    }
    if ((await tasks.locator('[data-admin-table-selected-count="tasks"]').innerText()).trim() !== "1 selected") {
      throw new Error("Cancelling task deletion must preserve the selection.");
    }
    await page.evaluate(() => window.setPreviewBulkDeleteConfirmation(true));
    await tasks.locator('[data-admin-table-bulk-action="delete"]').click();
    if (await page.locator("#preview-root").getAttribute("data-deleted-records-view") !== "tasks" ||
        await page.locator("#preview-root").getAttribute("data-deleted-record-ids") !== "task-a") {
      throw new Error("Confirmed task deletion did not remove only the selected synthetic task.");
    }
    await tasks.locator('[data-admin-table-filter="tasks"]').selectOption("all");
    if (await tasks.locator('[data-admin-table-row="tasks"]').count() !== 2) {
      throw new Error("Confirmed task deletion should remove exactly one task.");
    }

    // Follow-ups use the same confirm/retain-selection workflow.
    const followupToDelete = followups.locator('[data-admin-table-row="followups"]').filter({ hasText: "Check interest" });
    await followupToDelete.locator('[data-admin-table-select="followups"]').check();
    await page.evaluate(() => window.setPreviewBulkDeleteConfirmation(false));
    await followups.locator('[data-admin-table-bulk-action="delete"]').click();
    if (!(await page.locator("#preview-root").getAttribute("data-confirmation-message")).includes("Permanently delete 1 selected follow-up")) {
      throw new Error("Follow-up bulk deletion did not display a singular confirmation.");
    }
    if ((await followups.locator('[data-admin-table-selected-count="followups"]').innerText()).trim() !== "1 selected") {
      throw new Error("Cancelling follow-up deletion must preserve the selection.");
    }
    await page.evaluate(() => window.setPreviewBulkDeleteConfirmation(true));
    await followups.locator('[data-admin-table-bulk-action="delete"]').click();
    if (await page.locator("#preview-root").getAttribute("data-deleted-records-view") !== "followups" ||
        await page.locator("#preview-root").getAttribute("data-deleted-record-ids") !== "follow-b") {
      throw new Error("Confirmed follow-up deletion did not remove only the selected synthetic follow-up.");
    }

    const communications = page.locator('[data-preview-view="communications"]');
    await communications.locator('[data-admin-table-search-input="communications"]').fill("Earlier introduction");
    if (await communications.locator('[data-admin-table-row="communications"]:visible').count() !== 1) {
      throw new Error("Communication Log message search failed.");
    }
    await communications.locator('[data-admin-table-search-input="communications"]').fill("");
    await communications.locator('[data-admin-table-sort="communications"]').selectOption("date_desc");
    if (!(await communications.locator('[data-admin-table-row="communications"]:visible').first().innerText()).includes("Follow-up")) {
      throw new Error("Communication Log should sort newest first.");
    }
    const communicationToDelete = communications.locator('[data-admin-table-row="communications"]').filter({ hasText: "Earlier introduction" });
    await communicationToDelete.locator('[data-admin-table-select="communications"]').check();
    await page.evaluate(() => window.setPreviewBulkDeleteConfirmation(false));
    await communications.locator('[data-admin-table-bulk-action="delete"]').click();
    if (!(await page.locator("#preview-root").getAttribute("data-confirmation-message")).includes("Permanently delete 1 selected communication log entry")) {
      throw new Error("Communication Log bulk deletion did not display a count-specific confirmation.");
    }
    await page.evaluate(() => window.setPreviewBulkDeleteConfirmation(true));
    await communications.locator('[data-admin-table-bulk-action="delete"]').click();
    if (await page.locator("#preview-root").getAttribute("data-deleted-records-view") !== "communications" ||
        await page.locator("#preview-root").getAttribute("data-deleted-record-ids") !== "comm-a") {
      throw new Error("Confirmed Communication Log deletion did not remove only the selected synthetic entry.");
    }

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
