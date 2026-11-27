"use strict";

function hostMatchesDomain(hostname, domain) {
    return hostname === domain || hostname.endsWith("." + domain);
}

const cases = [
    {
        dataset: "national_brands",
        business: "Dis-Chem Pharmacy",
        query: "Dis-Chem Pharmacy Pretoria South Africa official website",
        expectedDomain: "dischem.co.za",
        category: "pharmacy retail"
    },
    {
        dataset: "national_brands",
        business: "Sorbet",
        query: "Sorbet beauty salon Pretoria South Africa official website",
        expectedDomain: "sorbet.co.za",
        category: "beauty and grooming"
    },
    {
        dataset: "national_brands",
        business: "Clicks",
        query: "Clicks pharmacy Pretoria South Africa official website",
        expectedDomain: "clicks.co.za",
        category: "pharmacy and retail"
    },
    {
        dataset: "national_brands",
        business: "Planet Fitness",
        query: "Planet Fitness gym Centurion South Africa official website",
        expectedDomain: "planetfitness.co.za",
        category: "fitness"
    },
    {
        dataset: "national_brands",
        business: "NetFlorist",
        query: "NetFlorist South Africa official website",
        expectedDomain: "netflorist.co.za",
        category: "online florist and gifts"
    },
    {
        dataset: "pretoria_independent_operators",
        business: "The Cure Spa",
        query: "The Cure Spa Waterkloof Glen Pretoria official website",
        expectedDomain: "thecurespa.co.za",
        category: "locally operated spa"
    },
    {
        dataset: "pretoria_independent_operators",
        business: "Charis Nail & Beauty Studio",
        query: "Charis Nail and Beauty Studio Lombardy Business Park Pretoria official website",
        expectedDomain: "charisbeauty.co.za",
        category: "woman-owned family-run beauty studio"
    },
    {
        dataset: "pretoria_independent_operators",
        business: "Jacqueline's Chapter One Hair and Beauty Salon",
        query: "Jacqueline Chapter One Hair and Beauty Salon Montana Park Pretoria official website",
        expectedDomain: "chapteronehairandbeauty.co.za",
        category: "independent salon"
    },
    {
        dataset: "pretoria_independent_operators",
        business: "Huba Fleurs",
        query: "Huba Fleurs florist Pretoria Central official website",
        expectedDomain: "hubafleurs.online",
        category: "local florist and floral studio"
    },
    {
        dataset: "pretoria_independent_operators",
        business: "Kalm Skin + Body Studio",
        query: "Kalm Skin and Body Studio Elarduspark Doringkloof Pretoria official website",
        expectedDomain: "kalm-studio.co.za",
        category: "locally owned husband-and-wife skincare and beauty business"
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

function summarise(items) {
    const total = items.length;
    const top5Count = items.filter((item) => item.top5).length;
    const top10Count = items.filter((item) => item.top10).length;
    return {
        total,
        top5Count,
        top10Count,
        top5Rate: total ? Number((top5Count / total).toFixed(3)) : 0,
        top10Rate: total ? Number((top10Count / total).toFixed(3)) : 0
    };
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
                dataset: testCase.dataset,
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
                dataset: testCase.dataset,
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

    const groupSummaries = {
        national_brands: summarise(report.filter((item) => item.dataset === "national_brands")),
        pretoria_independent_operators: summarise(report.filter((item) => item.dataset === "pretoria_independent_operators"))
    };
    const evaluated = {
        benchmarkVersion: "bof-sa-official-domain-search-v2",
        datasetNotes: {
            national_brands: "Five large, well-indexed South African brands; a broad search connectivity baseline.",
            pretoria_independent_operators: "Five locally operated or explicitly independent Pretoria businesses with independently verified official domains. This is a small, curated pilot and not a representative market sample."
        },
        groupSummaries,
        cases: report
    };

    console.log("BOF South African official-domain search benchmark");
    console.log(JSON.stringify(evaluated, null, 2));

    if (process.env.GITHUB_STEP_SUMMARY) {
        const fs = await import("node:fs/promises");
        const makeRows = (items) => items.map((item) =>
            "| " + item.business + " | " + item.expectedDomain + " | " +
            (item.rank ?? "Not found") + " | " + item.resultCount + " |"
        ).join("\n");
        const makeSummary = (label, items, stats) =>
            "\n### " + label + "\n\n" +
            "| Business | Expected domain | Rank (top 10) | Results |\n|---|---|---:|---:|\n" +
            makeRows(items) + "\n\n" +
            "- Expected official domain in top 5: **" + stats.top5Count + "/" + stats.total + "**\n" +
            "- Expected official domain in top 10: **" + stats.top10Count + "/" + stats.total + "**\n";
        const summary =
            "\n## BOF South African search benchmark\n\n" +
            "Ranks are based on the first ten normalised results returned by SearXNG.\n" +
            makeSummary(
                "Large national brands",
                report.filter((item) => item.dataset === "national_brands"),
                groupSummaries.national_brands
            ) +
            makeSummary(
                "Pretoria independent and locally operated businesses",
                report.filter((item) => item.dataset === "pretoria_independent_operators"),
                groupSummaries.pretoria_independent_operators
            ) +
            "\n**Interpretation:** this small curated test is a discovery baseline, not a statistically representative market sample or proof of business-identity matching accuracy.\n";
        await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
