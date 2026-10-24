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
        ["business", "Business & invoices"],
        ["notifications", "Notifications"],
        ["templates", "Communication templates"],
        ["security", "Account & security"],
        ["preferences", "Dashboard preferences"],
        ["website", "Website & reputation"],
        ["innerme", "InnerMe operations"]
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
            field("lead_no_response_days", "Days before follow-up is due", "number",
                "The existing lead follow-up clock reads this value.", 'min="1" max="365" step="1" required') +
            '<div class="swe-notice swe-wide"><strong>Current workflow:</strong> this changes the existing follow-up interval. It does not send messages automatically.</div>';

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
            '<div class="swe-panels">' + salesPanel + businessPanel + notificationsPanel +
            templatesPanel + securityPanel + preferencesPanel + websitePanel + innermePanel + '</div>' +
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
        var rows = await getRows("workflow_settings", { select: "id,lead_no_response_days,review_link,updated_at", id: "eq.1", limit: "1" });
        var row = rows[0];
        if (!row) throw new Error("The workflow_settings row is missing. Apply the existing business-flow SQL before using these controls.");
        setFormValues(root.querySelector('[data-settings-form="sales"]'), row);
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
                loadTemplates(root)
            ]);
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
            var days = Number(form.querySelector('[name="lead_no_response_days"]').value);
            if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("Enter a whole number from 1 to 365.");
            await updateRow("workflow_settings", "id=eq.1", {
                lead_no_response_days: days,
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
    }

    function mount() {
        var greetingForm = document.getElementById("sway-admin-greeting-form");
        if (!greetingForm || document.getElementById(ROOT_ID)) return;

        var anchor = greetingForm;
        if (greetingForm.parentElement) anchor = greetingForm.parentElement;
        var root = document.createElement("div");
        root.innerHTML = buildMarkup();
        root = root.firstElementChild;
        if (!root) return;
        anchor.insertAdjacentElement("afterend", root);
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