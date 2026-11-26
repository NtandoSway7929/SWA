import { createClient } from "npm:@supabase/supabase-js@2";
import {
    ASSESSMENT_VERSION,
    CONTACT_NOTICE_VERSION,
    normalizeAssessmentPayload,
    buildBusinessOpportunityReport
} from "./rules.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGINS = new Set([
    "https://swayphics.co.za",
    "https://www.swayphics.co.za"
]);
const MAX_BODY_BYTES = 16000;

function corsHeaders(origin = "") {
    const headers = {
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Vary": "Origin"
    };
    if (ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
    return headers;
}

function jsonResponse(payload, status, origin, extraHeaders = {}) {
    return Response.json(payload, {
        status,
        headers: {
            ...corsHeaders(origin),
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            ...extraHeaders
        }
    });
}

function cleanContactText(value, fieldName, maxLength, required = false) {
    if (value === undefined || value === null) value = "";
    if (typeof value !== "string") throw new Error(`${fieldName} must be text.`);
    const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
    if (required && cleaned.length < 2) throw new Error(`${fieldName} is required.`);
    if (cleaned.length > maxLength) throw new Error(`${fieldName} is too long.`);
    return cleaned;
}

function validUuid(value) {
    return typeof value === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getClientIp(request) {
    const direct = request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip");
    if (direct) return direct.trim().slice(0, 80);
    const forwarded = request.headers.get("x-forwarded-for") || "";
    return forwarded.split(",")[0].trim().slice(0, 80) || null;
}

async function hmacIdentifier(value) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(SERVICE_ROLE_KEY),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
    return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function enforceRateLimit(supabase, scope, identifier, maxAttempts, windowSeconds) {
    const identifierHash = await hmacIdentifier(scope + ":" + identifier);
    const { data, error } = await supabase.rpc("take_business_assessment_rate_limit", {
        p_scope: scope,
        p_identifier_hash: identifierHash,
        p_max_attempts: maxAttempts,
        p_window_seconds: windowSeconds
    });
    if (error) throw new Error("Rate limit check unavailable.");
    const result = Array.isArray(data) ? data[0] : data;
    if (!result || typeof result.allowed !== "boolean") {
        throw new Error("Rate limit check returned an invalid result.");
    }
    return result;
}

function rateLimitedResponse(retryAfter, origin) {
    return jsonResponse(
        { error: "Too many requests. Please wait before trying again." },
        429,
        origin,
        { "Retry-After": String(Math.max(1, retryAfter || 60)) }
    );
}

async function parseRequestBody(request) {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
        throw Object.assign(new Error("Send the assessment as JSON."), { status: 415 });
    }
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_BODY_BYTES) {
        throw Object.assign(new Error("The request is too large."), { status: 413 });
    }
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
        throw Object.assign(new Error("The request is too large."), { status: 413 });
    }
    try {
        return JSON.parse(raw);
    } catch {
        throw Object.assign(new Error("The request body is not valid JSON."), { status: 400 });
    }
}

function genericDatabaseError(error, fallback) {
    console.error(fallback, error?.code || "unknown");
    return fallback;
}

async function completeAssessment(supabase, body, request, origin) {
    let normalized;
    try {
        normalized = normalizeAssessmentPayload(body);
    } catch (error) {
        return jsonResponse({ error: error.message }, 400, origin);
    }

    const existingResult = await supabase
        .from("business_assessments")
        .select("id, assessment_version, business_profile, responses, report")
        .eq("submission_key", normalized.submissionKey)
        .maybeSingle();

    if (existingResult.error) {
        console.error("Business assessment idempotency lookup failed:", existingResult.error.code);
        return jsonResponse({ error: "We could not complete the assessment right now. Please try again." }, 503, origin);
    }

    if (existingResult.data) {
        const existing = existingResult.data;
        const samePayload =
            existing.assessment_version === normalized.assessmentVersion &&
            JSON.stringify(existing.business_profile) === JSON.stringify(normalized.businessProfile) &&
            JSON.stringify(existing.responses) === JSON.stringify(normalized.responses);
        if (!samePayload) {
            return jsonResponse({ error: "This submission reference has already been used." }, 409, origin);
        }
        return jsonResponse({
            ok: true,
            assessment_id: existing.id,
            report: existing.report,
            idempotent_replay: true
        }, 200, origin);
    }

    const clientIp = getClientIp(request);
    if (clientIp) {
        try {
            const limit = await enforceRateLimit(supabase, "assessment_ip", clientIp, 10, 3600);
            if (!limit.allowed) return rateLimitedResponse(limit.retry_after_seconds, origin);
        } catch (error) {
            console.error("Business assessment rate limiting failed.");
            return jsonResponse({ error: "Assessment submission is temporarily unavailable. Please try again." }, 503, origin);
        }
    }

    const report = buildBusinessOpportunityReport(normalized.businessProfile, normalized.answers);
    const insertResult = await supabase
        .from("business_assessments")
        .insert({
            assessment_version: normalized.assessmentVersion,
            status: "completed",
            business_name: normalized.businessProfile.business_name,
            industry: normalized.answers.industry,
            business_profile: normalized.businessProfile,
            responses: normalized.responses,
            findings: report.findings,
            report,
            submission_key: normalized.submissionKey
        })
        .select("id")
        .single();

    if (insertResult.error) {
        if (insertResult.error.code === "23505") {
            const retry = await supabase
                .from("business_assessments")
                .select("id, assessment_version, business_profile, responses, report")
                .eq("submission_key", normalized.submissionKey)
                .maybeSingle();
            if (!retry.error && retry.data &&
                retry.data.assessment_version === normalized.assessmentVersion &&
                JSON.stringify(retry.data.business_profile) === JSON.stringify(normalized.businessProfile) &&
                JSON.stringify(retry.data.responses) === JSON.stringify(normalized.responses)) {
                return jsonResponse({
                    ok: true,
                    assessment_id: retry.data.id,
                    report: retry.data.report,
                    idempotent_replay: true
                }, 200, origin);
            }
        }
        genericDatabaseError(insertResult.error, "Business assessment insert failed:");
        return jsonResponse({ error: "We could not complete the assessment right now. Please try again." }, 503, origin);
    }

    return jsonResponse({
        ok: true,
        assessment_id: insertResult.data.id,
        report,
        idempotent_replay: false
    }, 201, origin);
}

async function requestContact(supabase, body, request, origin) {
    const assessmentId = body.assessment_id;
    const submissionKey = body.submission_key;
    const contact = body.contact_request;

    if (!validUuid(assessmentId) || !validUuid(submissionKey) || !contact || typeof contact !== "object" || Array.isArray(contact)) {
        return jsonResponse({ error: "The assessment reference or contact details are invalid." }, 400, origin);
    }

    try {
        if (contact.notice_accepted !== true || contact.notice_version !== CONTACT_NOTICE_VERSION) {
            throw new Error("Please review and accept the contact notice.");
        }
        const name = cleanContactText(contact.name, "Name", 80, true);
        const email = cleanContactText(contact.email, "Email address", 120).toLowerCase();
        const phone = cleanContactText(contact.phone, "Phone number", 30);
        const preferred = contact.preferred_contact_method;
        const message = cleanContactText(contact.message, "Message", 1000);

        if (!email && !phone) throw new Error("Provide an email address or phone number.");
        if (email && !validEmail(email)) throw new Error("Enter a valid email address.");
        if (phone && (phone.length < 6 || !/^[0-9+() .-]+$/.test(phone))) {
            throw new Error("Enter a valid phone number.");
        }
        if (!["email", "phone", "whatsapp"].includes(preferred)) {
            throw new Error("Choose a preferred contact method.");
        }
        if (preferred === "email" && !email) throw new Error("Enter an email address for email contact.");
        if (["phone", "whatsapp"].includes(preferred) && !phone) {
            throw new Error("Enter a phone number for the selected contact method.");
        }

        const clientIp = getClientIp(request);
        if (clientIp) {
            const ipLimit = await enforceRateLimit(supabase, "contact_ip", clientIp, 5, 3600);
            if (!ipLimit.allowed) return rateLimitedResponse(ipLimit.retry_after_seconds, origin);
        }
        if (email) {
            const emailLimit = await enforceRateLimit(supabase, "contact_email", email, 3, 3600);
            if (!emailLimit.allowed) return rateLimitedResponse(emailLimit.retry_after_seconds, origin);
        }

        const { data, error } = await supabase.rpc("request_business_assessment_contact", {
            p_assessment_id: assessmentId,
            p_submission_key: submissionKey,
            p_contact_name: name,
            p_email: email || null,
            p_phone: phone || null,
            p_preferred_contact_method: preferred,
            p_message: message || null,
            p_notice_version: CONTACT_NOTICE_VERSION
        });

        if (error) {
            if (error.code === "P0002") {
                return jsonResponse({ error: "This assessment reference could not be verified. Please restart the assessment." }, 404, origin);
            }
            if (error.code === "22023") {
                return jsonResponse({ error: "Please review the contact details and try again." }, 400, origin);
            }
            genericDatabaseError(error, "Business assessment contact request failed:");
            return jsonResponse({ error: "We could not submit the contact request right now. Please try again." }, 503, origin);
        }

        return jsonResponse({
            ok: true,
            contact_requested: true,
            enquiry_reference: data,
            message: "Your contact request has been received."
        }, 200, origin);
    } catch (error) {
        return jsonResponse({ error: error.message || "Please review the contact details." }, 400, origin);
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

    if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed." }, 405, origin);
    }
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
        return jsonResponse({ error: "Request origin is not allowed." }, 403, "");
    }
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
        console.error("Business Opportunity Finder function is missing server configuration.");
        return jsonResponse({ error: "The assessment service is temporarily unavailable." }, 503, origin);
    }

    let body;
    try {
        body = await parseRequestBody(request);
    } catch (error) {
        return jsonResponse({ error: error.message || "Invalid request." }, error.status || 400, origin);
    }

    if (typeof body?.website === "string" && body.website.trim()) {
        return jsonResponse({ ok: true, accepted: true }, 200, origin);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    if (body?.action === "complete_assessment") {
        return await completeAssessment(supabase, body, request, origin);
    }
    if (body?.action === "request_contact") {
        return await requestContact(supabase, body, request, origin);
    }
    return jsonResponse({ error: "Choose a valid assessment action." }, 400, origin);
});
