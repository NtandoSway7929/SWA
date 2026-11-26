(() => {
    "use strict";

    const ACCESS_KEY = "swayphics_admin_access_token";
    const REFRESH_KEY = "swayphics_admin_refresh_token";
    const API_URL = "https://sqifhribgsqfaxgtobsa.supabase.co";
    const API_KEY = "sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QhB";
    let assessmentEnquiryIds = new Map();
    let lastLinkLoad = 0;
    let linkLoadPromise = null;

    function injectBusinessAssessmentLink() {
        const crmMenu = document.querySelector('[data-nav-menu="crm"]');
        if (!crmMenu || crmMenu.querySelector("[data-business-assessments-nav]")) return;

        const link = document.createElement("a");
        link.href = "business-assessments.html";
        link.className = "sway-workspace-nav-button";
        link.dataset.businessAssessmentsNav = "true";
        link.textContent = "Business assessments";
        crmMenu.appendChild(link);
    }

    async function loadAssessmentEnquiryIds(force = false) {
        if (linkLoadPromise) return linkLoadPromise;
        if (!force && Date.now() - lastLinkLoad < 60000) return assessmentEnquiryIds;

        linkLoadPromise = (async () => {
            try {
                const accessToken = localStorage.getItem(ACCESS_KEY) || "";
                const response = await fetch(
                    API_URL + "/rest/v1/website_enquiries?select=id,assessment_id&assessment_id=not.is.null",
                    {
                        headers: {
                            "apikey": API_KEY,
                            "Authorization": "Bearer " + accessToken
                        },
                        cache: "no-store"
                    }
                );
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
        const main = document.getElementById("sway-workspace-main");
        if (!main || !main.querySelector('[data-ai-record^="enquiries:"]')) return;

        await loadAssessmentEnquiryIds();
        main.querySelectorAll('[data-ai-record^="enquiries:"]').forEach((card) => {
            const record = String(card.getAttribute("data-ai-record") || "");
            const enquiryId = record.slice("enquiries:".length);
            const assessmentId = assessmentEnquiryIds.get(enquiryId);
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
        injectBusinessAssessmentLink();

        const sessionReady = window.swayphicsAdminSessionReady;
        if (sessionReady && typeof sessionReady.then === "function") {
            sessionReady.then((verified) => {
                if (verified === true) {
                    injectBusinessAssessmentLink();
                    protectAssessmentEnquiryActions();
                }
            }).catch(() => {});
        }

        window.addEventListener("focus", () => {
            loadAssessmentEnquiryIds(true).then(protectAssessmentEnquiryActions);
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }
})();
