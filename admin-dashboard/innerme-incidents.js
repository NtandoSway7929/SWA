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

    function headers() {
        return {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            Authorization: "Bearer " + token(),
            "Content-Type": "application/json"
        };
    }

    async function correlate() {
        const response = await fetch(
            SUPABASE_URL + "/rest/v1/rpc/generate_innerme_operational_incidents",
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
                    : "Incident correlation failed."
            );
        }
        return Number(data || 0);
    }

    async function loadIncidents() {
        const response = await fetch(
            SUPABASE_URL +
                "/rest/v1/innerme_operational_incidents" +
                "?select=id,incident_key,incident_type,severity,status,title,summary,categories,source_count,source_snapshot,correlation_reason,recommended_response,condition_fingerprint,first_detected_at,last_detected_at,acknowledged_at,resolved_at,ignored_at,created_at,updated_at" +
                "&order=last_detected_at.desc&limit=100",
            {
                method: "GET",
                headers: headers()
            }
        );

        const data = await response.json().catch(function () {
            return null;
        });

        if (!response.ok) {
            throw new Error(
                data && (data.message || data.error || data.hint)
                    ? String(data.message || data.error || data.hint)
                    : "Unable to load operational incidents."
            );
        }

        return Array.isArray(data) ? data : [];
    }

    async function loadEvents() {
        const response = await fetch(
            SUPABASE_URL +
                "/rest/v1/innerme_operational_incident_events" +
                "?select=id,incident_id,event_type,severity,status,note,created_at" +
                "&order=created_at.desc&limit=200",
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
                    : "Unable to load incident history."
            );
        }

        return Array.isArray(data) ? data : [];
    }

    async function review(id, status) {
        const response = await fetch(
            SUPABASE_URL + "/rest/v1/rpc/review_innerme_operational_incident",
            {
                method: "POST",
                headers: headers(),
                body: JSON.stringify({
                    p_incident_id: id,
                    p_status: status
                })
            }
        );

        const data = await response.json().catch(function () {
            return null;
        });

        if (!response.ok) {
            throw new Error(
                data && (data.message || data.error || data.hint)
                    ? String(data.message || data.error || data.hint)
                    : "Incident review failed."
            );
        }

        return data;
    }

    function severityClass(severity) {
        return String(severity || "medium").replace(/[^a-z]/gi, "").toLowerCase();
    }

    function statusClass(status) {
        return String(status || "open").replace(/[^a-z]/gi, "").toLowerCase();
    }

    function formatDate(value) {
        if (!value) return "Not recorded";
        const date = new Date(value);
        return Number.isNaN(date.getTime())
            ? String(value)
            : date.toLocaleString();
    }

    function categoryLabel(categories) {
        return Array.isArray(categories) && categories.length
            ? categories.map(function (item) {
                return String(item || "").replace(/_/g, " ");
            }).join(" · ")
            : "operational";
    }

    function renderSourceSnapshot(snapshot) {
        const rows = Array.isArray(snapshot) ? snapshot : [];
        if (!rows.length) {
            return '<p class="sway-ai-incidents-muted">No source snapshot recorded.</p>';
        }

        return rows.slice(0, 20).map(function (source) {
            const table = String(source && source.source_table || "source");
            const id = String(source && source.source_id || "");
            const type = String(source && source.exception_type || "signal").replace(/_/g, " ");
            const extra = source && source.title ? " · " + String(source.title) : "";

            return (
                '<div class="sway-ai-incident-source">' +
                    '<span>' + esc(type) + extra + '</span>' +
                    '<small>' + esc(table) + (id ? " · " + esc(id) : "") + '</small>' +
                '</div>'
            );
        }).join("");
    }

    function renderEvents(events) {
        if (!events.length) {
            return '<p class="sway-ai-incidents-muted">No audit events recorded.</p>';
        }

        return events.slice(0, 12).map(function (event) {
            return (
                '<div class="sway-ai-incident-event">' +
                    '<div><strong>' + esc(event.event_type || "event") + '</strong><span>' + esc(event.status || "") + '</span></div>' +
                    '<small>' + esc(formatDate(event.created_at)) + '</small>' +
                    '<p>' + esc(event.note || "Incident state recorded.") + '</p>' +
                '</div>'
            );
        }).join("");
    }

    function render(panel, incidents, events, generated) {
        const active = incidents.filter(function (item) {
            return ["open", "acknowledged"].includes(String(item.status));
        });
        const counts = incidents.reduce(function (result, item) {
            const severity = String(item.severity || "medium");
            const status = String(item.status || "open");
            result.total += 1;
            result[severity] = (result[severity] || 0) + 1;
            if (["open", "acknowledged"].includes(status)) {
                result.active += 1;
            }
            return result;
        }, { total: 0, active: 0 });

        const eventMap = new Map();
        events.forEach(function (event) {
            const key = String(event.incident_id || "");
            if (!eventMap.has(key)) eventMap.set(key, []);
            eventMap.get(key).push(event);
        });

        const summary = panel.querySelector("[data-im-incident-summary]");
        summary.innerHTML =
            '<div><span>Active</span><strong>' + esc(counts.active) + '</strong></div>' +
            '<div><span>Critical</span><strong>' + esc(counts.critical || 0) + '</strong></div>' +
            '<div><span>High</span><strong>' + esc(counts.high || 0) + '</strong></div>' +
            '<div><span>Total</span><strong>' + esc(counts.total) + '</strong></div>';

        const results = panel.querySelector("[data-im-incidents]");
        if (!active.length) {
            results.innerHTML =
                '<p class="sway-ai-ki-good">No active operational incidents. Individual exception monitoring remains separate and unchanged.</p>';
        } else {
            results.innerHTML = active.map(function (incident) {
                const status = String(incident.status || "open");
                const eventHistory = eventMap.get(String(incident.id)) || [];
                const acknowledgementAction =
                    status === "open"
                        ? '<button type="button" class="sway-ai-knowledge-test-button" data-im-incident-action="acknowledged" data-im-incident-id="' + esc(incident.id) + '">Acknowledge</button>'
                        : "";
                const resolveAction =
                    status !== "resolved"
                        ? '<button type="button" class="sway-ai-knowledge-test-button" data-im-incident-action="resolved" data-im-incident-id="' + esc(incident.id) + '">Resolve</button>'
                        : "";
                const reopenAction =
                    ["resolved", "ignored"].includes(status)
                        ? '<button type="button" class="sway-ai-knowledge-test-button" data-im-incident-action="open" data-im-incident-id="' + esc(incident.id) + '">Reopen</button>'
                        : "";

                return (
                    '<article class="sway-ai-incident-card">' +
                        '<div class="sway-ai-incident-head">' +
                            '<div><strong class="sway-ai-incident-pill ' + severityClass(incident.severity) + '">' + esc(incident.severity || "medium") + '</strong>' +
                            '<span>' + esc(status.replace(/_/g, " ")) + ' · ' + esc(categoryLabel(incident.categories)) + '</span></div>' +
                            '<small>' + esc(String(incident.source_count || 0)) + ' sources</small>' +
                        '</div>' +
                        '<h4>' + esc(incident.title || "Operational incident") + '</h4>' +
                        '<p>' + esc(incident.summary || "") + '</p>' +
                        '<div class="sway-ai-incident-reason"><strong>Why this is correlated</strong><p>' + esc(incident.correlation_reason || "") + '</p></div>' +
                        '<div class="sway-ai-incident-reason"><strong>Recommended response</strong><p>' + esc(incident.recommended_response || "") + '</p></div>' +
                        '<details class="sway-ai-incident-detail">' +
                            '<summary>Sources and audit history</summary>' +
                            '<div class="sway-ai-incident-sources">' + renderSourceSnapshot(incident.source_snapshot) + '</div>' +
                            '<div class="sway-ai-incident-events">' + renderEvents(eventHistory) + '</div>' +
                        '</details>' +
                        '<div class="sway-ai-incident-meta">' +
                            '<span>First detected: ' + esc(formatDate(incident.first_detected_at)) + '</span>' +
                            '<span>Last detected: ' + esc(formatDate(incident.last_detected_at)) + '</span>' +
                        '</div>' +
                        '<div class="sway-ai-incident-actions">' +
                            acknowledgementAction + resolveAction + reopenAction +
                        '</div>' +
                    '</article>'
                );
            }).join("");
        }

        const generatedLabel = panel.querySelector("[data-im-incident-generated]");
        generatedLabel.textContent =
            generated > 0
                ? generated + " new or changed incident signal(s) processed."
                : "No new or changed incident signals detected.";
    }

    function injectStyles() {
        if (document.getElementById("sway-ai-incidents-styles")) return;

        const style = document.createElement("style");
        style.id = "sway-ai-incidents-styles";
        style.textContent =
            ".sway-ai-incidents{width:100%;margin:4px 0}" +
            ".sway-ai-incidents>summary{padding:9px 10px;border-radius:11px;cursor:pointer;list-style:none;font-weight:700}" +
            ".sway-ai-incidents>summary::-webkit-details-marker{display:none}" +
            ".sway-ai-incidents-top{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 10px 10px}" +
            ".sway-ai-incidents-top>span{font-size:11px;line-height:1.45;opacity:.68;max-width:760px}" +
            ".sway-ai-incident-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;padding:0 10px 8px}" +
            ".sway-ai-incident-summary>div{display:grid;gap:3px;padding:8px;border:1px solid rgba(1,82,244,.09);border-radius:9px;background:rgba(1,82,244,.025)}" +
            ".sway-ai-incident-summary span{font-size:8px;opacity:.58}.sway-ai-incident-summary strong{font-size:12px}" +
            ".sway-ai-incident-generated{margin:0;padding:0 10px 9px;font-size:9px;opacity:.58}" +
            ".sway-ai-incidents-list{display:grid;gap:8px;padding:0 10px 10px}" +
            ".sway-ai-incident-card{display:grid;gap:6px;padding:10px;border:1px solid rgba(1,82,244,.09);border-radius:10px;background:rgba(1,82,244,.018)}" +
            ".sway-ai-incident-head{display:flex;align-items:center;justify-content:space-between;gap:8px}" +
            ".sway-ai-incident-head>div{display:flex;align-items:center;gap:7px;min-width:0}" +
            ".sway-ai-incident-head span,.sway-ai-incident-head small{font-size:8px;opacity:.58}" +
            ".sway-ai-incident-pill{display:inline-flex;padding:4px 7px;border-radius:999px;font-size:8px;font-weight:800;text-transform:capitalize}" +
            ".sway-ai-incident-pill.critical,.sway-ai-incident-pill.high{background:rgba(190,52,52,.12);color:#B42323}" +
            ".sway-ai-incident-pill.medium{background:rgba(247,201,120,.14);color:#9A6700}" +
            ".sway-ai-incident-pill.low{background:rgba(1,82,244,.08);color:#0152F4}" +
            ".sway-ai-incident-card h4{margin:0;font-size:11px}.sway-ai-incident-card>p{margin:0;font-size:9px;line-height:1.48}" +
            ".sway-ai-incident-reason{display:grid;gap:2px}.sway-ai-incident-reason strong{font-size:8px;text-transform:uppercase;letter-spacing:.04em;opacity:.58}" +
            ".sway-ai-incident-reason p{margin:0;font-size:9px;line-height:1.45}" +
            ".sway-ai-incident-detail{border-top:1px solid rgba(1,82,244,.08);padding-top:6px}.sway-ai-incident-detail>summary{font-size:8px;cursor:pointer;opacity:.72}" +
            ".sway-ai-incident-sources,.sway-ai-incident-events{display:grid;gap:5px;padding-top:7px}" +
            ".sway-ai-incident-source,.sway-ai-incident-event{display:grid;gap:2px;padding:7px;border:1px solid rgba(1,82,244,.07);border-radius:8px;background:rgba(1,82,244,.015)}" +
            ".sway-ai-incident-source span,.sway-ai-incident-event p{font-size:8px;line-height:1.4}.sway-ai-incident-source small,.sway-ai-incident-event small{font-size:7px;opacity:.55;overflow-wrap:anywhere}" +
            ".sway-ai-incident-event div{display:flex;justify-content:space-between;gap:8px}.sway-ai-incident-event div strong,.sway-ai-incident-event div span{font-size:8px;text-transform:capitalize}.sway-ai-incident-event p{margin:0}" +
            ".sway-ai-incident-meta{display:flex;flex-wrap:wrap;gap:8px;font-size:7px;opacity:.52}" +
            ".sway-ai-incident-actions{display:flex;flex-wrap:wrap;gap:6px}" +
            ".sway-ai-incidents-muted{margin:0;padding:6px 0;font-size:9px;opacity:.58}" +
            "body.sway-dark-mode .sway-ai-incident-summary>div,body.sway-dark-mode .sway-ai-incident-card,body.sway-dark-mode .sway-ai-incident-source,body.sway-dark-mode .sway-ai-incident-event{border-color:rgba(119,193,252,.11);background:rgba(119,193,252,.025)}" +
            "body.sway-dark-mode .sway-ai-incident-pill.critical,body.sway-dark-mode .sway-ai-incident-pill.high{background:rgba(190,52,52,.17);color:#FFB0B0}" +
            "body.sway-dark-mode .sway-ai-incident-pill.medium{background:rgba(247,201,120,.12);color:#FFD990}" +
            "body.sway-dark-mode .sway-ai-incident-pill.low{background:rgba(119,193,252,.09);color:#78C3FF}" +
            "@media(max-width:700px){.sway-ai-incidents-top{display:grid}.sway-ai-incident-summary{grid-template-columns:repeat(2,minmax(0,1fr))}}";
        document.head.appendChild(style);
    }

    function boot() {
        injectStyles();
        const bridge = document.getElementById(PANEL_ID);
        if (!bridge) {
            window.setTimeout(boot, 450);
            return;
        }

        if (bridge.querySelector("[data-sway-incident-panel]")) return;

        bridge.insertAdjacentHTML(
            "beforeend",
            '<details class="sway-ai-incidents" data-sway-incident-panel>' +
                '<summary>Operational incidents</summary>' +
                '<div class="sway-ai-incidents-top">' +
                    '<span>Correlates independent exceptions into compound operational incidents. Correlation is deterministic, source-backed and advisory. It does not mutate leads, clients, tasks, projects, invoices or InnerMe action state.</span>' +
                    '<button type="button" class="sway-ai-knowledge-test-button" data-im-incident-refresh>Run correlation</button>' +
                '</div>' +
                '<div class="sway-ai-incident-summary" data-im-incident-summary></div>' +
                '<p class="sway-ai-incident-generated" data-im-incident-generated>Not scanned yet.</p>' +
                '<div class="sway-ai-incidents-list" data-im-incidents><p class="sway-ai-incidents-muted">Loading incidents…</p></div>' +
            '</details>'
        );

        const panel = bridge.querySelector("[data-sway-incident-panel]");
        const refreshButton = panel.querySelector("[data-im-incident-refresh]");

        async function refresh() {
            refreshButton.disabled = true;
            refreshButton.textContent = "Correlating…";
            try {
                const generated = await correlate();
                const incidents = await loadIncidents();
                const events = await loadEvents();
                render(panel, incidents, events, generated);
            } catch (error) {
                panel.querySelector("[data-im-incidents]").innerHTML =
                    '<p class="sway-ai-ki-error">' + esc(error.message || "Incident correlation failed.") + "</p>";
            } finally {
                refreshButton.disabled = false;
                refreshButton.textContent = "Run correlation";
            }
        }

        panel.addEventListener("click", async function (event) {
            const button = event.target.closest("[data-im-incident-action]");
            if (!button) return;

            const id = String(button.getAttribute("data-im-incident-id") || "");
            const status = String(button.getAttribute("data-im-incident-action") || "");
            if (!id || !status) return;

            if (status === "resolved" && !window.confirm("Mark this operational incident as resolved?")) {
                return;
            }

            button.disabled = true;
            try {
                await review(id, status);
                await refresh();
            } catch (error) {
                window.alert(error.message || "Incident review failed.");
                button.disabled = false;
            }
        });

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