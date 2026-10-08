(function () {
    "use strict";

    const SUPABASE_URL = "https://sqifhribgsqfaxgtobsa.supabase.co";
    const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QhB";
    const ACCESS_TOKEN_KEY = "swayphics_admin_access_token";
    const PANEL_ID = "sway-ai-knowledge-intelligence-bridge";
    const FUNCTION_URL = SUPABASE_URL + "/functions/v1/innerme-autonomy";

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

    async function status() {
        const response = await fetch(FUNCTION_URL, {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ action: "status" })
        });

        const data = await response.json().catch(function () {
            return null;
        });

        if (!response.ok) {
            throw new Error(
                data && (data.message || data.error || data.hint)
                    ? String(data.message || data.error || data.hint)
                    : "Unable to load governed autonomy status."
            );
        }

        return data;
    }

    function render(panel, data) {
        const policy = data.policy || {};
        const agent = data.agent || {};
        const enabled = Boolean(policy.enabled);

        panel.querySelector("[data-sway-autonomy-state]").innerHTML =
            '<span class="sway-ai-autonomy-pill ' +
            (enabled ? "is-on" : "is-off") +
            '">' +
            (enabled ? "Permission enabled" : "Permission disabled") +
            "</span>";

        panel.querySelector("[data-sway-autonomy-copy]").textContent = enabled
            ? "The delivery operations agent currently has the low-risk autonomy permission."
            : "InnerMe is currently advisory. No autonomous task execution is permitted.";

        panel.querySelector("[data-sway-autonomy-agent]").textContent =
            (agent.name || "Delivery & Operations Operator") +
            " · trust stage " +
            String(agent.trust_stage == null ? 1 : agent.trust_stage);

        panel.querySelector("[data-sway-autonomy-limits]").innerHTML =
            "<div><span>Capability</span><strong>Create task</strong></div>" +
            "<div><span>Risk</span><strong>Low only</strong></div>" +
            "<div><span>Run limit</span><strong>" +
            esc(policy.max_actions_per_run || 3) +
            "</strong></div>" +
            "<div><span>Timing</span><strong>0–" +
            esc(policy.max_due_offset_days || 7) +
            " days</strong></div>" +
            "<div><span>Priority</span><strong>Low / Medium</strong></div>" +
            "<div><span>Email</span><strong>Always approved</strong></div>";

        const logs = Array.isArray(data.recent_autonomous_actions)
            ? data.recent_autonomous_actions
            : [];

        const logTarget = panel.querySelector("[data-sway-autonomy-logs]");
        logTarget.innerHTML = logs.length
            ? logs.slice(0, 10).map(function (log) {
                const governance = log.request_payload && log.request_payload.governed_autonomy
                    ? log.request_payload.governed_autonomy
                    : {};
                const result = log.response_payload || {};
                return (
                    '<article class="sway-ai-autonomy-log">' +
                    '<div class="sway-ai-autonomy-log-head"><strong>' +
                    esc(log.status || "unknown") +
                    "</strong><span>" +
                    esc(log.started_at || "") +
                    "</span></div>" +
                    "<p>Task proposal " +
                    esc(log.proposal_id || "unknown") +
                    (result.task_id ? " · task " + esc(result.task_id) : "") +
                    "</p>" +
                    "<small>Run " +
                    esc(governance.run_id || "unknown") +
                    " · " +
                    esc(governance.policy_key || "unknown") +
                    "</small>" +
                    "</article>"
                );
            }).join("")
            : '<p class="sway-ai-ki-muted">No autonomous task actions have been executed.</p>';
    }

    function markup() {
        return (
            '<details class="sway-ai-autonomy" data-sway-autonomy-panel>' +
            "<summary>Governed autonomy</summary>" +
            '<div class="sway-ai-autonomy-controls">' +
            "<span>Permission-based autonomy with fixed low-risk boundaries. This dashboard exposes status and audit history; permission changes remain an explicit administrator operation.</span>" +
            '<button type="button" class="sway-ai-knowledge-test-button" data-sway-autonomy-refresh>Refresh status</button>' +
            "</div>" +
            '<div class="sway-ai-autonomy-state" data-sway-autonomy-state><span class="sway-ai-autonomy-pill is-off">Loading</span></div>' +
            '<p class="sway-ai-autonomy-copy" data-sway-autonomy-copy>Loading permission state…</p>' +
            '<div class="sway-ai-autonomy-agent" data-sway-autonomy-agent>Delivery & Operations Operator</div>' +
            '<div class="sway-ai-autonomy-limits" data-sway-autonomy-limits></div>' +
            '<div class="sway-ai-autonomy-logs" data-sway-autonomy-logs></div>' +
            "</details>"
        );
    }

    function boot() {
        const bridge = document.getElementById(PANEL_ID);
        if (!bridge) {
            window.setTimeout(boot, 450);
            return;
        }

        if (bridge.querySelector("[data-sway-autonomy-panel]")) return;

        bridge.insertAdjacentHTML("beforeend", markup());

        const panel = bridge.querySelector("[data-sway-autonomy-panel]");
        const refreshButton = panel.querySelector("[data-sway-autonomy-refresh]");

        async function refresh() {
            refreshButton.disabled = true;
            try {
                render(panel, await status());
            } catch (error) {
                panel.querySelector("[data-sway-autonomy-copy]").textContent =
                    error.message || "Governed autonomy failed to load.";
            } finally {
                refreshButton.disabled = false;
            }
        }

        refreshButton.addEventListener("click", refresh);
        panel.addEventListener("toggle", function () {
            if (panel.open) refresh();
        });
        refresh();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
        boot();
    }
})();