"use strict";

const http = require("node:http");

const gatewayOrigin = process.env.BOF_GATEWAY_INTERNAL_URL || "http://10.77.30.254:8080";
const publicHost = process.env.BOF_GATEWAY_PUBLIC_HOST || "bof-inspect.swayphics.co.za";
const crawlToken = process.env.CRAWL4AI_API_TOKEN || "";
const forwardedIp = "203.0.113.77";

if (!crawlToken) {
    throw new Error("CRAWL4AI_API_TOKEN is required for the private gateway smoke test");
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function request(path, {
    method = "GET",
    headers = {},
    body,
    timeoutMs = 20_000
} = {}) {
    const target = new URL(path, gatewayOrigin);
    return new Promise((resolve, reject) => {
        const req = http.request({
            protocol: target.protocol,
            hostname: target.hostname,
            port: target.port,
            path: target.pathname + target.search,
            method,
            headers: {
                Host: publicHost,
                ...headers
            }
        }, (res) => {
            const chunks = [];
            let size = 0;
            res.on("data", (chunk) => {
                size += chunk.length;
                if (size > 2_000_000) {
                    req.destroy(new Error("gateway_smoke_response_too_large"));
                    return;
                }
                chunks.push(chunk);
            });
            res.on("end", () => resolve({
                status: res.statusCode || 0,
                headers: res.headers,
                body: Buffer.concat(chunks).toString("utf8")
            }));
        });
        req.setTimeout(timeoutMs, () => req.destroy(new Error("gateway_smoke_timeout")));
        req.on("error", reject);
        if (body !== undefined) req.write(body);
        req.end();
    });
}

function parseJson(response, serviceName) {
    try {
        return JSON.parse(response.body);
    } catch {
        throw new Error(serviceName + "_returned_invalid_json_http_" + response.status);
    }
}

async function assertNotRouted() {
    const missingIp = await request("/search?q=generic+smoke+test&format=json");
    assert(missingIp.status === 404,
        "Search requests without CF-Connecting-IP must not reach SearXNG");

    const wrongSearchMethod = await request("/search", {
        method: "POST",
        headers: { "CF-Connecting-IP": forwardedIp },
        body: "{}"
    });
    assert(wrongSearchMethod.status === 404,
        "POST /search must not be proxied");

    const wrongCrawlerMethod = await request("/crawl", {
        method: "GET",
        headers: { "CF-Connecting-IP": forwardedIp }
    });
    assert(wrongCrawlerMethod.status === 404,
        "GET /crawl must not be proxied");

    const unknownPath = await request("/", {
        headers: { "CF-Connecting-IP": forwardedIp }
    });
    assert(unknownPath.status === 404,
        "Unknown gateway paths must not be proxied");

    console.log("Gateway path, method and client-IP routing denials passed.");
}

async function runSearch() {
    const params = new URLSearchParams({
        q: "Crawl4AI open source web crawler",
        format: "json",
        language: "en",
        safesearch: "1",
        pageno: "1"
    });
    let lastStatus = 0;
    let lastError = "";

    for (let attempt = 1; attempt <= 24; attempt += 1) {
        try {
            const response = await request("/search?" + params.toString(), {
                headers: {
                    Accept: "application/json",
                    "CF-Connecting-IP": forwardedIp,
                    "CF-Access-Client-Id": "poc-probe-client-id",
                    "CF-Access-Client-Secret": "poc-probe-client-secret",
                    "Cf-Access-Jwt-Assertion": "poc-probe-jwt"
                },
                timeoutMs: 12_000
            });
            lastStatus = response.status;
            if (response.status === 200) {
                const payload = parseJson(response, "search");
                assert(Array.isArray(payload?.results),
                    "SearXNG response must contain a results array");
                return payload.results.length;
            }
            lastError = "http_" + response.status;
            if (response.status === 404) break;
        } catch (error) {
            lastError = error.message;
        }
        await sleep(2_000);
    }

    throw new Error("Private gateway search smoke test failed: " +
        (lastError || "http_" + lastStatus));
}

async function runCrawler() {
    const payload = {
        urls: ["https://example.com/"],
        browser_config: {},
        crawler_config: {}
    };
    const response = await request("/crawl", {
        method: "POST",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: "Bearer " + crawlToken,
            "CF-Connecting-IP": forwardedIp,
            "CF-Access-Client-Id": "poc-probe-client-id",
            "CF-Access-Client-Secret": "poc-probe-client-secret",
            "Cf-Access-Jwt-Assertion": "poc-probe-jwt"
        },
        body: JSON.stringify(payload),
        timeoutMs: 110_000
    });

    assert(response.status === 200,
        "Caddy /crawl route returned HTTP " + response.status);
    const data = parseJson(response, "crawl");
    assert(Array.isArray(data?.results) && data.results.length === 1,
        "Crawl4AI must return exactly one result for the reserved test URL");

    const page = data.results[0];
    const markdown = typeof page.markdown === "string"
        ? page.markdown
        : page.markdown && typeof page.markdown === "object"
            ? page.markdown.raw_markdown ||
                page.markdown.markdown_with_citations ||
                page.markdown.fit_markdown || ""
            : "";
    const readableText = markdown ||
        (typeof page.extracted_content === "string" ? page.extracted_content : "");
    const statusCode = Number.isInteger(page.status_code) ? page.status_code : null;

    assert(page.success === true, "Crawl4AI did not mark the reserved test page as successful");
    assert(statusCode === null || (statusCode >= 200 && statusCode < 300),
        "Crawl4AI returned a non-2xx page status");
    assert(typeof readableText === "string" && readableText.trim().length >= 30,
        "Crawl4AI did not return readable page text");

    const finalUrl = page.redirected_url || page.url || payload.urls[0];
    const finalHost = new URL(finalUrl).hostname.toLowerCase();
    assert(finalHost === "example.com" || finalHost === "www.example.com",
        "The reserved test URL unexpectedly redirected to another host");

    console.log("Gateway /crawl reached Crawl4AI; reserved example.com fetch succeeded with readable text.");
}

async function main() {
    await assertNotRouted();
    const resultCount = await runSearch();
    console.log("Gateway /search reached SearXNG; JSON response valid (" +
        resultCount + " candidates returned for the generic test query).");
    await runCrawler();
    console.log("Private gateway internal runtime smoke test passed.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
