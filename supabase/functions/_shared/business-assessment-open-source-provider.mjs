import { normalisePublicUrl } from "./business-assessment-evidence.mjs";

export const OPEN_SOURCE_PROVIDER_VERSION = "bof-open-source-provider-poc-v1";
export const OPEN_SOURCE_MAX_FETCH_URLS = 8;

const DEFAULT_SEARCH_TIMEOUT_MS = 15_000;
const DEFAULT_FETCH_TIMEOUT_MS = 45_000;
const MAX_RESPONSE_BYTES = 2_000_000;

function serviceBaseUrl(value, name) {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(name + "_not_configured");
    }

    let url;
    try {
        url = new URL(value.trim());
    } catch {
        throw new Error(name + "_invalid_url");
    }

    const isLoopbackHttp = url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "::1"].includes(url.hostname);

    if (url.protocol !== "https:" && !isLoopbackHttp) {
        throw new Error(name + "_must_use_https");
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new Error(name + "_invalid_url");
    }

    return url.toString().replace(/\/+$/, "");
}

function normaliseDomainList(value) {
    const entries = Array.isArray(value) ? value : String(value || "").split(",");
    return [...new Set(entries.map((item) => String(item || "").trim().toLowerCase())
        .filter(Boolean)
        .map((item) => item.replace(/^https?:\/\//, "").replace(/\/$/, "")))];
}

function hostMatchesDomain(hostname, domain) {
    return hostname === domain || hostname.endsWith("." + domain);
}

function allowedByDomainFilters(urlValue, includeDomains, excludeDomains) {
    let hostname;
    try {
        hostname = new URL(urlValue).hostname.toLowerCase();
    } catch {
        return false;
    }

    if (includeDomains.length &&
        !includeDomains.some((domain) => hostMatchesDomain(hostname, domain))) {
        return false;
    }
    return !excludeDomains.some((domain) => hostMatchesDomain(hostname, domain));
}

function normaliseSearxngResults(payload, options = {}) {
    const maxResults = Math.max(1, Math.min(20, Number(options.maxResults) || 10));
    const includeDomains = normaliseDomainList(options.includeDomains);
    const excludeDomains = normaliseDomainList(options.excludeDomains);
    const rawResults = Array.isArray(payload?.results) ? payload.results : [];

    const results = [];
    const seen = new Set();

    for (const item of rawResults) {
        const rawUrl = typeof item?.url === "string" ? item.url : "";
        let url;
        try {
            url = normalisePublicUrl(rawUrl);
        } catch {
            continue;
        }
        if (!url || seen.has(url) ||
            !allowedByDomainFilters(url, includeDomains, excludeDomains)) {
            continue;
        }

        seen.add(url);
        results.push({
            url,
            title: typeof item?.title === "string" ? item.title.slice(0, 300) : "",
            snippet: typeof item?.content === "string"
                ? item.content.slice(0, 1200)
                : typeof item?.snippet === "string" ? item.snippet.slice(0, 1200) : ""
        });

        if (results.length >= maxResults) break;
    }

    return results;
}

function flattenCrawlLinks(links) {
    if (!links || typeof links !== "object") return [];

    const values = [
        ...(Array.isArray(links.internal) ? links.internal : []),
        ...(Array.isArray(links.external) ? links.external : [])
    ];

    const seen = new Set();
    const output = [];
    for (const item of values) {
        const rawUrl = typeof item === "string"
            ? item
            : typeof item?.href === "string" ? item.href
                : typeof item?.url === "string" ? item.url : "";
        let url;
        try {
            url = normalisePublicUrl(rawUrl);
        } catch {
            continue;
        }
        if (!url || seen.has(url)) continue;
        seen.add(url);
        output.push(url);
        if (output.length >= 150) break;
    }
    return output;
}

function markdownText(markdown) {
    if (typeof markdown === "string") return markdown;
    if (!markdown || typeof markdown !== "object") return "";
    for (const key of ["raw_markdown", "markdown_with_citations", "fit_markdown"]) {
        if (typeof markdown[key] === "string" && markdown[key]) return markdown[key];
    }
    return "";
}

function responseHeader(headers, wantedName) {
    if (!headers || typeof headers !== "object") return null;
    const wanted = wantedName.toLowerCase();
    const key = Object.keys(headers).find((name) => name.toLowerCase() === wanted);
    return key ? String(headers[key]).slice(0, 300) : null;
}

function normaliseCrawlResult(item, requestedUrl) {
    const metadata = item?.metadata && typeof item.metadata === "object"
        ? item.metadata
        : {};

    let finalUrl = requestedUrl;
    try {
        finalUrl = normalisePublicUrl(
            typeof item?.redirected_url === "string" && item.redirected_url
                ? item.redirected_url
                : typeof item?.url === "string" && item.url ? item.url : requestedUrl
        ) || requestedUrl;
    } catch {
        return {
            url: requestedUrl,
            final_url: null,
            success: false,
            error_code: "invalid_redirect_url",
            title: "",
            description: "",
            language: "",
            text: "",
            links: []
        };
    }

    const text = markdownText(item?.markdown) ||
        (typeof item?.extracted_content === "string" ? item.extracted_content : "");

    return {
        url: requestedUrl,
        final_url: finalUrl,
        success: item?.success === true && Boolean(text.trim()),
        error_code: item?.success === true
            ? (text.trim() ? null : "empty_content")
            : "fetch_error",
        title: typeof metadata.title === "string" ? metadata.title.slice(0, 300) : "",
        description: typeof metadata.description === "string"
            ? metadata.description.slice(0, 1000)
            : "",
        language: typeof metadata.language === "string" ? metadata.language.slice(0, 40) : "",
        text: text.slice(0, 40_000),
        links: flattenCrawlLinks(item?.links),
        etag: responseHeader(item?.response_headers, "etag"),
        last_modified: responseHeader(item?.response_headers, "last-modified"),
        status_code: Number.isInteger(item?.status_code) ? item.status_code : null
    };
}

async function readJsonResponse(response, timeoutController) {
    const announcedLength = Number(response.headers?.get?.("content-length") || 0);
    if (announcedLength > MAX_RESPONSE_BYTES) {
        timeoutController.abort();
        throw new Error("provider_response_too_large");
    }

    let bodyText = "";
    if (response.body?.getReader) {
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > MAX_RESPONSE_BYTES) {
                await reader.cancel();
                timeoutController.abort();
                throw new Error("provider_response_too_large");
            }
            chunks.push(part.value);
        }
        const merged = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.byteLength;
        }
        bodyText = new TextDecoder().decode(merged);
    } else {
        bodyText = await response.text();
        if (new TextEncoder().encode(bodyText).byteLength > MAX_RESPONSE_BYTES) {
            timeoutController.abort();
            throw new Error("provider_response_too_large");
        }
    }

    try {
        return bodyText ? JSON.parse(bodyText) : null;
    } catch {
        throw new Error("provider_invalid_json");
    }
}

async function requestJson(fetchImpl, url, init, timeoutMs, serviceName) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetchImpl(url, { ...init, signal: controller.signal });
        const payload = await readJsonResponse(response, controller);

        if (!response.ok) {
            const status = Number(response.status) || 0;
            const code = status === 403 && serviceName === "search"
                ? "search_json_format_not_enabled"
                : status === 429 ? "provider_rate_limited"
                    : status === 401 || status === 403 ? "provider_auth_failed"
                        : status >= 500 ? "provider_unavailable" : "provider_http_error";
            const error = new Error(code);
            error.providerCode = code;
            error.status = status;
            error.requestId = response.headers?.get?.("x-request-id") || null;
            throw error;
        }

        return {
            data: payload,
            requestId: response.headers?.get?.("x-request-id") || null
        };
    } catch (error) {
        if (error?.name === "AbortError") {
            const timeoutError = new Error(serviceName + "_timeout");
            timeoutError.providerCode = "timeout";
            throw timeoutError;
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

export function createOpenSourceInspectionProvider({
    fetchImpl = fetch,
    searchBaseUrl,
    crawlBaseUrl,
    crawlApiToken,
    searchTimeoutMs = DEFAULT_SEARCH_TIMEOUT_MS,
    fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS
} = {}) {
    const searchOrigin = serviceBaseUrl(searchBaseUrl, "searxng");
    const crawlOrigin = serviceBaseUrl(crawlBaseUrl, "crawl4ai");
    const crawlToken = typeof crawlApiToken === "string" ? crawlApiToken.trim() : "";

    if (!crawlToken) throw new Error("crawl4ai_token_not_configured");
    if (typeof fetchImpl !== "function") throw new Error("fetch_implementation_required");

    return {
        version: OPEN_SOURCE_PROVIDER_VERSION,

        async search(query, options = {}) {
            const value = String(query || "").trim();
            if (!value || value.length > 500) throw new Error("invalid_search_query");

            const url = new URL("/search", searchOrigin);
            url.searchParams.set("q", value);
            url.searchParams.set("format", "json");
            url.searchParams.set("language", "en");
            url.searchParams.set("safesearch", "1");
            url.searchParams.set("pageno", "1");

            const { data, requestId } = await requestJson(fetchImpl, url.toString(), {
                method: "GET",
                headers: { Accept: "application/json" }
            }, searchTimeoutMs, "search");

            return {
                requestId,
                results: normaliseSearxngResults(data, options)
            };
        },

        async fetch(urls) {
            if (!Array.isArray(urls) || urls.length < 1 ||
                urls.length > OPEN_SOURCE_MAX_FETCH_URLS) {
                throw new Error("invalid_fetch_url_count");
            }

            const normalisedUrls = [];
            const seen = new Set();
            for (const value of urls) {
                const url = normalisePublicUrl(value);
                if (!url) throw new Error("invalid_fetch_url");
                if (!seen.has(url)) {
                    seen.add(url);
                    normalisedUrls.push(url);
                }
            }
            if (!normalisedUrls.length) throw new Error("no_fetch_urls");

            const endpoint = new URL("/crawl", crawlOrigin);
            const { data, requestId } = await requestJson(fetchImpl, endpoint.toString(), {
                method: "POST",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + crawlToken
                },
                body: JSON.stringify({
                    urls: normalisedUrls,
                    browser_config: {},
                    crawler_config: {}
                })
            }, fetchTimeoutMs, "fetch");

            const results = Array.isArray(data?.results) ? data.results : [];
            const byRequestedUrl = new Map();

            results.forEach((item, index) => {
                const rawUrl = typeof item?.url === "string" ? item.url : normalisedUrls[index];
                let key = null;
                try { key = normalisePublicUrl(rawUrl); } catch { /* invalid result URL */ }
                if (key && !byRequestedUrl.has(key)) byRequestedUrl.set(key, item);
            });

            return {
                requestId,
                results: normalisedUrls.map((requestedUrl, index) => {
                    const item = byRequestedUrl.get(requestedUrl) || results[index] || null;
                    if (!item) {
                        return {
                            url: requestedUrl,
                            final_url: null,
                            success: false,
                            error_code: "fetch_result_missing",
                            title: "",
                            description: "",
                            language: "",
                            text: "",
                            links: []
                        };
                    }
                    return normaliseCrawlResult(item, requestedUrl);
                })
            };
        }
    };
}

export const __testing = {
    normaliseSearxngResults,
    normaliseCrawlResult,
    flattenCrawlLinks
};
