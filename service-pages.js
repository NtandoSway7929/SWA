/* =========================================================
   SWAYPHICS — SERVICE PAGE SHARED SCRIPTS
   Cookie consent, analytics and simple page interactions
   ========================================================= */

(function () {
    "use strict";

    const CONSENT_KEY = "swayphics_cookie_consent";
    const SESSION_KEY = "swayphics_cookie_analytics_session";
    const POLICY_VERSION = "2026-11-09";
    const GA_MEASUREMENT_ID = "G-YNVEVHGFTZ";
    const SUPABASE_URL = "https://sqifhribgsqfaxgtobsa.supabase.co";
    const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kV_YWij7nHIHjyr-2v2IA_PIhr-QhB";

    const banner = document.getElementById("sway-cookie-banner");
    const acceptButton = document.getElementById("sway-cookie-accept");
    const rejectButton = document.getElementById("sway-cookie-reject");

    if (!banner || !acceptButton || !rejectButton) return;

    let selectionSource = "banner";

    function getConsent() {
        try {
            return localStorage.getItem(CONSENT_KEY);
        } catch (error) {
            return null;
        }
    }

    function getConsentSessionId() {
        try {
            let sessionId = sessionStorage.getItem(SESSION_KEY);
            if (!sessionId && window.crypto && typeof window.crypto.randomUUID === "function") {
                sessionId = window.crypto.randomUUID();
                sessionStorage.setItem(SESSION_KEY, sessionId);
            }
            return sessionId || "";
        } catch (error) {
            return "";
        }
    }

    function recordConsentEvent(value, previousValue, source) {
        const sessionId = getConsentSessionId();
        if (!sessionId || previousValue === value) return;

        let eventType = value;
        if (previousValue) {
            eventType =
                previousValue === "accepted" && value === "rejected"
                    ? "withdrawn"
                    : "changed";
        }

        const payload = {
            session_id: sessionId,
            event_type: eventType,
            analytics_consent: value === "accepted",
            source: source === "preferences" ? "preferences" : "banner",
            policy_version: POLICY_VERSION,
            page_path: String(window.location.pathname || "/").slice(0, 240)
        };

        fetch(SUPABASE_URL + "/rest/v1/swayphics_cookie_consent_events", {
            method: "POST",
            headers: {
                "apikey": SUPABASE_PUBLISHABLE_KEY,
                "Authorization": "Bearer " + SUPABASE_PUBLISHABLE_KEY,
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
            },
            body: JSON.stringify(payload),
            keepalive: true
        }).catch(function (error) {
            console.warn("Cookie consent analytics could not be recorded.", error);
        });
    }

    function clearGoogleAnalyticsCookies() {
        const names = document.cookie
            .split(";")
            .map(function (item) { return item.trim().split("=")[0]; })
            .filter(function (name) { return /^_ga(?:_|$)|^_gid$|^_gat(?:_|$)/i.test(name); });

        const host = String(window.location.hostname || "").toLowerCase();
        const domains = [""];
        if (host) domains.push(host);
        if (host === "swayphics.co.za" || host.endsWith(".swayphics.co.za")) {
            domains.push("swayphics.co.za", ".swayphics.co.za");
        }

        names.forEach(function (name) {
            domains.forEach(function (domain) {
                document.cookie =
                    name + "=; Max-Age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/" +
                    (domain ? "; domain=" + domain : "") +
                    "; SameSite=Lax";
            });
        });
    }

    function disableAnalytics() {
        window["ga-disable-" + GA_MEASUREMENT_ID] = true;
        if (typeof window.gtag === "function") {
            window.gtag("consent", "update", { analytics_storage: "denied" });
        }
        clearGoogleAnalyticsCookies();
    }

    function loadAnalytics() {
        const disableKey = "ga-disable-" + GA_MEASUREMENT_ID;

        if (window.swayphicsAnalyticsLoaded) {
            window[disableKey] = false;
            if (typeof window.gtag === "function") {
                window.gtag("consent", "update", { analytics_storage: "granted" });
            }
            return;
        }

        window[disableKey] = false;
        window.swayphicsAnalyticsLoaded = true;
        window.dataLayer = window.dataLayer || [];

        function gtag() {
            window.dataLayer.push(arguments);
        }

        window.gtag = gtag;
        gtag("consent", "default", { analytics_storage: "denied" });
        gtag("consent", "update", { analytics_storage: "granted" });
        gtag("js", new Date());
        gtag("config", GA_MEASUREMENT_ID);

        const script = document.createElement("script");
        script.async = true;
        script.src =
            "https://www.googletagmanager.com/gtag/js?id=" +
            encodeURIComponent(GA_MEASUREMENT_ID);
        document.head.appendChild(script);
    }

    function openBanner(source) {
        selectionSource = source === "preferences" ? "preferences" : "banner";
        banner.hidden = false;
        requestAnimationFrame(function () {
            banner.classList.add("is-visible");
        });
    }

    function closeBanner() {
        banner.classList.remove("is-visible");
        window.setTimeout(function () {
            banner.hidden = true;
        }, 350);
    }

    function setConsent(value, source) {
        const previousValue = getConsent();

        try {
            localStorage.setItem(CONSENT_KEY, value);
        } catch (error) {
            console.warn("Cookie consent could not be stored.", error);
        }

        recordConsentEvent(value, previousValue, source || selectionSource);

        if (value === "accepted") {
            loadAnalytics();
        } else {
            disableAnalytics();
        }
    }

    acceptButton.addEventListener("click", function () {
        setConsent("accepted", selectionSource);
        closeBanner();
    });

    rejectButton.addEventListener("click", function () {
        setConsent("rejected", selectionSource);
        closeBanner();
    });

    document.addEventListener("click", function (event) {
        const trigger = event.target && typeof event.target.closest === "function"
            ? event.target.closest("#sway-cookie-preferences")
            : null;
        if (!trigger) return;
        event.preventDefault();
        openBanner("preferences");
    });

    window.swayphicsOpenCookiePreferences = function () {
        openBanner("preferences");
    };

    const existingConsent = getConsent();
    if (existingConsent === "accepted") {
        loadAnalytics();
    } else if (existingConsent === "rejected") {
        disableAnalytics();
        banner.hidden = true;
    } else {
        openBanner("banner");
    }
})();

document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".sp-mobile-menu").forEach(function (menu) {
        menu.addEventListener("click", function (event) {
            const link = event.target.closest("a");
            if (link) menu.removeAttribute("open");
        });
    });
});
