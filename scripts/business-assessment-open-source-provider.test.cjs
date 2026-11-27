"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

(async () => {
    const providerModule = await import("../supabase/functions/_shared/business-assessment-open-source-provider.mjs");
    const { createOpenSourceInspectionProvider, __testing } = providerModule;

    const compose = fs.readFileSync(path.join(
        __dirname, "bof-open-source-provider-poc", "docker-compose.yml"
    ), "utf8");
    assert.match(compose, /unclecode\/crawl4ai:0\.9\.6@sha256:4603d7c4d69769673dfa1214fa9abbcac2a874d4d9af07d784782af528b65c68/,
        "The Crawl4AI security release must be pinned by multi-architecture digest");
    assert.match(compose, /cap_drop:\s*\n\s*- ALL/,
        "Crawl4AI must drop all Linux capabilities");
    assert.match(compose, /no-new-privileges:true/,
        "Crawl4AI must prohibit privilege escalation");
    assert.match(compose, /read_only:\s*true/,
        "Crawl4AI must use a read-only root filesystem");
    assert.match(compose, /user:\s*"appuser"/,
        "Crawl4AI must run as the non-root application user");
    assert.match(compose, /\/var\/lib\/crawl4ai\/outputs:uid=999,gid=999,mode=0700/,
        "Crawl4AI output writes must use a private tmpfs mount");
    assert.match(compose, /pids:\s*512/,
        "Crawl4AI must have a PID limit");
    assert.match(compose, /127\.0\.0\.1:\$\{SEARXNG_PORT/,
        "SearXNG must bind only to host loopback in the isolated POC");
    assert.match(compose, /127\.0\.0\.1:\$\{CRAWL4AI_PORT/,
        "Crawl4AI must bind only to host loopback in the isolated POC");

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

    const selectedStorePage = __testing.selectIdentityFollowupUrl([
        "https://www.example.co.za/about-us",
        "https://www.example.co.za/pages/our-stores?utm_source=homepage",
        "https://www.example.co.za/contact",
        "https://www.example.co.za/blog/store-locations",
        "https://www.instagram.com/example/",
        "https://locations.example.co.za/stores",
        "http://www.example.co.za/locations"
    ], "https://www.example.co.za/");
    assert.equal(selectedStorePage, "https://www.example.co.za/pages/our-stores",
        "The selector should prefer same-host store/location pages and discard external, alternate-host, insecure and blog links");

    assert.equal(__testing.selectIdentityFollowupUrl([
        "https://www.example.co.za/blog/contact",
        "https://www.example.co.za/products/store-finder",
        "https://www.example.co.za/services"
    ], "https://www.example.co.za/"), null,
        "The selector must not treat blog, product or unrelated pages as identity follow-ups");

    assert.equal(__testing.selectIdentityFollowupUrl([
        "https://www.example.co.za/contact"
    ], "http://www.example.co.za/"), null,
        "The selector must require an HTTPS homepage");

    assert.equal(__testing.isSameHttpsOrigin(
        "https://www.example.co.za/pages/our-stores",
        "https://www.example.co.za/pages/our-stores"
    ), true, "An HTTPS fetch that stays on the selected origin is eligible for identity evaluation");

    assert.equal(__testing.isSameHttpsOrigin(
        "https://www.example.co.za/pages/our-stores",
        "https://www.example.co.za.evil.test/locations"
    ), false, "A cross-origin redirect must not count as same-origin evidence");

    assert.equal(__testing.isSameHttpsOrigin(
        "https://www.example.co.za/pages/our-stores",
        "http://www.example.co.za/pages/our-stores"
    ), false, "A downgrade to HTTP must not count as same-origin evidence");

    assert.equal(__testing.isSameHttpsOrigin(
        "https://www.example.co.za/pages/our-stores",
        "https://example.co.za/pages/our-stores"
    ), false, "A redirect to an alternate host must not count as same-origin evidence");

    const suspendedCrawl = __testing.normaliseCrawlResult({
        url: "https://business.example.co.za/",
        redirected_url: "https://business.example.co.za/cgi-sys/suspendedpage.cgi",
        success: true,
        markdown: { raw_markdown: "# Account Suspended\\nThis account has been suspended." },
        metadata: { title: "Account Suspended" },
        status_code: 302
    }, "https://business.example.co.za/");
    assert.equal(suspendedCrawl.success, false, "A non-2xx HTTP response must not count as a successful page fetch");
    assert.equal(suspendedCrawl.error_code, "http_status_302");
    assert.equal(suspendedCrawl.status_code, 302);
    assert.equal(suspendedCrawl.final_url, "https://business.example.co.za/cgi-sys/suspendedpage.cgi");

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
        crawlApiToken: "test-token",
        cloudflareAccessClientId: "test-access-client-id",
        cloudflareAccessClientSecret: "test-access-client-secret"
    });

    const search = await provider.search('"Business" Pretoria official website', {
        excludeDomains: "facebook.com",
        maxResults: 10
    });
    assert.equal(search.requestId, "search-1");
    assert.equal(search.results.length, 1);
    const searchCall = calls.find((call) => call.url.includes("/search"));
    assert.equal(searchCall.init.headers["CF-Access-Client-Id"], "test-access-client-id");
    assert.equal(searchCall.init.headers["CF-Access-Client-Secret"], "test-access-client-secret");
    assert.equal(search.results[0].url, "https://business.example.co.za/");

    const fetched = await provider.fetch(["https://business.example.co.za/?utm_campaign=discard"]);
    assert.equal(fetched.requestId, "fetch-1");
    assert.equal(fetched.results.length, 1);
    assert.equal(fetched.results[0].success, true);
    assert.ok(fetched.results[0].text.includes("Pretoria"));
    assert.equal(fetched.results[0].title, "Business");

    // Reject local, private, link-local and internal destinations before any provider call.
    const callsBeforeUnsafeUrls = calls.length;
    for (const unsafeUrl of [
        "http://127.0.0.1/",
        "http://localhost/",
        "http://169.254.169.254/latest/meta-data/",
        "http://service.internal/",
        "http://[::1]/"
    ]) {
        await assert.rejects(
            () => provider.fetch([unsafeUrl]),
            /Only public HTTP or HTTPS business URLs can be submitted/
        );
    }
    assert.equal(calls.length, callsBeforeUnsafeUrls, "Unsafe destination URLs must be rejected before network access");

    const crawlCall = calls.find((call) => call.url.endsWith("/crawl"));
    assert.equal(crawlCall.init.method, "POST");
    assert.equal(crawlCall.init.headers.Authorization, "Bearer test-token");
    assert.equal(crawlCall.init.headers["CF-Access-Client-Id"], "test-access-client-id");
    assert.equal(crawlCall.init.headers["CF-Access-Client-Secret"], "test-access-client-secret");
    const crawlBody = JSON.parse(crawlCall.init.body);
    assert.deepEqual(crawlBody.urls, ["https://business.example.co.za/"]);
    assert.deepEqual(crawlBody.browser_config, {});
    assert.deepEqual(crawlBody.crawler_config, {});
    assert.equal(Object.prototype.hasOwnProperty.call(crawlBody, "hooks"), false);
    assert.equal(JSON.stringify(crawlBody).includes("test-access-client-id"), false);
    assert.equal(JSON.stringify(crawlBody).includes("test-access-client-secret"), false);

    assert.throws(() => createOpenSourceInspectionProvider({
        fetchImpl: fakeFetch,
        searchBaseUrl: "https://search.remote.example",
        crawlBaseUrl: "https://crawl.remote.example",
        crawlApiToken: "test-token"
    }), /cloudflare_access_credentials_not_configured/);

    assert.throws(() => createOpenSourceInspectionProvider({
        fetchImpl: fakeFetch,
        searchBaseUrl: "https://search.remote.example",
        crawlBaseUrl: "https://crawl.remote.example",
        crawlApiToken: "test-token",
        cloudflareAccessClientId: "test-access-client-id"
    }), /cloudflare_access_credentials_incomplete/);

    assert.doesNotThrow(() => createOpenSourceInspectionProvider({
        fetchImpl: fakeFetch,
        searchBaseUrl: "http://127.0.0.1:8080",
        crawlBaseUrl: "http://127.0.0.1:11235",
        crawlApiToken: "test-token"
    }), "Loopback-only local Docker tests may run without Cloudflare Access credentials");

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
        crawlApiToken: "",
        cloudflareAccessClientId: "test-access-client-id",
        cloudflareAccessClientSecret: "test-access-client-secret"
    }), /crawl4ai_token_not_configured/);

    assert.deepEqual(__testing.normaliseSearxngResults({
        results: [{ url: "https://evil.example/" }]
    }, { includeDomains: "trusted.example" }), []);

    const noJsonProvider = createOpenSourceInspectionProvider({
        fetchImpl: async () => new Response("<!doctype html><title>Forbidden</title>", {
            status: 403,
            headers: { "content-type": "text/html" }
        }),
        searchBaseUrl: "https://search.internal.example",
        crawlBaseUrl: "https://crawl.internal.example",
        crawlApiToken: "test-token",
        cloudflareAccessClientId: "test-access-client-id",
        cloudflareAccessClientSecret: "test-access-client-secret"
    });
    await assert.rejects(
        () => noJsonProvider.search("test"),
        (error) => error.providerCode === "search_json_format_not_enabled"
    );

    const jsonErrorProvider = createOpenSourceInspectionProvider({
        fetchImpl: async () => new Response(JSON.stringify({ detail: "JSON disabled" }), {
            status: 403,
            headers: { "content-type": "application/json" }
        }),
        searchBaseUrl: "https://search.internal.example",
        crawlBaseUrl: "https://crawl.internal.example",
        crawlApiToken: "test-token",
        cloudflareAccessClientId: "test-access-client-id",
        cloudflareAccessClientSecret: "test-access-client-secret"
    });
    await assert.rejects(
        () => jsonErrorProvider.search("test"),
        (error) => error.providerCode === "search_json_format_not_enabled"
    );

    const { matchBusinessIdentity } = await import(
        "../supabase/functions/_shared/business-assessment-evidence.mjs"
    );

    const confirmedIdentity = matchBusinessIdentity({
        businessName: "The Cure Spa",
        location: "Waterkloof Glen Pretoria",
        title: "Beauty Business | The Cure Spa | Pretoria",
        text: "The Cure Spa provides beauty treatments in Waterkloof Glen, Pretoria.",
        sourceType: "website",
        sourceUrl: "https://www.thecurespa.co.za/"
    });
    assert.equal(confirmedIdentity.status, "confirmed");

    const thirdPartyIdentity = matchBusinessIdentity({
        businessName: "The Cure Spa",
        location: "Waterkloof Glen Pretoria",
        title: "The Cure Spa | Waterkloof Glen Pretoria",
        text: "The Cure Spa provides beauty treatments in Waterkloof Glen, Pretoria.",
        sourceType: "website",
        sourceUrl: "https://www.fresha.com/"
    });
    assert.equal(thirdPartyIdentity.status, "ambiguous",
        "A third-party directory must not be confirmed as the business's own website");

    const missingLocationIdentity = matchBusinessIdentity({
        businessName: "The Cure Spa",
        location: "Soweto",
        title: "The Cure Spa | Pretoria",
        text: "The Cure Spa provides beauty treatments in Pretoria.",
        sourceType: "website",
        sourceUrl: "https://www.thecurespa.co.za/"
    });
    assert.equal(missingLocationIdentity.status, "ambiguous",
        "A business-name/domain match without the supplied locality must remain ambiguous");

    const rejectedIdentity = matchBusinessIdentity({
        businessName: "The Cure Spa",
        location: "Soweto",
        title: "Kalm Skin + Body Studio",
        text: "Kalm Skin + Body Studio offers skincare in Pretoria.",
        sourceType: "website",
        sourceUrl: "https://www.kalm-studio.co.za/"
    });
    assert.equal(rejectedIdentity.status, "rejected",
        "A page matching neither the business name nor location must be rejected");

    const storePageIdentity = matchBusinessIdentity({
        businessName: "Kalm Skin + Body Studio",
        location: "Elarduspark Pretoria",
        title: "Our Stores – Kalm: Skin + Body Studio",
        text: "Kalm The Park / Elarduspark. Address: Shop 27 The Park Shopping Centre, Barnard Street, Elarduspark, Pretoria.",
        sourceType: "website",
        sourceUrl: "https://www.kalm-studio.co.za/pages/our-stores"
    });
    assert.equal(storePageIdentity.status, "confirmed",
        "A same-domain store page with the business name and supplied locality should confirm identity");

    const privateGatewayRoot = path.join(
        __dirname, "bof-open-source-provider-poc", "private-gateway"
    );
    const privateCompose = fs.readFileSync(path.join(privateGatewayRoot, "compose.yml"), "utf8");
    const privateCaddyfile = fs.readFileSync(path.join(privateGatewayRoot, "gateway", "Caddyfile"), "utf8");
    const privateSearxSettings = fs.readFileSync(path.join(privateGatewayRoot, "searxng", "settings.yml"), "utf8");
    const privateLimiter = fs.readFileSync(path.join(privateGatewayRoot, "searxng", "limiter.toml"), "utf8");
    const privateEnvExample = fs.readFileSync(path.join(privateGatewayRoot, ".env.example"), "utf8");

    assert.doesNotMatch(privateCompose, /^\s*ports:/m,
        "The private deployment Compose file must not publish host ports");
    assert.equal((privateCompose.match(/internal: true/g) || []).length, 3,
        "The gateway, search and crawler backplane networks must be internally isolated");
    assert.match(privateCompose, /10\.77\.10\.2/);
    assert.match(privateCompose, /10\.77\.20\.2/);
    assert.match(privateCompose, /10\.77\.30\.2/);
    assert.match(privateCompose, /CLOUDFLARED_TUNNEL_TOKEN_FILE/);
    assert.match(privateCompose, /--token-file/);
    assert.match(privateCompose, /condition: service_healthy/);
    assert.match(privateCompose, /SEARXNG_LIMITER: "true"/);
    assert.match(privateCompose, /SEARXNG_VALKEY_URL: valkey:\/\/valkey:6379\/0/);
    assert.match(privateCompose, /--maxmemory/);
    assert.match(privateCompose, /allkeys-lru/);
    assert.match(privateCompose, /memory: 384M/);
    assert.match(privateCompose, /--appendonly/);
    assert.match(privateCompose, /--save/);
    assert.match(privateCompose, /CADDY_IMAGE:\?/);
    assert.match(privateCompose, /VALKEY_IMAGE:\?/);
    assert.match(privateCompose, /CLOUDFLARED_IMAGE:\?/);
    assert.match(privateCompose, /unclecode\/crawl4ai:0\.9\.6@sha256:/);
    assert.match(privateCompose, /ghcr\.io\/searxng\/searxng:.*@sha256:/);
    assert.match(privateCompose, /search_egress/);
    assert.match(privateCompose, /crawl_egress/);
    assert.match(privateCompose, /cloudflare_egress/);

    const gatewayService = privateCompose.match(/  gateway:\n([\s\S]*?)\n  cloudflared:/)?.[1] || "";
    assert.ok(gatewayService, "The private Compose file must define a gateway service");
    assert.match(gatewayService, /tunnel_internal:/);
    assert.match(gatewayService, /search_internal:/);
    assert.match(gatewayService, /crawl_internal:/);
    assert.doesNotMatch(gatewayService, /_egress:/,
        "The Caddy gateway must not share outbound internet egress networks");

    const tunnelService = privateCompose.match(/  cloudflared:\n([\s\S]*?)\nnetworks:/)?.[1] || "";
    assert.ok(tunnelService, "The private Compose file must define a Cloudflare Tunnel connector");
    assert.match(tunnelService, /tunnel_internal/);
    assert.match(tunnelService, /cloudflare_egress/);
    assert.doesNotMatch(tunnelService, /ports:/);

    assert.match(privateCaddyfile, /path \/search/);
    assert.match(privateCaddyfile, /path \/crawl/);
    assert.match(privateCaddyfile, /method GET/);
    assert.match(privateCaddyfile, /method POST/);
    assert.match(privateCaddyfile, /header CF-Connecting-IP \*/);
    assert.match(privateCaddyfile, /X-Forwarded-For \{http\.request\.header\.CF-Connecting-IP\}/);
    assert.match(privateCaddyfile, /X-Real-IP \{http\.request\.header\.CF-Connecting-IP\}/);
    assert.equal((privateCaddyfile.match(/header_up -CF-Access-Client-Id/g) || []).length, 2,
        "Caddy must strip the Cloudflare Access client ID before forwarding to each upstream");
    assert.equal((privateCaddyfile.match(/header_up -CF-Access-Client-Secret/g) || []).length, 2,
        "Caddy must strip the Cloudflare Access client secret before forwarding to each upstream");
    assert.match(privateCaddyfile, /reverse_proxy searxng:8080/);
    assert.match(privateCaddyfile, /reverse_proxy crawl4ai:11235/);

    assert.match(privateSearxSettings, /limiter: true/);
    assert.match(privateSearxSettings, /- json/);
    assert.match(privateLimiter, /trusted_proxies/);
    assert.match(privateLimiter, /10\.77\.10\.2\/32/);
    assert.match(privateEnvExample, /CLOUDFLARED_TUNNEL_TOKEN_FILE/);
    assert.match(privateEnvExample, /CADDY_IMAGE=/);
    assert.match(privateEnvExample, /VALKEY_IMAGE=/);
    assert.match(privateEnvExample, /CLOUDFLARED_IMAGE=/);
    assert.doesNotMatch(privateEnvExample, /CF-Access-Client-Secret\s*=\s*[^\n]+/);

    console.log("Swayphics business identity matcher contract tests passed.");
    console.log("Business Opportunity Finder open-source provider adapter tests passed.");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
