(function () {
    "use strict";

    var ROOT_ID = "sway-settings-expanded";
    var SUPABASE_URL = "https://sqifhribgsqfaxgtobsa.supabase.co";
    var SUPABASE_KEY = "sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QhB";
    var ACCESS_KEY = "swayphics_admin_access_token";
    var REFRESH_KEY = "swayphics_admin_refresh_token";
    var LOCAL_PREFS_KEY = "swayphics_admin_dashboard_preferences";
    var identityPromise = null;
    var cachedIdentity = null;
    var cachedTemplates = [];
    var isOwner = false;

    var SECTION_NAMES = [
        ["sales", "Sales workflow"],
        ["performance", "Performance targets"],
        ["commercial", "Commercial rules"],
        ["delivery", "Project delivery"],
        ["business", "Business & invoices"],
        ["notifications", "Notifications"],
        ["templates", "Communication templates"],
        ["security", "Account & security"],
        ["preferences", "Dashboard preferences"],
        ["website", "Website & reputation"],
        ["innerme", "InnerMe operations"],
        ["governance", "Governance & audit"]
    ];

    var DEFAULT_NOTIFICATIONS = {
        in_app_notifications_enabled: true,
        notify_sales: true,
        notify_finance: true,
        notify_delivery: true,
        notify_innerme: true,
        browser_push_enabled: true
    };

    var DEFAULT_PREFERENCES = {
        default_landing_view: "current",
        table_density: "comfortable",
        date_format: "en-ZA",
        currency_display: "symbol",
        reduced_motion: false
    };

    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function readAccessToken() {
        try { return localStorage.getItem(ACCESS_KEY) || ""; }
        catch (error) { return ""; }
    }

    function readRefreshToken() {
        try { return localStorage.getItem(REFRESH_KEY) || ""; }
        catch (error) { return ""; }
    }

    async function refreshSession() {
        var refreshToken = readRefreshToken();
        if (!refreshToken) return false;

        var response = await fetch(
            SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token",
            {
                method: "POST",
                headers: {
                    apikey: SUPABASE_KEY,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ refresh_token: refreshToken })
            }
        );
        if (!response.ok) return false;

        var data = await response.json();
        if (!data.access_token || !data.refresh_token) return false;

        localStorage.setItem(ACCESS_KEY, data.access_token);
        localStorage.setItem(REFRESH_KEY, data.refresh_token);
        return true;
    }

    async function request(path, options, retry) {
        options = options || {};
        retry = retry !== false;
        var accessToken = readAccessToken();
        if (!accessToken) throw new Error("Your admin session is missing. Sign in again.");

        var headers = {
            apikey: SUPABASE_KEY,
            Authorization: "Bearer " + accessToken
        };
        Object.keys(options.headers || {}).forEach(function (key) {
            headers[key] = options.headers[key];
        });
        var init = {
            method: options.method || "GET",
            headers: headers
        };
        if (Object.prototype.hasOwnProperty.call(options, "body")) {
            if (options.body !== null && typeof options.body !== "string") {
                headers["Content-Type"] = "application/json";
                init.body = JSON.stringify(options.body);
            } else {
                init.body = options.body;
            }
        }

        var response = await fetch(SUPABASE_URL + path, init);
        if (response.status === 401 && retry && await refreshSession()) {
            return request(path, options, false);
        }

        var raw = await response.text();
        var payload = null;
        if (raw) {
            try { payload = JSON.parse(raw); }
            catch (error) { payload = { message: raw }; }
        }
        if (!response.ok) {
            var message = payload && (payload.message || payload.error_description || payload.error);
            if (response.status === 401) {
                throw new Error("Your admin session has expired. Sign in again.");
            }
            if (response.status === 403) {
                throw new Error("Your account is not permitted to change this setting.");
            }
            if (response.status === 404 || response.status === 400) {
                throw new Error((message || "The settings schema is not available yet.") +
                    " Apply the admin settings migration in Supabase and reload.");
            }
            throw new Error(message || ("Request failed (" + response.status + ")."));
        }
        return payload;
    }

    function queryPath(table, params) {
        var query = new URLSearchParams(params || {});
        return "/rest/v1/" + table + (query.toString() ? "?" + query.toString() : "");
    }

    async function getRows(table, params) {
        var rows = await request(queryPath(table, params));
        return Array.isArray(rows) ? rows : [];
    }

    async function upsert(table, payload, conflictColumn) {
        return request(
            "/rest/v1/" + table + "?on_conflict=" + encodeURIComponent(conflictColumn || "user_id"),
            {
                method: "POST",
                headers: { Prefer: "resolution=merge-duplicates,return=representation" },
                body: payload
            }
        );
    }

    async function updateRow(table, filter, payload) {
        return request(
            "/rest/v1/" + table + "?" + filter,
            {
                method: "PATCH",
                headers: { Prefer: "return=representation" },
                body: payload
            }
        );
    }

    async function getIdentity() {
        if (cachedIdentity) return cachedIdentity;
        if (identityPromise) return identityPromise;

        identityPromise = (async function () {
            var authUser = await request("/auth/v1/user");
            if (!authUser || !authUser.id) throw new Error("Unable to verify the signed-in administrator.");

            var rows = await getRows("admin_users", {
                select: "user_id,email,full_name,role,active",
                user_id: "eq." + authUser.id,
                limit: "1"
            });
            var admin = rows[0];
            if (!admin || admin.active === false) {
                throw new Error("This account does not have active Swayphics administrator access.");
            }
            cachedIdentity = {
                user: authUser,
                admin: admin,
                role: String(admin.role || "").toLowerCase(),
                email: admin.email || authUser.email || ""
            };
            isOwner = cachedIdentity.role === "owner";
            return cachedIdentity;
        })();

        try {
            return await identityPromise;
        } catch (error) {
            identityPromise = null;
            throw error;
        }
    }

    function field(name, label, type, help, attrs) {
        attrs = attrs || "";
        var wide = attrs.indexOf("data-wide") >= 0 ? " swe-wide" : "";
        attrs = attrs.replace("data-wide", "");
        var input;
        if (type === "textarea") {
            input = '<textarea name="' + name + '" ' + attrs + '></textarea>';
        } else if (type === "checkbox") {
            return '<label class="swe-check"><input type="checkbox" name="' + name + '" ' + attrs + '>' +
                '<span class="swe-checkbox-copy"><strong>' + label + '</strong>' +
                (help ? '<small>' + help + '</small>' : "") + '</span></label>';
        } else {
            input = '<input name="' + name + '" type="' + (type || "text") + '" ' + attrs + '>';
        }
        return '<label class="swe-field' + wide + '"><span>' + label + '</span>' + input +
            (help ? '<small>' + help + '</small>' : "") + '</label>';
    }

    function selectField(name, label, options, help) {
        var optionHtml = options.map(function (item) {
            return '<option value="' + item[0] + '">' + item[1] + '</option>';
        }).join("");
        return '<label class="swe-field"><span>' + label + '</span><select name="' + name + '">' +
            optionHtml + '</select>' + (help ? '<small>' + help + '</small>' : "") + '</label>';
    }

    function formCard(id, title, description, fields, buttonText, ownerOnly) {
        return '<form class="swe-card" data-settings-form="' + id + '">' +
            '<h3>' + title + '</h3><p>' + description + '</p>' +
            '<div class="swe-fields">' + fields + '</div>' +
            '<div class="swe-actions"><button type="submit" class="swe-button swe-button-primary"' +
            (ownerOnly ? ' data-owner-only' : "") + '>' + buttonText + '</button></div>' +
            '<p class="swe-status" data-settings-status role="status" aria-live="polite"></p>' +
            '</form>';
    }

    function checkCard(title, description, checks, id) {
        return '<form class="swe-card" data-settings-form="' + id + '">' +
            '<h3>' + title + '</h3><p>' + description + '</p>' +
            '<div class="swe-check-grid">' + checks + '</div>' +
            '<div class="swe-actions"><button type="submit" class="swe-button swe-button-primary">Save preferences</button></div>' +
            '<p class="swe-status" data-settings-status role="status" aria-live="polite"></p></form>';
    }

    function buildMarkup() {
        var nav = SECTION_NAMES.map(function (section, index) {
            return '<button type="button" class="swe-tab" role="tab" id="swe-tab-' + section[0] +
                '" aria-controls="swe-panel-' + section[0] + '" aria-selected="' + (index === 0 ? "true" : "false") +
                '" data-settings-tab="' + section[0] + '">' + section[1] + '</button>';
        }).join("");

        var notifications = [
            ["in_app_notifications_enabled", "In-dashboard notifications", "Master switch for new alerts in the dashboard inbox."],
            ["notify_sales", "Sales and workflow", "New leads, enquiries, follow-ups and task events."],
            ["notify_finance", "Invoices and payments", "Invoice and payment events, where those events produce an admin notification."],
            ["notify_delivery", "Email delivery and reviews", "Email delivery and client review-request events."],
            ["notify_innerme", "InnerMe incidents", "InnerMe, AI-provider and related operational events."],
            ["browser_push_enabled", "Browser push notifications", "Controls push delivery to this administrator's registered browsers."]
        ].map(function (item) {
            return field(item[0], item[1], "checkbox", item[2]);
        }).join("");

        var businessFields =
            field("business_name", "Business name", "text", "Displayed on invoices and business documents.", 'required data-wide') +
            field("slogan", "Slogan", "text", "Your invoice identity line.") +
            field("email", "Business email", "email", "Default contact email for invoices.") +
            field("phone", "Business phone", "tel", "Optional public contact number.") +
            field("website", "Website", "url", "The canonical business website.") +
            field("address", "Business address", "textarea", "Optional address printed on invoices.", 'data-wide') +
            field("bank_name", "Bank name", "text", "Banking information shown on invoices.") +
            field("account_name", "Account holder", "text", "Account name for payments.") +
            field("account_number", "Account number", "text", "Stored in the restricted invoice settings table.") +
            field("account_type", "Account type", "text", "For example, cheque or savings.") +
            field("branch_code", "Branch code", "text", "Bank branch code, if applicable.") +
            field("swift_bic", "SWIFT/BIC", "text", "Optional international transfer details.") +
            field("payment_instructions", "Payment instructions", "textarea", "Instructions printed on invoice documents.", 'data-wide') +
            field("vat_registered", "VAT registered", "checkbox", "Enable only if Swayphics is VAT registered.") +
            field("vat_number", "VAT number", "text", "Required when VAT registration is enabled.");

        var salesFields =
            field("new_lead_response_hours", "New enquiry response target (hours)", "number",
                "Flag new leads that have waited longer than this target.", 'min="1" max="720" step="1" required') +
            field("lead_no_response_days", "Fallback follow-up interval (days)", "number",
                "Used only when a stage-specific interval has not been configured.", 'min="1" max="365" step="1" required') +
            field("stage_days_contacted", "Contacted stage interval (days)", "number",
                "Leave blank to use the fallback interval.", 'min="1" max="365" step="1"') +
            field("stage_days_interested", "Interested stage interval (days)", "number",
                "Leave blank to use the fallback interval.", 'min="1" max="365" step="1"') +
            field("stage_days_proposal_sent", "Proposal sent interval (days)", "number",
                "Leave blank to use the fallback interval.", 'min="1" max="365" step="1"') +
            field("stage_days_negotiating", "Negotiating stage interval (days)", "number",
                "Leave blank to use the fallback interval.", 'min="1" max="365" step="1"') +
            field("stage_days_follow_up", "Follow-up stage interval (days)", "number",
                "Leave blank to use the fallback interval.", 'min="1" max="365" step="1"') +
            field("max_followup_attempts", "Maximum follow-up attempts", "number",
                "After this many completed or pending attempts, flag the lead for owner review instead of creating more tasks.", 'min="1" max="20" step="1" required') +
            '<div class="swe-notice swe-wide"><strong>Manual outreach remains protected:</strong> these rules schedule tasks and in-dashboard alerts. They do not automatically send emails or WhatsApp messages.</div>';

        var performanceFields =
            field("monthly_revenue_target", "Monthly invoiced revenue target (R)", "number",
                "Use 0 when no target is set.", 'min="0" max="1000000000" step="0.01" required') +
            field("monthly_new_leads_target", "Monthly new leads target", "number",
                "Count of leads created this month. Use 0 to leave unset.", 'min="0" max="1000000" step="1" required') +
            field("monthly_proposals_target", "Monthly proposals target", "number",
                "Quotes issued this month. Use 0 to leave unset.", 'min="0" max="1000000" step="1" required') +
            field("monthly_wins_target", "Monthly wins target", "number",
                "Leads marked won this month. Use 0 to leave unset.", 'min="0" max="1000000" step="1" required') +
            field("target_conversion_rate", "Target lead-to-win conversion (%)", "number",
                "Target percentage from new leads created this month to leads marked won this month.", 'min="0" max="100" step="0.01" required');

        var commercialFields =
            field("quote_validity_days", "Default quote validity (days)", "number",
                "Applied to new quotes only when an expiry date is not explicitly supplied.", 'min="1" max="365" step="1" required') +
            field("invoice_payment_terms_days", "Default invoice payment terms (days)", "number",
                "Applied to new invoices only when a due date is not explicitly supplied. Zero means due on issue date.", 'min="0" max="365" step="1" required');

        var deliveryFields =
            field("default_project_duration_days", "Default project duration (days)", "number",
                "Applied to new projects with no due date. Existing projects are unchanged.", 'min="1" max="365" step="1" required') +
            field("default_project_task_template", "Default project checklist", "textarea",
                "One task per line. Optional format: Task title | days after creation | priority (low, medium, high, urgent).", 'data-wide rows="8" maxlength="4000');

        var preferencesFields =
            selectField("default_landing_view", "Default landing page", [
                ["current", "Keep the dashboard's default"],
                ["leads", "Leads"],
                ["followups", "Follow-ups"],
                ["tasks", "Tasks"],
                ["clients", "Clients"],
                ["projects", "Projects"],
                ["invoices", "Invoices"],
                ["settings", "Settings"],
                ["innerme", "InnerMe"]
            ], "Applied on a fresh dashboard visit unless a specific view is requested in the URL.") +
            selectField("table_density", "Table density", [
                ["comfortable", "Comfortable"],
                ["compact", "Compact"]
            ], "Compact mode reduces table cell spacing.") +
            selectField("date_format", "Date display preference", [
                ["en-ZA", "South African format (day/month/year)"],
                ["iso", "ISO format (YYYY-MM-DD)"]
            ], "Saved to your profile for settings-aware views.") +
            selectField("currency_display", "Currency display", [
                ["symbol", "Currency symbol (R)"],
                ["code", "Currency code (ZAR)"]
            ], "The ledger remains denominated in South African rand.") +
            field("reduced_motion", "Reduce interface motion", "checkbox", "Reduce transitions and animations across the admin interface.", 'data-wide');

        var securityPanel =
            '<section class="swe-panel" role="tabpanel" id="swe-panel-security" aria-labelledby="swe-tab-security" data-settings-panel="security" hidden>' +
            '<div class="swe-card"><h3>Administrator account</h3><p>Verified from your active Supabase session and Swayphics admin record.</p>' +
            '<div class="swe-account-grid">' +
            '<div class="swe-stat"><span>Signed-in email</span><strong data-account-email>Checking…</strong></div>' +
            '<div class="swe-stat"><span>Role</span><strong data-account-role>Checking…</strong></div>' +
            '<div class="swe-stat"><span>Access status</span><strong data-account-status>Checking…</strong></div>' +
            '<div class="swe-stat"><span>Authentication</span><strong>Supabase Auth</strong></div></div>' +
            '<div class="swe-notice"><strong>Credential boundary:</strong> API keys, service-role credentials and provider secrets are not exposed in this settings page.</div>' +
            '<div class="swe-actions"><button type="button" class="swe-button" data-action="password-reset">Send password reset email</button>' +
            '<button type="button" class="swe-button swe-danger" data-action="sign-out">Sign out</button></div>' +
            '<p class="swe-status" data-security-status role="status" aria-live="polite"></p></div></section>';

        var templatesPanel =
            '<section class="swe-panel" role="tabpanel" id="swe-panel-templates" aria-labelledby="swe-tab-templates" data-settings-panel="templates" hidden>' +
            '<form class="swe-card" data-settings-form="templates"><h3>Communication template library</h3>' +
            '<p>Edit shared starting points for sales and client messages. Templates are not sent automatically; use Copy template to take the selected text into your normal communication workflow.</p>' +
            '<div class="swe-fields">' +
            selectField("template_key", "Template", [], "Choose a reusable starting point.") +
            field("subject", "Email subject", "text", "Leave blank for channels that do not use a subject.", 'data-wide') +
            field("body", "Message body", "textarea", "Placeholders use double braces, for example {{contact_name}}. They are not replaced when copied.", 'data-wide') +
            '</div><div class="swe-actions"><button type="submit" class="swe-button swe-button-primary" data-owner-only>Save template</button>' +
            '<button type="button" class="swe-button" data-action="copy-template">Copy template</button></div>' +
            '<div class="swe-notice"><strong>Available placeholders:</strong> {{business_name}}, {{contact_name}}, {{service_name}}, {{meeting_date}}, {{meeting_time}}, {{invoice_number}}, {{amount_due}}, {{due_date}}, {{project_name}}, {{review_link}}.</div>' +
            '<h3 style="margin-top:18px">Preview</h3><div class="swe-template-preview" data-template-preview>Loading templates…</div>' +
            '<p class="swe-status" data-settings-status role="status" aria-live="polite"></p></form></section>';

        var salesPanel =
            '<section class="swe-panel" role="tabpanel" id="swe-panel-sales" aria-labelledby="swe-tab-sales" data-settings-panel="sales">' +
            formCard("sales", "Lead follow-up rules", "Control the existing workflow clock without changing individual lead records.", salesFields, "Save workflow", true) +
            '<div class="swe-card"><h3>Workflow boundary</h3><p>These settings change the follow-up interval used by the current database workflow. Email and WhatsApp outreach still require the existing manual or approved sending steps.</p></div></section>';

        var performancePanel =
            '<section class="swe-panel" role="tabpanel" id="swe-panel-performance" aria-labelledby="swe-tab-performance" data-settings-panel="performance" hidden>' +
            formCard("performance", "Monthly performance targets", "Set the outcomes you want to measure. Actuals are calculated from the current month’s lead, quote and invoice records.", performanceFields, "Save performance targets", true) +
            '<div class="swe-card"><div class="swe-card-heading"><div><h3>Current month scorecard</h3><p>Figures refresh from live records. Draft and archived invoices are excluded from invoiced revenue. Conversion is the share of this month’s new leads that are currently marked won.</p></div><button type="button" class="swe-button" data-action="refresh-performance">Refresh figures</button></div>' +
            '<div class="swe-performance-grid">' +
            '<div class="swe-stat"><span>Invoiced revenue</span><strong data-performance-actual="revenue">Loading…</strong><small data-performance-target="revenue">Target not set</small><div class="swe-progress"><span data-performance-bar="revenue"></span></div></div>' +
            '<div class="swe-stat"><span>New leads</span><strong data-performance-actual="leads">Loading…</strong><small data-performance-target="leads">Target not set</small><div class="swe-progress"><span data-performance-bar="leads"></span></div></div>' +
            '<div class="swe-stat"><span>Proposals issued</span><strong data-performance-actual="proposals">Loading…</strong><small data-performance-target="proposals">Target not set</small><div class="swe-progress"><span data-performance-bar="proposals"></span></div></div>' +
            '<div class="swe-stat"><span>New leads won</span><strong data-performance-actual="wins">Loading…</strong><small data-performance-target="wins">Target not set</small><div class="swe-progress"><span data-performance-bar="wins"></span></div></div>' +
            '<div class="swe-stat"><span>Lead-to-win conversion</span><strong data-performance-actual="conversion">Loading…</strong><small data-performance-target="conversion">Target not set</small><div class="swe-progress"><span data-performance-bar="conversion"></span></div></div>' +
            '</div><p class="swe-status" data-performance-status role="status" aria-live="polite"></p></div></section>';

        var commercialPanel =
            '<section class="swe-panel" role="tabpanel" id="swe-panel-commercial" aria-labelledby="swe-tab-commercial" data-settings-panel="commercial" hidden>' +
            formCard("commercial", "Default commercial terms", "These defaults affect newly created documents only. Existing quotes, invoice due dates and issued documents are not rewritten.", commercialFields, "Save commercial rules", true) +
            '<div class="swe-card"><h3>Document safety</h3><p>Existing explicit expiry and due dates are preserved. The defaults apply only when a new quote or invoice is saved without a date.</p></div></section>';

        var governancePanel =
            '<section class="swe-panel" role="tabpanel" id="swe-panel-governance" aria-labelledby="swe-tab-governance" data-settings-panel="governance" hidden>' +
            '<div class="swe-card"><div class="swe-card-heading"><div><h3>Scheduled automation health</h3><p>Latest recorded run for each Swayphics background job. No run history is reported as “Not run yet”, not as a success.</p></div><button type="button" class="swe-button" data-action="refresh-governance">Refresh status</button></div>' +
            '<div data-governance-automation><p class="swe-muted">Loading automation status…</p></div>' +
            '<p class="swe-status" data-governance-status role="status" aria-live="polite"></p></div>' +
            '<div class="swe-card"><h3>Settings audit history</h3><p>Records who changed a settings area and which field names changed. Previous and new values are deliberately not stored here, so banking details and template contents are not copied into the audit trail.</p>' +
            '<div data-governance-audit><p class="swe-muted">Loading settings history…</p></div>' +
            '<p class="swe-status" data-audit-status role="status" aria-live="polite"></p></div>' +
            '<div class="swe-card"><h3>Backup and recovery boundary</h3><p>Backup retention and restore-test status are not exposed by the dashboard database API. Verify those directly in the Supabase project controls; this page will not label backups healthy without a verified signal.</p></div>' +
            '<div class="swe-card"><h3>InnerMe approval boundary</h3><p>Settings here do not grant InnerMe new action permissions. Sensitive actions remain subject to the existing InnerMe autonomy and action-approval controls.</p></div></section>';

        var businessPanel =
            '<section class="swe-panel" role="tabpanel" id="swe-panel-business" aria-labelledby="swe-tab-business" data-settings-panel="business" hidden>' +
            formCard("business", "Business identity and invoice details", "Values are saved to the existing invoice_settings record. Treat banking details as confidential.", businessFields, "Save business details", true) +
            '<div class="swe-card"><h3>Invoice behaviour</h3><p>Invoice numbering, currency and totals remain controlled by the existing invoice implementation. This form changes business identity, payment instructions and VAT registration details only.</p></div></section>';

        var notificationsPanel =
            '<section class="swe-panel" role="tabpanel" id="swe-panel-notifications" aria-labelledby="swe-tab-notifications" data-settings-panel="notifications" hidden>' +
            checkCard("Alert preferences", "These settings govern new notifications. Existing records remain in the inbox; changes do not delete history.", notifications, "notifications") +
            '<div class="swe-notice"><strong>Email alert limitation:</strong> transactional email delivery is separate from admin notification preferences. This panel does not disable invoice or review-request emails sent by their existing workflows.</div></section>';

        var preferencesPanel =
            '<section class="swe-panel" role="tabpanel" id="swe-panel-preferences" aria-labelledby="swe-tab-preferences" data-settings-panel="preferences" hidden>' +
            formCard("preferences", "Your dashboard experience", "These choices are private to your administrator account.", preferencesFields, "Save preferences", false) +
            '<div class="swe-card"><h3>Formatting note</h3><p>Date and currency choices are stored on your admin profile and exposed to settings-aware views. Existing invoice PDFs continue to use their established South African date and ZAR formatting.</p></div></section>';

        var websitePanel =
            '<section class="swe-panel" role="tabpanel" id="swe-panel-website" aria-labelledby="swe-tab-website" data-settings-panel="website" hidden>' +
            formCard("website", "Website and reputation", "Manage the destination used by the existing post-project review request workflow.", field("review_link", "Customer review link", "url", "This is used by the current review-request email.", 'required data-wide'), "Save reputation settings", true) +
            '<div class="swe-card"><h3>Review-request safety</h3><p>Saving the link changes the destination for future requests. It does not send review requests or alter requests already queued.</p></div></section>';

        var innermePanel =
            '<section class="swe-panel" role="tabpanel" id="swe-panel-innerme" aria-labelledby="swe-tab-innerme" data-settings-panel="innerme" hidden>' +
            '<div class="swe-card"><h3>InnerMe service health</h3><p>Run the existing authenticated operational check for the dashboard database workspace. This check does not send a chat prompt or call the model provider.</p>' +
            '<div class="swe-status-grid"><div class="swe-stat"><span>Secrets</span><strong>Server-side only</strong></div>' +
            '<div class="swe-stat"><span>Model provider controls</span><strong>Managed by runtime configuration</strong></div>' +
            '<div class="swe-stat"><span>Health check</span><strong data-innerme-settings-health>Not checked from Settings</strong></div>' +
            '<div class="swe-stat"><span>Current health output</span><strong data-innerme-health-summary>Open the health check to inspect results</strong></div></div>' +
            '<div class="swe-actions"><button type="button" class="swe-button swe-button-primary" data-action="run-innerme-health">Open and run health check</button></div>' +
            '<p class="swe-status" data-innerme-settings-status role="status" aria-live="polite"></p>' +
            '<div class="swe-notice"><strong>Security:</strong> provider API keys, Supabase service-role keys, and VAPID secrets must remain in Supabase Edge Function secrets. Do not paste secrets into these settings or browser code.</div></div></section>';

        return '<div id="' + ROOT_ID + '" aria-label="Expanded admin settings">' +
            '<header class="swe-header"><div><span class="swe-eyebrow">Swayphics workspace</span>' +
            '<h2>Settings</h2><p class="swe-description">Control the business workflow, invoice identity, alerts, reusable communication and your administrator experience from one place.</p></div></header>' +
            '<div class="swe-tabs" role="tablist" aria-label="Settings sections">' + nav + '</div>' +
            '<div class="swe-panels">' + salesPanel + performancePanel + commercialPanel + businessPanel + notificationsPanel +
            templatesPanel + securityPanel + preferencesPanel + websitePanel + innermePanel + governancePanel + '</div>' +
            '<p class="swe-status" data-settings-global-status role="status" aria-live="polite"></p></div>';
    }

    function setStatus(node, message, kind) {
        if (!node) return;
        node.textContent = message || "";
        node.classList.remove("is-success", "is-error");
        if (kind === "success") node.classList.add("is-success");
        if (kind === "error") node.classList.add("is-error");
    }

    function formStatus(form) {
        return form ? form.querySelector("[data-settings-status]") : null;
    }

    function setFormValues(root, row) {
        if (!root || !row) return;
        Object.keys(row).forEach(function (name) {
            var input = root.querySelector('[name="' + name + '"]');
            if (!input) return;
            if (input.type === "checkbox") input.checked = row[name] === true;
            else input.value = row[name] == null ? "" : String(row[name]);
        });
    }

    function formValues(form, onlyNames) {
        var values = {};
        var fields = form.querySelectorAll("[name]");
        fields.forEach(function (input) {
            if (onlyNames && onlyNames.indexOf(input.name) < 0) return;
            if (input.type === "checkbox") values[input.name] = input.checked;
            else values[input.name] = input.value;
        });
        return values;
    }

    function ownerGatedControls(root) {
        root.querySelectorAll("[data-owner-only]").forEach(function (control) {
            control.disabled = !isOwner;
            if (!isOwner) control.title = "Only the Swayphics owner can change this business-wide setting.";
        });
    }

    function selectTab(root, tabId) {
        root.querySelectorAll("[data-settings-tab]").forEach(function (tab) {
            var active = tab.getAttribute("data-settings-tab") === tabId;
            tab.setAttribute("aria-selected", active ? "true" : "false");
            tab.tabIndex = active ? 0 : -1;
        });
        root.querySelectorAll("[data-settings-panel]").forEach(function (panel) {
            panel.hidden = panel.getAttribute("data-settings-panel") !== tabId;
        });
    }

    function applyDashboardPreferences(prefs) {
        prefs = Object.assign({}, DEFAULT_PREFERENCES, prefs || {});
        try { localStorage.setItem(LOCAL_PREFS_KEY, JSON.stringify(prefs)); } catch (error) {}
        document.body.classList.toggle("sway-admin-compact-tables", prefs.table_density === "compact");
        document.body.classList.toggle("sway-admin-reduced-motion", prefs.reduced_motion === true);
        document.documentElement.setAttribute("data-sway-date-format", prefs.date_format);
        document.documentElement.setAttribute("data-sway-currency-display", prefs.currency_display);
        window.SwayphicsAdminSettings = window.SwayphicsAdminSettings || {};
        window.SwayphicsAdminSettings.preferences = prefs;
        window.SwayphicsAdminSettings.formatDate = function (value) {
            if (!value) return "—";
            var date = new Date(value);
            if (Number.isNaN(date.getTime())) return String(value);
            if (prefs.date_format === "iso") {
                return date.getFullYear() + "-" +
                    String(date.getMonth() + 1).padStart(2, "0") + "-" +
                    String(date.getDate()).padStart(2, "0");
            }
            return date.toLocaleDateString("en-ZA", {
                day: "2-digit", month: "2-digit", year: "numeric",
                timeZone: "Africa/Johannesburg"
            });
        };
        window.SwayphicsAdminSettings.formatCurrency = function (value) {
            var amount = Number(value || 0);
            if (!Number.isFinite(amount)) amount = 0;
            return new Intl.NumberFormat("en-ZA", {
                style: "currency",
                currency: "ZAR",
                currencyDisplay: prefs.currency_display === "code" ? "code" : "symbol",
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(amount);
        };
    }

    function findNavButton(view) {
        var candidates = Array.from(document.querySelectorAll(".sway-workspace-nav-button"));
        var map = {
            followups: ["follow-ups", "followups", "follow ups"],
            innerme: ["innerme", "inner me", "ai agent"],
            settings: ["settings"],
            leads: ["leads"],
            tasks: ["tasks"],
            clients: ["clients"],
            projects: ["projects"],
            invoices: ["invoices"]
        };
        return candidates.find(function (button) {
            if (button.getAttribute("data-view") === view ||
                button.getAttribute("data-sway-view") === view ||
                button.id.toLowerCase().indexOf(view) >= 0) return true;
            var text = String(button.textContent || "").trim().toLowerCase().replace(/\s+/g, " ");
            return (map[view] || [view]).some(function (label) {
                return text === label || text.indexOf(label) >= 0;
            });
        }) || null;
    }

    function applyPreferredLandingView(view) {
        if (!view || view === "current") return;
        if (new URLSearchParams(window.location.search).has("view")) return;
        var direct = findNavButton(view);
        if (direct) {
            direct.click();
            return;
        }
        var attempts = 0;
        var timer = window.setInterval(function () {
            attempts += 1;
            var button = findNavButton(view);
            if (button) {
                window.clearInterval(timer);
                button.click();
            } else if (attempts >= 25) {
                window.clearInterval(timer);
            }
        }, 200);
    }

    function renderTemplatePreview(root) {
        var form = root.querySelector('[data-settings-form="templates"]');
        if (!form) return;
        var subject = form.querySelector('[name="subject"]').value || "";
        var body = form.querySelector('[name="body"]').value || "";
        var sample = {
            business_name: "Example Business",
            contact_name: "Example contact",
            service_name: "Website design",
            meeting_date: "Tuesday, 27 October",
            meeting_time: "11:00",
            invoice_number: "SWY-2026-0001",
            amount_due: "R1 500,00",
            due_date: "30 October 2026",
            project_name: "Website project",
            review_link: "https://swayphics.co.za/testimonial/"
        };
        function interpolate(value) {
            return String(value).replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, function (match, key) {
                return Object.prototype.hasOwnProperty.call(sample, key) ? sample[key] : match;
            });
        }
        var preview = root.querySelector("[data-template-preview]");
        if (preview) preview.textContent = (subject ? interpolate(subject) + "\n\n" : "") + interpolate(body);
    }

    function templateOptions(root) {
        var select = root.querySelector('[data-settings-form="templates"] [name="template_key"]');
        if (!select) return;
        var current = select.value;
        select.innerHTML = cachedTemplates.map(function (item) {
            return '<option value="' + escapeHtml(item.template_key) + '">' +
                escapeHtml(item.name || item.template_key) + '</option>';
        }).join("");
        if (cachedTemplates.some(function (item) { return item.template_key === current; })) {
            select.value = current;
        }
        if (!select.value && cachedTemplates.length) select.value = cachedTemplates[0].template_key;
        loadSelectedTemplate(root);
    }

    function loadSelectedTemplate(root) {
        var form = root.querySelector('[data-settings-form="templates"]');
        if (!form) return;
        var key = form.querySelector('[name="template_key"]').value;
        var item = cachedTemplates.find(function (entry) { return entry.template_key === key; });
        if (item) {
            form.querySelector('[name="subject"]').value = item.subject || "";
            form.querySelector('[name="body"]').value = item.body || "";
        }
        renderTemplatePreview(root);
    }

    async function loadWorkflow(root) {
        var rows = await getRows("workflow_settings", {
            select: "id,lead_no_response_days,new_lead_response_hours,followup_stage_days,max_followup_attempts,monthly_revenue_target,monthly_new_leads_target,monthly_proposals_target,monthly_wins_target,target_conversion_rate,quote_validity_days,invoice_payment_terms_days,review_link,updated_at",
            id: "eq.1",
            limit: "1"
        });
        var row = rows[0];
        if (!row) throw new Error("The workflow_settings row is missing. Apply the existing business-flow SQL before using these controls.");
        var stageDays = row.followup_stage_days && typeof row.followup_stage_days === "object" ? row.followup_stage_days : {};
        var salesValues = Object.assign({}, row, {
            stage_days_contacted: stageDays.contacted == null ? "" : stageDays.contacted,
            stage_days_interested: stageDays.interested == null ? "" : stageDays.interested,
            stage_days_proposal_sent: stageDays["proposal sent"] == null ? "" : stageDays["proposal sent"],
            stage_days_negotiating: stageDays.negotiating == null ? "" : stageDays.negotiating,
            stage_days_follow_up: stageDays["follow-up"] == null ? "" : stageDays["follow-up"]
        });
        setFormValues(root.querySelector('[data-settings-form="sales"]'), salesValues);
        setFormValues(root.querySelector('[data-settings-form="performance"]'), row);
        setFormValues(root.querySelector('[data-settings-form="commercial"]'), row);
        setFormValues(root.querySelector('[data-settings-form="website"]'), row);
    }

    async function loadBusiness(root) {
        var rows = await getRows("invoice_settings", {
            select: "id,business_name,slogan,email,phone,website,address,bank_name,account_name,account_number,account_type,branch_code,swift_bic,payment_instructions,vat_registered,vat_number",
            id: "eq.1",
            limit: "1"
        });
        if (!rows[0]) throw new Error("The invoice_settings row is missing. Apply the existing invoicing SQL before using these controls.");
        setFormValues(root.querySelector('[data-settings-form="business"]'), rows[0]);
    }

    async function loadNotifications(root, userId) {
        var rows = await getRows("admin_notification_preferences", {
            select: "*", user_id: "eq." + userId, limit: "1"
        });
        setFormValues(root.querySelector('[data-settings-form="notifications"]'),
            Object.assign({}, DEFAULT_NOTIFICATIONS, rows[0] || {}));
    }

    async function loadPreferences(root, userId) {
        var rows = await getRows("admin_dashboard_preferences", {
            select: "*", user_id: "eq." + userId, limit: "1"
        });
        var preferences = Object.assign({}, DEFAULT_PREFERENCES, rows[0] || {});
        setFormValues(root.querySelector('[data-settings-form="preferences"]'), preferences);
        applyDashboardPreferences(preferences);
    }

    async function loadTemplates(root) {
        cachedTemplates = await getRows("communication_templates", {
            select: "id,template_key,name,subject,body,enabled,updated_at",
            order: "name.asc"
        });
        templateOptions(root);
        var form = root.querySelector('[data-settings-form="templates"]');
        if (!cachedTemplates.length) {
            setStatus(formStatus(form), "No templates were returned. Confirm the settings migration has been applied and your admin account can read templates.", "error");
        }
    }

    function monthWindow() {
        var parts = new Intl.DateTimeFormat("en-ZA", {
            timeZone: "Africa/Johannesburg",
            year: "numeric",
            month: "2-digit"
        }).formatToParts(new Date());
        var year = Number(parts.find(function (part) { return part.type === "year"; }).value);
        var month = Number(parts.find(function (part) { return part.type === "month"; }).value);
        var nextYear = month === 12 ? year + 1 : year;
        var nextMonth = month === 12 ? 1 : month + 1;
        function pad(value) { return String(value).padStart(2, "0"); }
        var startDate = year + "-" + pad(month) + "-01";
        var endDate = nextYear + "-" + pad(nextMonth) + "-01";
        // South Africa observes UTC+02:00 year-round. Keep calendar boundaries
        // in SAST, then convert them to UTC timestamps for timestamptz queries.
        return {
            startDate: startDate,
            endDate: endDate,
            startIso: new Date(startDate + "T00:00:00+02:00").toISOString(),
            endIso: new Date(endDate + "T00:00:00+02:00").toISOString()
        };
    }

    function setText(root, selector, value) {
        var node = root.querySelector(selector);
        if (node) node.textContent = value == null ? "" : String(value);
    }

    function renderSimpleTable(container, columns, rows, emptyMessage) {
        if (!container) return;
        container.replaceChildren();
        if (!rows || !rows.length) {
            var empty = document.createElement("p");
            empty.className = "swe-muted";
            empty.textContent = emptyMessage || "No records to display.";
            container.appendChild(empty);
            return;
        }
        var table = document.createElement("table");
        table.className = "swe-table";
        var thead = document.createElement("thead");
        var headRow = document.createElement("tr");
        columns.forEach(function (column) {
            var th = document.createElement("th");
            th.scope = "col";
            th.textContent = column.label;
            headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);
        var tbody = document.createElement("tbody");
        rows.forEach(function (row) {
            var tr = document.createElement("tr");
            columns.forEach(function (column) {
                var td = document.createElement("td");
                var value = column.value(row);
                td.textContent = value == null || value === "" ? "—" : String(value);
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        container.appendChild(table);
    }

    function formatMetricCurrency(value) {
        return new Intl.NumberFormat("en-ZA", {
            style: "currency", currency: "ZAR", maximumFractionDigits: 0
        }).format(Number(value) || 0);
    }

    async function loadPerformance(root) {
        var status = root.querySelector("[data-performance-status]");
        setStatus(status, "Refreshing current-month figures…", "");
        try {
            var bounds = monthWindow();
            var result = await Promise.all([
                getRows("leads", {
                    select: "id,status,created_at,updated_at",
                    created_at: "gte." + bounds.startIso,
                    limit: "1000"
                }),
                getRows("quotes", {
                    select: "id,status,created_at,amount",
                    created_at: "gte." + bounds.startIso,
                    limit: "1000"
                }),
                getRows("invoices", {
                    select: "id,status,issue_date,total,archived",
                    issue_date: "gte." + bounds.startDate,
                    archived: "eq.false",
                    limit: "1000"
                })
            ]);
            var leads = result[0].filter(function (row) {
                return row.created_at < bounds.endIso;
            });
            var quotes = result[1].filter(function (row) {
                return row.created_at < bounds.endIso && String(row.status || "").toLowerCase() !== "draft";
            });
            var invoices = result[2].filter(function (row) {
                return row.issue_date >= bounds.startDate && row.issue_date < bounds.endDate &&
                    row.archived !== true &&
                    !["draft", "cancelled", "void"].includes(String(row.status || "").toLowerCase());
            });
            var newLeads = leads.length;
            var wins = leads.filter(function (row) {
                return String(row.status || "").toLowerCase() === "won";
            }).length;
            var revenue = invoices.reduce(function (sum, row) {
                return sum + (Number(row.total) || 0);
            }, 0);
            var proposals = quotes.length;
            var conversion = newLeads ? wins / newLeads * 100 : 0;
            var form = root.querySelector('[data-settings-form="performance"]');
            var targets = {
                revenue: Number(form.querySelector('[name="monthly_revenue_target"]').value) || 0,
                leads: Number(form.querySelector('[name="monthly_new_leads_target"]').value) || 0,
                proposals: Number(form.querySelector('[name="monthly_proposals_target"]').value) || 0,
                wins: Number(form.querySelector('[name="monthly_wins_target"]').value) || 0,
                conversion: Number(form.querySelector('[name="target_conversion_rate"]').value) || 0
            };
            var actuals = { revenue: revenue, leads: newLeads, proposals: proposals, wins: wins, conversion: conversion };
            Object.keys(actuals).forEach(function (key) {
                var actualNode = root.querySelector('[data-performance-actual="' + key + '"]');
                var targetNode = root.querySelector('[data-performance-target="' + key + '"]');
                var bar = root.querySelector('[data-performance-bar="' + key + '"]');
                var formatted = key === "revenue" ? formatMetricCurrency(actuals[key]) :
                    key === "conversion" ? actuals[key].toFixed(1) + "%" : String(actuals[key]);
                if (actualNode) actualNode.textContent = formatted;
                if (targetNode) {
                    targetNode.textContent = targets[key] > 0
                        ? "Target: " + (key === "revenue" ? formatMetricCurrency(targets[key]) :
                            key === "conversion" ? targets[key].toFixed(1) + "%" : String(targets[key]))
                        : "Target not set";
                }
                if (bar) {
                    var progress = targets[key] > 0 ? Math.max(0, Math.min(100, actuals[key] / targets[key] * 100)) : 0;
                    bar.style.width = progress + "%";
                    bar.setAttribute("aria-label", targets[key] > 0 ? Math.round(progress) + "% of target" : "Target not set");
                }
            });
            setStatus(status, "Figures for " + bounds.startDate + " to " + bounds.endDate + " loaded from current records.", "success");
        } catch (error) {
            setStatus(status, "Unable to load the scorecard: " + (error.message || "request failed"), "error");
        }
    }

    async function loadGovernance(root) {
        var status = root.querySelector("[data-governance-status]");
        var auditStatus = root.querySelector("[data-audit-status]");
        setStatus(status, "Checking scheduled jobs…", "");
        setStatus(auditStatus, "Loading audit records…", "");
        var results = await Promise.allSettled([
            request("/rest/v1/rpc/get_swayphics_automation_status", { method: "POST", body: {} }),
            getRows("admin_settings_audit_log", {
                select: "id,actor_id,setting_area,changed_fields,created_at",
                order: "created_at.desc",
                limit: "30"
            }),
            getRows("admin_users", {
                select: "user_id,full_name,email,role,active",
                limit: "100"
            })
        ]);
        var jobs = results[0].status === "fulfilled" && Array.isArray(results[0].value) ? results[0].value : null;
        if (jobs) {
            renderSimpleTable(root.querySelector("[data-governance-automation]"), [
                { label: "Automation", value: function (row) { return row.job_name; } },
                { label: "Schedule", value: function (row) { return row.schedule; } },
                { label: "Active", value: function (row) { return row.active ? "Yes" : "No"; } },
                { label: "Last run (SAST)", value: function (row) {
                    return row.last_run ? new Date(row.last_run).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" }) : "Not run yet";
                } },
                { label: "Last result", value: function (row) {
                    return row.last_status ? row.last_status + (row.last_message ? " · " + row.last_message : "") : "No run recorded";
                } }
            ], jobs, "No allowlisted automation jobs were found.");
            setStatus(status, jobs.length + " scheduled jobs inspected.", "success");
        } else {
            renderSimpleTable(root.querySelector("[data-governance-automation]"), [], [], "Automation status unavailable. Confirm the dashboard migration was applied.");
            setStatus(status, results[0].reason && results[0].reason.message ? results[0].reason.message : "Unable to inspect automation jobs.", "error");
        }

        var auditRows = results[1].status === "fulfilled" ? results[1].value : null;
        var admins = results[2].status === "fulfilled" ? results[2].value : [];
        if (auditRows) {
            var byId = Object.create(null);
            admins.forEach(function (admin) {
                byId[admin.user_id] = admin.full_name || admin.email || admin.user_id;
            });
            renderSimpleTable(root.querySelector("[data-governance-audit]"), [
                { label: "Changed at (SAST)", value: function (row) {
                    return row.created_at ? new Date(row.created_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" }) : "";
                } },
                { label: "Changed by", value: function (row) {
                    return row.actor_id ? (byId[row.actor_id] || row.actor_id.slice(0, 8)) : "System / migration";
                } },
                { label: "Settings area", value: function (row) { return row.setting_area; } },
                { label: "Fields changed", value: function (row) {
                    return Array.isArray(row.changed_fields) ? row.changed_fields.join(", ") : "";
                } }
            ], auditRows, "No settings changes have been recorded yet.");
            setStatus(auditStatus, auditRows.length + " audit records loaded.", "success");
        } else {
            renderSimpleTable(root.querySelector("[data-governance-audit]"), [], [], "Settings audit history unavailable.");
            setStatus(auditStatus, results[1].reason && results[1].reason.message ? results[1].reason.message : "Unable to load audit history.", "error");
        }
    }

    function loadAccount(root, identity) {
        var email = root.querySelector("[data-account-email]");
        var role = root.querySelector("[data-account-role]");
        var status = root.querySelector("[data-account-status]");
        if (email) email.textContent = identity.email || "No email returned";
        if (role) role.textContent = identity.admin.role || "Administrator";
        if (status) status.textContent = identity.admin.active === false ? "Inactive" : "Active session";
    }

    async function loadAll(root) {
        var globalStatus = root.querySelector("[data-settings-global-status]");
        try {
            var identity = await getIdentity();
            root.querySelectorAll("button[type='submit']").forEach(function (button) { button.disabled = false; });
            loadAccount(root, identity);
            ownerGatedControls(root);

            var results = await Promise.allSettled([
                loadWorkflow(root),
                loadBusiness(root),
                loadNotifications(root, identity.user.id),
                loadPreferences(root, identity.user.id),
                loadTemplates(root),
                loadGovernance(root)
            ]);
            await loadPerformance(root);
            var errors = results.filter(function (result) { return result.status === "rejected"; });
            if (errors.length) {
                var details = errors.map(function (result) {
                    return result.reason && result.reason.message ? result.reason.message : "A settings section could not load.";
                });
                setStatus(globalStatus, details.join(" "), "error");
            } else {
                setStatus(globalStatus, "Settings loaded. Business-wide controls are " +
                    (isOwner ? "editable by this owner account." : "read-only for this administrator.") , "success");
            }
            bindOwnerNotices(root);
        } catch (error) {
            setStatus(globalStatus, error.message || "Unable to verify administrator access.", "error");
            root.querySelectorAll("button[type='submit']").forEach(function (button) { button.disabled = true; });
        }
    }

    function bindOwnerNotices(root) {
        root.querySelectorAll("[data-owner-only]").forEach(function (control) {
            if (isOwner) {
                control.disabled = false;
                control.removeAttribute("title");
            } else {
                control.disabled = true;
                control.title = "Only the Swayphics owner can change this business-wide setting.";
            }
        });
    }

    function bindForm(root, key, handler) {
        var form = root.querySelector('[data-settings-form="' + key + '"]');
        if (!form || form.dataset.sweBound === "true") return;
        form.dataset.sweBound = "true";
        form.addEventListener("submit", async function (event) {
            event.preventDefault();
            var submit = form.querySelector('button[type="submit"]');
            if (submit) submit.disabled = true;
            setStatus(formStatus(form), "Saving changes…", "");
            try {
                await handler(form);
                setStatus(formStatus(form), "Saved successfully.", "success");
            } catch (error) {
                setStatus(formStatus(form), error.message || "Unable to save changes.", "error");
            } finally {
                if (submit) submit.disabled = !isOwner && submit.hasAttribute("data-owner-only");
            }
        });
    }

    function bindForms(root, identity) {
        bindForm(root, "sales", async function (form) {
            if (!isOwner) throw new Error("Only the Swayphics owner can change workflow timing.");
            function wholeNumber(name, min, max, label) {
                var value = Number(form.querySelector('[name="' + name + '"]').value);
                if (!Number.isInteger(value) || value < min || value > max) {
                    throw new Error(label + " must be a whole number from " + min + " to " + max + ".");
                }
                return value;
            }
            var days = wholeNumber("lead_no_response_days", 1, 365, "Fallback interval");
            var responseHours = wholeNumber("new_lead_response_hours", 1, 720, "New lead response target");
            var maxAttempts = wholeNumber("max_followup_attempts", 1, 20, "Maximum follow-up attempts");
            function optionalStageInterval(name, label) {
                var raw = String(form.querySelector('[name="' + name + '"]').value || "").trim();
                if (!raw) return null;
                return wholeNumber(name, 1, 365, label);
            }
            var stageDays = {};
            [
                ["contacted", "stage_days_contacted", "Contacted interval"],
                ["interested", "stage_days_interested", "Interested interval"],
                ["proposal sent", "stage_days_proposal_sent", "Proposal-sent interval"],
                ["negotiating", "stage_days_negotiating", "Negotiating interval"],
                ["follow-up", "stage_days_follow_up", "Follow-up interval"]
            ].forEach(function (entry) {
                var value = optionalStageInterval(entry[1], entry[2]);
                if (value !== null) stageDays[entry[0]] = value;
            });
            await updateRow("workflow_settings", "id=eq.1", {
                lead_no_response_days: days,
                new_lead_response_hours: responseHours,
                followup_stage_days: stageDays,
                max_followup_attempts: maxAttempts,
                updated_at: new Date().toISOString()
            });
            await loadWorkflow(root);
            await loadPerformance(root);
        });

        bindForm(root, "performance", async function (form) {
            if (!isOwner) throw new Error("Only the Swayphics owner can change business targets.");
            function countValue(name, label) {
                var value = Number(form.querySelector('[name="' + name + '"]').value);
                if (!Number.isInteger(value) || value < 0 || value > 1000000) {
                    throw new Error(label + " must be a whole number from 0 to 1,000,000.");
                }
                return value;
            }
            var revenue = Number(form.querySelector('[name="monthly_revenue_target"]').value);
            var conversion = Number(form.querySelector('[name="target_conversion_rate"]').value);
            if (!Number.isFinite(revenue) || revenue < 0 || revenue > 1000000000) {
                throw new Error("Monthly revenue target must be between R0 and R1,000,000,000.");
            }
            if (!Number.isFinite(conversion) || conversion < 0 || conversion > 100) {
                throw new Error("Conversion target must be between 0% and 100%.");
            }
            await updateRow("workflow_settings", "id=eq.1", {
                monthly_revenue_target: revenue,
                monthly_new_leads_target: countValue("monthly_new_leads_target", "New leads target"),
                monthly_proposals_target: countValue("monthly_proposals_target", "Proposals target"),
                monthly_wins_target: countValue("monthly_wins_target", "Wins target"),
                target_conversion_rate: conversion,
                updated_at: new Date().toISOString()
            });
            await loadPerformance(root);
        });

        bindForm(root, "commercial", async function (form) {
            if (!isOwner) throw new Error("Only the Swayphics owner can change commercial defaults.");
            var quoteDays = Number(form.querySelector('[name="quote_validity_days"]').value);
            var paymentDays = Number(form.querySelector('[name="invoice_payment_terms_days"]').value);
            if (!Number.isInteger(quoteDays) || quoteDays < 1 || quoteDays > 365) {
                throw new Error("Quote validity must be a whole number from 1 to 365 days.");
            }
            if (!Number.isInteger(paymentDays) || paymentDays < 0 || paymentDays > 365) {
                throw new Error("Invoice payment terms must be a whole number from 0 to 365 days.");
            }
            await updateRow("workflow_settings", "id=eq.1", {
                quote_validity_days: quoteDays,
                invoice_payment_terms_days: paymentDays,
                updated_at: new Date().toISOString()
            });
        });

        bindForm(root, "business", async function (form) {
            if (!isOwner) throw new Error("Only the Swayphics owner can change invoice identity.");
            var values = formValues(form, [
                "business_name", "slogan", "email", "phone", "website", "address",
                "bank_name", "account_name", "account_number", "account_type",
                "branch_code", "swift_bic", "payment_instructions", "vat_registered", "vat_number"
            ]);
            values.business_name = String(values.business_name || "").trim();
            values.vat_number = String(values.vat_number || "").trim();
            if (!values.business_name) throw new Error("Business name is required.");
            if (values.vat_registered && !values.vat_number) throw new Error("Enter a VAT number or turn off VAT registration.");
            values.updated_at = new Date().toISOString();
            await updateRow("invoice_settings", "id=eq.1", values);
        });

        bindForm(root, "notifications", async function (form) {
            var values = formValues(form, Object.keys(DEFAULT_NOTIFICATIONS));
            values.user_id = identity.user.id;
            values.updated_at = new Date().toISOString();
            await upsert("admin_notification_preferences", values, "user_id");
        });

        bindForm(root, "templates", async function (form) {
            if (!isOwner) throw new Error("Only the Swayphics owner can edit shared communication templates.");
            var key = form.querySelector('[name="template_key"]').value;
            var item = cachedTemplates.find(function (entry) { return entry.template_key === key; });
            if (!item) throw new Error("Choose an available template before saving.");
            var subject = form.querySelector('[name="subject"]').value;
            var body = form.querySelector('[name="body"]').value;
            if (!String(body).trim()) throw new Error("Message body cannot be blank.");
            var saved = await upsert("communication_templates", {
                template_key: key,
                name: item.name,
                subject: subject,
                body: body,
                enabled: item.enabled !== false,
                updated_by: identity.user.id,
                updated_at: new Date().toISOString()
            }, "template_key");
            cachedTemplates = await getRows("communication_templates", {
                select: "id,template_key,name,subject,body,enabled,updated_at",
                order: "name.asc"
            });
            templateOptions(root);
            var selector = form.querySelector('[name="template_key"]');
            selector.value = key;
            loadSelectedTemplate(root);
        });

        bindForm(root, "preferences", async function (form) {
            var values = formValues(form, Object.keys(DEFAULT_PREFERENCES));
            values.user_id = identity.user.id;
            values.updated_at = new Date().toISOString();
            await upsert("admin_dashboard_preferences", values, "user_id");
            applyDashboardPreferences(values);
        });

        bindForm(root, "website", async function (form) {
            if (!isOwner) throw new Error("Only the Swayphics owner can change the review destination.");
            var link = String(form.querySelector('[name="review_link"]').value || "").trim();
            var parsed;
            try { parsed = new URL(link); } catch (error) { throw new Error("Enter a valid review URL."); }
            if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Review links must use HTTP or HTTPS.");
            await updateRow("workflow_settings", "id=eq.1", {
                review_link: link,
                updated_at: new Date().toISOString()
            });
        });

        var templateSelect = root.querySelector('[data-settings-form="templates"] [name="template_key"]');
        if (templateSelect) templateSelect.addEventListener("change", function () { loadSelectedTemplate(root); });
        ["subject", "body"].forEach(function (name) {
            var input = root.querySelector('[data-settings-form="templates"] [name="' + name + '"]');
            if (input) input.addEventListener("input", function () { renderTemplatePreview(root); });
        });
    }

    async function sendPasswordReset(root) {
        var identity = await getIdentity();
        if (!identity.email) throw new Error("No email address is associated with this admin account.");
        var response = await fetch(SUPABASE_URL + "/auth/v1/recover", {
            method: "POST",
            headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({ email: identity.email })
        });
        var raw = await response.text();
        if (!response.ok) {
            var payload = {};
            try { payload = JSON.parse(raw); } catch (error) {}
            throw new Error(payload.message || "Password reset request failed.");
        }
        setStatus(root.querySelector("[data-security-status]"),
            "If the account is eligible, Supabase Auth will send password-reset instructions to " + identity.email + ".", "success");
    }

    async function signOut(root) {
        setStatus(root.querySelector("[data-security-status]"), "Signing out…", "");
        try {
            await request("/auth/v1/logout", { method: "POST", body: null });
        } catch (error) {
            // Clear the local session even if the server session has already expired.
        }
        try {
            localStorage.removeItem(ACCESS_KEY);
            localStorage.removeItem(REFRESH_KEY);
            localStorage.removeItem(LOCAL_PREFS_KEY);
            sessionStorage.removeItem("swayphics_admin_welcome_pending");
            sessionStorage.removeItem("swayphics_admin_welcome_seen_user");
        } catch (error) {}
        window.location.replace("/admin/");
    }

    async function runInnerMeHealth(root) {
        var status = root.querySelector("[data-innerme-settings-status]");
        var health = root.querySelector("[data-innerme-settings-health]");
        var summary = root.querySelector("[data-innerme-health-summary]");
        var button = document.querySelector("[data-innerme-health-run]");
        if (button) {
            button.click();
            if (health) health.textContent = "Health check requested";
            setStatus(status, "Triggered the existing InnerMe workspace health check. Review its detailed output in the InnerMe health panel.", "success");
            window.setTimeout(function () {
                var sourceStatus = document.querySelector("[data-innerme-health-status]");
                var results = document.querySelector("[data-innerme-health-results]");
                if (sourceStatus && health) health.textContent = sourceStatus.textContent || "Check completed";
                if (results && summary) {
                    summary.textContent = String(results.textContent || "Results are available in the health panel.")
                        .replace(/\s+/g, " ").trim().slice(0, 240);
                }
            }, 600);
            return;
        }

        var nav = findNavButton("innerme");
        if (nav) {
            nav.click();
            setStatus(status, "Opening the InnerMe workspace. Run its health check there, then return to Settings for the summary.", "success");
            window.setTimeout(function () {
                var healthButton = document.querySelector("[data-innerme-health-run]");
                if (healthButton) {
                    healthButton.click();
                    if (health) health.textContent = "Health check requested";
                } else if (status) {
                    setStatus(status, "The InnerMe workspace opened, but its health control was not found. Use the health panel in that workspace.", "error");
                }
            }, 650);
            return;
        }
        setStatus(status, "The InnerMe health panel is not mounted yet. Open the InnerMe workspace, then return here to run the check.", "error");
    }

    function bindActions(root) {
        root.querySelectorAll("[data-settings-tab]").forEach(function (tab) {
            tab.addEventListener("click", function () {
                selectTab(root, tab.getAttribute("data-settings-tab"));
            });
            tab.addEventListener("keydown", function (event) {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                event.preventDefault();
                var tabs = Array.from(root.querySelectorAll("[data-settings-tab]"));
                var index = tabs.indexOf(tab);
                var delta = event.key === "ArrowRight" ? 1 : -1;
                var next = tabs[(index + delta + tabs.length) % tabs.length];
                selectTab(root, next.getAttribute("data-settings-tab"));
                next.focus();
            });
        });

        var resetButton = root.querySelector('[data-action="password-reset"]');
        if (resetButton) resetButton.addEventListener("click", async function () {
            resetButton.disabled = true;
            try { await sendPasswordReset(root); }
            catch (error) { setStatus(root.querySelector("[data-security-status]"), error.message, "error"); }
            finally { resetButton.disabled = false; }
        });

        var logoutButton = root.querySelector('[data-action="sign-out"]');
        if (logoutButton) logoutButton.addEventListener("click", function () {
            if (window.confirm("Sign out of the Swayphics admin dashboard?")) signOut(root);
        });

        var copyButton = root.querySelector('[data-action="copy-template"]');
        if (copyButton) copyButton.addEventListener("click", async function () {
            var form = root.querySelector('[data-settings-form="templates"]');
            var subject = form.querySelector('[name="subject"]').value || "";
            var body = form.querySelector('[name="body"]').value || "";
            var content = (subject ? subject + "\n\n" : "") + body;
            try {
                await navigator.clipboard.writeText(content);
                setStatus(formStatus(form), "Copied template text, including placeholders, to the clipboard.", "success");
            } catch (error) {
                setStatus(formStatus(form), "Clipboard access was blocked by the browser. Select the subject and body, then copy manually.", "error");
            }
        });

        var healthButton = root.querySelector('[data-action="run-innerme-health"]');
        if (healthButton) healthButton.addEventListener("click", function () {
            runInnerMeHealth(root);
        });

        var governanceButton = root.querySelector('[data-action="refresh-governance"]');
        if (governanceButton) governanceButton.addEventListener("click", function () {
            governanceButton.disabled = true;
            loadGovernance(root).finally(function () { governanceButton.disabled = false; });
        });

        var performanceButton = root.querySelector('[data-action="refresh-performance"]');
        if (performanceButton) performanceButton.addEventListener("click", function () {
            performanceButton.disabled = true;
            loadPerformance(root).finally(function () { performanceButton.disabled = false; });
        });
    }

    function normalizeSettingsSidebar() {
        var workspace = document.getElementById("sway-admin-workspace");
        if (!workspace) return;

        var group = workspace.querySelector('[data-nav-group="settings"]');
        if (!group) return;

        var button = group.querySelector('[data-view="settings"]');
        if (!button) return;

        var label = button.querySelector("span");
        if (label) label.textContent = "Settings";
        else button.textContent = "Settings";

        button.classList.add("sway-settings-direct-nav");
        button.setAttribute("aria-label", "Settings");
        group.parentNode.insertBefore(button, group);
        group.remove();
    }

    function mount() {
        normalizeSettingsSidebar();

        var greetingForm = document.getElementById("sway-admin-greeting-form");
        if (!greetingForm || document.getElementById(ROOT_ID)) return;

        var greetingPanel = greetingForm.closest(".sway-panel");
        var root = document.createElement("div");
        root.innerHTML = buildMarkup();
        root = root.firstElementChild;
        if (!root) return;

        if (greetingPanel && greetingPanel.parentElement) {
            greetingPanel.insertAdjacentElement("afterend", root);
            greetingPanel.classList.add("swe-greeting-settings-panel");
            var preferencesPanel = root.querySelector('[data-settings-panel="preferences"]');
            if (preferencesPanel) {
                preferencesPanel.insertBefore(greetingPanel, preferencesPanel.firstElementChild);
            }
        } else {
            greetingForm.insertAdjacentElement("afterend", root);
        }

        var headingDescription = document.querySelector(
            "#sway-admin-workspace .sway-workspace-heading-copy p"
        );
        if (headingDescription) {
            headingDescription.textContent =
                "Manage sales rules, performance targets, commercial defaults, notifications and operational governance.";
        }

        root.querySelectorAll("button[type='submit']").forEach(function (button) { button.disabled = true; });

        selectTab(root, "sales");
        getIdentity().then(function (identity) {
            bindForms(root, identity);
            bindActions(root);
            loadAll(root);
        }).catch(function (error) {
            setStatus(root.querySelector("[data-settings-global-status]"), error.message || "Administrator access could not be verified.", "error");
            root.querySelectorAll("button[type='submit']").forEach(function (button) { button.disabled = true; });
            bindActions(root);
        });
    }

    async function bootSavedPreferences() {
        try {
            var identity = await getIdentity();
            var rows = await getRows("admin_dashboard_preferences", {
                select: "*", user_id: "eq." + identity.user.id, limit: "1"
            });
            if (!rows[0]) return;
            applyDashboardPreferences(rows[0]);
            if (document.readyState === "complete" && rows[0].default_landing_view !== "current") {
                applyPreferredLandingView(rows[0].default_landing_view);
            } else if (rows[0].default_landing_view !== "current") {
                window.addEventListener("load", function () {
                    applyPreferredLandingView(rows[0].default_landing_view);
                }, { once: true });
            }
        } catch (error) {
            // Settings are optional at initial dashboard boot; errors are shown inside Settings itself.
        }
    }

    function start() {
        if (!document.body) return;
        var observer = new MutationObserver(function () { mount(); });
        observer.observe(document.body, { childList: true, subtree: true });
        mount();
        bootSavedPreferences();
        window.setTimeout(mount, 400);
        window.setTimeout(mount, 1400);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }
})();