export const INSPECTION_VERSION = "bof-evidence-2026-11-v1";
export const CONSENT_VERSION = "bof-public-presence-v1";

const DISALLOWED_HOSTS = new Set([
    "localhost",
    "metadata.google.internal",
    "metadata.google",
    "169.254.169.254"
]);

function isGoogleMapsUrl(value) {
    try {
        const url = new URL(value);
        const hostname = url.hostname.toLowerCase();
        if (hostname === "maps.app.goo.gl" || hostname === "g.page") return true;
        const isGoogleHost = /(^|\.)google\.[a-z.]+$/i.test(hostname);
        return isGoogleHost &&
            (hostname.startsWith("maps.") || /^\/maps(?:\/|$)/i.test(url.pathname));
    } catch {
        return false;
    }
}

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

    // Retain only non-sensitive place identifiers for Google Maps URLs.
    // For ordinary business/profile URLs, query parameters are not needed
    // to identify the public page and may contain tracking or session data.
    const isGoogleMaps = isGoogleMapsUrl(url.toString());
    if (isGoogleMaps) {
        const allowedParams = new Set([
            "q", "query", "query_place_id", "cid", "ftid", "ll", "center", "zoom", "map_action", "api"
        ]);
        for (const key of Array.from(url.searchParams.keys())) {
            if (!allowedParams.has(key.toLowerCase())) url.searchParams.delete(key);
        }
    } else {
        url.search = "";
    }
    return url.toString();
}

/** @returns {string | null} */
export function detectPlatform(value) {
    try {
        const hostname = new URL(value).hostname.toLowerCase();
        if (/(^|\.)instagram\.com$/i.test(hostname)) return "instagram";
        if (/(^|\.)facebook\.com$/i.test(hostname)) return "facebook";
        if (/(^|\.)tiktok\.com$/i.test(hostname)) return "tiktok";
        if (/(^|\.)linkedin\.com$/i.test(hostname)) return "linkedin";
        return null;
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

export function matchBusinessIdentity({
    businessName,
    location,
    title,
    text,
    sourceType,
    sourceUrl
}) {
    const name = normaliseWords(businessName);
    const area = normaliseWords(location);
    const titleText = normaliseWords(title);
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
    const titleMatch = Boolean(titleText) &&
        (titleText.includes(name) || (nameTokens.length > 0 && nameTokens.every((token) => titleText.includes(token))));
    const basis = [];

    basis.push(businessNameMatch
        ? "The fetched title or public text contains the supplied business name."
        : "The fetched title or public text does not clearly match the supplied business name.");
    if (locationTokens.length) {
        basis.push(locationMatch
            ? "The fetched title or public text contains the supplied location."
            : "The supplied location could not be confirmed in the fetched content.");
    }

    // A directory, marketplace or generic search landing page can mention a
    // business and its suburb without being that business's own website.
    // Require an identity signal in the registered-domain label as well as
    // a matching page title before classifying a website as observed.
    if (sourceType === "website" && businessNameMatch && locationMatch && sourceUrl) {
        try {
            const labels = new URL(sourceUrl).hostname.toLowerCase().split(".");
            let domainLabel = labels.length >= 2 ? labels[labels.length - 2] : "";
            if (["co", "com", "org", "net", "gov", "ac", "edu"].includes(domainLabel) && labels.length >= 3) {
                domainLabel = labels[labels.length - 3];
            }
            const distinctiveTokens = nameTokens.filter((token) =>
                !["the", "hair", "beauty", "salon", "studio", "business", "company", "services", "group", "limited", "ltd", "pty"].includes(token)
            );
            const domainTokens = significantTokens(domainLabel);
            const domainMatch = (distinctiveTokens.length ? distinctiveTokens : nameTokens)
                .some((token) => domainTokens.some((domainToken) => domainToken.includes(token)));
            basis.push(domainMatch
                ? "The registered-domain label contains a distinctive part of the business name."
                : "The registered domain does not contain a distinctive part of the business name; the page may be a directory or third-party listing.");
            basis.push(titleMatch
                ? "The page title independently matches the supplied business name."
                : "The page title does not independently confirm the supplied business name.");
            if (domainMatch && titleMatch) return { status: "confirmed", basis };
            return { status: "ambiguous", basis };
        } catch {
            basis.push("The business website domain could not be checked safely.");
            return { status: "ambiguous", basis };
        }
    }

    if (sourceType === "social_profile" && businessNameMatch && locationMatch && sourceUrl) {
        try {
            if (!detectPlatform(sourceUrl)) {
                basis.push("The resolved destination is not on a supported public social platform.");
                return { status: "ambiguous", basis };
            }
            const slug = normaliseWords(new URL(sourceUrl).pathname);
            const distinctiveTokens = nameTokens.filter((token) =>
                !["the", "hair", "beauty", "salon", "studio", "business", "company", "services", "group", "limited", "ltd", "pty"].includes(token)
            );
            const slugMatch = (distinctiveTokens.length ? distinctiveTokens : nameTokens)
                .some((token) => slug.split(" ").some((slugToken) => slugToken.includes(token)));
            basis.push(slugMatch
                ? "The public profile URL contains a distinctive part of the business name."
                : "The public profile URL does not independently match the business name.");
            basis.push(titleMatch
                ? "The public profile title independently matches the supplied business name."
                : "The public profile title does not independently confirm the supplied business name.");
            if (slugMatch && titleMatch) return { status: "confirmed", basis };
            return { status: "ambiguous", basis };
        } catch {
            basis.push("The public profile URL could not be checked safely.");
            return { status: "ambiguous", basis };
        }
    }

    // A Google listing is on a known Google Maps host; still require both the
    // supplied business name and locality to be visible in the extracted page.
    if (sourceType === "google_business_profile") {
        if (!sourceUrl || !isGoogleMapsUrl(sourceUrl)) {
            basis.push("The resolved source is not a Google Maps or Business Profile URL.");
            return { status: "ambiguous", basis };
        }
        if (businessNameMatch && locationMatch) return { status: "confirmed", basis };
        return { status: "ambiguous", basis };
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

function sanitisePublicLink(value) {
    if (typeof value !== "string") return null;
    try {
        const normalised = normalisePublicUrl(value);
        if (!normalised) return null;
        const url = new URL(normalised);
        // Public link query strings can contain tracking IDs, email addresses or booking tokens.
        url.search = "";
        url.hash = "";
        return url.toString();
    } catch {
        return null;
    }
}

export function buildPageObservations({ title, description, language, links, text }) {
    const safeLinks = Array.isArray(links)
        ? links.map(sanitisePublicLink).filter(Boolean).slice(0, 80)
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
