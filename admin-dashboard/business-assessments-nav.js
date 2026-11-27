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
        const crmMenu = document.getElementById("sway-nav-menu-crm");
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

    function embeddedAssessmentId(card) {
        const match = String(card.textContent || "")
            .match(/Business Opportunity Finder assessment reference:\s*([0-9a-f-]{36})/i);
        return match ? match[1] : "";
    }

    function attachAssessmentReviewAction(card, assessmentId) {
        if (!assessmentId) return;

        const legacyConvertButton = card.querySelector("[data-enquiry-status][data-status-next='contacted']");
        if (legacyConvertButton) legacyConvertButton.remove();

        const actions = card.querySelector(".sway-record-card-actions");
        if (!actions) return;

        let reviewLink = actions.querySelector("[data-bfa-review-link]");
        if (!reviewLink) {
            reviewLink = document.createElement("a");
            reviewLink.className = "sway-workspace-button primary";
            reviewLink.dataset.bfaReviewLink = "true";
            reviewLink.textContent = "Review assessment";
            actions.insertBefore(reviewLink, actions.firstChild);
        }
        reviewLink.href = "business-assessments.html?assessment=" + encodeURIComponent(assessmentId);

        const eyebrow = card.querySelector(".sway-record-card-eyebrow");
        if (eyebrow) eyebrow.textContent = "BUSINESS OPPORTUNITY FINDER";
    }

    async function protectAssessmentEnquiryActions() {
        if (!sessionVerified) return;
        const main = document.getElementById("sway-workspace-main");
        if (!main) return;
        const cards = Array.from(main.querySelectorAll('[data-ai-record^="enquiries:"]'));
        if (!cards.length) return;

        // Remove the legacy converter immediately from assessment cards. The
        // enquiry message contains the opaque assessment reference inserted
        // by the server-side contact-request transaction.
        cards.forEach((card) => {
            const directAssessmentId = embeddedAssessmentId(card);
            if (directAssessmentId) attachAssessmentReviewAction(card, directAssessmentId);
        });

        // Keep the linked column lookup as a fallback for card renderings that
        // do not expose the full enquiry message.
        await loadAssessmentEnquiryIds();
        cards.forEach((card) => {
            if (!card.isConnected) return;
            const record = String(card.getAttribute("data-ai-record") || "");
            const enquiryId = record.slice("enquiries:".length);
            const assessmentId = assessmentEnquiryIds.get(enquiryId) || "";
            if (assessmentId) attachAssessmentReviewAction(card, assessmentId);
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
