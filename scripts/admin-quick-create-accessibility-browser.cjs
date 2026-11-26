"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const artifactDir = path.resolve("artifacts/admin-quick-create-accessibility");
fs.mkdirSync(artifactDir, { recursive: true });

async function main() {
    const browserInstance = await chromium.launch({ headless: true });
    const page = await browserInstance.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));

    try {
        await page.goto("http://127.0.0.1:4173/tests/admin-quick-create-accessibility-preview/", {
            waitUntil: "domcontentloaded"
        });

        const wrapper = page.locator(".sway-quick-create");
        const toggle = page.locator(".sway-quick-create-toggle");
        const menu = page.locator(".sway-quick-create-menu");

        assert.equal(await wrapper.isVisible(), false,
            "the global + New launcher and its menu must not be visible");
        assert.equal(await toggle.isVisible(), false,
            "the + New shortcut must not be visible");
        assert.equal(await menu.isVisible(), false,
            "the global quick-create menu must not be visible");

        const hiddenState = await wrapper.evaluate(element => ({
            display: getComputedStyle(element).display,
            focusableDescendants: Array.from(element.querySelectorAll("button, a, input, select, textarea, [tabindex]"))
                .filter(control => control.getClientRects().length > 0 && control.tabIndex >= 0).length
        }));
        assert.equal(hiddenState.display, "none");
        assert.equal(hiddenState.focusableDescendants, 0,
            "hidden global create actions must not remain in the keyboard tab order");

        await page.keyboard.press("Tab");
        assert.equal(await page.evaluate(() => document.activeElement.id), "after-create",
            "keyboard navigation must skip the removed shortcut");

        assert.deepEqual(errors, []);
        await page.screenshot({
            path: path.join(artifactDir, "global-new-shortcut-removed.png"),
            fullPage: true
        });

        console.log(JSON.stringify({
            result: "PASS",
            viewport: "390x844",
            checks: [
                "floating + New launcher hidden",
                "attached quick-create menu hidden",
                "no hidden actions exposed to keyboard navigation",
                "tab order skips the retired shortcut",
                "no browser page errors"
            ]
        }, null, 2));
    } finally {
        await browserInstance.close();
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
