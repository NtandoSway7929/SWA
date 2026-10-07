(function () {
    "use strict";

    const SUPABASE_URL = "https://sqifhribgsqfaxgtobsa.supabase.co";
    const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QhB";
    const ACCESS_TOKEN_KEY = "swayphics_admin_access_token";
    const PANEL_ID = "sway-ai-knowledge-intelligence-bridge";

    function esc(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function token() {
        try {
            return localStorage.getItem(ACCESS_TOKEN_KEY) || "";
        } catch (error) {
            return "";
        }
    }

    async function analyse() {
        const accessToken = token();
        if (!accessToken) {
            throw new Error("Admin session is unavailable. Please sign in again.");
        }

        const response = await fetch(
            SUPABASE_URL + "/rest/v1/rpc/analyze_innerme_knowledge",
            {
                method: "POST",
                headers: {
                    apikey: SUPABASE_PUBLISHABLE_KEY,
                    Authorization: "Bearer " + accessToken,
                    "Content-Type": "application/json"
                },
                body: "{}"
            }
        );

        const data = await response.json().catch(function () {
            return null;
        });

        if (!response.ok) {
            throw new Error(
                data && (data.message || data.error || data.hint)
                    ? String(data.message || data.error || data.hint)
                    : "Knowledge intelligence analysis failed."
            );
        }

        return data;
    }

    function render(report) {
        const summary = report && report.summary ? report.summary : {};
        const domains = Array.isArray(report && report.coverage_by_domain)
            ? report.coverage_by_domain
            : [];
        const overlaps = Array.isArray(report && report.semantic_overlaps)
            ? report.semantic_overlaps
            : [];
        const conflicts = Array.isArray(report && report.potential_conflicts)
            ? report.potential_conflicts
            : [];
        const recommendations = Array.isArray(report && report.recommendations)
            ? report.recommendations
            : [];

        const metric = function (label, value) {
            return (
                '<div class="sway-ai-ki-metric">' +
                    '<span>' + esc(label) + '</span>' +
                    '<strong>' + esc(value) + '</strong>' +
                '</div>'
            );
        };

        const domainHtml = domains.length
            ? '<div class="sway-ai-ki-list">' +
                domains.map(function (item) {
                    return (
                        '<div class="sway-ai-ki-row">' +
                            '<span>' + esc(item.domain || "Unclassified") + '</span>' +
                            '<strong>' +
                                esc(String(item.retrievable || 0)) +
                                '/' +
                                esc(String(item.count || 0)) +
                            '</strong>' +
                        '</div>'
                    );
                }).join("") +
              '</div>'
            : '<p class="sway-ai-ki-muted">No domain data yet.</p>';

        const signals = [
            Number(summary.stale_knowledge || 0)
                ? "Stale: " + summary.stale_knowledge
                : "",
            Number(summary.semantic_overlaps || 0)
                ? "Overlap: " + summary.semantic_overlaps
                : "",
            Number(summary.potential_conflicts || 0)
                ? "Potential conflicts: " + summary.potential_conflicts
                : ""
        ].filter(Boolean);

        return (
            '<div class="sway-ai-ki-metrics">' +
                metric("Coverage", String(summary.retrieval_coverage_pct || 0) + "%") +
                metric("Retrievable", String(summary.retrievable_knowledge || 0)) +
                metric("Stale", String(summary.stale_knowledge || 0)) +
                metric("Overlap", String(summary.semantic_overlaps || 0)) +
                metric("Conflicts", String(summary.potential_conflicts || 0)) +
                metric("Feedback", String(summary.feedback_records || 0)) +
            '</div>' +
            '<div class="sway-ai-ki-section">' +
                '<strong>Domain coverage</strong>' +
                '<span>Retrievable / total records</span>' +
                domainHtml +
            '</div>' +
            '<div class="sway-ai-ki-section">' +
                '<strong>Attention signals</strong>' +
                (
                    signals.length
                        ? '<p class="sway-ai-ki-signals">' + esc(signals.join(" · ")) + '</p>'
                        : '<p class="sway-ai-ki-good">No current warnings detected.</p>'
                ) +
            '</div>' +
            (
                recommendations.length
                    ? '<div class="sway-ai-ki-section"><strong>Recommended next moves</strong><ul>' +
                        recommendations.slice(0, 3).map(function (item) {
                            return '<li>' + esc(item) + '</li>';
                        }).join("") +
                      '</ul></div>'
                    : ""
            ) +
            '<small class="sway-ai-ki-foot">' +
                esc(
                    overlaps.length || conflicts.length
                        ? "Similarity flags are advisory and require human review."
                        : "Advisory only. No knowledge or retrieval state was changed."
                ) +
            '</small>'
        );
    }

    function ensurePanel() {
        if (document.getElementById(PANEL_ID)) return;

        const morePanel = document.getElementById("sway-ai-more-panel");
        if (!morePanel) return;

        const details = document.createElement("details");
        details.id = PANEL_ID;
        details.className = "sway-ai-knowledge-intelligence-panel";
        details.innerHTML =
            '<summary>Knowledge intelligence</summary>' +
            '<div class="sway-ai-ki-controls">' +
                '<span>Checks knowledge coverage, freshness, semantic overlap, possible conflicts and retrieval evidence.</span>' +
                '<button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-ki-run>Analyse knowledge health</button>' +
            '</div>' +
            '<div class="sway-ai-ki-results">' +
                '<p class="sway-ai-ki-muted">Not analysed yet.</p>' +
            '</div>';

        const retrievalTest = morePanel.querySelector(".sway-ai-knowledge-test");
        if (retrievalTest) {
            morePanel.insertBefore(details, retrievalTest);
        } else {
            morePanel.appendChild(details);
        }

        const button = details.querySelector("[data-sway-ai-ki-run]");
        const results = details.querySelector(".sway-ai-ki-results");

        button.addEventListener("click", async function () {
            if (button.disabled) return;

            button.disabled = true;
            button.textContent = "Analysing…";
            results.innerHTML = '<p class="sway-ai-ki-muted">Checking the knowledge base…</p>';

            try {
                const report = await analyse();
                results.innerHTML = render(report);
            } catch (error) {
                results.innerHTML =
                    '<p class="sway-ai-ki-error">' +
                        esc(error.message || "Analysis failed.") +
                    '</p>';
            } finally {
                button.disabled = false;
                button.textContent = "Analyse knowledge health";
            }
        });
    }

    const style = document.createElement("style");
    style.textContent =
        ".sway-ai-knowledge-intelligence-panel{width:100%;margin:2px 0}" +
        ".sway-ai-knowledge-intelligence-panel>summary{display:flex;align-items:center;justify-content:space-between;padding:9px 10px;border-radius:11px;cursor:pointer;list-style:none}" +
        ".sway-ai-knowledge-intelligence-panel>summary::-webkit-details-marker{display:none}" +
        ".sway-ai-knowledge-intelligence-panel>summary:after{content:'›';transform:rotate(90deg);transition:transform .16s ease}" +
        ".sway-ai-knowledge-intelligence-panel[open]>summary:after{transform:rotate(-90deg)}" +
        ".sway-ai-ki-controls{display:grid;gap:8px;padding:6px 10px 10px}" +
        ".sway-ai-ki-controls>span{font-size:11px;line-height:1.45;opacity:.68}" +
        ".sway-ai-ki-results{display:grid;gap:9px;padding:0 10px 10px}" +
        ".sway-ai-ki-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}" +
        ".sway-ai-ki-metric{padding:8px;border:1px solid rgba(1,82,244,.1);border-radius:9px;background:rgba(1,82,244,.025)}" +
        ".sway-ai-ki-metric span{display:block;font-size:8px;opacity:.58}" +
        ".sway-ai-ki-metric strong{display:block;margin-top:3px;font-size:12px}" +
        ".sway-ai-ki-section{display:grid;gap:5px;padding:9px;border:1px solid rgba(1,82,244,.08);border-radius:10px}" +
        ".sway-ai-ki-section>strong{font-size:11px}" +
        ".sway-ai-ki-section>span{font-size:9px;opacity:.55}" +
        ".sway-ai-ki-list{display:grid;gap:4px}" +
        ".sway-ai-ki-row{display:flex;justify-content:space-between;gap:8px;font-size:9px}" +
        ".sway-ai-ki-muted,.sway-ai-ki-good,.sway-ai-ki-error,.sway-ai-ki-signals{margin:0;font-size:10px;line-height:1.45}" +
        ".sway-ai-ki-good{color:#157347}" +
        ".sway-ai-ki-error{color:#b42318}" +
        ".sway-ai-ki-section ul{margin:0;padding-left:17px;display:grid;gap:4px}" +
        ".sway-ai-ki-section li{font-size:9px;line-height:1.4}" +
        ".sway-ai-ki-foot{font-size:8px;line-height:1.4;opacity:.52}" +
        "body.sway-dark-mode .sway-ai-ki-metric,body.sway-dark-mode .sway-ai-ki-section{border-color:rgba(119,193,252,.11);background:rgba(119,193,252,.025)}" +
        "body.sway-dark-mode .sway-ai-ki-good{color:#8bd3a8}" +
        "body.sway-dark-mode .sway-ai-ki-error{color:#ffb4ab}" +
        "@media(max-width:680px){.sway-ai-ki-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}";
    document.head.appendChild(style);

    const observer = new MutationObserver(function () {
        if (document.getElementById("sway-ai-more-panel")) ensurePanel();
    });

    observer.observe(document.body, {childList: true, subtree: true});
    ensurePanel();
})();
