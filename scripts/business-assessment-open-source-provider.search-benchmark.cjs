"use strict";

const assert = require("node:assert/strict");

function hostMatchesDomain(hostname, domain) {
    return hostname === domain || hostname.endsWith("." + domain);
}

const cases = [
    {
        business: "Dis-Chem Pharmacy",
        query: "Dis-Chem Pharmacy Pretoria South Africa official website",
        expectedDomain: "dischem.co.za",
        category: "pharmacy retail"
    },
    {
        business: "Sorbet",
        query: "Sorbet beauty salon Pretoria South Africa official website",
        expectedDomain: "sorbet.co.za",
        category: "beauty and grooming"
    },
    {
        business: "Clicks",
        query: "Clicks pharmacy Pretoria South Africa official website",
        expectedDomain: "clicks.co.za",
        category: "pharmacy and retail"
    },
    {
        business: "Planet Fitness",
        query: "Planet Fitness gym Centurion South Africa official website",
        expectedDomain: "planetfitness.co.za",
        category: "fitness"
    },
    {
        business: "NetFlorist",
        query: "NetFlorist South Africa official website",
        expectedDomain: "netflorist.co.za",
        category: "online florist and gifts"
    }
];

function domainRank(results, expectedDomain) {
    const index = results.findIndex((item) => {
        try {
            return hostMatchesDomain(new URL(item.url).hostname.toLowerCase(), expectedDomain);
        } catch {
            return false;
        }
    });
    return index < 0 ? null : index + 1;
}

(async () => {
    const searchBaseUrl = process.env.SEARXNG_BASE_URL?.trim();
    if (!searchBaseUrl) throw new Error("SEARXNG_BASE_URL_is_required");

    const { createOpenSourceInspectionProvider } = await import(
        "../supabase/functions/_shared/business-assessment-open-source-provider.mjs"
    );

    const provider = createOpenSourceInspectionProvider({
        searchBaseUrl,
        // Search-only benchmark: crawl service is not contacted.
        crawlBaseUrl: process.env.CRAWL4AI_BASE_URL || "https://crawl.invalid.example",
        crawlApiToken: process.env.CRAWL4AI_API_TOKEN || "search-benchmark-unused"
    });

    const report = [];
    for (const testCase of cases) {
        try {
            const response = await provider.search(testCase.query, { maxResults: 10 });
            const results = response.results.slice(0, 10);
            const rank = domainRank(results, testCase.expectedDomain);
            report.push({
                business: testCase.business,
                category: testCase.category,
                expectedDomain: testCase.expectedDomain,
                rank,
                top5: rank !== null && rank <= 5,
                top10: rank !== null,
                resultCount: results.length,
                results: results.slice(0, 5).map((item, index) => ({
                    rank: index + 1,
                    domain: (() => {
                        try { return new URL(item.url).hostname; } catch { return "invalid"; }
                    })(),
                    title: item.title
                }))
            });
        } catch (error) {
            report.push({
                business: testCase.business,
                category: testCase.category,
                expectedDomain: testCase.expectedDomain,
                rank: null,
                top5: false,
                top10: false,
                resultCount: 0,
                error: String(error?.providerCode || error?.message || "search_failed").slice(0, 120)
            });
        }
    }

    const total = report.length;
    const top5Count = report.filter((item) => item.top5).length;
    const top10Count = report.filter((item) => item.top10).length;
    const evaluated = {
        benchmarkVersion: "bof-sa-official-domain-search-v1",
        datasetScope: "Five large, well-indexed South African brands. This is a connectivity/discovery baseline, not a representative sample of small independent businesses.",
        total,
        top5Count,
        top10Count,
        top5Rate: Number((top5Count / total).toFixed(3)),
        top10Rate: Number((top10Count / total).toFixed(3)),
        cases: report
    };

    console.log("BOF South African official-domain search benchmark");
    console.log(JSON.stringify(evaluated, null, 2));

    if (process.env.GITHUB_STEP_SUMMARY) {
        const fs = await import("node:fs/promises");
        const rows = report.map((item) =>
            "| " + item.business + " | " + item.expectedDomain + " | " +
            (item.rank ?? "Not found") + " | " + item.resultCount + " |"
        ).join("\n");
        const summary =
            "\n## BOF South African search benchmark\n\n" +
            "Five large, well-indexed South African brands; not representative of independent small-business discovery.\n\n" +
            "| Business | Expected domain | Rank (top 10) | Results |\n|---|---|---:|---:|\n" +
            rows + "\n\n" +
            "- Expected official domain in top 5: **" + top5Count + "/" + total + "**\n" +
            "- Expected official domain in top 10: **" + top10Count + "/" + total + "**\n";
        await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
