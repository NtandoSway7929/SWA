"use strict";

const cases = [
    {
        dataset: "pretoria_independent_operators",
        business: "The Cure Spa",
        url: "https://www.thecurespa.co.za/",
        expectedDomain: "thecurespa.co.za",
        identityTerms: ["the cure spa"]
    },
    {
        dataset: "pretoria_independent_operators",
        business: "Charis Nail & Beauty Studio",
        url: "https://www.charisbeauty.co.za/",
        expectedDomain: "charisbeauty.co.za",
        identityTerms: ["charis"]
    },
    {
        dataset: "pretoria_independent_operators",
        business: "Jacqueline's Chapter One Hair and Beauty Salon",
        url: "https://chapteronehairandbeauty.co.za/",
        expectedDomain: "chapteronehairandbeauty.co.za",
        identityTerms: ["chapter one"]
    },
    {
        dataset: "pretoria_independent_operators",
        business: "Huba Fleurs",
        url: "https://hubafleurs.online/",
        expectedDomain: "hubafleurs.online",
        identityTerms: ["huba fleurs"]
    },
    {
        dataset: "pretoria_independent_operators",
        business: "Kalm Skin + Body Studio",
        url: "https://www.kalm-studio.co.za/",
        expectedDomain: "kalm-studio.co.za",
        identityTerms: ["kalm"]
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
    const wrongDomain = items.filter((item) => item.finalDomainMatches === false).length;
    return {
        total,
        succeeded,
        successRate: total ? Number((succeeded / total).toFixed(3)) : 0,
        titleIdentityCue: items.filter((item) => item.titleIdentityCue).length,
        contentIdentityCue: items.filter((item) => item.contentIdentityCue).length,
        anyIdentityCue: identityCue,
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
        return {
            dataset: testCase.dataset,
            business: testCase.business,
            expectedDomain: testCase.expectedDomain,
            requestedUrl: testCase.url,
            finalHost,
            finalDomainMatches: finalHost
                ? hostMatchesDomain(finalHost, testCase.expectedDomain)
                : false,
            success: result.success === true,
            errorCode: result.error_code || null,
            statusCode: result.status_code ?? null,
            title: String(result.title || "").slice(0, 180),
            titleIdentityCue: containsIdentityCue(result.title, testCase.identityTerms),
            contentIdentityCue: containsIdentityCue(result.text, testCase.identityTerms),
            descriptionPresent: Boolean(String(result.description || "").trim()),
            textCharacters: String(result.text || "").length,
            extractedLinkCount: Array.isArray(result.links) ? result.links.length : 0
        };
    });

    const evaluated = {
        benchmarkVersion: "bof-public-page-fetch-v1",
        scope: "Five independently verified Pretoria business websites; public URLs only; no assessment answers, respondent contact details or customer-submitted destinations.",
        provider: "Crawl4AI through the isolated Swayphics adapter",
        batchSizes: [3, 2],
        summary: summarise(report),
        cases: report
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
            (item.errorCode || "—") + " |"
        ).join("\n");
        const summary =
            "\n## BOF public-business page retrieval benchmark\n\n" +
            "| Business | Extracted | HTTP | Final host | Text chars | Title cue | Content cue | Error |\n" +
            "|---|---:|---:|---|---:|---:|---:|---|\n" +
            rows + "\n\n" +
            "- Pages successfully extracted: **" + evaluated.summary.succeeded + "/" + evaluated.summary.total + "**\n" +
            "- Business-name cue present in page content: **" + evaluated.summary.contentIdentityCue + "/" + evaluated.summary.total + "**\n" +
            "- Final-domain mismatches: **" + evaluated.summary.finalDomainMismatch + "**\n\n" +
            "**Interpretation:** extraction success, text presence and simple name cues are diagnostics, not proof of full page completeness, correct business identity or conversion quality. Individual site blocking or content differences are reported, not treated as provider API failures.\n";
        await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
