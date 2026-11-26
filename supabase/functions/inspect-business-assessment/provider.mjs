export const INSPECTION_VERSION = "bof-evidence-2026-11-v1";
export const CONSENT_VERSION = "bof-public-presence-v1";

const DISALLOWED_HOSTS = new Set([
    "localhost",
    "metadata.google.internal",
    "metadata.google",
    "169.254.169.254"
]);

const PLATFORM_HOSTS = [
    ["instagram", /(^|\.)instagram\.com$/i],
    ["facebook", /(^|\.)facebook\.com$/i],
    ["tiktok", /(^|\.)tiktok\.com$/i],
    ["linkedin", /(^|\.)linkedin\.com$/i]
];

export function normalisePublicUrl(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    let url;
    try {
        url = new URL(value.trim());
    } catch {
        throw new Error("Enter a complete public website or profile URL.");
    }
    const hostname = url.hostname.toLowerCase();
    if (!["https:", "http:"].includes(url.protocol) ||
        url.username || url.password ||
        !hostname.includes(".") ||
        DISALLOWED_HOSTS.has(hostname) ||
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname.endsWith(".local") ||
        hostname.endsWith(".internal") ||
        hostname.endsWith(".test") ||
        /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) ||
        url.port && !["80", "443"].includes(url.port)) {
        throw new Error("Only public HTTP or HTTPS business URLs can be submitted.");
    }
    url.hash = "";
    return url.toString();
}

export function detectPlatform(value) {
    try {
        const hostname = new URL(value).hostname.toLowerCase();
        const found = PLATFORM_HOSTS.find(([, pattern]) => pattern.test(hostname));
        return found ? found[0] : null;
    } catch {
        return null;
    }
}

function normaliseWords(value) {
    return String(value || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
}

function significantTokens(value) {
    return normaliseWords(value).split(" ").filter((token) => token.length > 2);
}

export function matchBusinessIdentity({ businessName, location, title, text }) {
    const name = normaliseWords(businessName);
    const area = normaliseWords(location);
    const source = normaliseWords([title, text].filter(Boolean).join(" "));
    if (!name || !source) {
        return {
            status: "ambiguous",
            basis: ["The fetched page did not provide enough public text to confirm the business identity."]
        };
    }

    const nameTokens = significantTokens(name);
    const locationTokens = significantTokens(area);
    const exactName = source.includes(name);
    const allNameTokens = nameTokens.length > 0 && nameTokens.every((token) => source.includes(token));
    const locationMatch = locationTokens.length > 0 &&
        locationTokens.every((token) => source.includes(token));
    const businessNameMatch = exactName || allNameTokens;
    const basis = [];

    basis.push(businessNameMatch
        ? "The fetched title or public text contains the supplied business name."
        : "The fetched title or public text does not clearly match the supplied business name.");
    if (locationTokens.length) {
        basis.push(locationMatch
            ? "The fetched title or public text contains the supplied location."
            : "The supplied location could not be confirmed in the fetched content.");
    }

    if (businessNameMatch && locationMatch) return { status: "confirmed", basis };
    if (!businessNameMatch && !locationMatch) return { status: "rejected", basis };
    return { status: "ambiguous", basis };
}

export function mapTinyFishFetchError(error) {
    const code = String(error || "").toLowerCase();
    if (code === "bot_blocked") return "blocked";
    if (code === "timeout") return "timeout";
    if (code === "page_not_found" || code === "target_unreachable" ||
        code === "invalid_redirect_url" || code === "invalid_url" || code === "proxy_error") {
        return "unreachable";
    }
    return "fetch_error";
}

export function sanitiseExcerpt(value, maxLength = 500) {
    return String(value || "")
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
        .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength);
}

export function buildPageObservations({ title, description, language, links, text }) {
    const safeLinks = Array.isArray(links)
        ? links.filter((value) => typeof value === "string" && /^https?:\/\//i.test(value)).slice(0, 80)
        : [];
    const contactLinks = safeLinks.filter((value) => /contact|enquir|reach-us|reach_us/i.test(value)).slice(0, 5);
    const bookingLinks = safeLinks.filter((value) => /book|booking|appointment|reservation|schedule/i.test(value)).slice(0, 5);
    return {
        page_title: sanitiseExcerpt(title, 180) || null,
        meta_description: sanitiseExcerpt(description, 300) || null,
        language: typeof language === "string" ? language.slice(0, 12) : null,
        contact_links: contactLinks,
        booking_links: bookingLinks,
        public_excerpt: sanitiseExcerpt(text, 500),
        inspected_link_count: safeLinks.length
    };
}
