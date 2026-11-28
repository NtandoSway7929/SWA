"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

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
        "http://localhost./",
        "http://169.254.169.254/latest/meta-data/",
        "http://service.internal/",
        "http://router.home.arpa/",
        "http://printer.lan/",
        "https://office.example/",
        "https://office.invalid/",
        "https://metadata.google./",
        "http://[::1]/",
        "http://[fc00::1]/",
        "http://[fe80::1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://2130706433/",
        "http://0177.0.0.1/",
        "http://0x7f000001/",
        "http://127.1/",
        "https://user:password@iana.org/",
        "https://iana.org:8443/",
        "ftp://iana.org/",
        "file:///etc/passwd",
        "http://service.localhost/",
        "http://service.localdomain/",
        "http://metadata.google.internal/",
        "http://[::ffff:7f00:1]/",
        "https://service.test/",
        "https://service.invalid/"
    ]) {
        await assert.rejects(
            () => provider.fetch([unsafeUrl]),
            /Only public HTTP or HTTPS business URLs can be submitted/
        );
    }
    assert.equal(calls.length, callsBeforeUnsafeUrls, "Unsafe destination URLs must be rejected before network access");

    const unsafeSearchResults = __testing.normaliseSearxngResults({
        results: [
            { url: "https://iana.org/", title: "Public" },
            { url: "http://127.0.0.1/", title: "Loopback" },
            { url: "http://169.254.169.254/latest/meta-data/", title: "Cloud metadata" },
            { url: "https://service.internal/", title: "Internal service" },
            { url: "https://user:password@iana.org/", title: "Credential URL" },
            { url: "https://iana.org:8443/", title: "Unexpected port" }
        ]
    });
    assert.deepEqual(
        unsafeSearchResults.map((item) => item.url),
        ["https://iana.org/"],
        "Search candidates must pass the same public-URL validation as crawler targets"
    );

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
    assert.match(privateCompose, /ipv4_address: 10\.77\.10\.254/);
    assert.match(privateCompose, /ipv4_address: 10\.77\.20\.254/);
    assert.match(privateCompose, /ipv4_address: 10\.77\.30\.254/);
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
    assert.match(privateCompose, /caddy:2\.11\.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0/);
    assert.match(privateCompose, /valkey\/valkey:9\.2\.1-alpine@sha256:3ad5a213cb1bc2fd4a113c89b6248a88655a6bf1dda69519d04e03cd3e3d2742/);
    assert.match(privateCompose, /cloudflare\/cloudflared:2026\.11\.2@sha256:55c7e3e8d89d5e8d20b75a82f3602cbf98e06db406e73e282073cfdc5a9a3af6/);
    assert.match(privateCompose, /unclecode\/crawl4ai:0\.9\.6@sha256:/);
    assert.match(privateCompose, /ghcr\.io\/searxng\/searxng:.*@sha256:/);
    assert.doesNotMatch(privateCompose, /(?:CADDY|VALKEY|CLOUDFLARED)_IMAGE/);
    assert.match(privateCompose, /search_egress/);
    assert.match(privateCompose, /crawl_egress/);
    assert.match(privateCompose, /cloudflare_egress/);
    assert.match(privateCompose, /search_egress:\s*\n\s+driver: bridge\s*\n\s+ipam:\s*\n\s+config:\s*\n\s+- subnet: 10\.77\.40\.0\/24/);
    assert.match(privateCompose, /crawl_egress:\s*\n\s+driver: bridge\s*\n\s+ipam:\s*\n\s+config:\s*\n\s+- subnet: 10\.77\.50\.0\/24/);
    assert.match(privateCompose, /cloudflare_egress:\s*\n\s+driver: bridge\s*\n\s+ipam:\s*\n\s+config:\s*\n\s+- subnet: 10\.77\.60\.0\/24/);

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
    assert.match(tunnelService, /profiles:\s*\n\s+- tunnel/,
        "The tunnel connector must be opt-in so CI can test the private gateway without a live tunnel token");
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
    assert.equal((privateCaddyfile.match(/header_up -Cf-Access-Jwt-Assertion/g) || []).length, 2,
        "Caddy must strip the Cloudflare Access JWT assertion before forwarding to each upstream");
    assert.match(privateCaddyfile, /reverse_proxy searxng:8080/);
    assert.match(privateCaddyfile, /reverse_proxy crawl4ai:11235/);
    assert.match(privateCaddyfile, /respond "not found" 404/,
        "Unknown paths and methods must not be proxied to either provider");

    assert.match(privateSearxSettings, /limiter: true/);
    assert.match(privateSearxSettings, /- json/);
    assert.match(privateLimiter, /trusted_proxies/);
    assert.match(privateLimiter, /10\.77\.10\.254\/32/);
    assert.match(privateEnvExample, /CLOUDFLARED_TUNNEL_TOKEN_FILE/);
    assert.match(privateEnvExample, /multi-platform sha256 index digest/);
    assert.doesNotMatch(privateEnvExample, /(?:CADDY|VALKEY|CLOUDFLARED)_IMAGE=/);
    assert.doesNotMatch(privateEnvExample, /CF-Access-Client-Secret\s*=\s*[^\n]+/);

    const firewallAuditScript = path.join(
        __dirname, "bof-open-source-provider-poc", "private-gateway",
        "audit-host-firewall-backend.sh"
    );
    assert.ok(fs.existsSync(firewallAuditScript),
        "The private gateway must include a read-only host firewall backend audit");

    const mockBin = fs.mkdtempSync(path.join(os.tmpdir(), "bof-firewall-audit-"));
    try {
        const mockCommands = {
            docker: '#!/bin/sh\nif [ "$1" = "info" ]; then printf " Firewall Backend: %s\\n" "$MOCK_DOCKER_FIREWALL_BACKEND"; exit 0; fi\nexit 1\n',
            iptables: '#!/bin/sh\nif [ "$1" = "-S" ] && [ "$2" = "DOCKER-USER" ]; then exit 0; fi\nexit 1\n',
            nft: '#!/bin/sh\nif [ "$1" = "list" ] && [ "$2" = "tables" ]; then exit 0; fi\nexit 1\n'
        };
        for (const [name, content] of Object.entries(mockCommands)) {
            const commandPath = path.join(mockBin, name);
            fs.writeFileSync(commandPath, content, { mode: 0o755 });
            fs.chmodSync(commandPath, 0o755);
        }
        const runAudit = (backend) => spawnSync("bash", [firewallAuditScript], {
            encoding: "utf8",
            env: {
                ...process.env,
                PATH: mockBin + path.delimiter + process.env.PATH,
                MOCK_DOCKER_FIREWALL_BACKEND: backend
            }
        });
        const iptablesAudit = runAudit("iptables");
        assert.equal(iptablesAudit.status, 0, iptablesAudit.stderr);
        assert.match(iptablesAudit.stdout, /DOCKER-USER/);
        const nftablesAudit = runAudit("nftables");
        assert.equal(nftablesAudit.status, 0, nftablesAudit.stderr);
        assert.match(nftablesAudit.stdout, /administrator-owned nftables table/);
        const unknownAudit = runAudit("unknown");
        assert.equal(unknownAudit.status, 2);
        assert.match(unknownAudit.stderr, /could not identify/i);
    } finally {
        fs.rmSync(mockBin, { recursive: true, force: true });
    }



    const firewallStateAuditScript = path.join(
        __dirname, "bof-open-source-provider-poc", "private-gateway",
        "audit-host-firewall-state.sh"
    );
    assert.ok(fs.existsSync(firewallStateAuditScript),
        "The private gateway must include a read-only host firewall state audit");

    const stateMockBin = fs.mkdtempSync(path.join(os.tmpdir(), "bof-firewall-state-"));
    try {
        const stateMocks = {
            docker: '#!/bin/sh\nif [ "$1" = "info" ]; then printf " Firewall Backend: %s\\n" "$MOCK_DOCKER_FIREWALL_BACKEND"; exit 0; fi\nexit 1\n',
            iptables: '#!/bin/sh\ncase "$*" in\n  "-S DOCKER-USER") printf "%s\\n" "$MOCK_IPTABLES_DOCKER_USER";;\n  "-S FORWARD") printf "%s\\n" "$MOCK_IPTABLES_FORWARD";;\n  "-t nat -S DOCKER") printf "%s\\n" "$MOCK_IPTABLES_NAT_DOCKER";;\n  *) echo "unexpected iptables arguments: $*" >&2; exit 1;;\nesac\n',
            ip6tables: '#!/bin/sh\ncase "$*" in\n  "-S FORWARD") printf "%s\\n" "$MOCK_IP6TABLES_FORWARD";;\n  "-S DOCKER-USER") if [ "$MOCK_IP6TABLES_DOCKER_USER_PRESENT" = "yes" ]; then printf "%s\\n" "$MOCK_IP6TABLES_DOCKER_USER"; else echo "No chain/target/match by that name." >&2; exit 1; fi;;\n  *) echo "unexpected ip6tables arguments: $*" >&2; exit 1;;\nesac\n',
            sysctl: '#!/bin/sh\nif [ "$1" != "-n" ]; then exit 1; fi\ncase "$2" in\n  net.ipv4.ip_forward) [ "$MOCK_SYSCTL_IPV4" != "missing" ] || exit 1; printf "%s\\n" "$MOCK_SYSCTL_IPV4";;\n  net.ipv6.conf.all.forwarding) [ "$MOCK_SYSCTL_IPV6" != "missing" ] || exit 1; printf "%s\\n" "$MOCK_SYSCTL_IPV6";;\n  *) exit 1;;\nesac\n',
            nft: '#!/bin/sh\ncase "$*" in\n  "list tables") exit 0;;\n  "-a list ruleset") printf "%s\\n" "$MOCK_NFT_RULESET";;\n  *) echo "unexpected nft arguments: $*" >&2; exit 1;;\nesac\n'
        };
        for (const [name, content] of Object.entries(stateMocks)) {
            const commandPath = path.join(stateMockBin, name);
            fs.writeFileSync(commandPath, content, { mode: 0o755 });
            fs.chmodSync(commandPath, 0o755);
        }

        const stateEnv = {
            ...process.env,
            PATH: stateMockBin + path.delimiter + process.env.PATH,
            MOCK_SYSCTL_IPV4: "1",
            MOCK_SYSCTL_IPV6: "1",
            MOCK_IPTABLES_FORWARD: "-P FORWARD ACCEPT\n-A FORWARD -j DOCKER-USER",
            MOCK_IPTABLES_DOCKER_USER: "-N DOCKER-USER\n-A DOCKER-USER -j RETURN",
            MOCK_IPTABLES_NAT_DOCKER: "-N DOCKER",
            MOCK_IP6TABLES_FORWARD: "-P FORWARD DROP",
            MOCK_IP6TABLES_DOCKER_USER_PRESENT: "yes",
            MOCK_IP6TABLES_DOCKER_USER: "-N DOCKER-USER",
            MOCK_NFT_RULESET: "table inet docker-bridges {\n chain forward {\n  type filter hook forward priority filter; policy accept;\n }\n }"
        };
        const runStateAudit = (backend, overrides = {}) => spawnSync(
            "bash", [firewallStateAuditScript],
            {
                encoding: "utf8",
                env: {
                    ...stateEnv,
                    ...overrides,
                    MOCK_DOCKER_FIREWALL_BACKEND: backend
                }
            }
        );

        const iptablesState = runStateAudit("iptables");
        assert.equal(iptablesState.status, 0, iptablesState.stderr);
        assert.match(iptablesState.stdout, /Docker firewall backend: iptables/);
        assert.ok(iptablesState.stdout.includes("net.ipv4.ip_forward=1"));
        assert.match(iptablesState.stdout, /IPv4 filter FORWARD chain/);
        assert.match(iptablesState.stdout, /-P FORWARD ACCEPT/);
        assert.match(iptablesState.stdout, /IPv4 DOCKER-USER chain/);
        assert.match(iptablesState.stdout, /IPv4 Docker NAT chain/);
        assert.match(iptablesState.stdout, /IPv6 filter FORWARD chain/);

        const nftablesState = runStateAudit("nftables");
        assert.equal(nftablesState.status, 0, nftablesState.stderr);
        assert.match(nftablesState.stdout, /Docker firewall backend: nftables/);
        assert.match(nftablesState.stdout, /Complete nftables ruleset/);
        assert.match(nftablesState.stdout, /priority filter/);

        const missingForwardingState = runStateAudit("iptables", {
            MOCK_SYSCTL_IPV6: "missing"
        });
        assert.equal(missingForwardingState.status, 2);
        assert.match(missingForwardingState.stderr, /host forwarding state is unknown/i);

        const missingIPv6UserChain = runStateAudit("iptables", {
            MOCK_IP6TABLES_DOCKER_USER_PRESENT: "no"
        });
        assert.equal(missingIPv6UserChain.status, 0, missingIPv6UserChain.stderr);
        assert.match(missingIPv6UserChain.stdout, /IPv6 DOCKER-USER chain/);
        assert.match(missingIPv6UserChain.stdout, /manual review is required/);
    } finally {
        fs.rmSync(stateMockBin, { recursive: true, force: true });
    }

    const networkAuditScript = path.join(
        __dirname, "bof-open-source-provider-poc", "private-gateway",
        "audit-host-network-overlap.py"
    );
    assert.ok(fs.existsSync(networkAuditScript),
        "The private gateway must include a read-only host subnet-overlap audit");

    const networkMockBin = fs.mkdtempSync(path.join(os.tmpdir(), "bof-network-audit-"));
    try {
        const mockCommands = {
            ip: '#!/bin/sh\ncase "$*" in\n  "-j address show") printf "%s" "$MOCK_IP_ADDRESS_JSON";;\n  "-j -4 route show table all") printf "%s" "$MOCK_IP_ROUTE4_JSON";;\n  "-j -6 route show table all") printf "%s" "$MOCK_IP_ROUTE6_JSON";;\n  *) echo "unexpected ip arguments: $*" >&2; exit 1;;\nesac\n',
            docker: '#!/bin/sh\nif [ "$1" = "context" ] && [ "$2" = "show" ]; then printf "%s\\n" "$MOCK_DOCKER_CONTEXT_NAME"; exit 0; fi\nif [ "$1" = "context" ] && [ "$2" = "inspect" ]; then printf "%s" "$MOCK_DOCKER_CONTEXT_JSON"; exit 0; fi\nif [ "$1" = "network" ] && [ "$2" = "ls" ] && [ "$3" = "-q" ]; then printf "%s\\n" "$MOCK_DOCKER_NETWORK_IDS"; exit 0; fi\nif [ "$1" = "network" ] && [ "$2" = "inspect" ]; then printf "%s" "$MOCK_DOCKER_NETWORK_INSPECT_JSON"; exit 0; fi\necho "unexpected docker arguments: $*" >&2\nexit 1\n',
        };
        for (const [name, content] of Object.entries(mockCommands)) {
            const commandPath = path.join(networkMockBin, name);
            fs.writeFileSync(commandPath, content, { mode: 0o755 });
            fs.chmodSync(commandPath, 0o755);
        }

        const cleanAddresses = [
            { ifname: "lo", addr_info: [{ family: "inet", local: "127.0.0.1", prefixlen: 8 }] },
            { ifname: "eth0", addr_info: [{ family: "inet", local: "192.0.2.10", prefixlen: 24 }] },
            { ifname: "eth0", addr_info: [{ family: "inet6", local: "2001:db8:1::10", prefixlen: 64 }] }
        ];
        const cleanRoutes4 = [
            { dst: "default", gateway: "192.0.2.1", dev: "eth0" },
            { dst: "192.0.2.0/24", dev: "eth0" }
        ];
        const cleanRoutes6 = [
            { dst: "default", gateway: "2001:db8:1::1", dev: "eth0" },
            { dst: "2001:db8:1::/64", dev: "eth0" }
        ];
        const cleanDockerNetworks = [
            { Name: "bridge", IPAM: { Config: [{ Subnet: "172.17.0.0/16" }] } },
            { Name: "existing-app", IPAM: { Config: [{ Subnet: "192.168.40.0/24" }] } }
        ];

        const localDockerContext = [
            { Name: "default", Endpoints: { docker: { Host: "unix:///var/run/docker.sock" } } }
        ];

        const runNetworkAudit = ({
            addresses = cleanAddresses,
            routes4 = cleanRoutes4,
            routes6 = cleanRoutes6,
            dockerNetworks = cleanDockerNetworks,
            dockerIds = "network-one\nnetwork-two",
            dockerContext = localDockerContext,
            dockerContextName = "default",
            dockerHost = ""
        } = {}) => spawnSync("python3", [networkAuditScript], {
            encoding: "utf8",
            env: {
                ...process.env,
                PATH: networkMockBin + path.delimiter + process.env.PATH,
                MOCK_IP_ADDRESS_JSON: JSON.stringify(addresses),
                MOCK_IP_ROUTE4_JSON: JSON.stringify(routes4),
                MOCK_IP_ROUTE6_JSON: JSON.stringify(routes6),
                MOCK_DOCKER_CONTEXT_NAME: dockerContextName,
                MOCK_DOCKER_CONTEXT_JSON: JSON.stringify(dockerContext),
                DOCKER_HOST: dockerHost,
                DOCKER_CONTEXT: "",
                MOCK_DOCKER_NETWORK_IDS: dockerIds,
                MOCK_DOCKER_NETWORK_INSPECT_JSON: JSON.stringify(dockerNetworks)
            }
        });

        const cleanAudit = runNetworkAudit();
        assert.equal(cleanAudit.status, 0, cleanAudit.stderr);
        assert.match(cleanAudit.stdout, /PASS: no overlap detected/);
        assert.match(cleanAudit.stdout, /non-default routes/);
        assert.match(cleanAudit.stdout, /Verified Docker context: default/);
        assert.match(cleanAudit.stdout, /unix:\/\/\/var\/run\/docker\.sock/);

        const remoteDockerContext = runNetworkAudit({
            dockerContextName: "remote",
            dockerContext: [
                { Name: "remote", Endpoints: { docker: { Host: "ssh://deploy@example.invalid" } } }
            ]
        });
        assert.equal(remoteDockerContext.status, 2);
        assert.match(remoteDockerContext.stderr, /not a local Linux Unix-socket endpoint/i);

        const dockerHostOverride = runNetworkAudit({ dockerHost: "tcp://192.0.2.20:2376" });
        assert.equal(dockerHostOverride.status, 2);
        assert.match(dockerHostOverride.stderr, /DOCKER_HOST is set/i);

        const interfaceConflict = runNetworkAudit({
            addresses: [
                { ifname: "eth0", addr_info: [{ family: "inet", local: "10.77.8.5", prefixlen: 21 }] }
            ]
        });
        assert.equal(interfaceConflict.status, 1, interfaceConflict.stderr);
        assert.match(interfaceConflict.stdout, /host interface eth0/);
        assert.match(interfaceConflict.stdout, /10\.77\.10\.0\/24/);

        const routeConflict = runNetworkAudit({
            routes4: [{ dst: "default" }, { dst: "10.77.0.0/16", dev: "vpn0" }]
        });
        assert.equal(routeConflict.status, 1, routeConflict.stderr);
        assert.match(routeConflict.stdout, /IPv4 route via vpn0/);
        assert.match(routeConflict.stdout, /10\.77\.0\.0\/16/);

        const dockerConflict = runNetworkAudit({
            dockerNetworks: [
                { Name: "existing-gateway", IPAM: { Config: [{ Subnet: "10.77.50.0/24" }] } }
            ],
            dockerIds: "network-one"
        });
        assert.equal(dockerConflict.status, 1, dockerConflict.stderr);
        assert.match(dockerConflict.stdout, /Docker network existing-gateway/);
        assert.match(dockerConflict.stdout, /10\.77\.50\.0\/24/);

        const malformedDockerInventory = spawnSync("python3", [networkAuditScript], {
            encoding: "utf8",
            env: {
                ...process.env,
                PATH: networkMockBin + path.delimiter + process.env.PATH,
                MOCK_IP_ADDRESS_JSON: JSON.stringify(cleanAddresses),
                MOCK_IP_ROUTE4_JSON: JSON.stringify(cleanRoutes4),
                MOCK_IP_ROUTE6_JSON: JSON.stringify(cleanRoutes6),
                MOCK_DOCKER_CONTEXT_NAME: "default",
                MOCK_DOCKER_CONTEXT_JSON: JSON.stringify(localDockerContext),
                DOCKER_HOST: "",
                DOCKER_CONTEXT: "",
                MOCK_DOCKER_NETWORK_IDS: "network-one",
                MOCK_DOCKER_NETWORK_INSPECT_JSON: "not-json"
            }
        });
        assert.equal(malformedDockerInventory.status, 2);
        assert.match(malformedDockerInventory.stderr, /audit incomplete/i);
    } finally {
        fs.rmSync(networkMockBin, { recursive: true, force: true });
    }

    console.log("Swayphics business identity matcher contract tests passed.");
    console.log("Business Opportunity Finder open-source provider adapter tests passed.");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
