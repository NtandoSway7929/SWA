"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ARTIFACT_DIR = path.resolve("artifacts/admin-quick-create-accessibility");
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

async function main() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const pageErrors = [];

    page.on("pageerror", error => pageErrors.push(error.message));

    try {
        await page.goto(
            "http://127.0.0.1:4173/tests/admin-quick-create-accessibility-preview/",
            { waitUntil: "domcontentloaded" }
        );

        const toggle = page.locator(".sway-quick-create-toggle");
        const menu = page.locator(".sway-quick-create-menu");
        const actions = menu.locator("[data-global-quick]");
        const after = page.locator("#after-create");

        assert.equal(await actions.count(), 9,
            "all nine existing quick-create actions must remain available");
        assert.equal(await toggle.getAttribute("aria-label"), "Quick-create actions",
            "the compact toggle must have a useful accessible name");
        assert.equal(await menu.getAttribute("aria-labelledby"), "sway-quick-create-heading",
            "the action panel must be named by its visible heading");
        assert.equal(await menu.getAttribute("role"), "group",
            "the action panel must be exposed as a semantic group");

        await toggle.focus();
        await page.keyboard.press("Enter");
        assert.equal(await toggle.getAttribute("aria-expanded"), "true",
            "keyboard activation must open the disclosure");
        assert.equal(await menu.isVisible(), true,
            "the action list must become visible");
        assert.equal(await page.evaluate(() => document.activeElement.dataset.globalQuick), "client",
            "keyboard activation must place focus on the first action");

        const focusStyle = await page.locator('[data-global-quick="client"]').evaluate(element => {
            const style = getComputedStyle(element);
            return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
        });
        assert.equal(focusStyle.outlineStyle, "solid",
            "the focused action must expose a visible outline");
        assert.equal(focusStyle.outlineWidth, "3px",
            "the keyboard focus outline must meet the declared 3px treatment");

        await page.keyboard.press("Escape");
        assert.equal(await menu.isVisible(), false,
            "Escape must close the action list");
        assert.equal(await toggle.getAttribute("aria-expanded"), "false",
            "Escape must reset the expanded state");
        assert.equal(await page.evaluate(() => document.activeElement.classList.contains("sway-quick-create-toggle")), true,
            "Escape must return focus to the quick-create toggle");

        await toggle.focus();
        await page.keyboard.press("Enter");
        const lastAction = menu.locator('[data-global-quick="payment"]');
        await lastAction.focus();
        await page.keyboard.press("Tab");
        assert.equal(await menu.isVisible(), false,
            "tabbing beyond the action list must close the disclosure");
        assert.equal(await toggle.getAttribute("aria-expanded"), "false",
            "focus leaving the disclosure must clear its expanded state");
        assert.equal(await page.evaluate(() => document.activeElement.id), "after-create",
            "closing on focusout must not steal focus from the next control");

        await page.emulateMedia({ reducedMotion: "reduce" });
        await toggle.focus();
        const reducedMotion = await toggle.evaluate(element => ({
            transitionDuration: getComputedStyle(element).transitionDuration,
            transform: getComputedStyle(element).transform
        }));
        assert.equal(reducedMotion.transitionDuration, "0s",
            "quick-create focus styling must respect reduced-motion settings");
        assert.equal(reducedMotion.transform, "none",
            "quick-create focus treatment must not animate under reduced motion");

        assert.deepEqual(pageErrors, [],
            "the quick-create accessibility preview must not produce browser errors");
        await page.screenshot({
            path: path.join(ARTIFACT_DIR, "quick-create-keyboard-accessibility.png"),
            fullPage: true
        });

        console.log(JSON.stringify({
            result: "PASS",
            viewport: "390x844",
            actions: await actions.count(),
            checks: [
                "all nine quick-create actions retained",
                "accessible toggle name and heading relationship",
                "named action group semantics",
                "keyboard opening and first-action focus",
                "visible 3px keyboard focus indicator",
                "Escape close and focus restoration",
                "focusout close without focus theft",
                "reduced-motion-safe focus treatment",
                "no browser page errors"
            ]
        }, null, 2));
    } finally {
        await browser.close();
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
