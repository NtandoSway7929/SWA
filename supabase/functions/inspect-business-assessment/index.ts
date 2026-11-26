import { createClient } from "npm:@supabase/supabase-js@2";
import {
    CONSENT_VERSION,
    INSPECTION_VERSION,
    buildPageObservations,
    detectPlatform,
    mapTinyFishFetchError,
    matchBusinessIdentity,
    normalisePublicUrl,
    sanitiseExcerpt
} from "./provider.mjs";

declare const EdgeRuntime: {
    waitUntil(promise: Promise<unknown>): void;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const TINYFISH_API_KEY = Deno.env.get("TINYFISH_API_KEY") ?? "";
const ALLOWED_ORIGINS = new Set([
    "https://swayphics.co.za",
    "https://www.swayphics.co.za"
]);
const MAX_BODY_BYTES = 8000;
const MAX_FETCH_URLS = 8;
const SEARCH_TIMEOUT_MS = 15000;
const FETCH_TIMEOUT_MS = 45000;

type SourceType = "website" | "google_business_profile" | "social_profile";
type Candidate = {
    source_type: SourceType;
    platform: string | null;
    requested_url: string | null;
    source_url: string;
    source_title: string | null;
    search_snippet: string | null;
};

function corsHeaders(origin = "") {
    const headers: Record<string, string> = {
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Vary": "Origin"
    };
    if (ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
    return headers;
}

function jsonResponse(payload: unknown, status: number, origin = "") {
    return Response.json(payload, {
        status,
        headers: {
            ...corsHeaders(origin),
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
        }
    });
}

function isUuid(value: unknown): value is string {
    return typeof value === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function readJsonBody(request: Request) {
    const length = Number(request.headers.get("content-length") || 0);
    if (length > MAX_BODY_BYTES) {
        throw Object.assign(new Error("The inspection request is too large."), { status: 413 });
    }
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
        throw Object.assign(new Error("The inspection request is too large."), { status: 413 });
    }
    try {
        return JSON.parse(text);
    } catch {
        throw Object.assign(new Error("Send a valid JSON inspection request."), { status: 400 });
    }
}

function createServiceClient() {
    return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
    });
}

async function verifyAdmin(request: Request) {
    const authHeader = request.headers.get("authorization") || "";
    const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1] || "";
    if (!bearer || !ANON_KEY) return false;

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: "Bearer " + bearer } }
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(bearer);
    if (userError || !userData?.user?.id) return false;

    const { data: isAdmin, error: adminError } = await userClient.rpc("is_swayphics_admin");
    return !adminError && isAdmin === true;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        const bodyText = await response.text();
        let data: any = null;
        try {
            data = bodyText ? JSON.parse(bodyText) : null;
        } catch {
            data = { message: sanitiseExcerpt(bodyText, 240) };
        }
        if (!response.ok) {
            const error = new Error("TinyFish provider returned HTTP " + response.status);
            Object.assign(error, {
                status: response.status,
                providerCode: String(data?.error?.code || data?.code || "provider_http_error").slice(0, 80),
                requestId: response.headers.get("x-request-id") || response.headers.get("x-tinyfish-request-id")
            });
            throw error;
        }
        return {
            data,
            requestId: response.headers.get("x-request-id") || response.headers.get("x-tinyfish-request-id")
        };
    } finally {
        clearTimeout(timeout);
    }
}

function hostOf(value: string) {
    try {
        return new URL(value).hostname.toLowerCase();
    } catch {
        return "";
    }
}

function isGoogleMapsUrl(value: string) {
    const host = hostOf(value);
    return host === "google.com" || host.endsWith(".google.com") ||
        /^google\.[a-z.]+$/i.test(host) ||
        host === "maps.app.goo.gl" || host === "g.page";
}

function isSocialUrl(value: string) {
    return Boolean(detectPlatform(value));
}

function addCandidate(target: Candidate[], seen: Set<string>, item: Candidate) {
    const normalised = normalisePublicUrl(item.source_url);
    if (!normalised || seen.has(normalised) || target.length >= MAX_FETCH_URLS) return;
    seen.add(normalised);
    target.push({ ...item, source_url: normalised });
}

async function tinyfishSearch(query: string, includeDomains?: string, excludeDomains?: string) {
    const url = new URL("https://api.search.tinyfish.ai/");
    url.searchParams.set("query", query);
    url.searchParams.set("location", "ZA");
    url.searchParams.set("language", "en");
    if (includeDomains) url.searchParams.set("include_domains", includeDomains);
    if (excludeDomains) url.searchParams.set("exclude_domains", excludeDomains);

    const { data, requestId } = await fetchJson(url.toString(), {
        method: "GET",
        headers: { "X-API-Key": TINYFISH_API_KEY }
    }, SEARCH_TIMEOUT_MS);

    const results = Array.isArray(data?.results) ? data.results :
        Array.isArray(data?.data?.results) ? data.data.results : [];
    return {
        requestId,
        results: results.map((item: any) => ({
            url: typeof item?.url === "string" ? item.url :
                typeof item?.link === "string" ? item.link : "",
            title: typeof item?.title === "string" ? item.title :
                typeof item?.site_name === "string" ? item.site_name : "",
            snippet: typeof item?.snippet === "string" ? item.snippet : ""
        })).filter((item: any) => item.url)
    };
}

async function discoverCandidates(assessment: any): Promise<{
    candidates: Candidate[];
    noResults: SourceType[];
    searchErrors: Array<{ source_type: SourceType; code: string; request_id: string | null }>;
}> {
    const profile = assessment.business_profile || {};
    const presence = profile.public_presence || {};
    const businessName = String(profile.business_name || assessment.business_name || "").trim();
    const location = String(profile.location || "").trim();
    const candidates: Candidate[] = [];
    const seen = new Set<string>();
    const noResults: SourceType[] = [];
    const searchErrors: Array<{ source_type: SourceType; code: string; request_id: string | null }> = [];

    const websiteUrl = presence.website_url ? normalisePublicUrl(presence.website_url) : null;
    const googleUrl = presence.google_business_profile_url
        ? normalisePublicUrl(presence.google_business_profile_url)
        : null;
    const socials = Array.isArray(presence.social_profile_urls)
        ? presence.social_profile_urls.slice(0, 4)
        : [];

    if (websiteUrl) {
        if (isSocialUrl(websiteUrl) || isGoogleMapsUrl(websiteUrl)) {
            throw new Error("The supplied website URL must be a business website, not a social or Google Maps profile.");
        }
        addCandidate(candidates, seen, {
            source_type: "website", platform: null, requested_url: websiteUrl,
            source_url: websiteUrl, source_title: null, search_snippet: null
        });
    } else {
        try {
            const search = await tinyfishSearch(
                businessName + " " + location + " official website",
                undefined,
                "instagram.com,facebook.com,tiktok.com,linkedin.com,google.com"
            );
            const match = search.results.find((item: any) => {
                const url = normalisePublicUrl(item.url);
                return url && !isSocialUrl(url) && !isGoogleMapsUrl(url);
            });
            if (match) {
                addCandidate(candidates, seen, {
                    source_type: "website", platform: null, requested_url: null,
                    source_url: match.url, source_title: match.title, search_snippet: match.snippet
                });
            } else noResults.push("website");
        } catch (error) {
            searchErrors.push({
                source_type: "website",
                code: String((error as any)?.providerCode || "search_error"),
                request_id: (error as any)?.requestId || null
            });
        }
    }

    if (googleUrl) {
        if (!isGoogleMapsUrl(googleUrl)) throw new Error("The Google Business Profile field must contain a Google Maps or Google profile link.");
        addCandidate(candidates, seen, {
            source_type: "google_business_profile", platform: "google_maps", requested_url: googleUrl,
            source_url: googleUrl, source_title: null, search_snippet: null
        });
    } else {
        try {
            const search = await tinyfishSearch(
                businessName + " " + location + " Google Maps business profile",
                "google.com,maps.app.goo.gl,g.page"
            );
            const match = search.results.find((item: any) => {
                const url = normalisePublicUrl(item.url);
                return url && isGoogleMapsUrl(url);
            });
            if (match) {
                addCandidate(candidates, seen, {
                    source_type: "google_business_profile", platform: "google_maps", requested_url: null,
                    source_url: match.url, source_title: match.title, search_snippet: match.snippet
                });
            } else noResults.push("google_business_profile");
        } catch (error) {
            searchErrors.push({
                source_type: "google_business_profile",
                code: String((error as any)?.providerCode || "search_error"),
                request_id: (error as any)?.requestId || null
            });
        }
    }

    const requestedPlatforms = new Set<string>();
    for (const entry of socials) {
        if (!entry || typeof entry.url !== "string" || !entry.url.trim()) continue;
        const url = normalisePublicUrl(entry.url);
        const platform = detectPlatform(url);
        if (!platform || (entry.platform && entry.platform !== platform)) {
            throw new Error("Each social profile URL must match its selected public platform.");
        }
        requestedPlatforms.add(platform);
        addCandidate(candidates, seen, {
            source_type: "social_profile", platform, requested_url: url,
            source_url: url, source_title: null, search_snippet: null
        });
    }

    const socialPlatforms = ["instagram", "facebook", "tiktok", "linkedin"];
    for (const platform of socialPlatforms) {
        if (requestedPlatforms.has(platform) || socials.some((entry: any) => detectPlatform(entry?.url || "") === platform)) continue;
        if (candidates.filter((item) => item.source_type === "social_profile").length >= 4) break;
        try {
            const domain = platform + ".com";
            const search = await tinyfishSearch(
                businessName + " " + location + " official " + platform + " profile",
                domain
            );
            const match = search.results.find((item: any) => detectPlatform(item.url) === platform);
            if (match) {
                addCandidate(candidates, seen, {
                    source_type: "social_profile", platform, requested_url: null,
                    source_url: match.url, source_title: match.title, search_snippet: match.snippet
                });
            } else noResults.push("social_profile");
        } catch (error) {
            searchErrors.push({
                source_type: "social_profile",
                code: String((error as any)?.providerCode || "search_error"),
                request_id: (error as any)?.requestId || null
            });
        }
    }

    return { candidates: candidates.slice(0, MAX_FETCH_URLS), noResults, searchErrors };
}

function sourceRow(
    inspectionId: string,
    candidate: Candidate | null,
    sourceType: SourceType,
    status: string,
    extra: Record<string, unknown> = {}
) {
    return {
        inspection_id: inspectionId,
        source_type: sourceType,
        source_status: status,
        platform: candidate?.platform || null,
        requested_url: candidate?.requested_url || null,
        source_url: candidate?.source_url || null,
        source_title: candidate?.source_title || null,
        identity_match_status: "not_checked",
        identity_match_basis: [],
        observations: {},
        ...extra
    };
}

async function persistEvidence(service: any, rows: any[]) {
    if (!rows.length) return;
    const { error } = await service.from("business_assessment_evidence").insert(rows);
    if (error) throw new Error("Evidence records could not be saved (" + error.code + ").");
}

async function processInspection(inspectionId: string, assessmentId: string) {
    const service = createServiceClient();
    let evidenceRows: any[] = [];
    let searchErrors: Array<{ source_type: SourceType; code: string; request_id: string | null }> = [];
    try {
        const { data: run, error: runError } = await service
            .from("business_assessment_inspections")
            .select("id, assessment_id, consent_version")
            .eq("id", inspectionId)
            .single();
        if (runError || !run) throw new Error("inspection_run_unavailable");

        if (!TINYFISH_API_KEY) {
            await service.from("business_assessment_inspections").update({
                status: "failed",
                failure_code: "provider_not_configured",
                failure_summary: "Public-source inspection is not configured. An administrator must configure the TinyFish API key.",
                completed_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }).eq("id", inspectionId);
            return;
        }

        const { data: assessment, error: assessmentError } = await service
            .from("business_assessments")
            .select("id, business_name, industry, business_profile")
            .eq("id", assessmentId)
            .single();
        if (assessmentError || !assessment) throw new Error("assessment_unavailable");

        const profile = assessment.business_profile || {};
        const presence = profile.public_presence || {};
        if (presence.inspection_consent !== true || presence.inspection_consent_version !== CONSENT_VERSION ||
            run.consent_version !== CONSENT_VERSION) {
            throw new Error("inspection_consent_unavailable");
        }

        await service.from("business_assessment_inspections").update({
            status: "running",
            started_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }).eq("id", inspectionId);

        const { candidates, noResults, searchErrors: foundSearchErrors } = await discoverCandidates(assessment);
        searchErrors = foundSearchErrors;

        for (const sourceType of noResults) {
            evidenceRows.push(sourceRow(inspectionId, null, sourceType, "not_found_in_search"));
        }

        for (const entry of searchErrors) {
            evidenceRows.push(sourceRow(inspectionId, null, entry.source_type, "fetch_error", {
                provider_error_code: entry.code,
                provider_request_id: entry.request_id
            }));
        }

        const fetchedCandidates = candidates.slice(0, MAX_FETCH_URLS);
        if (fetchedCandidates.length) {
            const fetchResponse = await fetchJson("https://api.fetch.tinyfish.ai", {
                method: "POST",
                headers: {
                    "X-API-Key": TINYFISH_API_KEY,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    urls: fetchedCandidates.map((item) => item.source_url),
                    format: "markdown",
                    links: true,
                    image_links: false,
                    ttl: 0,
                    include_etag_and_last_modified: true,
                    per_url_timeout_ms: 25000
                })
            }, FETCH_TIMEOUT_MS);

            const results = Array.isArray(fetchResponse.data?.results) ? fetchResponse.data.results : [];
            const errors = Array.isArray(fetchResponse.data?.errors) ? fetchResponse.data.errors : [];
            const resultByUrl = new Map<string, any>();
            const errorByUrl = new Map<string, any>();
            results.forEach((item: any, index: number) => {
                const original = item?.original_url || item?.requested_url || item?.url || fetchedCandidates[index]?.source_url;
                try { resultByUrl.set(normalisePublicUrl(original) || String(original), item); } catch { /* ignored */ }
            });
            errors.forEach((item: any) => {
                const original = item?.url || item?.original_url || item?.requested_url || "";
                try { errorByUrl.set(normalisePublicUrl(original) || String(original), item); } catch { /* ignored */ }
            });

            for (const candidate of fetchedCandidates) {
                const key = normalisePublicUrl(candidate.source_url) || candidate.source_url;
                const fetched = resultByUrl.get(key);
                if (!fetched) {
                    const providerError = errorByUrl.get(key);
                    const providerCode = String(providerError?.code || providerError?.error?.code || "empty_content");
                    evidenceRows.push(sourceRow(
                        inspectionId,
                        candidate,
                        candidate.source_type,
                        mapTinyFishFetchError(providerCode),
                        {
                            provider_error_code: providerCode.slice(0, 80),
                            provider_request_id: fetchResponse.requestId || null
                        }
                    ));
                    continue;
                }

                const finalRaw = String(fetched.final_url || fetched.url || candidate.source_url);
                let finalUrl: string;
                try {
                    finalUrl = normalisePublicUrl(finalRaw) || "";
                } catch {
                    evidenceRows.push(sourceRow(
                        inspectionId,
                        candidate,
                        candidate.source_type,
                        "unreachable",
                        {
                            final_url: null,
                            provider_error_code: "invalid_redirect_url",
                            provider_request_id: fetchResponse.requestId || null
                        }
                    ));
                    continue;
                }
                if (!finalUrl) {
                    evidenceRows.push(sourceRow(
                        inspectionId, candidate, candidate.source_type, "unreachable",
                        { provider_error_code: "invalid_redirect_url" }
                    ));
                    continue;
                }

                const text = String(
                    fetched.text || fetched.markdown || fetched.content || fetched.extracted_text || ""
                ).slice(0, 40000);
                const title = String(fetched.title || fetched.page_metadata?.title || candidate.source_title || "");
                const description = String(fetched.description || fetched.page_metadata?.description || "");
                const identity = matchBusinessIdentity({
                    businessName: profile.business_name || assessment.business_name,
                    location: profile.location,
                    title,
                    text: text.slice(0, 12000)
                });
                const observations = buildPageObservations({
                    title,
                    description,
                    language: fetched.language || fetched.page_metadata?.language,
                    links: fetched.links,
                    text
                });
                const sourceStatus = identity.status === "confirmed"
                    ? "observed"
                    : identity.status === "rejected" ? "unverifiable" : "needs_admin_review";
                const excerpt = sanitiseExcerpt(text, 500);
                const contentHash = Array.from(new Uint8Array(await crypto.subtle.digest(
                    "SHA-256",
                    new TextEncoder().encode(text)
                )), (byte) => byte.toString(16).padStart(2, "0")).join("");

                evidenceRows.push(sourceRow(
                    inspectionId,
                    candidate,
                    candidate.source_type,
                    sourceStatus,
                    {
                        final_url: finalUrl,
                        source_title: sanitiseExcerpt(title, 180) || null,
                        observations: {
                            ...observations,
                            search_title: candidate.source_title || null,
                            search_snippet: sanitiseExcerpt(candidate.search_snippet || "", 300) || null
                        },
                        evidence_excerpt: excerpt,
                        identity_match_status: identity.status,
                        identity_match_basis: identity.basis,
                        provider_request_id: fetchResponse.requestId || null,
                        content_sha256: contentHash,
                        observed_at: new Date().toISOString()
                    }
                ));
            }
        }

        await persistEvidence(service, evidenceRows);
        const failures = evidenceRows.filter((row) =>
            ["blocked", "unreachable", "timeout", "fetch_error"].includes(row.source_status)
        );
        const observed = evidenceRows.some((row) => row.source_status === "observed");
        const status = failures.length
            ? (observed || evidenceRows.length > failures.length ? "partial" : "failed")
            : "completed";
        await service.from("business_assessment_inspections").update({
            status,
            failure_code: failures.length ? "one_or_more_sources_unavailable" : null,
            failure_summary: failures.length
                ? "Some public sources could not be checked. Review the source-specific results and limitations."
                : null,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }).eq("id", inspectionId);
    } catch (error) {
        const message = String((error as Error)?.message || "inspection_failed").slice(0, 120);
        if (evidenceRows.length) {
            try { await persistEvidence(service, evidenceRows); } catch { /* failure summary remains */ }
        }
        await service.from("business_assessment_inspections").update({
            status: "failed",
            failure_code: message === "provider_not_configured" ? message : "inspection_failed",
            failure_summary: "The inspection did not complete. No unverified claim should be treated as a finding.",
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }).eq("id", inspectionId);
    }
}

Deno.serve(async (request) => {
    const origin = request.headers.get("origin") || "";
    if (request.method === "OPTIONS") {
        if (origin && !ALLOWED_ORIGINS.has(origin)) {
            return new Response(null, { status: 403, headers: corsHeaders("") });
        }
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405, origin);
    if (origin && !ALLOWED_ORIGINS.has(origin)) return jsonResponse({ error: "Request origin is not allowed." }, 403);
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
        return jsonResponse({ error: "The inspection service is temporarily unavailable." }, 503, origin);
    }

    let body: any;
    try {
        body = await readJsonBody(request);
    } catch (error) {
        return jsonResponse({ error: (error as Error).message }, Number((error as any).status || 400), origin);
    }

    if (!isUuid(body?.assessment_id) || !isUuid(body?.idempotency_key)) {
        return jsonResponse({ error: "A valid assessment and inspection reference are required." }, 400, origin);
    }
    if (!await verifyAdmin(request)) {
        return jsonResponse({ error: "Swayphics administrator access is required." }, 403, origin);
    }

    const service = createServiceClient();
    const { data: assessment, error: assessmentError } = await service
        .from("business_assessments")
        .select("id, business_name, business_profile")
        .eq("id", body.assessment_id)
        .maybeSingle();
    if (assessmentError || !assessment) return jsonResponse({ error: "The assessment could not be found." }, 404, origin);

    const profile = assessment.business_profile || {};
    const presence = profile.public_presence || {};
    if (presence.inspection_consent !== true ||
        presence.inspection_consent_version !== CONSENT_VERSION ||
        !String(profile.business_name || assessment.business_name || "").trim() ||
        !String(profile.location || "").trim()) {
        return jsonResponse({
            error: "This assessment does not contain the required permission and business details for public-source inspection."
        }, 409, origin);
    }

    const { data: existing, error: existingError } = await service
        .from("business_assessment_inspections")
        .select("id, status")
        .eq("assessment_id", body.assessment_id)
        .eq("idempotency_key", body.idempotency_key)
        .maybeSingle();
    if (existingError) return jsonResponse({ error: "The inspection request could not be checked." }, 503, origin);
    if (existing) {
        return jsonResponse({ ok: true, inspection_id: existing.id, status: existing.status, idempotent_replay: true }, 200, origin);
    }

    const { data: active, error: activeError } = await service
        .from("business_assessment_inspections")
        .select("id, status")
        .eq("assessment_id", body.assessment_id)
        .in("status", ["queued", "running"])
        .maybeSingle();
    if (activeError) return jsonResponse({ error: "An active inspection could not be checked." }, 503, origin);
    if (active) {
        return jsonResponse({ ok: true, inspection_id: active.id, status: active.status, existing_active_run: true }, 200, origin);
    }

    const { data: run, error: insertError } = await service
        .from("business_assessment_inspections")
        .insert({
            assessment_id: body.assessment_id,
            inspection_version: INSPECTION_VERSION,
            status: "queued",
            requested_sources: [
                "website",
                "google_business_profile",
                "social_profile"
            ],
            idempotency_key: body.idempotency_key,
            requested_by: (await createClient(SUPABASE_URL, ANON_KEY, {
                global: { headers: { Authorization: request.headers.get("authorization") || "" } },
                auth: { autoRefreshToken: false, persistSession: false }
            }).auth.getUser()).data.user?.id || null,
            consent_version: CONSENT_VERSION,
            provider: "tinyfish"
        })
        .select("id, status")
        .single();

    if (insertError || !run) {
        if (insertError?.code === "23505") {
            const { data: replay } = await service
                .from("business_assessment_inspections")
                .select("id, status")
                .eq("assessment_id", body.assessment_id)
                .eq("idempotency_key", body.idempotency_key)
                .maybeSingle();
            if (replay) {
                return jsonResponse({ ok: true, inspection_id: replay.id, status: replay.status, idempotent_replay: true }, 200, origin);
            }
        }
        return jsonResponse({ error: "The inspection could not be queued. Please retry." }, 503, origin);
    }

    const task = processInspection(run.id, assessment.id);
    try {
        EdgeRuntime.waitUntil(task);
    } catch {
        void task;
    }
    return jsonResponse({ ok: true, inspection_id: run.id, status: "queued" }, 202, origin);
});
