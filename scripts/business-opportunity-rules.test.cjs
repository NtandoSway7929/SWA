const assert = require("node:assert/strict");

(async () => {
    const rules = await import("../supabase/functions/submit-business-assessment/rules.mjs");
    const base = {
        assessment_version: rules.ASSESSMENT_VERSION,
        submission_key: "6e4d8ba9-16e8-4a7c-96cb-1374a63cfe12",
        business_profile: { business_name: "Example Studio", location: "Pretoria" },
        responses: [
            { question_id: "industry", answer: "beauty_personal_care" },
            { question_id: "discovery", answer: ["instagram", "facebook", "google_business"] },
            { question_id: "contactMethods", answer: ["whatsapp"] },
            { question_id: "friction", answer: ["missed_followups"] },
            { question_id: "priority", answer: "responses" }
        ]
    };

    function makePayload(overrides = {}) {
        return {
            ...base,
            ...overrides,
            business_profile: { ...base.business_profile, ...(overrides.business_profile || {}) },
            responses: overrides.responses || base.responses
        };
    }

    const first = rules.normalizeAssessmentPayload(makePayload());
    const firstReport = rules.buildBusinessOpportunityReport(first.businessProfile, first.answers);
    assert.equal(firstReport.website_status, "Not established from your answers");
    assert.equal(firstReport.findings[0].evidence_classification, "self_reported");
    assert.ok(firstReport.recommendations.some((item) => item.service_id === "replies"));
    assert.ok(!firstReport.recommendations.some((item) => item.service_id === "website"));
    assert.equal(first.businessProfile.public_presence.inspection_consent, false);

    const consented = rules.normalizeAssessmentPayload(makePayload({
        business_profile: {
            public_presence: {
                inspection_consent: true,
                inspection_consent_version: "bof-public-presence-v1",
                website_url: "https://example.co.za",
                google_business_profile_url: "https://maps.app.goo.gl/example",
                social_profile_urls: [
                    { platform: "instagram", url: "https://www.instagram.com/example/" }
                ]
            }
        }
    }));
    assert.equal(consented.businessProfile.public_presence.inspection_consent, true);
    assert.equal(consented.businessProfile.public_presence.website_url, "https://example.co.za/");
    assert.equal(consented.businessProfile.public_presence.social_profile_urls[0].platform, "instagram");

    const unconsented = rules.normalizeAssessmentPayload(makePayload({
        business_profile: {
            public_presence: {
                inspection_consent: false,
                website_url: "https://example.co.za",
                social_profile_urls: [{ platform: "instagram", url: "https://www.instagram.com/example/" }]
            }
        }
    }));
    assert.equal(unconsented.businessProfile.public_presence.inspection_consent, false);
    assert.equal(unconsented.businessProfile.public_presence.website_url, undefined);

    assert.throws(() => rules.normalizeAssessmentPayload(makePayload({
        business_profile: {
            public_presence: {
                inspection_consent: true,
                inspection_consent_version: "wrong",
                website_url: "https://example.co.za"
            }
        }
    })), /consent version is not supported/);
    assert.throws(() => rules.normalizeAssessmentPayload(makePayload({
        business_profile: {
            public_presence: {
                inspection_consent: true,
                inspection_consent_version: "bof-public-presence-v1",
                website_url: "http://127.0.0.1/private"
            }
        }
    })), /public HTTP or HTTPS/);
    assert.throws(() => rules.normalizeAssessmentPayload(makePayload({
        business_profile: {
            public_presence: {
                inspection_consent: true,
                inspection_consent_version: "bof-public-presence-v1",
                social_profile_urls: [
                    { platform: "instagram", url: "https://facebook.com/not-instagram" }
                ]
            }
        }
    })), /must match Instagram/);

    const noWebsiteAnswers = base.responses.map((entry) => {
        if (entry.question_id === "discovery") return { ...entry, answer: ["no_website", "instagram"] };
        return entry;
    });
    const second = rules.normalizeAssessmentPayload(makePayload({ responses: noWebsiteAnswers }));
    const secondReport = rules.buildBusinessOpportunityReport(second.businessProfile, second.answers);
    assert.equal(secondReport.website_status, "No website reported");
    assert.ok(!secondReport.recommendations.some((item) => item.service_id === "website"));

    const offlineAnswers = base.responses.map((entry) => {
        if (entry.question_id === "discovery") return { ...entry, answer: ["no_online_presence", "referrals", "walk_ins"] };
        if (entry.question_id === "contactMethods") return { ...entry, answer: ["phone", "in_person"] };
        if (entry.question_id === "friction") return { ...entry, answer: ["not_sure"] };
        if (entry.question_id === "priority") return { ...entry, answer: "exploring" };
        return entry;
    });
    const third = rules.normalizeAssessmentPayload(makePayload({ responses: offlineAnswers }));
    const thirdReport = rules.buildBusinessOpportunityReport(third.businessProfile, third.answers);
    assert.equal(thirdReport.website_status, "No online presence reported");
    assert.ok(thirdReport.current_starting_point.some((item) => item.includes("Referrals")));
    assert.ok(!thirdReport.recommendations.some((item) => item.service_id === "website"));

    assert.throws(() => rules.normalizeAssessmentPayload(makePayload({
        assessment_version: "old-version"
    })), /version is not supported/);
    assert.throws(() => rules.normalizeAssessmentPayload(makePayload({
        responses: base.responses.filter((entry) => entry.question_id !== "priority")
    })), /responses are incomplete/);
    assert.throws(() => rules.normalizeAssessmentPayload(makePayload({
        responses: base.responses.map((entry) => entry.question_id === "discovery"
            ? { ...entry, answer: ["no_online_presence", "instagram"] }
            : entry)
    })), /cannot be combined/);

    console.log("Business Opportunity Finder backend rule tests passed.");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});