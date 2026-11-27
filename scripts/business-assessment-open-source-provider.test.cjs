"use strict";

const assert = require("node:assert/strict");

(async () => {
    const providerModule = await import("../supabase/functions/_shared/business-assessment-open-source-provider.mjs");
    const { createOpenSourceInspectionProvider, __testing } = providerModule;

    const searchResults = __testing.normaliseSearxngResults({
        results: [
            { url: "https://www.instagram.com/example/?utm_source=test", title: "Example", content: "Official profile" },
            { url: "https://www.facebook.com/example/", title: "Facebook", content: "Social page" },
            { url: "javascript:alert(1)", title: "Unsafe", content: "Must be discarded" },
            { url: "https://www.instagram.com/example/?tracking=duplicate", title: "Duplicate", content: "Duplicate URL" }
        ]
    }, { includeDomains: "instagram.com", maxResults: 5 });

    assert.equal(searchResults.length, 1);
    assert.equal(searchResults[0].url, "https://www.instagram.com/example/");
    assert.equal(searchResults[0].title, "Example");

    const normalizedCrawl = __testing.normaliseCrawlResult({
        url: "https://example.co.za/",
        redirected_url: "https://www.example.co.za/",
        success: true,
        markdown: {
            raw_markdown: "# Example Business\nContact us",
            markdown_with_citations: "# Example Business\nContact us"
        },
        metadata: {
            title: "Example Business",
            description: "A sample business",
            language: "en"
        },
        links: {
            internal: [{ href: "https://www.example.co.za/contact?session=secret" }],
            external: [{ url: "https://www.instagram.com/example/" }]
        },
        response_headers: { ETag: "abc123", "Last-Modified": "Wed, 01 Jan 2025 00:00:00 GMT" },
        status_code: 200
    }, "https://example.co.za/");

    assert.equal(normalizedCrawl.success, true);
    assert.equal(normalizedCrawl.final_url, "https://www.example.co.za/");
    assert.equal(normalizedCrawl.title, "Example Business");
    assert.equal(normalizedCrawl.language, "en");
    assert.ok(normalizedCrawl.text.includes("Example Business"));
    assert.deepEqual(normalizedCrawl.links, [
        "https://www.example.co.za/contact",
        "https://www.instagram.com/example/"
    ]);
    assert.equal(normalizedCrawl.etag, "abc123");

    const calls = [];
    const fakeFetch = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if (String(url).includes("/search")) {
            return new Response(JSON.stringify({
                results: [
                    { url: "https://business.example.co.za/", title: "Business", content: "Official site" },
                    { url: "https://facebook.com/business", title: "Facebook", content: "Profile" }
                ]
            }), { status: 200, headers: { "content-type": "application/json", "x-request-id": "search-1" } });
        }
        if (String(url).endsWith("/crawl")) {
            return new Response(JSON.stringify({
                success: true,
                results: [{
                    url: "https://business.example.co.za/",
                    redirected_url: "https://business.example.co.za/",
                    success: true,
                    markdown: { raw_markdown: "# Business\nBased in Pretoria." },
                    metadata: { title: "Business", description: "Example description", language: "en" },
                    links: { internal: [{ href: "https://business.example.co.za/contact" }], external: [] },
                    status_code: 200
                }]
            }), { status: 200, headers: { "content-type": "application/json", "x-request-id": "fetch-1" } });
        }
        throw new Error("Unexpected mocked provider URL");
    };

    const provider = createOpenSourceInspectionProvider({
        fetchImpl: fakeFetch,
        searchBaseUrl: "https://search.internal.example",
        crawlBaseUrl: "https://crawl.internal.example",
        crawlApiToken: "test-token"
    });

    const search = await provider.search('"Business" Pretoria official website', {
        excludeDomains: "facebook.com",
        maxResults: 10
    });
    assert.equal(search.requestId, "search-1");
    assert.equal(search.results.length, 1);
    assert.equal(search.results[0].url, "https://business.example.co.za/");

    const fetched = await provider.fetch(["https://business.example.co.za/?utm_campaign=discard"]);
    assert.equal(fetched.requestId, "fetch-1");
    assert.equal(fetched.results.length, 1);
    assert.equal(fetched.results[0].success, true);
    assert.ok(fetched.results[0].text.includes("Pretoria"));
    assert.equal(fetched.results[0].title, "Business");

    const crawlCall = calls.find((call) => call.url.endsWith("/crawl"));
    assert.equal(crawlCall.init.method, "POST");
    assert.equal(crawlCall.init.headers.Authorization, "Bearer test-token");
    const crawlBody = JSON.parse(crawlCall.init.body);
    assert.deepEqual(crawlBody.urls, ["https://business.example.co.za/"]);
    assert.deepEqual(crawlBody.browser_config, {});
    assert.deepEqual(crawlBody.crawler_config, {});
    assert.equal(Object.prototype.hasOwnProperty.call(crawlBody, "hooks"), false);

    assert.throws(() => createOpenSourceInspectionProvider({
        fetchImpl: fakeFetch,
        searchBaseUrl: "http://search.example.com",
        crawlBaseUrl: "https://crawl.example.com",
        crawlApiToken: "test-token"
    }), /searxng_must_use_https/);

    assert.throws(() => createOpenSourceInspectionProvider({
        fetchImpl: fakeFetch,
        searchBaseUrl: "https://search.example.com",
        crawlBaseUrl: "https://crawl.example.com",
        crawlApiToken: ""
    }), /crawl4ai_token_not_configured/);

    assert.throws(() => __testing.normaliseSearxngResults({
        results: [{ url: "https://evil.example/" }]
    }, { includeDomains: "trusted.example" }), /does not throw/);

    const noJsonProvider = createOpenSourceInspectionProvider({
        fetchImpl: async () => new Response(JSON.stringify({ detail: "JSON disabled" }), {
            status: 403,
            headers: { "content-type": "application/json" }
        }),
        searchBaseUrl: "https://search.internal.example",
        crawlBaseUrl: "https://crawl.internal.example",
        crawlApiToken: "test-token"
    });
    await assert.rejects(
        () => noJsonProvider.search("test"),
        (error) => error.providerCode === "search_json_format_not_enabled"
    );

    console.log("Business Opportunity Finder open-source provider adapter tests passed.");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
