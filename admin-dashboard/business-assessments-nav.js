(() => {
    "use strict";

    const ACCESS_KEY = "swayphics_admin_access_token";
    const REFRESH_KEY = "swayphics_admin_refresh_token";
    const API_URL = "https://sqifhribgsqfaxgtobsa.supabase.co";
    const API_KEY = "sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QhB";
    let assessmentEnquiryIds = new Map();
    let sessionVerified = false;
    let lastLinkLoad = 0;
    let linkLoadPromise = null;

    function injectBusinessAssessmentLink() {
        if (!sessionVerified) return;
        const crmMenu = document.querySelector('[data-nav-menu="crm"]');
        if (!crmMenu || crmMenu.querySelector("[data-business-assessments-nav]")) return;

        const link = document.createElement("a");
        link.href = "business-assessments.html";
        link.className = "sway-workspace-nav-button";
        link.dataset.businessAssessmentsNav = "true";
        link.textContent = "Business assessments";
        crmMenu.appendChild(link);
    }

    async function refreshAdminToken() {
        const refreshToken = localStorage.getItem(REFRESH_KEY) || "";
        if (!refreshToken) return "";
        try {
            const response = await fetch(
                API_URL + "/auth/v1/token?grant_type=refresh_token",
                {
                    method: "POST",
                    headers: {
                        "apikey": API_KEY,
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
            if (session.refresh_token) localStorage.setItem(REFRESH_KEY, session.refresh_token);
            return session.access_token;
        } catch (error) {
            return "";
        }
    }

    async function loadAssessmentEnquiryIds(force = false) {
        if (linkLoadPromise) return linkLoadPromise;
        if (!force && Date.now() - lastLinkLoad < 60000) return assessmentEnquiryIds;

        linkLoadPromise = (async () => {
            try {
                let accessToken = localStorage.getItem(ACCESS_KEY) || "";
                const endpoint = API_URL + "/rest/v1/website_enquiries?select=id,assessment_id&assessment_id=not.is.null";
                const requestOptions = {
                    headers: {
                        "apikey": API_KEY,
                        "Authorization": "Bearer " + accessToken
                    },
                    cache: "no-store"
                };
                let response = await fetch(endpoint, requestOptions);
                if (response.status === 401) {
                    accessToken = await refreshAdminToken();
                    if (accessToken) {
                        requestOptions.headers.Authorization = "Bearer " + accessToken;
                        response = await fetch(endpoint, requestOptions);
                    }
                }
                if (!response.ok) return assessmentEnquiryIds;
                const rows = await response.json();
                assessmentEnquiryIds = new Map(
                    (Array.isArray(rows) ? rows : [])
                        .filter((row) => row && row.id && row.assessment_id)
                        .map((row) => [String(row.id), String(row.assessment_id)])
                );
                lastLinkLoad = Date.now();
                return assessmentEnquiryIds;
            } catch (error) {
                return assessmentEnquiryIds;
            } finally {
                linkLoadPromise = null;
            }
        })();
        return linkLoadPromise;
    }

    async function protectAssessmentEnquiryActions() {
        if (!sessionVerified) return;
        const main = document.getElementById("sway-workspace-main");
        if (!main || !main.querySelector('[data-ai-record^="enquiries:"]')) return;

        await loadAssessmentEnquiryIds();
        main.querySelectorAll('[data-ai-record^="enquiries:"]').forEach((card) => {
            const record = String(card.getAttribute("data-ai-record") || "");
            const enquiryId = record.slice("enquiries:".length);
            let assessmentId = assessmentEnquiryIds.get(enquiryId) || "";

            if (!assessmentId) {
                const message = card.querySelector(".sway-record-card-detail-wide strong");
                const match = String(message ? message.textContent : "")
                    .match(/Business Opportunity Finder assessment reference:\\s*([0-9a-f-]{36})/i);
                assessmentId = match ? match[1] : "";
            }

            if (!assessmentId) return;

            const legacyConvertButton = card.querySelector("[data-enquiry-status][data-status-next='contacted']");
            if (legacyConvertButton) legacyConvertButton.remove();

            const actions = card.querySelector(".sway-record-card-actions");
            if (!actions || actions.querySelector("[data-bfa-review-link]")) return;

            const reviewLink = document.createElement("a");
            reviewLink.href = "business-assessments.html?assessment=" + encodeURIComponent(assessmentId);
            reviewLink.className = "sway-workspace-button primary";
            reviewLink.dataset.bfaReviewLink = "true";
            reviewLink.textContent = "Review assessment";
            actions.insertBefore(reviewLink, actions.firstChild);
            const eyebrow = card.querySelector(".sway-record-card-eyebrow");
            if (eyebrow) eyebrow.textContent = "BUSINESS OPPORTUNITY FINDER";
        });
    }


    function start() {
        const root = document.getElementById("sway-admin-workspace");
        if (!root) return;

        const observer = new MutationObserver(() => {
            injectBusinessAssessmentLink();
            protectAssessmentEnquiryActions();
        });
        observer.observe(root, { childList: true, subtree: true });
        const sessionReady = window.swayphicsAdminSessionReady;
        if (sessionReady && typeof sessionReady.then === "function") {
            sessionReady.then((verified) => {
                sessionVerified = verified === true;
                if (sessionVerified) {
                    injectBusinessAssessmentLink();
                    protectAssessmentEnquiryActions();
                }
            }).catch(() => {
                sessionVerified = false;
            });
        }

        window.addEventListener("focus", () => {
            if (!sessionVerified) return;
            loadAssessmentEnquiryIds(true).then(protectAssessmentEnquiryActions);
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }
})();
