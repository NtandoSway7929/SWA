"use strict";

const cases = [
    {
        dataset: "pretoria_independent_operators",
        business: "The Cure Spa",
        url: "https://www.thecurespa.co.za/",
        expectedDomain: "thecurespa.co.za",
        location: "Waterkloof Glen Pretoria",
        identityTerms: ["the cure spa"]
    },
    {
        dataset: "pretoria_independent_operators",
        business: "Charis Nail & Beauty Studio",
        url: "https://www.charisbeauty.co.za/",
        expectedDomain: "charisbeauty.co.za",
        location: "Pretoria East",
        identityTerms: ["charis"]
    },
    {
        dataset: "pretoria_independent_operators",
        business: "Jacqueline's Chapter One Hair and Beauty Salon",
        url: "https://chapteronehairandbeauty.co.za/",
        expectedDomain: "chapteronehairandbeauty.co.za",
        location: "Montana Park Pretoria",
        identityTerms: ["chapter one"]
    },
    {
        dataset: "pretoria_independent_operators",
        business: "Huba Fleurs",
        url: "https://hubafleurs.online/",
        expectedDomain: "hubafleurs.online",
        location: "Pretoria Central",
        identityTerms: ["huba fleurs"]
    },
    {
        dataset: "pretoria_independent_operators",
        business: "Kalm Skin + Body Studio",
        url: "https://www.kalm-studio.co.za/",
        expectedDomain: "kalm-studio.co.za",
        location: "Elarduspark Pretoria",
        identityTerms: ["kalm"],
        identityFollowupPages: [
            {
                url: "https://www.kalm-studio.co.za/pages/our-stores",
                location: "Elarduspark Pretoria"
            }
        ]
    }
];

function normaliseText(value) {
    return String(value || "")
        .normalize("NFKD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function hostMatchesDomain(hostname, domain) {
    return hostname === domain || hostname.endsWith("." + domain);
}

function hostname(value) {
    try {
        return new URL(value).hostname.toLowerCase();
    } catch {
        return null;
    }
}

function containsIdentityCue(value, terms) {
    const haystack = normaliseText(value);
    return terms.some((term) => haystack.includes(normaliseText(term)));
}

function summarise(items) {
    const total = items.length;
    const succeeded = items.filter((item) => item.success).length;
    const identityCue = items.filter((item) => item.titleIdentityCue || item.contentIdentityCue).length;
    const usableBusinessPages = items.filter((item) => item.usableBusinessPage).length;
    const identityMatchCounts = {
        confirmed: items.filter((item) => item.identityMatchStatus === "confirmed").length,
        ambiguous: items.filter((item) => item.identityMatchStatus === "ambiguous").length,
        rejected: items.filter((item) => item.identityMatchStatus === "rejected").length,
        not_evaluated_fetch_failed: items.filter((item) => item.identityMatchStatus === "not_evaluated_fetch_failed").length
    };
    const wrongDomain = items.filter((item) => item.finalDomainMatches === false).length;
    return {
        total,
        succeeded,
        successRate: total ? Number((succeeded / total).toFixed(3)) : 0,
        titleIdentityCue: items.filter((item) => item.titleIdentityCue).length,
        contentIdentityCue: items.filter((item) => item.contentIdentityCue).length,
        anyIdentityCue: identityCue,
        usableBusinessPages,
        usableBusinessPageRate: total ? Number((usableBusinessPages / total).toFixed(3)) : 0,
        identityMatchCounts,
        finalDomainMismatch: wrongDomain
    };
}

(async () => {
    const searchBaseUrl = process.env.SEARXNG_BASE_URL?.trim();
    const crawlBaseUrl = process.env.CRAWL4AI_BASE_URL?.trim();
    const crawlApiToken = process.env.CRAWL4AI_API_TOKEN?.trim();
    if (!searchBaseUrl) throw new Error("SEARXNG_BASE_URL_is_required");
    if (!crawlBaseUrl) throw new Error("CRAWL4AI_BASE_URL_is_required");
    if (!crawlApiToken) throw new Error("CRAWL4AI_API_TOKEN_is_required");

    const { createOpenSourceInspectionProvider } = await import(
        "../supabase/functions/_shared/business-assessment-open-source-provider.mjs"
    );
    const { matchBusinessIdentity } = await import(
        "../supabase/functions/_shared/business-assessment-evidence.mjs"
    );

    const provider = createOpenSourceInspectionProvider({
        searchBaseUrl,
        crawlBaseUrl,
        crawlApiToken,
        fetchTimeoutMs: 90_000
    });

    const rawResults = [];
    // Keep each live request bounded; this test uses only independently verified public domains.
    for (const batch of [cases.slice(0, 3), cases.slice(3)]) {
        const response = await provider.fetch(batch.map((item) => item.url));
        if (!Array.isArray(response.results) || response.results.length !== batch.length) {
            throw new Error("crawl4ai_result_count_mismatch");
        }
        response.results.forEach((result, index) => {
            rawResults.push({ testCase: batch[index], result });
        });
    }

    const report = rawResults.map(({ testCase, result }) => {
        const finalHost = hostname(result.final_url);
        const finalDomainMatches = finalHost
            ? hostMatchesDomain(finalHost, testCase.expectedDomain)
            : false;
        const titleIdentityCue = containsIdentityCue(result.title, testCase.identityTerms);
        const text = String(result.text || "");
        const contentIdentityCue = containsIdentityCue(text, testCase.identityTerms);
        const textCharacters = text.length;
        const success = result.success === true;
        const usableBusinessPage = success && finalDomainMatches &&
            (titleIdentityCue || contentIdentityCue) && textCharacters >= 150;
        const identity = success
            ? matchBusinessIdentity({
                businessName: testCase.business,
                location: testCase.location,
                title: result.title,
                text: text.slice(0, 12_000),
                sourceType: "website",
                sourceUrl: result.final_url
            })
            : null;
        return {
            dataset: testCase.dataset,
            business: testCase.business,
            expectedDomain: testCase.expectedDomain,
            locationTested: testCase.location,
            requestedUrl: testCase.url,
            finalHost,
            finalDomainMatches,
            success,
            usableBusinessPage,
            identityMatchStatus: identity?.status || "not_evaluated_fetch_failed",
            identityMatchBasis: identity?.basis || [
                "Identity matching was not evaluated because the HTTP page retrieval did not succeed."
            ],
            errorCode: result.error_code || null,
            statusCode: result.status_code ?? null,
            title: String(result.title || "").slice(0, 180),
            titleIdentityCue,
            contentIdentityCue,
            descriptionPresent: Boolean(String(result.description || "").trim()),
            textCharacters,
            extractedLinkCount: Array.isArray(result.links) ? result.links.length : 0
        };
    });

    // When the homepage is ambiguous, test a single, explicitly listed same-domain
    // location/contact page. Keep this result separate from the homepage assessment.
    const followupCases = cases.flatMap((testCase) =>
        (testCase.identityFollowupPages || []).map((page) => ({ testCase, page }))
    );
    const secondaryPageResults = [];
    for (const batchStart of Array.from(
        { length: Math.ceil(followupCases.length / 8) },
        (_, index) => index * 8
    )) {
        const batch = followupCases.slice(batchStart, batchStart + 8);
        const response = await provider.fetch(batch.map((item) => item.page.url));
        if (!Array.isArray(response.results) || response.results.length !== batch.length) {
            throw new Error("crawl4ai_followup_result_count_mismatch");
        }
        response.results.forEach((result, index) => {
            const { testCase, page } = batch[index];
            const success = result.success === true;
            const identity = success
                ? matchBusinessIdentity({
                    businessName: testCase.business,
                    location: page.location,
                    title: result.title,
                    text: String(result.text || "").slice(0, 12_000),
                    sourceType: "website",
                    sourceUrl: result.final_url
                })
                : null;
            const primary = report.find((item) => item.business === testCase.business);
            secondaryPageResults.push({
                business: testCase.business,
                url: page.url,
                finalHost: hostname(result.final_url),
                expectedDomain: testCase.expectedDomain,
                statusCode: result.status_code ?? null,
                success,
                identityMatchStatus: identity?.status || "not_evaluated_fetch_failed",
                identityMatchBasis: identity?.basis || [
                    "Identity matching was not evaluated because the follow-up page retrieval did not succeed."
                ],
                primaryPageIdentityStatus: primary?.identityMatchStatus || "not_available",
                resolvesPrimaryAmbiguity: primary?.identityMatchStatus === "ambiguous" &&
                    identity?.status === "confirmed",
                title: String(result.title || "").slice(0, 180),
                textCharacters: String(result.text || "").length,
                errorCode: result.error_code || null
            });
        });
    }
    const secondaryPageSummary = {
        total: secondaryPageResults.length,
        succeeded: secondaryPageResults.filter((item) => item.success).length,
        confirmed: secondaryPageResults.filter((item) => item.identityMatchStatus === "confirmed").length,
        ambiguous: secondaryPageResults.filter((item) => item.identityMatchStatus === "ambiguous").length,
        rejected: secondaryPageResults.filter((item) => item.identityMatchStatus === "rejected").length,
        notEvaluatedAfterFetchFailure: secondaryPageResults.filter((item) =>
            item.identityMatchStatus === "not_evaluated_fetch_failed"
        ).length,
        resolvedPrimaryAmbiguities: secondaryPageResults.filter((item) => item.resolvesPrimaryAmbiguity).length
    };

    const evaluated = {
        benchmarkVersion: "bof-public-page-fetch-v4-followup",
        scope: "Five independently verified Pretoria business websites; public URLs only; no assessment answers, respondent contact details or customer-submitted destinations.",
        provider: "Crawl4AI through the isolated Swayphics adapter",
        batchSizes: [3, 2],
        summary: summarise(report),
        cases: report,
        secondaryPageSummary,
        secondaryPageResults
    };

    console.log("BOF public-business page retrieval benchmark");
    console.log(JSON.stringify(evaluated, null, 2));
    if (!evaluated.summary.succeeded) {
        console.warn("No benchmark business page was successfully extracted. The reserved example.com integration test remains the API compatibility check.");
    }

    if (process.env.GITHUB_STEP_SUMMARY) {
        const fs = await import("node:fs/promises");
        const rows = report.map((item) =>
            "| " + item.business + " | " + (item.success ? "Yes" : "No") + " | " +
            (item.statusCode ?? "—") + " | " + (item.finalHost || "—") + " | " +
            item.textCharacters + " | " +
            (item.titleIdentityCue ? "Yes" : "No") + " | " +
            (item.contentIdentityCue ? "Yes" : "No") + " | " +
            (item.usableBusinessPage ? "Yes" : "No") + " | " +
            item.identityMatchStatus + " | " +
            (item.errorCode || "—") + " |"
        ).join("\n");
        const secondaryRows = secondaryPageResults.map((item) =>
            "| " + item.business + " | " + item.url + " | " +
            (item.success ? "Yes" : "No") + " | " + (item.statusCode ?? "—") + " | " +
            item.primaryPageIdentityStatus + " | " + item.identityMatchStatus + " | " +
            (item.resolvesPrimaryAmbiguity ? "Yes" : "No") + " |"
        ).join("\n");
        const secondarySummary = secondaryPageResults.length
            ? "\n### Targeted same-domain follow-up pages\n\n" +
                "| Business | Follow-up page | Fetch OK | HTTP | Homepage match | Follow-up match | Resolved ambiguity |\n" +
                "|---|---|---:|---:|---|---|---:|\n" +
                secondaryRows + "\n\n" +
                "- Ambiguous homepage matches resolved by a confirmed same-domain page: **" +
                secondaryPageSummary.resolvedPrimaryAmbiguities + "/" + secondaryPageSummary.total + "**\n"
            : "";
        const summary =
            "\n## BOF public-business page retrieval and identity benchmark\n\n" +
            "| Business | Fetch OK | HTTP | Final host | Text chars | Title cue | Content cue | Page usable | Production identity match | Error |\n" +
            "|---|---:|---:|---|---:|---:|---:|---:|---|---|\n" +
            rows + "\n\n" +
            "- Successful 2xx page extractions: **" + evaluated.summary.succeeded + "/" + evaluated.summary.total + "**\n" +
            "- Business-name cue present in page content: **" + evaluated.summary.contentIdentityCue + "/" + evaluated.summary.total + "**\n" +
            "- Pages passing the basic usable-page check: **" + evaluated.summary.usableBusinessPages + "/" + evaluated.summary.total + "**\n" +
            "- Existing Swayphics identity matcher — confirmed: **" + evaluated.summary.identityMatchCounts.confirmed + "**; ambiguous: **" + evaluated.summary.identityMatchCounts.ambiguous + "**; rejected: **" + evaluated.summary.identityMatchCounts.rejected + "**; not evaluated after fetch failure: **" + evaluated.summary.identityMatchCounts.not_evaluated_fetch_failed + "**\n" +
            "- Final-domain mismatches: **" + evaluated.summary.finalDomainMismatch + "**\n\n" +
            "**Identity matching:** statuses are produced by the existing `matchBusinessIdentity()` function from Swayphics' evidence module. Inputs are the public business name/location in this test case, fetched title and up to 12,000 extracted characters. A confirmed result exercises the current rules; it is not independent proof of legal ownership.\n\n" +
            "**Interpretation:** the usable-page check is a diagnostic gate, not proof of full page completeness or legal ownership. HTTP error/redirect pages with short or unrelated text must not be treated as successful website evidence. Individual site blocking or content differences are reported, not treated as provider API failures.\n" +
            secondarySummary;

        await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
