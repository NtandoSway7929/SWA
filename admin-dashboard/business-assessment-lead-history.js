(() => {
    "use strict";

    const SUPABASE_URL = "https://sqifhribgsqfaxgtobsa.supabase.co";
    const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QhB";
    const ACCESS_KEY = "swayphics_admin_access_token";
    const REFRESH_KEY = "swayphics_admin_refresh_token";

    let sessionVerified = false;
    let pendingLeadId = "";
    let refreshPromise = null;

    function create(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = String(text);
        return node;
    }

    async function refreshAdminToken() {
        const refreshToken = localStorage.getItem(REFRESH_KEY) || "";
        if (!refreshToken) return "";
        if (refreshPromise) return refreshPromise;

        refreshPromise = (async () => {
            try {
                const response = await fetch(
                    SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token",
                    {
                        method: "POST",
                        headers: {
                            "apikey": SUPABASE_PUBLISHABLE_KEY,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            grant_type: "refresh_token",
                            refresh_token: refreshToken
                        })
                    }
                );
                if (!response.ok) return "";

                const session = await response.json();
                if (!session || !session.access_token) return "";

                localStorage.setItem(ACCESS_KEY, session.access_token);
                if (session.refresh_token) {
                    localStorage.setItem(REFRESH_KEY, session.refresh_token);
                }
                return session.access_token;
            } catch (error) {
                return "";
            } finally {
                refreshPromise = null;
            }
        })();

        return refreshPromise;
    }

    async function loadLinkedAssessments(leadId) {
        let token = localStorage.getItem(ACCESS_KEY) || "";
        const endpoint = SUPABASE_URL +
            "/rest/v1/business_assessments?select=id,assessment_version,status,business_name,industry,report,contact_requested,submitted_at&lead_id=eq." +
            encodeURIComponent(leadId) +
            "&order=submitted_at.desc&limit=20";

        const options = {
            method: "GET",
            headers: {
                "apikey": SUPABASE_PUBLISHABLE_KEY,
                "Authorization": "Bearer " + token
            },
            cache: "no-store"
        };

        let response = await fetch(endpoint, options);
        if (response.status === 401) {
            token = await refreshAdminToken();
            if (token) {
                options.headers.Authorization = "Bearer " + token;
                response = await fetch(endpoint, options);
            }
        }

        if (!response.ok) {
            throw new Error("Linked assessment history could not be loaded.");
        }

        const rows = await response.json();
        return Array.isArray(rows) ? rows : [];
    }

    function dateLabel(value) {
        if (!value) return "Date not recorded";
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) return "Date not recorded";
        return new Intl.DateTimeFormat("en-ZA", {
            dateStyle: "medium",
            timeStyle: "short"
        }).format(date);
    }

    function reportSummary(report) {
        const parts = [];
        if (report && report.industry && report.industry.label) {
            parts.push(report.industry.label);
        }
        if (report && report.website_status) {
            parts.push("Website: " + report.website_status);
        }
        if (report && report.priority && report.priority.label) {
            parts.push("Priority: " + report.priority.label);
        }
        return parts.join(" · ") || "Respondent answers saved";
    }

    function renderHistory(section, rows) {
        section.querySelectorAll(".bfa-lead-history-content").forEach((node) => node.remove());
        const content = create("div", "bfa-lead-history-content");

        if (!rows.length) {
            content.appendChild(create("p", "bfa-lead-history-empty",
                "No Business Opportunity Finder assessments have been linked to this lead."));
            section.appendChild(content);
            return;
        }

        rows.forEach((item) => {
            const card = create("article", "bfa-lead-history-card");
            const header = create("div", "bfa-lead-history-card-header");
            const report = item.report || {};
            header.appendChild(create("strong", "bfa-lead-history-title",
                report.title || item.business_name || "Business assessment"));
            header.appendChild(create("span", "bfa-lead-history-status",
                String(item.status || "completed").replace(/_/g, " ")));
            card.appendChild(header);
            card.appendChild(create("p", "bfa-lead-history-summary", reportSummary(report)));
            card.appendChild(create("p", "bfa-lead-history-meta",
                dateLabel(item.submitted_at) + " · " + String(item.assessment_version || "Version not recorded")));

            const findings = Array.isArray(report.findings) ? report.findings : [];
            if (findings.length) {
                const evidence = create("div", "bfa-lead-history-findings");
                evidence.appendChild(create("span", "bfa-lead-history-evidence-label",
                    "RESPONDENT-REPORTED OPPORTUNITIES"));
                findings.slice(0, 3).forEach((finding) => {
                    evidence.appendChild(create("p", "", finding.title || "Opportunity identified"));
                });
                card.appendChild(evidence);
            }

            const link = create("a", "sway-workspace-button", "Review full assessment");
            link.href = "business-assessments.html?assessment=" + encodeURIComponent(item.id);
            card.appendChild(link);
            content.appendChild(card);
        });

        section.appendChild(content);
    }

    function mountLeadHistory(modal, leadId) {
        if (!modal || !leadId || modal.dataset.bfaLeadHistory) return;
        modal.dataset.bfaLeadHistory = "loading";

        const body = modal.querySelector(".sway-lead-profile-body");
        if (!body) {
            delete modal.dataset.bfaLeadHistory;
            return;
        }

        const section = create("section", "sway-lead-profile-section bfa-lead-history");
        const heading = create("div", "sway-lead-profile-section-heading");
        const headingCopy = create("div");
        headingCopy.appendChild(create("span", "", "BUSINESS OPPORTUNITY FINDER"));
        headingCopy.appendChild(create("h4", "", "Linked assessment history"));
        heading.appendChild(headingCopy);
        section.appendChild(heading);
        section.appendChild(create("p", "bfa-lead-history-loading", "Loading linked assessments…"));

        const pipelineSection = Array.from(body.querySelectorAll(".sway-lead-profile-section"))
            .find((node) => node.textContent.includes("03 · PIPELINE"));
        if (pipelineSection) body.insertBefore(section, pipelineSection);
        else body.appendChild(section);

        loadLinkedAssessments(leadId)
            .then((rows) => renderHistory(section, rows))
            .catch((error) => {
                section.querySelectorAll(".bfa-lead-history-loading").forEach((node) => node.remove());
                section.appendChild(create("p", "bfa-lead-history-empty",
                    error.message || "Linked assessment history could not be loaded."));
            });
    }

    function scanLeadProfileModals() {
        if (!sessionVerified || !pendingLeadId) return;
        const modal = document.querySelector(".sway-lead-profile-modal:not([data-bfa-lead-history])");
        if (!modal) return;
        const leadId = pendingLeadId;
        pendingLeadId = "";
        mountLeadHistory(modal, leadId);
    }

    function start() {
        if (!document.body) return;

        document.addEventListener("click", (event) => {
            if (!sessionVerified) return;
            const trigger = event.target && typeof event.target.closest === "function"
                ? event.target.closest(".sway-lead-card-open[data-id]")
                : null;
            if (!trigger) return;
            pendingLeadId = String(trigger.dataset.id || "");
        }, true);

        const observer = new MutationObserver(scanLeadProfileModals);
        observer.observe(document.body, { childList: true, subtree: true });

        const ready = window.swayphicsAdminSessionReady;
        if (ready && typeof ready.then === "function") {
            ready.then((verified) => {
                sessionVerified = verified === true;
                if (sessionVerified) scanLeadProfileModals();
            }).catch(() => {
                sessionVerified = false;
            });
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }
})();
