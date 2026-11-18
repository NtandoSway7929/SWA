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

        const toggle = page.locator(".sway-quick-create-toggle");
        const menu = page.locator(".sway-quick-create-menu");
        const actions = menu.locator("[data-global-quick]");

        assert.equal(await actions.count(), 9);
        assert.equal(await toggle.getAttribute("aria-label"), "Quick-create actions");
        assert.equal(await menu.getAttribute("aria-labelledby"), "sway-quick-create-heading");
        assert.equal(await menu.getAttribute("role"), "group");

        await toggle.focus();
        await page.keyboard.press("Enter");
        assert.equal(await toggle.getAttribute("aria-expanded"), "true");
        assert.equal(await menu.isVisible(), true);
        assert.equal(await page.evaluate(() => document.activeElement.dataset.globalQuick), "client");

        const focusStyle = await page.locator('[data-global-quick="client"]').evaluate(element => {
            const style = getComputedStyle(element);
            return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
        });
        assert.equal(focusStyle.outlineStyle, "solid");
        assert.equal(focusStyle.outlineWidth, "3px");

        await page.keyboard.press("Escape");
        assert.equal(await menu.isVisible(), false);
        assert.equal(await toggle.getAttribute("aria-expanded"), "false");
        assert.equal(await page.evaluate(() => document.activeElement.classList.contains("sway-quick-create-toggle")), true);

        await toggle.focus();
        await page.keyboard.press("Enter");
        await menu.locator('[data-global-quick="payment"]').focus();
        await page.keyboard.press("Tab");
        assert.equal(await menu.isVisible(), false);
        assert.equal(await toggle.getAttribute("aria-expanded"), "false");
        assert.equal(await page.evaluate(() => document.activeElement.id), "after-create");

        await page.emulateMedia({ reducedMotion: "reduce" });
        await toggle.focus();
        const reduced = await toggle.evaluate(element => ({
            transitionDuration: getComputedStyle(element).transitionDuration,
            transform: getComputedStyle(element).transform
        }));
        assert.equal(reduced.transitionDuration, "0s");
        assert.equal(reduced.transform, "none");
        assert.deepEqual(errors, []);

        await page.screenshot({
            path: path.join(artifactDir, "quick-create-keyboard-accessibility.png"),
            fullPage: true
        });
        console.log(JSON.stringify({
            result: "PASS",
            viewport: "390x844",
            actions: await actions.count(),
            checks: [
                "accessible toggle name and named group",
                "keyboard opening and first-action focus",
                "visible 3px focus indicator",
                "Escape close and focus restoration",
                "focusout close without focus theft",
                "reduced-motion support",
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
