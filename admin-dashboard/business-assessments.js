(() => {
    "use strict";

    const SUPABASE_URL = "https://sqifhribgsqfaxgtobsa.supabase.co";
    const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QhB";
    const ACCESS_KEY = "swayphics_admin_access_token";
    const REFRESH_KEY = "swayphics_admin_refresh_token";

    const status = document.getElementById("bfa-status");
    const app = document.getElementById("bfa-app");
    const list = document.getElementById("bfa-record-list");
    const count = document.getElementById("bfa-count");
    const search = document.getElementById("bfa-search");
    const detail = document.getElementById("bfa-detail");
    const detailPlaceholder = document.getElementById("bfa-detail-placeholder");
    const detailContent = document.getElementById("bfa-detail-content");
    const refreshButton = document.getElementById("bfa-refresh");

    if (!status || !app || !list) return;

    let accessToken = localStorage.getItem(ACCESS_KEY) || "";
    let refreshToken = localStorage.getItem(REFRESH_KEY) || "";
    let refreshPromise = null;
    let assessments = [];
    let selectedId = "";
    let currentFilter = "all";

    function setStatus(message, state = "info") {
        status.hidden = !message;
        status.textContent = message;
        status.dataset.state = state;
    }

    function parseJwtExpiry(token) {
        try {
            const parts = String(token || "").split(".");
            if (parts.length !== 3) return 0;
            const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
            const padded = payload + "=".repeat((4 - payload.length % 4) % 4);
            const claims = JSON.parse(atob(padded));
            return Number(claims.exp || 0) * 1000;
        } catch (error) {
            return 0;
        }
    }

    async function refreshAdminSession(force = false) {
        accessToken = localStorage.getItem(ACCESS_KEY) || accessToken;
        refreshToken = localStorage.getItem(REFRESH_KEY) || refreshToken;

        const expiresAt = parseJwtExpiry(accessToken);
        if (!force && accessToken && expiresAt > Date.now() + 5 * 60 * 1000) return true;
        if (refreshPromise) return refreshPromise;
        if (!refreshToken) return false;

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
                        body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken })
                    }
                );
                if (!response.ok) return false;
                const session = await response.json();
                if (!session || !session.access_token) return false;

                accessToken = session.access_token;
                localStorage.setItem(ACCESS_KEY, accessToken);
                if (session.refresh_token) {
                    refreshToken = session.refresh_token;
                    localStorage.setItem(REFRESH_KEY, refreshToken);
                }
                return true;
            } catch (error) {
                return false;
            } finally {
                refreshPromise = null;
            }
        })();
        return refreshPromise;
    }

    async function api(path, options = {}) {
        await refreshAdminSession(false);
        const requestOptions = { ...options };
        requestOptions.headers = {
            "apikey": SUPABASE_PUBLISHABLE_KEY,
            "Authorization": "Bearer " + (accessToken || ""),
            "Content-Type": "application/json",
            ...(options.headers || {})
        };

        let response = await fetch(SUPABASE_URL + path, requestOptions);
        if (response.status === 401 && await refreshAdminSession(true)) {
            requestOptions.headers.Authorization = "Bearer " + accessToken;
            response = await fetch(SUPABASE_URL + path, requestOptions);
        }

        const text = await response.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch (error) {
            data = null;
        }
        if (!response.ok) {
            const message = data && (data.message || data.msg || data.error)
                ? (data.message || data.msg || data.error)
                : "Request failed (" + response.status + ").";
            throw new Error(message);
        }
        return data;
    }

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = String(text);
        return node;
    }

    function formattedDate(value) {
        if (!value) return "Date not available";
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) return "Date not available";
        return new Intl.DateTimeFormat("en-ZA", {
            dateStyle: "medium",
            timeStyle: "short"
        }).format(date);
    }

    function displayStatus(value) {
        return String(value || "completed").replace(/_/g, " ");
    }

    function assessmentSearchText(item) {
        const report = item.report || {};
        const profile = item.business_profile || {};
        return [
            item.business_name,
            profile.business_name,
            item.industry,
            report.priority && report.priority.label,
            report.title,
            item.status
        ].join(" ").toLowerCase();
    }

    function filteredAssessments() {
        const query = String(search.value || "").trim().toLowerCase();
        return assessments.filter((item) => {
            const filterMatch = currentFilter === "all" ||
                (currentFilter === "contact_requested"
                    ? item.contact_requested === true
                    : item.status === currentFilter);
            const queryMatch = !query || assessmentSearchText(item).includes(query);
            return filterMatch && queryMatch;
        });
    }

    function renderList() {
        const visible = filteredAssessments();
        list.replaceChildren();
        count.textContent = visible.length + (visible.length === 1 ? " record" : " records");

        if (!visible.length) {
            list.appendChild(element("p", "bfa-empty",
                assessments.length ? "No assessments match this filter." : "No submitted assessments yet."));
            return;
        }

        visible.forEach((item) => {
            const report = item.report || {};
            const profile = item.business_profile || {};
            const name = item.business_name || profile.business_name || "Unnamed business";
            const priority = report.priority && report.priority.label
                ? report.priority.label
                : "Priority not provided";

            const button = element("button", "bfa-record");
            button.type = "button";
            button.dataset.assessmentId = item.id;
            button.setAttribute("aria-current", String(selectedId === item.id));

            const top = element("div", "bfa-record-top");
            top.appendChild(element("strong", "bfa-record-title", name));
            top.appendChild(element("span", "bfa-tag", displayStatus(item.status)));
            const sub = element("div", "bfa-record-sub",
                [report.industry && report.industry.label || item.industry, priority].filter(Boolean).join(" · "));
            const meta = element("div", "bfa-record-meta");
            meta.appendChild(element("span", "bfa-record-sub", formattedDate(item.submitted_at)));
            if (item.contact_requested) {
                meta.appendChild(element("span", "bfa-tag bfa-tag-contact", "Contact requested"));
            }
            button.append(top, sub, meta);
            button.addEventListener("click", () => showAssessment(item.id));
            list.appendChild(button);
        });
    }

    function addSection(parent, title, intro) {
        const section = element("section", "bfa-detail-section");
        section.appendChild(element("h3", "", title));
        if (intro) section.appendChild(element("p", "", intro));
        parent.appendChild(section);
        return section;
    }

    function addList(section, items) {
        if (!Array.isArray(items) || !items.length) {
            section.appendChild(element("p", "", "No information was recorded for this section."));
            return;
        }
        const ul = element("ul", "bfa-detail-list");
        items.forEach((item) => ul.appendChild(element("li", "", item)));
        section.appendChild(ul);
    }

    async function loadLinkedEnquiry(assessmentId) {
        const query = "/rest/v1/website_enquiries?select=id,name,business_name,email,phone,service,message,status,created_at,source,assessment_id&assessment_id=eq." +
            encodeURIComponent(assessmentId) + "&limit=1";
        const rows = await api(query);
        return Array.isArray(rows) && rows.length ? rows[0] : null;
    }

    function renderContactCard(parent, enquiry) {
        const card = element("section", "bfa-contact-card");
        card.appendChild(element("h4", "", "Contact request"));
        const grid = element("div", "bfa-contact-grid");
        const values = [
            ["Contact name", enquiry.name],
            ["Business", enquiry.business_name],
            ["Email", enquiry.email],
            ["Phone", enquiry.phone],
            ["Enquiry status", displayStatus(enquiry.status)],
            ["Received", formattedDate(enquiry.created_at)],
            ["Source", enquiry.source]
        ];
        values.forEach(([label, value]) => {
            if (!value) return;
            const cell = element("div");
            cell.appendChild(element("span", "", label));
            cell.appendChild(element("strong", "", value));
            grid.appendChild(cell);
        });
        card.appendChild(grid);
        if (enquiry.message) {
            const message = element("p", "");
            message.style.marginTop = "13px";
            message.textContent = enquiry.message;
            card.appendChild(message);
        }
        parent.appendChild(card);
    }

    function renderConversionSection(parent, item, report) {
        const section = addSection(
            parent,
            "Convert to the lead pipeline",
            "A contact request is not proof that Swayphics has already contacted this person. A new lead starts as New, with no last-contacted timestamp. Existing lead details and stages are never overwritten by linking."
        );

        if (item.lead_id) {
            section.appendChild(element("p", "bfa-conversion-success",
                "This assessment is already linked to lead " + item.lead_id + "."));
            return;
        }

        if (!item.contact_requested) {
            section.appendChild(element("p", "bfa-readonly-note",
                "No contact request was submitted. This assessment must remain an assessment record and cannot be converted into a sales lead yet."));
            return;
        }

        const status = element("p", "bfa-conversion-status",
            "Check for possible existing leads before creating a new record.");
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");

        const resultArea = element("div", "bfa-conversion-results");
        const previewButton = element("button", "bfa-conversion-primary", "Check for existing leads");
        previewButton.type = "button";
        previewButton.addEventListener("click", async () => {
            previewButton.disabled = true;
            previewButton.textContent = "Checking CRM…";
            status.textContent = "Checking exact email, phone and business-name matches.";
            resultArea.replaceChildren();

            try {
                const result = await api("/rest/v1/rpc/convert_business_assessment_to_lead", {
                    method: "POST",
                    body: JSON.stringify({
                        p_assessment_id: item.id,
                        p_action: "preview"
                    })
                });
                renderConversionPreview(result, item, report, status, resultArea);
                previewButton.textContent = "Refresh possible matches";
            } catch (error) {
                status.textContent = error.message || "Possible lead matches could not be checked.";
                previewButton.textContent = "Retry match check";
            } finally {
                previewButton.disabled = false;
            }
        });

        section.append(status, previewButton, resultArea);
    }

    function renderConversionPreview(result, item, report, status, resultArea) {
        resultArea.replaceChildren();

        if (!result || typeof result !== "object") {
            status.textContent = "The conversion check returned an unexpected response.";
            return;
        }

        if (result.status === "already_converted") {
            item.lead_id = result.lead_id;
            item.status = "converted";
            status.textContent = "This assessment is already linked to a lead.";
            renderList();
            return;
        }

        if (result.status !== "possible_matches" && result.status !== "ready_to_create") {
            status.textContent = result.message || "This assessment is not ready for lead conversion.";
            return;
        }

        const matches = Array.isArray(result.matches) ? result.matches : [];
        if (matches.length) {
            status.textContent = matches.length + " possible existing lead" +
                (matches.length === 1 ? " was" : "s were") +
                " found. Review the details before deciding what to do.";
            matches.forEach((match) => {
                const card = element("article", "bfa-match-card");
                const heading = element("div", "bfa-match-heading");
                heading.appendChild(element("strong", "", match.business_name || "Unnamed lead"));
                heading.appendChild(element("span", "bfa-tag", displayStatus(match.status)));
                card.appendChild(heading);

                const details = [
                    match.contact_name,
                    match.email,
                    match.phone,
                    match.source ? "Source: " + match.source : "",
                    Array.isArray(match.matching_reasons)
                        ? "Matched by: " + match.matching_reasons.join(", ")
                        : ""
                ].filter(Boolean);
                details.forEach((line) => card.appendChild(element("p", "", line)));

                const linkButton = element("button", "bfa-conversion-secondary", "Link this assessment to this lead");
                linkButton.type = "button";
                linkButton.addEventListener("click", () => linkToExistingLead(match, item, status, resultArea, linkButton));
                card.appendChild(linkButton);
                resultArea.appendChild(card);
            });
        } else {
            status.textContent = "No exact email, phone or business-name matches were found.";
        }

        const businessName = String(report.business_name || item.business_name || "").trim();
        const createPanel = element("div", "bfa-create-lead-panel");
        createPanel.appendChild(element("h4", "", matches.length
            ? "Create a separate new lead"
            : "Create a new lead"));

        if (result.business_name_required || !businessName) {
            const label = element("label", "bfa-business-name-field", "Business name for the new lead");
            const input = element("input");
            input.type = "text";
            input.id = "bfa-business-name-override";
            input.maxLength = 150;
            input.autocomplete = "organization";
            input.placeholder = "Enter the verified business name";
            label.appendChild(input);
            createPanel.appendChild(label);
        } else {
            createPanel.appendChild(element("p", "", "Business name: " + businessName));
        }

        if (matches.length) {
            createPanel.appendChild(element("p", "bfa-match-warning",
                "A possible existing lead was found. Creating a separate record may duplicate that business. Only continue when you have reviewed the matches and confirmed a separate lead is appropriate."));
        }

        const createButton = element("button", "bfa-conversion-primary",
            matches.length ? "Create a separate new lead anyway" : "Create new lead");
        createButton.type = "button";
        createButton.addEventListener("click", async () => {
            const overrideInput = createPanel.querySelector("#bfa-business-name-override");
            const override = overrideInput ? String(overrideInput.value || "").trim() : null;
            if (overrideInput && override.length < 2) {
                status.textContent = "Enter a business name before creating the lead.";
                overrideInput.focus();
                return;
            }

            const confirmation = matches.length
                ? "Possible existing lead matches were found. Are you sure this should be a separate new lead?"
                : "Create a new lead with status New? This will not mark the respondent as contacted.";
            if (!window.confirm(confirmation)) return;

            createButton.disabled = true;
            createButton.textContent = "Creating lead…";
            status.textContent = "Creating the lead and linking the assessment.";
            try {
                const converted = await api("/rest/v1/rpc/convert_business_assessment_to_lead", {
                    method: "POST",
                    body: JSON.stringify({
                        p_assessment_id: item.id,
                        p_action: "create_new",
                        p_business_name_override: override || null,
                        p_confirm_create_new: true
                    })
                });
                handleConversionResult(converted, item, status, resultArea);
            } catch (error) {
                status.textContent = error.message || "The new lead could not be created.";
            } finally {
                createButton.disabled = false;
                createButton.textContent = "Create new lead";
            }
        });
        createPanel.appendChild(createButton);
        resultArea.appendChild(createPanel);
    }

    async function linkToExistingLead(match, item, status, resultArea, button) {
        if (!match || !match.id) return;
        if (!window.confirm(
            "Link this assessment to " + (match.business_name || "the selected lead") +
            "? Existing lead details, source and status will remain unchanged."
        )) return;

        button.disabled = true;
        button.textContent = "Linking…";
        status.textContent = "Linking the assessment to the selected existing lead.";
        try {
            const result = await api("/rest/v1/rpc/convert_business_assessment_to_lead", {
                method: "POST",
                body: JSON.stringify({
                    p_assessment_id: item.id,
                    p_action: "link_existing",
                    p_existing_lead_id: match.id
                })
            });
            handleConversionResult(result, item, status, resultArea);
        } catch (error) {
            status.textContent = error.message || "The assessment could not be linked.";
            button.disabled = false;
            button.textContent = "Retry linking";
        }
    }

    function handleConversionResult(result, item, status, resultArea) {
        if (!result || typeof result !== "object") {
            status.textContent = "The conversion service returned an unexpected response.";
            return;
        }
        if (result.status === "created" || result.status === "linked_existing" || result.status === "already_converted") {
            item.lead_id = result.lead_id;
            item.status = "converted";
            status.textContent = result.status === "created"
                ? "New lead created with status New. No contact timestamp was added."
                : result.status === "linked_existing"
                    ? "Assessment linked. The existing lead's details, source and status were preserved."
                    : "This assessment is already linked to a lead.";
            resultArea.replaceChildren(element("p", "bfa-conversion-success",
                "Lead reference: " + result.lead_id));
            renderList();
            return;
        }
        if (result.status === "business_name_required") {
            status.textContent = result.message || "Enter the verified business name and try again.";
            return;
        }
        if (result.status === "lead_not_a_matching_candidate") {
            status.textContent = result.message || "That lead no longer matches. Refresh the match list.";
            return;
        }
        status.textContent = result.message || "The lead conversion could not be completed.";
    }


    function inspectionTimestamp(value) {
        if (!value) return "Not recorded";
        return formattedDate(value);
    }

    function inspectionSourceLabel(row) {
        if (row.source_type === "website") return "Business website";
        if (row.source_type === "google_business_profile") return "Google Business Profile";
        const platform = String(row.platform || "social").replace(/_/g, " ");
        return platform.charAt(0).toUpperCase() + platform.slice(1) + " profile";
    }

    function safeExternalLink(parent, value, label) {
        if (typeof value !== "string" || !value.trim()) return;
        try {
            const url = new URL(value);
            if (!["https:", "http:"].includes(url.protocol)) return;
            const link = element("a", "bfa-inspection-link", label || url.hostname);
            link.href = url.toString();
            link.target = "_blank";
            link.rel = "noopener noreferrer nofollow";
            parent.appendChild(link);
        } catch (error) {
            // Invalid stored URLs are not rendered as links.
        }
    }

    function inspectionStatusLabel(value) {
        return String(value || "unknown").replace(/_/g, " ");
    }

    function renderInspectionEvidence(parent, row) {
        const card = element("article", "bfa-inspection-evidence");
        const heading = element("div", "bfa-inspection-evidence-heading");
        heading.appendChild(element("strong", "", inspectionSourceLabel(row)));
        heading.appendChild(element("span", "bfa-inspection-status", inspectionStatusLabel(row.source_status)));
        card.appendChild(heading);

        const match = element("p", "bfa-inspection-meta",
            "Identity match: " + inspectionStatusLabel(row.identity_match_status || "not_checked") +
            " · Captured: " + inspectionTimestamp(row.observed_at || row.created_at));
        card.appendChild(match);

        if (row.source_title) card.appendChild(element("h4", "bfa-inspection-title", row.source_title));
        const url = row.final_url || row.source_url || row.requested_url;
        if (url) safeExternalLink(card, url, "Open inspected source");

        if (row.identity_match_basis && row.identity_match_basis.length) {
            const basis = element("ul", "bfa-inspection-basis");
            row.identity_match_basis.forEach((item) => basis.appendChild(element("li", "", String(item))));
            card.appendChild(basis);
        }

        const observations = row.observations && typeof row.observations === "object"
            ? row.observations : {};
        const observationItems = [
            observations.page_title ? "Page title: " + observations.page_title : "",
            observations.meta_description ? "Description: " + observations.meta_description : "",
            Array.isArray(observations.contact_links) && observations.contact_links.length
                ? "Contact links found: " + observations.contact_links.length : "",
            Array.isArray(observations.booking_links) && observations.booking_links.length
                ? "Booking links found: " + observations.booking_links.length : "",
            observations.language ? "Language: " + observations.language : ""
        ].filter(Boolean);
        if (observationItems.length) {
            const summary = element("ul", "bfa-inspection-observations");
            observationItems.forEach((item) => summary.appendChild(element("li", "", item)));
            card.appendChild(summary);
        }

        if (row.evidence_excerpt) {
            const excerpt = element("p", "bfa-inspection-excerpt", row.evidence_excerpt);
            card.appendChild(excerpt);
        }
        if (row.provider_error_code) {
            card.appendChild(element("p", "bfa-inspection-meta",
                "Provider limitation: " + row.provider_error_code +
                (row.upstream_status ? " (HTTP " + row.upstream_status + ")" : "")));
        }
        parent.appendChild(card);
    }

    async function triggerPublicPresenceInspection(assessmentId, button, message) {
        await refreshAdminSession(false);
        const token = localStorage.getItem(ACCESS_KEY) || accessToken || "";
        if (!token) throw new Error("Your administrator session has expired. Sign in again.");
        const response = await fetch(SUPABASE_URL + "/functions/v1/inspect-business-assessment", {
            method: "POST",
            headers: {
                "apikey": SUPABASE_PUBLISHABLE_KEY,
                "Authorization": "Bearer " + token,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                assessment_id: assessmentId,
                idempotency_key: window.crypto && typeof window.crypto.randomUUID === "function"
                    ? window.crypto.randomUUID()
                    : createInspectionUuid()
            }),
            cache: "no-store"
        });

        let result = null;
        try { result = await response.json(); } catch (error) { result = null; }
        if (!response.ok || !result || result.ok !== true) {
            throw new Error(result && typeof result.error === "string"
                ? result.error
                : "The public-presence inspection could not be started.");
        }
        message.textContent = result.existing_active_run
            ? "An inspection is already running. Refresh this section to see its latest status."
            : "Inspection request accepted. The source checks are running separately from the original report.";
    }

    function createInspectionUuid() {
        const bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
        return [
            hex.slice(0, 4).join(""),
            hex.slice(4, 6).join(""),
            hex.slice(6, 8).join(""),
            hex.slice(8, 10).join(""),
            hex.slice(10, 16).join("")
        ].join("-");
    }

    async function renderInspectionSection(parent, item) {
        const section = addSection(
            parent,
            "Independent public-presence inspection",
            "A separate read-only check of public information. These results do not overwrite respondent answers or create a lead."
        );
        const profile = item.business_profile || {};
        const presence = profile.public_presence || {};
        if (presence.inspection_consent !== true ||
            presence.inspection_consent_version !== "bof-public-presence-v1") {
            section.appendChild(element("p", "bfa-inspection-notice",
                "No valid public-presence inspection permission is recorded for this assessment. No independent website, Google Business Profile or social-profile check has been run."));
            return;
        }

        const sources = element("div", "bfa-inspection-requested-sources");
        sources.appendChild(element("span", "bfa-inspection-request-label", "Permission recorded for"));
        const sourceLabels = [
            presence.website_url ? "Website link supplied" : "Website search",
            presence.google_business_profile_url ? "Google Business Profile link supplied" : "Google Business Profile search",
            Array.isArray(presence.social_profile_urls) && presence.social_profile_urls.length
                ? "Social profile links supplied" : "Public social profile search"
        ];
        sources.appendChild(element("p", "", sourceLabels.join(" · ")));
        [
            presence.website_url,
            presence.google_business_profile_url,
            ...(Array.isArray(presence.social_profile_urls)
                ? presence.social_profile_urls.map((entry) => entry && entry.url).filter(Boolean)
                : [])
        ].forEach((url) => safeExternalLink(sources, url));
        section.appendChild(sources);

        const message = element("p", "bfa-inspection-message");
        section.appendChild(message);
        const latest = await api(
            "/rest/v1/business_assessment_inspections?select=id,status,inspection_version,requested_sources,provider_agreement_reference,failure_code,failure_summary,queued_at,started_at,completed_at,created_at&assessment_id=eq." +
            encodeURIComponent(item.id) + "&order=created_at.desc&limit=1"
        );
        const run = Array.isArray(latest) && latest.length ? latest[0] : null;
        let evidence = [];
        if (run) {
            const records = await api(
                "/rest/v1/business_assessment_evidence?select=id,source_type,source_status,platform,requested_url,source_url,final_url,source_title,observations,evidence_excerpt,identity_match_status,identity_match_basis,provider_error_code,upstream_status,observed_at,created_at&inspection_id=eq." +
                encodeURIComponent(run.id) + "&order=created_at.asc&limit=20"
            );
            evidence = Array.isArray(records) ? records : [];

            const runSummary = element("div", "bfa-inspection-run-summary");
            const runHeading = element("div", "bfa-inspection-evidence-heading");
            runHeading.appendChild(element("strong", "", "Latest inspection"));
            runHeading.appendChild(element("span", "bfa-inspection-status", inspectionStatusLabel(run.status)));
            runSummary.appendChild(runHeading);
            runSummary.appendChild(element("p", "bfa-inspection-meta",
                "Inspection version: " + String(run.inspection_version || "Unknown") +
                " · Started: " + inspectionTimestamp(run.started_at || run.queued_at)));
            runSummary.appendChild(element("p", "bfa-inspection-meta",
                "Provider agreement reference: " + String(run.provider_agreement_reference || "Not recorded")));
            if (run.failure_summary) runSummary.appendChild(element("p", "bfa-inspection-notice", run.failure_summary));
            if (run.failure_code) runSummary.appendChild(element("p", "bfa-inspection-meta", "Run limitation: " + run.failure_code));
            section.appendChild(runSummary);

            if (evidence.length) {
                evidence.forEach((record) => renderInspectionEvidence(section, record));
            } else if (["queued", "running"].includes(run.status)) {
                section.appendChild(element("p", "bfa-inspection-notice",
                    "The inspection has been queued. Source-by-source results will appear here when the worker saves them."));
            } else {
                section.appendChild(element("p", "bfa-inspection-notice",
                    "No source evidence was saved for this run. Review its status and limitation before drawing any conclusion."));
            }
        } else {
            section.appendChild(element("p", "bfa-inspection-notice",
                "No independent public-presence inspection has been run yet."));
        }

        const controls = element("div", "bfa-inspection-actions");
        const refresh = element("button", "bfa-inspection-secondary", "Refresh inspection status");
        refresh.type = "button";
        refresh.addEventListener("click", async () => {
            refresh.disabled = true;
            try {
                await replaceInspectionSection(parent, section, item);
            } catch (error) {
                message.textContent = error.message || "Inspection status could not be refreshed.";
            } finally {
                refresh.disabled = false;
            }
        });
        controls.appendChild(refresh);

        if (!run || !["queued", "running"].includes(run.status)) {
            const inspect = element("button", "bfa-inspection-primary",
                run ? "Run a fresh inspection" : "Inspect public presence");
            inspect.type = "button";
            inspect.addEventListener("click", async () => {
                const confirmation = [
                    "Swayphics will check public business information for:",
                    "• Business website: " + (presence.website_url || "discoverable public website"),
                    "• Google Business Profile: " + (presence.google_business_profile_url || "public Google listing"),
                    "• Social profiles: " + (Array.isArray(presence.social_profile_urls) && presence.social_profile_urls.length
                        ? presence.social_profile_urls.map((entry) => entry.platform).join(", ")
                        : "public profiles on supported platforms"),
                    "",
                    "Only public pages will be checked. Some sources may be unavailable or need manual identity review. This action does not contact the business."
                ].join("\n");
                if (!window.confirm(confirmation)) return;
                inspect.disabled = true;
                inspect.textContent = "Starting inspection…";
                message.textContent = "Submitting the inspection request.";
                try {
                    await triggerPublicPresenceInspection(item.id, inspect, message);
                    await replaceInspectionSection(parent, section, item);
                } catch (error) {
                    message.textContent = error.message || "The inspection request failed.";
                } finally {
                    inspect.disabled = false;
                    inspect.textContent = "Inspect public presence";
                }
            });
            controls.appendChild(inspect);
        } else {
            message.textContent = "An inspection is currently " + run.status + ". Use Refresh inspection status to check for results.";
        }
        section.appendChild(controls);
    }

    async function replaceInspectionSection(parent, oldSection, item) {
        const nextSibling = oldSection.nextSibling;
        await renderInspectionSection(parent, item);
        const replacement = parent.lastElementChild;
        if (!replacement || replacement === oldSection) {
            throw new Error("The inspection panel could not be refreshed.");
        }
        parent.insertBefore(replacement, nextSibling);
        oldSection.remove();
    }

    async function showAssessment(id) {
        const item = assessments.find((record) => record.id === id);
        if (!item) return;
        selectedId = id;
        renderList();
        detail.hidden = false;
        detailPlaceholder.hidden = true;
        detailContent.hidden = false;
        detailContent.replaceChildren();

        const report = item.report || {};
        const header = element("header", "bfa-detail-header");
        header.appendChild(element("span", "bfa-eyebrow", "ASSESSMENT / " + String(item.assessment_version || "version not recorded")));
        header.appendChild(element("h2", "", report.title || item.business_name || "Business assessment"));
        const tags = element("div", "bfa-detail-tags");
        [
            report.industry && report.industry.label || item.industry,
            "Website: " + (report.website_status || "Not established"),
            report.priority && report.priority.label,
            displayStatus(item.status)
        ].filter(Boolean).forEach((tag) => tags.appendChild(element("span", "bfa-tag", tag)));
        header.appendChild(tags);
        detailContent.appendChild(header);

        const context = addSection(detailContent, "Submitted business context", "Information supplied by the respondent. This has not been independently verified.");
        addList(context, [
            report.business_name ? "Business: " + report.business_name : "",
            report.location ? "Location: " + report.location : "",
            report.industry && report.industry.label ? "Industry: " + report.industry.label : "",
            report.priority && report.priority.label ? "Priority: " + report.priority.label : "",
            Array.isArray(report.discovery_channels) ? "Discovery routes: " + report.discovery_channels.join(", ") : "",
            Array.isArray(report.contact_methods) ? "Customer contact methods: " + report.contact_methods.join(", ") : ""
        ].filter(Boolean));

        const strengths = addSection(detailContent, "Current starting point");
        addList(strengths, report.current_starting_point);

        const findingsSection = addSection(detailContent, "Opportunities and evidence");
        if (Array.isArray(report.findings) && report.findings.length) {
            report.findings.forEach((finding) => {
                const box = element("article", "bfa-finding");
                const title = element("div", "bfa-finding-title");
                title.appendChild(element("strong", "", finding.title || "Opportunity"));
                title.appendChild(element("span", "bfa-evidence",
                    finding.evidence_classification === "self_reported" ? "SELF-REPORTED" :
                    String(finding.evidence_classification || "UNVERIFIED").replace(/_/g, " ").toUpperCase()));
                box.appendChild(title);
                if (finding.explanation) box.appendChild(element("p", "", finding.explanation));
                if (finding.confidence_basis) {
                    const basis = element("p");
                    basis.append(element("strong", "", "Confidence basis: "), document.createTextNode(finding.confidence_basis));
                    box.appendChild(basis);
                }
                if (finding.business_implication) {
                    const implication = element("p");
                    implication.append(element("strong", "", "Business implication: "), document.createTextNode(finding.business_implication));
                    box.appendChild(implication);
                }
                if (finding.next_action) {
                    const action = element("p");
                    action.append(element("strong", "", "Suggested next action: "), document.createTextNode(finding.next_action));
                    box.appendChild(action);
                }
                findingsSection.appendChild(box);
            });
        } else {
            findingsSection.appendChild(element("p", "", "No separate opportunity finding was recorded."));
        }

        const recommendations = addSection(detailContent, "Recommended next steps");
        if (Array.isArray(report.recommendations) && report.recommendations.length) {
            report.recommendations.forEach((recommendation) => {
                const p = element("p");
                p.appendChild(element("strong", "", recommendation.title || recommendation.service_id || "Suggested service"));
                p.appendChild(document.createTextNode(" " + (recommendation.recommended_action || recommendation.description || "")));
                recommendations.appendChild(p);
            });
        } else {
            recommendations.appendChild(element("p", "", "No specific Swayphics service was recommended from these answers."));
        }

        try {
            const enquiry = await loadLinkedEnquiry(id);
            if (enquiry) {
                renderContactCard(detailContent, enquiry);
            } else if (item.contact_requested) {
                detailContent.appendChild(element("p", "bfa-readonly-note",
                    "A contact request is recorded, but the linked enquiry could not be retrieved."));
            } else {
                detailContent.appendChild(element("p", "bfa-readonly-note",
                    "The respondent did not request contact. This is an assessment record only, not a sales lead."));
            }
        } catch (error) {
            detailContent.appendChild(element("p", "bfa-readonly-note",
                "The assessment is available, but its linked enquiry details could not be loaded."));
        }

        const disclaimer = addSection(detailContent, "Evidence note");
        disclaimer.appendChild(element("p", "", report.disclaimer ||
            "This assessment is based on respondent answers. No independent website, social-media or Google Business Profile inspection has been performed."));

        try {
            await renderInspectionSection(detailContent, item);
        } catch (error) {
            const inspectionError = addSection(detailContent, "Independent public-presence inspection");
            inspectionError.appendChild(element("p", "bfa-inspection-notice",
                "Inspection history could not be loaded. " + (error.message || "Refresh the assessment to try again.")));
        }
        renderConversionSection(detailContent, item, report);

        const actions = element("div", "bfa-detail-actions");
        const copyButton = element("button", "", "Copy report");
        copyButton.type = "button";
        copyButton.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(reportToText(report));
                copyButton.textContent = "Copied";
                window.setTimeout(() => { copyButton.textContent = "Copy report"; }, 1800);
            } catch (error) {
                copyButton.textContent = "Copy unavailable";
            }
        });
        actions.appendChild(copyButton);
        const workspaceLink = element("a", "", "Open admin workspace");
        workspaceLink.href = "index.html";
        actions.appendChild(workspaceLink);
        detailContent.appendChild(actions);
    }

    function reportToText(report) {
        const lines = [
            "SWAYPHICS BUSINESS OPPORTUNITY FINDER",
            report.title || "",
            report.industry && report.industry.label ? "Industry: " + report.industry.label : "",
            report.location ? "Location: " + report.location : "",
            "Website status: " + (report.website_status || "Not established from your answers"),
            "",
            "CURRENT STARTING POINT",
            ...(Array.isArray(report.current_starting_point) ? report.current_starting_point.map((item) => "- " + item) : []),
            "",
            "OPPORTUNITIES"
        ];
        (Array.isArray(report.findings) ? report.findings : []).forEach((item) => {
            lines.push("- " + item.title + " [" + (item.evidence_classification || "unverified") + "]: " + (item.explanation || ""));
            if (item.next_action) lines.push("  Next action: " + item.next_action);
        });
        lines.push("", report.disclaimer || "");
        return lines.filter(Boolean).join("\n");
    }

    async function loadAssessments() {
        setStatus("Loading private assessment records…");
        const columns = [
            "id", "assessment_version", "status", "business_name", "industry",
            "business_profile", "responses", "findings", "report", "contact_requested",
            "contact_requested_at", "lead_id", "submitted_at", "created_at", "updated_at"
        ].join(",");
        const rows = await api("/rest/v1/business_assessments?select=" + columns + "&order=submitted_at.desc&limit=200");
        assessments = Array.isArray(rows) ? rows : [];
        renderList();
        setStatus(assessments.length
            ? assessments.length + " assessment record" + (assessments.length === 1 ? "" : "s") + " loaded."
            : "No submitted assessments have been recorded yet.");
        app.hidden = false;

        const params = new URLSearchParams(window.location.search);
        const requestedId = params.get("assessment");
        if (requestedId && assessments.some((item) => item.id === requestedId)) {
            await showAssessment(requestedId);
        } else {
            detail.hidden = false;
            detailPlaceholder.hidden = false;
            detailContent.hidden = true;
        }
    }

    async function verifyAdminAccess() {
        if (!localStorage.getItem(ACCESS_KEY)) {
            window.location.href = "../admin/";
            return false;
        }

        await refreshAdminSession(false);
        let userResponse = await fetch(SUPABASE_URL + "/auth/v1/user", {
            method: "GET",
            headers: {
                "apikey": SUPABASE_PUBLISHABLE_KEY,
                "Authorization": "Bearer " + (accessToken || "")
            }
        });

        if (userResponse.status === 401 && await refreshAdminSession(true)) {
            userResponse = await fetch(SUPABASE_URL + "/auth/v1/user", {
                method: "GET",
                headers: {
                    "apikey": SUPABASE_PUBLISHABLE_KEY,
                    "Authorization": "Bearer " + accessToken
                }
            });
        }
        if (!userResponse.ok) {
            localStorage.removeItem(ACCESS_KEY);
            localStorage.removeItem(REFRESH_KEY);
            window.location.href = "../admin/";
            return false;
        }

        const user = await userResponse.json();
        if (!user || typeof user.id !== "string" || !user.id) {
            throw new Error("Your administrator identity could not be verified.");
        }

        const isAdmin = await api("/rest/v1/rpc/is_swayphics_admin", {
            method: "POST",
            body: "{}"
        });
        if (isAdmin !== true) {
            throw new Error("This account does not have Swayphics administrator access.");
        }
        return true;
    }

    document.querySelectorAll("[data-bfa-filter]").forEach((button) => {
        button.addEventListener("click", () => {
            currentFilter = button.dataset.bfaFilter || "all";
            document.querySelectorAll("[data-bfa-filter]").forEach((item) => {
                item.setAttribute("aria-pressed", String(item === button));
            });
            renderList();
        });
    });

    search.addEventListener("input", renderList);
    refreshButton.addEventListener("click", () => {
        refreshButton.disabled = true;
        loadAssessments().catch((error) => setStatus(error.message, "error"))
            .finally(() => { refreshButton.disabled = false; });
    });

    (async () => {
        try {
            const authorised = await verifyAdminAccess();
            if (!authorised) return;
            await loadAssessments();
        } catch (error) {
            app.hidden = true;
            setStatus(error.message || "The assessment records could not be loaded.", "error");
        }
    })();
})();
