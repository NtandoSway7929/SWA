"use strict";

const assert = require("node:assert/strict");

function requiredEnv(name) {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(name + "_is_required");
    return value;
}

(async () => {
    const searchBaseUrl = requiredEnv("SEARXNG_BASE_URL");
    const crawlBaseUrl = requiredEnv("CRAWL4AI_BASE_URL");
    const crawlApiToken = requiredEnv("CRAWL4AI_API_TOKEN");
    const cloudflareAccessClientId = process.env.CLOUDFLARE_ACCESS_CLIENT_ID?.trim();
    const cloudflareAccessClientSecret = process.env.CLOUDFLARE_ACCESS_CLIENT_SECRET?.trim();

    const { createOpenSourceInspectionProvider } = await import(
        "../supabase/functions/_shared/business-assessment-open-source-provider.mjs"
    );

    const provider = createOpenSourceInspectionProvider({
        searchBaseUrl,
        crawlBaseUrl,
        crawlApiToken,
        cloudflareAccessClientId,
        cloudflareAccessClientSecret
    });

    // This is intentionally a generic software query, not a customer/business query.
    const search = await provider.search("Crawl4AI open source web crawler", {
        maxResults: 5
    });

    assert.ok(Array.isArray(search.results), "SearXNG response must normalize to results[]");
    assert.ok(search.results.length <= 5, "Search adapter must enforce its result limit");
    for (const result of search.results) {
        assert.match(result.url, /^https:\/\//, "Search candidates must be normalized public HTTPS URLs");
        assert.equal(typeof result.title, "string");
        assert.equal(typeof result.snippet, "string");
    }

    // Use a reserved example domain, never a real Swayphics prospect or assessment URL.
    const fetched = await provider.fetch(["https://example.com/"]);
    assert.equal(fetched.results.length, 1, "Crawl4AI must return one result per requested URL");

    const page = fetched.results[0];
    assert.equal(page.success, true, "Crawl4AI must successfully retrieve the reserved example page");
    assert.match(page.title, /example domain/i, "Crawl4AI must return the page title");
    // The reserved example page is geo-localised. Validate non-empty extracted prose,
    // not an English-only phrase that may be absent in other runner regions.
    assert.ok(page.text.trim().length >= 100, "Crawl4AI must return substantial readable page text");
    assert.doesNotMatch(page.text, /<\/?(?:html|body|script)\b/i, "Crawl4AI should return extracted text, not raw document HTML");
    assert.match(page.final_url, /^https:\/\/example\.com\//i);
    assert.equal(page.status_code, 200);

    console.log("Live SearXNG API integration passed.");
    console.log("SearXNG returned " + search.results.length + " candidate result(s) for the generic test query.");
    if (search.results.length === 0) {
        console.warn("SearXNG returned no candidates. API compatibility passed; search-engine discovery quality remains unverified.");
    }
    console.log("Live Crawl4AI Docker API integration passed for https://example.com/.");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
