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
        alternateQueries: [
            "The Cure Spa Pretoria South Africa spa treatments Waterkloof Glen",
            "The Cure Spa 454 Durr Street Pretoria"
        ],
        expectedDomain: "thecurespa.co.za",
        category: "locally operated spa"
    },
    {
        dataset: "pretoria_independent_operators",
        business: "Charis Nail & Beauty Studio",
        query: "Charis Nail and Beauty Studio Lombardy Business Park Pretoria official website",
        alternateQueries: [
            "Charis Nail & Beauty Studio Pretoria 012 809 3318",
            "Charis Nail & Beauty Studio 66 Graham Road Lombardy"
        ],
        expectedDomain: "charisbeauty.co.za",
        candidateAliasDomains: ["charisnails.co.za"],
        aliasNote: "Possible older/alternate domain with matching business name, Pretoria location and phone; retain for manual identity review, not automatic acceptance.",
        category: "woman-owned family-run beauty studio"
    },
    {
        dataset: "pretoria_independent_operators",
        business: "Jacqueline's Chapter One Hair and Beauty Salon",
        query: "Jacqueline Chapter One Hair and Beauty Salon Montana Park Pretoria official website",
        alternateQueries: [
            "Jacqueline's Chapter One Hair and Beauty Pretoria salon Montana Park",
            "Chapter One Hair and Beauty Salon Pretoria"
        ],
        expectedDomain: "chapteronehairandbeauty.co.za",
        category: "independent salon"
    },
    {
        dataset: "pretoria_independent_operators",
        business: "Huba Fleurs",
        query: "Huba Fleurs florist Pretoria Central official website",
        alternateQueries: [
            "Huba Fleurs Pretoria flower delivery bouquets",
            "Huba Fleurs 071 989 6471 Pretoria"
        ],
        expectedDomain: "hubafleurs.online",
        category: "local florist and floral studio"
    },
    {
        dataset: "pretoria_independent_operators",
        business: "Kalm Skin + Body Studio",
        query: "Kalm Skin and Body Studio Elarduspark Doringkloof Pretoria official website",
        alternateQueries: [
            "Kalm Skin + Body Studio Pretoria Elarduspark skincare",
            "Kalm Skin Body Studio Doringkloof Pretoria studio"
        ],
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

function topResults(results) {
    return results.slice(0, 5).map((item, index) => ({
        rank: index + 1,
        domain: (() => {
            try { return new URL(item.url).hostname; } catch { return "invalid"; }
        })(),
        title: item.title
    }));
}

function summarise(items, prefix) {
    const total = items.length;
    const top5Count = items.filter((item) => item[prefix + "Top5"]).length;
    const top10Count = items.filter((item) => item[prefix + "Top10"]).length;
    const recovered = items.filter((item) => item.fallbackRecoveredTop10).length;
    const improved = items.filter((item) => item.rankImproved).length;
    return {
        total,
        top5Count,
        top10Count,
        top5Rate: total ? Number((top5Count / total).toFixed(3)) : 0,
        top10Rate: total ? Number((top10Count / total).toFixed(3)) : 0,
        fallbackRecoveredTop10: recovered,
        rankImprovedByAlternateQuery: improved
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
    let totalSearchAttempts = 0;
    for (const testCase of cases) {
        const queries = [
            { kind: "primary", query: testCase.query },
            ...(testCase.alternateQueries || []).map((query, index) => ({
                kind: "alternate_" + (index + 1),
                query
            }))
        ];
        const attempts = [];
        for (const item of queries) {
            totalSearchAttempts += 1;
            try {
                const response = await provider.search(item.query, { maxResults: 10 });
                const results = response.results.slice(0, 10);
                const candidateAliasRanks = Object.fromEntries(
                    (testCase.candidateAliasDomains || []).map((domain) => [
                        domain,
                        domainRank(results, domain)
                    ])
                );
                attempts.push({
                    kind: item.kind,
                    rank: domainRank(results, testCase.expectedDomain),
                    candidateAliasRanks,
                    resultCount: results.length,
                    results: topResults(results)
                });
            } catch (error) {
                attempts.push({
                    kind: item.kind,
                    rank: null,
                    resultCount: 0,
                    error: String(error?.providerCode || error?.message || "search_failed").slice(0, 120),
                    results: []
                });
            }
        }

        const primary = attempts[0];
        const successfulRanks = attempts
            .map((item) => item.rank)
            .filter((rank) => rank !== null);
        const bestRank = successfulRanks.length ? Math.min(...successfulRanks) : null;
        const bestAttempt = bestRank === null ? null : attempts.find((item) => item.rank === bestRank) || null;
        const aliasRanks = {};
        for (const aliasDomain of testCase.candidateAliasDomains || []) {
            const ranks = attempts
                .map((attempt) => attempt.candidateAliasRanks?.[aliasDomain] ?? null)
                .filter((rank) => rank !== null);
            aliasRanks[aliasDomain] = ranks.length ? Math.min(...ranks) : null;
        }

        const primaryRank = primary?.rank ?? null;
        const record = {
            dataset: testCase.dataset,
            business: testCase.business,
            category: testCase.category,
            expectedDomain: testCase.expectedDomain,
            primaryRank,
            bestRank,
            bestQueryKind: bestAttempt?.kind ?? null,
            primaryTop5: primaryRank !== null && primaryRank <= 5,
            primaryTop10: primaryRank !== null,
            bestTop5: bestRank !== null && bestRank <= 5,
            bestTop10: bestRank !== null,
            fallbackRecoveredTop10: primaryRank === null && bestRank !== null,
            rankImproved: bestRank !== null && (primaryRank === null || bestRank < primaryRank),
            resultCount: primary?.resultCount ?? 0,
            candidateAliasRanks: aliasRanks,
            attempts
        };
        if (testCase.aliasNote) record.aliasNote = testCase.aliasNote;
        report.push(record);
    }

    const national = report.filter((item) => item.dataset === "national_brands");
    const local = report.filter((item) => item.dataset === "pretoria_independent_operators");
    const groupSummaries = {
        national_brands: {
            primary: summarise(national, "primary"),
            bestAcrossQueries: summarise(national, "best")
        },
        pretoria_independent_operators: {
            primary: summarise(local, "primary"),
            bestAcrossQueries: summarise(local, "best")
        }
    };
    const evaluated = {
        benchmarkVersion: "bof-sa-official-domain-search-v3",
        totalSearchAttempts,
        datasetNotes: {
            national_brands: "Five large, well-indexed South African brands; one primary query per case as a broad search connectivity baseline.",
            pretoria_independent_operators: "Five locally operated or explicitly independent Pretoria businesses with independently verified official domains; each uses one primary and two alternate public-information queries. This is a small, curated pilot and not a representative market sample.",
            queryMethod: "Primary query results are kept separate from the best result across alternate queries. Alternate-query success is not proof of identity matching. Candidate alias domains are reported separately and are not automatically accepted."
        },
        groupSummaries,
        cases: report
    };

    console.log("BOF South African multi-query official-domain search benchmark");
    console.log(JSON.stringify(evaluated, null, 2));

    if (process.env.GITHUB_STEP_SUMMARY) {
        const fs = await import("node:fs/promises");
        const makeRows = (items) => items.map((item) =>
            "| " + item.business + " | " + (item.primaryRank ?? "Not found") + " | " +
            (item.bestRank ?? "Not found") + " | " + (item.bestQueryKind || "—") + " | " +
            Object.entries(item.candidateAliasRanks || {}).map(([domain, rank]) => domain + ": " + (rank ?? "Not found")).join("<br>") + " |"
        ).join("\n");
        const makeSummary = (label, items, stats) =>
            "\n### " + label + "\n\n" +
            "| Business | Primary rank | Best rank | Best query | Candidate alias (not auto-accepted) |\n|---|---:|---:|---|---|\n" +
            makeRows(items) + "\n\n" +
            "- Primary query: **" + stats.primary.top5Count + "/" + stats.primary.total + "** in top 5; **" + stats.primary.top10Count + "/" + stats.primary.total + "** in top 10\n" +
            "- Best across queries: **" + stats.bestAcrossQueries.top5Count + "/" + stats.bestAcrossQueries.total + "** in top 5; **" + stats.bestAcrossQueries.top10Count + "/" + stats.bestAcrossQueries.total + "** in top 10\n" +
            "- Recovered into top 10 by an alternate query: **" + stats.bestAcrossQueries.fallbackRecoveredTop10 + "**\n" +
            "- Rank improved by an alternate query: **" + stats.bestAcrossQueries.rankImprovedByAlternateQuery + "**\n";
        const summary =
            "\n## BOF South African multi-query search benchmark\n\n" +
            "The primary query is measured separately from the best rank across the primary and two alternate query formulations for each Pretoria case. Ranks refer to the first ten normalised SearXNG results for each search.\n" +
            makeSummary("Large national brands", national, groupSummaries.national_brands) +
            makeSummary("Pretoria independent and locally operated businesses", local, groupSummaries.pretoria_independent_operators) +
            "\n**Interpretation:** alternate query recovery measures search formulation sensitivity only. Candidate alias domains are surfaced for manual identity review and are not counted as official-domain hits. This is a small curated pilot, not a statistically representative market sample.\n";
        await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
