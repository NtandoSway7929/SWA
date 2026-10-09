(function () {
    "use strict";

    const SUPABASE_URL = "https://sqifhribgsqfaxgtobsa.supabase.co";
    const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QhB";
    const ACCESS_TOKEN_KEY = "swayphics_admin_access_token";
    const BRIDGE_ID = "sway-ai-knowledge-intelligence-bridge";

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

    function headers() {
        return {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            Authorization: "Bearer " + token(),
            "Content-Type": "application/json"
        };
    }

    async function refreshForecasts() {
        const response = await fetch(
            SUPABASE_URL + "/rest/v1/rpc/refresh_innerme_predictive_business_intelligence",
            {
                method: "POST",
                headers: headers(),
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
                    : "Predictive intelligence refresh failed."
            );
        }

        return Number(data || 0);
    }

    async function loadForecasts() {
        const today = new Date().toISOString().slice(0, 10);
        const response = await fetch(
            SUPABASE_URL +
                "/rest/v1/innerme_predictive_forecasts" +
                "?select=id,forecast_key,forecast_type,horizon_days,forecast_date,status,confidence,unit,baseline_value,projected_value,delta_value,direction,metric_label,statement,evidence,horizon_start,horizon_end,verification_status,updated_at" +
                "&forecast_date=eq." + encodeURIComponent(today) +
                "&order=horizon_days.asc,forecast_type.asc",
            {
                method: "GET",
                headers: headers()
            }
        );

        const data = await response.json().catch(function () {
            return [];
        });

        if (!response.ok) {
            throw new Error(
                data && (data.message || data.error || data.hint)
                    ? String(data.message || data.error || data.hint)
                    : "Unable to load predictive forecasts."
            );
        }

        return Array.isArray(data) ? data : [];
    }

    function formatValue(item, value) {
        if (value == null) return "Not available";

        if (item.unit === "zar") {
            return "R" + Number(value).toLocaleString("en-ZA", {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0
            });
        }

        if (item.unit === "count") {
            return Number(value).toLocaleString("en-ZA", {
                maximumFractionDigits: 1
            });
        }

        return Number(value).toLocaleString("en-ZA", {
            maximumFractionDigits: 2
        });
    }

    function card(item) {
        const insufficient = item.status === "insufficient_evidence";
        const projected = formatValue(item, item.projected_value);
        const baseline = formatValue(item, item.baseline_value);
        const direction = item.direction === "unknown" ? "evidence limited" : item.direction;
        const signal =
            insufficient
                ? "Evidence limited"
                : (
                    item.direction === "up"
                        ? "Increasing"
                        : item.direction === "down"
                            ? "Decreasing"
                            : "Stable"
                );

        return (
            '<article class="sway-ai-predictive-card">' +
                '<div class="sway-ai-predictive-card-head">' +
                    '<div>' +
                        '<strong>' + esc(item.metric_label || "Forecast") + '</strong>' +
                        '<span>' + esc(String(item.horizon_days || "") + "-day horizon") + '</span>' +
                    '</div>' +
                    '<em class="' + (insufficient ? "is-limited" : "is-active") + '">' +
                        esc(signal) +
                    '</em>' +
                '</div>' +
                '<div class="sway-ai-predictive-values">' +
                    '<div><span>Baseline</span><strong>' + esc(baseline) + '</strong></div>' +
                    '<div><span>Projection</span><strong>' + esc(projected) + '</strong></div>' +
                    '<div><span>Confidence</span><strong>' + esc(item.confidence || "low") + '</strong></div>' +
                '</div>' +
                '<p>' + esc(item.statement || "") + '</p>' +
                '<small>Evidence window: ' + esc(item.horizon_start || "") + ' → ' + esc(item.horizon_end || "") +
                    ' · Direction: ' + esc(direction) + '</small>' +
            '</article>'
        );
    }

    function render(panel, forecasts) {
        const active = forecasts.filter(function (item) {
            return item.status === "forecast";
        }).length;

        const limited = forecasts.filter(function (item) {
            return item.status === "insufficient_evidence";
        }).length;

        panel.innerHTML =
            '<details class="sway-ai-predictive" open>' +
                '<summary>' +
                    '<span>Predictive Business Intelligence</span>' +
                    '<span class="sway-ai-predictive-summary">' +
                        esc(active) + ' forecast(s) · ' + esc(limited) + ' evidence-limited' +
                    '</span>' +
                '</summary>' +
                '<div class="sway-ai-predictive-controls">' +
                    '<p>Forecasts use observed workspace evidence only. Pipeline projections are not treated as realized revenue.</p>' +
                    '<button type="button" class="sway-ai-knowledge-test-button" data-sway-ai-predictive-refresh>Refresh forecast</button>' +
                '</div>' +
                '<div class="sway-ai-predictive-grid">' +
                    (forecasts.length
                        ? forecasts.slice(0, 8).map(card).join("")
                        : '<p class="sway-ai-ki-muted">No predictive forecast records are available yet.</p>') +
                '</div>' +
            '</details>';
    }

    function styles() {
        if (document.getElementById("sway-ai-predictive-styles")) return;

        const style = document.createElement("style");
        style.id = "sway-ai-predictive-styles";
        style.textContent =
            ".sway-ai-predictive{width:100%;margin:10px 0 0}" +
            ".sway-ai-predictive>summary{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-radius:11px;cursor:pointer;list-style:none;font-weight:800}" +
            ".sway-ai-predictive>summary::-webkit-details-marker{display:none}" +
            ".sway-ai-predictive-summary{font-size:8px;opacity:.56;font-weight:700}" +
            ".sway-ai-predictive-controls{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 12px 10px}" +
            ".sway-ai-predictive-controls p{margin:0;max-width:800px;font-size:9px;line-height:1.45;opacity:.62}" +
            ".sway-ai-predictive-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:0 12px 12px}" +
            ".sway-ai-predictive-card{display:grid;gap:7px;padding:10px;border:1px solid rgba(1,82,244,.09);border-radius:10px;background:rgba(1,82,244,.018)}" +
            ".sway-ai-predictive-card-head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}" +
            ".sway-ai-predictive-card-head>div{display:grid;gap:2px}" +
            ".sway-ai-predictive-card-head strong{font-size:9px}" +
            ".sway-ai-predictive-card-head span{font-size:7px;opacity:.55}" +
            ".sway-ai-predictive-card-head em{font-size:7px;font-style:normal;font-weight:800;padding:3px 6px;border-radius:999px;background:rgba(1,82,244,.08);color:#0152F4}" +
            ".sway-ai-predictive-card-head em.is-limited{background:rgba(100,116,139,.10);color:#64748B}" +
            ".sway-ai-predictive-values{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}" +
            ".sway-ai-predictive-values>div{display:grid;gap:2px;padding:6px;border-radius:8px;background:rgba(1,82,244,.025)}" +
            ".sway-ai-predictive-values span{font-size:7px;opacity:.5}" +
            ".sway-ai-predictive-values strong{font-size:9px}" +
            ".sway-ai-predictive-card p{margin:0;font-size:8px;line-height:1.4;opacity:.72}" +
            ".sway-ai-predictive-card small{font-size:7px;opacity:.5;line-height:1.35}" +
            "body.sway-dark-mode .sway-ai-predictive-card{border-color:rgba(119,193,252,.12);background:rgba(119,193,252,.025)}" +
            "body.sway-dark-mode .sway-ai-predictive-values>div{background:rgba(119,193,252,.035)}" +
            "body.sway-dark-mode .sway-ai-predictive-card-head em{background:rgba(119,193,252,.08);color:#78C3FF}" +
            "@media(max-width:700px){.sway-ai-predictive-grid{grid-template-columns:1fr}.sway-ai-predictive-controls{display:grid}}";
        document.head.appendChild(style);
    }

    async function boot() {
        styles();

        const bridge = document.getElementById(BRIDGE_ID);
        if (!bridge) {
            window.setTimeout(boot, 500);
            return;
        }

        let panel = bridge.querySelector("[data-sway-ai-predictive]");
        if (!panel) {
            panel = document.createElement("div");
            panel.setAttribute("data-sway-ai-predictive", "true");
            bridge.appendChild(panel);
        }

        async function refresh(button) {
            if (button) {
                button.disabled = true;
                button.textContent = "Refreshing…";
            }

            try {
                await refreshForecasts();
                render(panel, await loadForecasts());

                const nextButton = panel.querySelector("[data-sway-ai-predictive-refresh]");
                if (nextButton) {
                    nextButton.addEventListener("click", function () {
                        refresh(nextButton);
                    }, { once: true });
                }
            } catch (error) {
                panel.innerHTML =
                    '<details class="sway-ai-predictive">' +
                        '<summary>Predictive Business Intelligence</summary>' +
                        '<p class="sway-ai-ki-muted">' + esc(error.message || "Forecast loading failed.") + '</p>' +
                    '</details>';
            } finally {
                if (button) {
                    button.disabled = false;
                    button.textContent = "Refresh forecast";
                }
            }
        }

        await refresh();
    }

    window.addEventListener("swayphics:workspace-view-rendered", boot);
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
        boot();
    }
})();