
(function () {
    "use strict";

    const SUPABASE_URL = "https://sqifhribgsqfaxgtobsa.supabase.co";
    const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QhB";

    const workspace = document.getElementById("sway-admin-workspace");
    if (!workspace) return;

    const state = {
        currentView: "overview",
        currentUser: null,
        currentAdmin: null,
        admins: [],
        tasks: [],
        leads: [],
        followups: [],
        clients: [],
        projects: [],
        quotes: [],
        payments: [],
        enquiries: [],
        activities: [],
        announcements: [],
        services: [],
        invoices: [],
        invoiceSettings: null,
        realtimeStatus: "connecting",
        lastLiveUpdate: null,
        realtimeClient: null
    };

    const nav = [
        ["overview", "Overview"],
        ["insights", "Insights"],
        ["tasks", "Tasks"],
        ["leads", "Leads"],
        ["followups", "Follow-ups"],
        ["clients", "Clients"],
        ["projects", "Projects"],
        ["quotes", "Quotes"],
        ["payments", "Payments"],
        ["invoices", "Invoices"],
        ["services", "Services"],
        ["invoice-settings", "Invoice settings"],
        ["enquiries", "Enquiries"],
        ["content", "Website content"],
        ["activity", "Activity"],
        ["team", "Team"],
        ["portfolio", "Portfolio"],
        ["testimonials", "Testimonials"]
    ];

    function token() {
        return localStorage.getItem("swayphics_admin_access_token");
    }

    function headers(extra) {
        return Object.assign({
            "apikey": SUPABASE_PUBLISHABLE_KEY,
            "Authorization": "Bearer " + token(),
            "Content-Type": "application/json"
        }, extra || {});
    }

    async function api(path, options) {
        const response = await fetch(
            SUPABASE_URL + path,
            Object.assign(
                {
                    method: "GET",
                    headers: headers()
                },
                options || {}
            )
        );

        const responseText = await response.text();
        let data = null;

        try {
            data = responseText ? JSON.parse(responseText) : null;
        } catch (error) {
            data = responseText;
        }

        if (!response.ok) {
            const message =
                data && data.message
                    ? data.message
                    : responseText || "Request failed.";

            throw new Error(
                "Supabase returned " +
                response.status +
                ": " +
                message
            );
        }

        return data;
    }

    function esc(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function money(value) {
        return new Intl.NumberFormat("en-ZA", {
            style: "currency",
            currency: "ZAR",
            maximumFractionDigits: 0
        }).format(Number(value || 0));
    }

    const SOUTH_AFRICA_TIME_ZONE =
        "Africa/Johannesburg";

    function parseDashboardDate(value) {
        if (!value) return null;

        const raw = String(value);

        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            const parsed = new Date(
                raw + "T00:00:00+02:00"
            );

            return Number.isNaN(parsed.getTime())
                ? null
                : parsed;
        }

        const parsed = new Date(raw);

        return Number.isNaN(parsed.getTime())
            ? null
            : parsed;
    }

    function dashboardNow() {
        return new Date(
            new Date().toLocaleString(
                "en-US",
                {
                    timeZone:
                        SOUTH_AFRICA_TIME_ZONE
                }
            )
        );
    }

    function dashboardTodayISO() {
        return new Intl.DateTimeFormat(
            "en-CA",
            {
                timeZone:
                    SOUTH_AFRICA_TIME_ZONE,
                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            }
        ).format(new Date());
    }

    function dashboardMonthKey(value) {
        const parsed =
            parseDashboardDate(value);

        if (!parsed) return null;

        return parsed.toLocaleDateString(
            "en-CA",
            {
                timeZone:
                    SOUTH_AFRICA_TIME_ZONE,
                year: "numeric",
                month: "2-digit"
            }
        );
    }

    function dashboardHourKey(value) {
        const parsed =
            parseDashboardDate(value);

        if (!parsed) return null;

        const parts =
            new Intl.DateTimeFormat(
                "en-CA",
                {
                    timeZone:
                        SOUTH_AFRICA_TIME_ZONE,
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    hourCycle: "h23"
                }
            ).formatToParts(parsed);

        const map = {};

        parts.forEach(function (part) {
            if (part.type !== "literal") {
                map[part.type] = part.value;
            }
        });

        return (
            map.year +
            "-" +
            map.month +
            "-" +
            map.day +
            "-" +
            map.hour
        );
    }

    function date(value) {
        if (!value) return "—";

        const parsed =
            parseDashboardDate(value);

        if (!parsed) {
            return String(value);
        }

        return parsed.toLocaleDateString(
            "en-ZA",
            {
                timeZone:
                    SOUTH_AFRICA_TIME_ZONE,
                day: "2-digit",
                month: "short",
                year: "numeric"
            }
        );
    }

    function dateInput(value) {
        return value ? String(value).slice(0, 10) : "";
    }

    function adminName(id) {
        const admin = state.admins.find(function (item) {
            return item.user_id === id;
        });

        return admin
            ? admin.full_name || admin.email || admin.user_id
            : "Unassigned";
    }

    function clientName(id) {
        const client = state.clients.find(function (item) {
            return item.id === id;
        });

        return client
            ? client.business_name
            : "No client";
    }

    function projectName(id) {
        const project = state.projects.find(function (item) {
            return item.id === id;
        });

        return project
            ? project.name
            : "No project";
    }

    function leadName(id) {
        const lead = state.leads.find(function (item) {
            return item.id === id;
        });

        return lead
            ? lead.business_name
            : "No lead";
    }

    function chip(value) {
        const text = String(value || "—");
        const lower = text.toLowerCase();

        let className = "neutral";

        if (
            [
                "completed",
                "won",
                "paid",
                "approved",
                "published",
                "active"
            ].includes(lower)
        ) {
            className = "success";
        }

        if (
            [
                "high",
                "urgent",
                "overdue",
                "rejected",
                "lost",
                "cancelled"
            ].includes(lower)
        ) {
            className = "danger";
        }

        if (
            [
                "in progress",
                "review",
                "proposal sent",
                "pending",
                "new",
                "sent",
                "draft",
                "invoice sent",
                "partially paid",
                "interested"
            ].includes(lower)
        ) {
            className = "warning";
        }

        return (
            '<span class="sway-chip ' +
            className +
            '">' +
            esc(text.replace(/_/g, " ")) +
            "</span>"
        );
    }

    function dashboardDateKey(value) {
        const parsed =
            parseDashboardDate(value);

        if (!parsed) return null;

        return parsed.toLocaleDateString(
            "en-CA",
            {
                timeZone:
                    SOUTH_AFRICA_TIME_ZONE,
                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            }
        );
    }

    function isOverdue(value) {
        if (!value) return false;

        const today =
            dashboardTodayISO();

        const due =
            dashboardDateKey(value);

        return Boolean(
            due &&
            due < today
        );
    }

    function currentUserName() {
        return (
            state.currentAdmin &&
            (
                state.currentAdmin.full_name ||
                state.currentAdmin.email
            )
        ) || "there";
    }

    async function loadState() {
        const currentUserResponse = await api(
            "/auth/v1/user",
            {
                method: "GET"
            }
        );

        state.currentUser = currentUserResponse;

        const admins = await api(
            "/rest/v1/admin_users?select=user_id,full_name,email,role,active,created_at&order=created_at.asc"
        );

        state.admins = Array.isArray(admins)
            ? admins
            : [];

        state.currentAdmin = state.admins.find(function (item) {
            return (
                item.user_id === state.currentUser.id &&
                item.active === true
            );
        });

        if (!state.currentAdmin) {
            throw new Error(
                "Your account is authenticated, but it is not active in the Swayphics admin team."
            );
        }

        const results = await Promise.all([
            api("/rest/v1/tasks?select=*&order=created_at.desc"),
            api("/rest/v1/leads?select=*&order=created_at.desc"),
            api("/rest/v1/follow_ups?select=*&order=scheduled_for.asc"),
            api("/rest/v1/clients?select=*&order=created_at.desc"),
            api("/rest/v1/client_projects?select=*&order=created_at.desc"),
            api("/rest/v1/quotes?select=*&order=created_at.desc"),
            api("/rest/v1/payments?select=*&order=created_at.desc"),
            api("/rest/v1/website_enquiries?select=*&order=created_at.desc"),
            api("/rest/v1/activity_log?select=*&order=created_at.desc&limit=50"),
            api("/rest/v1/site_announcements?select=*&order=created_at.desc"),
            api("/rest/v1/services?select=*&order=active.desc,name.asc"),
            api("/rest/v1/invoices?select=*&order=created_at.desc"),
            api("/rest/v1/invoice_settings?select=*&id=eq.1")
        ]);

        state.tasks = results[0] || [];
        state.leads = results[1] || [];
        state.followups = results[2] || [];
        state.clients = results[3] || [];
        state.projects = results[4] || [];
        state.quotes = results[5] || [];
        state.payments = results[6] || [];
        state.enquiries = results[7] || [];
        state.activities = results[8] || [];
        state.announcements = results[9] || [];
        state.services = results[10] || [];
        state.invoices = results[11] || [];
        state.invoiceSettings =
            Array.isArray(results[12]) &&
            results[12][0]
                ? results[12][0]
                : null;
    }

    async function refreshData() {
        const results = await Promise.all([
            api("/rest/v1/admin_users?select=user_id,full_name,email,role,active,created_at&order=created_at.asc"),
            api("/rest/v1/tasks?select=*&order=created_at.desc"),
            api("/rest/v1/leads?select=*&order=created_at.desc"),
            api("/rest/v1/follow_ups?select=*&order=scheduled_for.asc"),
            api("/rest/v1/clients?select=*&order=created_at.desc"),
            api("/rest/v1/client_projects?select=*&order=created_at.desc"),
            api("/rest/v1/quotes?select=*&order=created_at.desc"),
            api("/rest/v1/payments?select=*&order=created_at.desc"),
            api("/rest/v1/website_enquiries?select=*&order=created_at.desc"),
            api("/rest/v1/activity_log?select=*&order=created_at.desc&limit=50"),
            api("/rest/v1/site_announcements?select=*&order=created_at.desc"),
            api("/rest/v1/services?select=*&order=active.desc,name.asc"),
            api("/rest/v1/invoices?select=*&order=created_at.desc"),
            api("/rest/v1/invoice_settings?select=*&id=eq.1")
        ]);

        state.admins = results[0] || [];
        state.tasks = results[1] || [];
        state.leads = results[2] || [];
        state.followups = results[3] || [];
        state.clients = results[4] || [];
        state.projects = results[5] || [];
        state.quotes = results[6] || [];
        state.payments = results[7] || [];
        state.enquiries = results[8] || [];
        state.activities = results[9] || [];
        state.announcements = results[10] || [];
        state.services = results[11] || [];
        state.invoices = results[12] || [];
        state.invoiceSettings =
            Array.isArray(results[13]) &&
            results[13][0]
                ? results[13][0]
                : null;

        state.currentAdmin =
            state.admins.find(function (item) {
                return (
                    item.user_id === state.currentUser.id &&
                    item.active === true
                );
            }) || state.currentAdmin;
    }

    function viewMeta(view) {
        const meta = {
            overview: [
                "Overview",
                "Your operational picture at a glance."
            ],
            insights: [
                "Insights",
                "Live financial, sales and delivery intelligence."
            ],
            tasks: [
                "Tasks",
                "Assignments, deadlines and delivery status."
            ],
            leads: [
                "Leads",
                "Track prospects from first contact to conversion."
            ],
            followups: [
                "Follow-ups",
                "Keep every promising conversation moving."
            ],
            clients: [
                "Clients",
                "A shared record for every Swayphics relationship."
            ],
            projects: [
                "Projects",
                "Plan, build, review and close client work."
            ],
            quotes: [
                "Quotes",
                "Track proposals and expected revenue."
            ],
            payments: [
                "Payments",
                "Track what is paid, due and outstanding."
            ],
            invoices: [
                "Invoices",
                "Create, send and track branded Swayphics invoices."
            ],
            services: [
                "Services",
                "Control the services and prices used on invoices."
            ],
            "invoice-settings": [
                "Invoice settings",
                "Control the business and payment details shown on invoices."
            ],
            enquiries: [
                "Website enquiries",
                "Move website submissions into the sales pipeline."
            ],
            content: [
                "Website content",
                "Manage reusable website announcements."
            ],
            activity: [
                "Activity",
                "See the shared operational history."
            ],
            team: [
                "Team",
                "Manage who can use the Swayphics workspace."
            ],
            portfolio: [
                "Portfolio",
                "Manage public Swayphics portfolio work."
            ],
            testimonials: [
                "Testimonials",
                "Review client feedback connected to the website."
            ]
        };

        return meta[view] || meta.overview;
    }

    function navButton(item) {
        const view = item[0];
        let count = "";

        if (view === "tasks") {
            count = state.tasks.filter(function (item) {
                return (
                    item.status !== "completed" &&
                    item.assigned_to === state.currentUser.id
                );
            }).length;
        }

        if (view === "leads") {
            count = state.leads.filter(function (item) {
                return !["won", "lost"].includes(item.status);
            }).length;
        }

        if (view === "followups") {
            count = state.followups.filter(function (item) {
                return item.status === "pending";
            }).length;
        }

        if (view === "enquiries") {
            count = state.enquiries.filter(function (item) {
                return item.status === "new";
            }).length;
        }

        return (
            '<button type="button" class="sway-workspace-nav-button ' +
            (state.currentView === view ? "active" : "") +
            '" data-view="' +
            esc(view) +
            '">' +
            '<span>' +
            esc(item[1]) +
            "</span>" +
            (
                count
                    ? '<span class="sway-workspace-count">' +
                      count +
                      "</span>"
                    : ""
            ) +
            "</button>"
        );
    }

    function renderShell() {
        workspace.innerHTML =
            '<div class="sway-workspace-shell">' +
                '<aside class="sway-workspace-sidebar" aria-label="Admin workspace navigation">' +
                    nav.map(navButton).join("") +
                "</aside>" +
                '<div class="sway-workspace-main" id="sway-workspace-main"></div>' +
            "</div>";

        workspace
            .querySelectorAll("[data-view]")
            .forEach(function (button) {
                button.addEventListener("click", function () {
                    const view = button.dataset.view;
                    state.currentView = view;

                    if (view === "portfolio") {
                        const target =
                            document.querySelector(
                                ".portfolio-manager"
                            );

                        if (target) {
                            target.scrollIntoView({
                                behavior: "smooth",
                                block: "start"
                            });
                        }

                        return;
                    }

                    if (view === "testimonials") {
                        const target =
                            document.querySelector(
                                "#testimonials-admin-section"
                            );

                        if (target) {
                            target.scrollIntoView({
                                behavior: "smooth",
                                block: "start"
                            });
                        }

                        return;
                    }

                    renderShell();
                    renderView();
                });
            });
    }

    function heading(extraActions) {
        const meta = viewMeta(state.currentView);

        return (
            '<div class="sway-workspace-heading">' +
                '<div class="sway-workspace-heading-copy">' +
                    '<span class="admin-label">' +
                        esc(meta[0]) +
                    "</span>" +
                    "<h2>" +
                        esc(meta[0]) +
                    "</h2>" +
                    "<p>" +
                        esc(meta[1]) +
                    "</p>" +
                "</div>" +
                '<div class="sway-workspace-heading-actions">' +
                    (extraActions || "") +
                "</div>" +
            "</div>"
        );
    }

    function panel(title, subtitle, content, action) {
        return (
            '<section class="sway-panel">' +
                '<div class="sway-panel-title">' +
                    "<div>" +
                        "<h3>" +
                            esc(title) +
                        "</h3>" +
                        (
                            subtitle
                                ? "<p>" +
                                  esc(subtitle) +
                                  "</p>"
                                : ""
                        ) +
                    "</div>" +
                    (action || "") +
                "</div>" +
                content +
            "</section>"
        );
    }

    function empty(message) {
        return (
            '<div class="sway-table-empty">' +
            esc(message) +
            "</div>"
        );
    }

    function quickButton(label, type, primary) {
        return (
            '<button type="button" class="sway-quick-action" data-quick="' +
            esc(type) +
            '">' +
            esc(label) +
            "</button>"
        );
    }


    function chartMonths() {
        const now =
            dashboardNow();

        const months = [];

        const currentYear =
            now.getFullYear();

        const currentMonth =
            now.getMonth();

        for (let i = 11; i >= 0; i -= 1) {
            const point =
                new Date(
                    currentYear,
                    currentMonth - i,
                    1
                );

            months.push({
                key:
                    point.getFullYear() +
                    "-" +
                    String(
                        point.getMonth() + 1
                    ).padStart(2, "0"),
                label:
                    point.toLocaleDateString(
                        "en-ZA",
                        {
                            timeZone:
                                SOUTH_AFRICA_TIME_ZONE,
                            month: "short"
                        }
                    )
            });
        }

        return months;
    }

    function chartMonthKey(value) {
        return dashboardMonthKey(value);
    }

    function liveBadge() {
        const status = state.realtimeStatus || "connecting";

        return (
            '<span class="sway-live-badge ' +
            esc(status) +
            '">' +
            '<i></i>' +
            (
                status === "live"
                    ? "LIVE"
                    : status === "polling"
                        ? "LIVE SYNC"
                        : "CONNECTING"
            ) +
            "</span>"
        );
    }

    function liveUpdateText() {
        if (!state.lastLiveUpdate) {
            return "Waiting for live updates";
        }

        const seconds = Math.floor(
            Math.max(
                0,
                Date.now() -
                state.lastLiveUpdate
            ) / 1000
        );

        if (seconds < 5) {
            return "Updated just now";
        }

        if (seconds < 60) {
            return "Updated " + seconds + "s ago";
        }

        return "Updated " +
            Math.floor(seconds / 60) +
            "m ago";
    }

    function trendChart(values, labels, color, label, currency) {
        const width = 680;
        const height = 250;
        const left = 44;
        const right = 18;
        const top = 20;
        const bottom = 34;
        const plotWidth = width - left - right;
        const plotHeight = height - top - bottom;

        const maxValue =
            Math.max.apply(
                null,
                values
                    .map(function (value) {
                        return Number(value || 0);
                    })
                    .concat([1])
            ) || 1;

        const points =
            values.map(function (value, index) {
                const x =
                    values.length === 1
                        ? width / 2
                        : left +
                          (
                              index /
                              (values.length - 1)
                          ) *
                          plotWidth;

                const y =
                    top +
                    plotHeight -
                    (
                        Number(value || 0) /
                        maxValue
                    ) *
                    plotHeight;

                return {
                    x: x,
                    y: y
                };
            });

        const pointString =
            points.map(function (point) {
                return (
                    point.x +
                    "," +
                    point.y
                );
            }).join(" ");

        let grid = "";

        for (let i = 0; i <= 4; i += 1) {
            const y =
                top +
                plotHeight -
                (
                    i / 4
                ) *
                plotHeight;

            grid +=
                '<line x1="' +
                left +
                '" y1="' +
                y +
                '" x2="' +
                (width - right) +
                '" y2="' +
                y +
                '" class="sway-chart-grid-line"></line>';
        }

        const circles =
            points.map(function (point) {
                return (
                    '<circle cx="' +
                    point.x +
                    '" cy="' +
                    point.y +
                    '" r="4" fill="' +
                    color +
                    '" class="sway-chart-point"></circle>'
                );
            }).join("");

        const xLabels =
            labels.map(function (item, index) {
                if (
                    labels.length > 7 &&
                    index % 2 !== 0 &&
                    index !== labels.length - 1
                ) {
                    return "";
                }

                return (
                    '<text x="' +
                    points[index].x +
                    '" y="' +
                    (height - 10) +
                    '" text-anchor="middle" class="sway-chart-axis-label">' +
                    esc(item) +
                    "</text>"
                );
            }).join("");

        return (
            '<div class="sway-chart-wrap">' +
                '<svg class="sway-chart" viewBox="0 0 ' +
                    width +
                    " " +
                    height +
                    '" role="img" aria-label="' +
                    esc(label) +
                    '">' +
                    grid +
                    '<polyline points="' +
                        pointString +
                        '" fill="none" stroke="' +
                        color +
                        '" class="sway-chart-line"></polyline>' +
                    circles +
                    xLabels +
                "</svg>" +
            "</div>"
        );
    }

    function barChartSimple(values, labels, color, label, currency) {
        const width = 680;
        const height = 250;
        const left = 44;
        const right = 18;
        const top = 20;
        const bottom = 34;
        const plotWidth = width - left - right;
        const plotHeight = height - top - bottom;
        const maxValue =
            Math.max.apply(
                null,
                values
                    .map(function (value) {
                        return Number(value || 0);
                    })
                    .concat([1])
            ) || 1;

        const groupWidth =
            plotWidth /
            Math.max(1, values.length);

        const bars =
            values.map(function (value, index) {
                const numeric =
                    Number(value || 0);

                const barHeight =
                    (
                        numeric /
                        maxValue
                    ) *
                    plotHeight;

                return (
                    '<rect x="' +
                    (
                        left +
                        index * groupWidth +
                        groupWidth * 0.19
                    ) +
                    '" y="' +
                    (
                        top +
                        plotHeight -
                        barHeight
                    ) +
                    '" width="' +
                    (
                        groupWidth * 0.62
                    ) +
                    '" height="' +
                    Math.max(2, barHeight) +
                    '" rx="5" fill="' +
                    color +
                    '" class="sway-chart-bar"></rect>' +
                    '<text x="' +
                    (
                        left +
                        index * groupWidth +
                        groupWidth / 2
                    ) +
                    '" y="' +
                    (height - 10) +
                    '" text-anchor="middle" class="sway-chart-axis-label">' +
                    esc(labels[index]) +
                    "</text>"
                );
            }).join("");

        let grid = "";

        for (let i = 0; i <= 4; i += 1) {
            const y =
                top +
                plotHeight -
                (
                    i / 4
                ) *
                plotHeight;

            grid +=
                '<line x1="' +
                left +
                '" y1="' +
                y +
                '" x2="' +
                (width - right) +
                '" y2="' +
                y +
                '" class="sway-chart-grid-line"></line>';
        }

        return (
            '<div class="sway-chart-wrap">' +
                '<svg class="sway-chart" viewBox="0 0 ' +
                    width +
                    " " +
                    height +
                    '" role="img" aria-label="' +
                    esc(label) +
                    '">' +
                    grid +
                    bars +
                "</svg>" +
            "</div>"
        );
    }

    function simpleBars(items, color) {
        const max =
            Math.max.apply(
                null,
                items
                    .map(function (item) {
                        return Number(item.value || 0);
                    })
                    .concat([1])
            ) || 1;

        return (
            '<div class="sway-simple-bars">' +
            items.map(function (item) {
                const value =
                    Number(item.value || 0);

                return (
                    '<div class="sway-simple-bar-row">' +
                        '<div class="sway-simple-bar-head">' +
                            "<span>" +
                                esc(item.label) +
                            "</span>" +
                            "<strong>" +
                                (
                                    item.currency
                                        ? esc(money(value))
                                        : value
                                ) +
                            "</strong>" +
                        "</div>" +
                        '<div class="sway-simple-bar-track">' +
                            '<span style="width:' +
                                (
                                    value /
                                    max *
                                    100
                                ) +
                                "%;background:" +
                                color +
                                ';"></span>' +
                        "</div>" +
                    "</div>"
                );
            }).join("") +
            "</div>"
        );
    }

    function insightData() {
        const months = chartMonths();

        return {
            months: months,
            revenue: months.map(function (month) {
                return state.payments
                    .filter(function (payment) {
                        return (
                            payment.status === "paid" &&
                            chartMonthKey(
                                payment.paid_at ||
                                payment.created_at
                            ) === month.key
                        );
                    })
                    .reduce(function (sum, payment) {
                        return sum +
                            Number(payment.amount || 0);
                    }, 0);
            }),

            invoiced: months.map(function (month) {
                return state.invoices
                    .filter(function (invoice) {
                        return (
                            invoice.status !== "cancelled" &&
                            chartMonthKey(
                                invoice.issue_date ||
                                invoice.created_at
                            ) === month.key
                        );
                    })
                    .reduce(function (sum, invoice) {
                        return sum +
                            Number(invoice.total || 0);
                    }, 0);
            }),
            pipeline: months.map(function (month) {
                return state.leads
                    .filter(function (lead) {
                        return chartMonthKey(
                            lead.created_at
                        ) === month.key;
                    })
                    .reduce(function (sum, lead) {
                        return sum +
                            Number(
                                lead.estimated_value ||
                                0
                            );
                    }, 0);
            }),
            enquiries: months.map(function (month) {
                return state.enquiries.filter(function (item) {
                    return chartMonthKey(
                        item.created_at
                    ) === month.key;
                }).length;
            }),
            tasksCreated: months.map(function (month) {
                return state.tasks.filter(function (item) {
                    return chartMonthKey(
                        item.created_at
                    ) === month.key;
                }).length;
            }),
            tasksCompleted: months.map(function (month) {
                return state.tasks.filter(function (item) {
                    return (
                        item.status === "completed" &&
                        chartMonthKey(
                            item.completed_at ||
                            item.updated_at
                        ) === month.key
                    );
                }).length;
            })
        };
    }

    function insightPanel(title, subtitle, content) {
        return (
            '<section class="sway-panel sway-insight-panel">' +
                '<div class="sway-panel-title">' +
                    "<div>" +
                        "<h3>" +
                            esc(title) +
                        "</h3>" +
                        (
                            subtitle
                                ? "<p>" +
                                  esc(subtitle) +
                                  "</p>"
                                : ""
                        ) +
                    "</div>" +
                "</div>" +
                content +
            "</section>"
        );
    }

    function renderInsightsOverview() {
        const data = insightData();
        const labels =
            data.months.map(function (month) {
                return month.label;
            });

        return (
            '<div class="sway-live-toolbar">' +
                "<div>" +
                    "<strong>Live business movement</strong>" +
                    "<span>" +
                        esc(liveUpdateText()) +
                    "</span>" +
                "</div>" +
                liveBadge() +
            "</div>" +

            '<div class="sway-insight-grid">' +
                insightPanel(
                    "Revenue collected",
                    "Paid payments by month.",
                    trendChart(
                        data.revenue,
                        labels,
                        "#002096",
                        "Revenue collected",
                        true
                    )
                ) +
                insightPanel(
                    "Pipeline created",
                    "Estimated lead value entering the pipeline.",
                    trendChart(
                        data.pipeline,
                        labels,
                        "#0152F4",
                        "Pipeline created",
                        true
                    )
                ) +
            "</div>" +

            '<div class="sway-insight-grid">' +
                insightPanel(
                    "Website demand",
                    "New enquiries received each month.",
                    barChartSimple(
                        data.enquiries,
                        labels,
                        "#2C91FC",
                        "Website demand"
                    )
                ) +
                insightPanel(
                    "Delivery throughput",
                    "Tasks created each month.",
                    barChartSimple(
                        data.tasksCreated,
                        labels,
                        "#77C1FC",
                        "Task creation"
                    )
                ) +
            "</div>"
        );
    }

    function renderInsights() {
        const data = insightData();
        const labels =
            data.months.map(function (month) {
                return month.label;
            });

        const paid =
            state.payments
                .filter(function (item) {
                    return item.status === "paid";
                })
                .reduce(function (sum, item) {
                    return sum +
                        Number(item.amount || 0);
                }, 0);

        const outstanding =
            state.payments
                .filter(function (item) {
                    return item.status !== "paid";
                })
                .reduce(function (sum, item) {
                    return sum +
                        Number(item.amount || 0);
                }, 0);

        const activePipeline =
            state.leads
                .filter(function (item) {
                    return !["won", "lost"].includes(
                        item.status
                    );
                })
                .reduce(function (sum, item) {
                    return sum +
                        Number(
                            item.estimated_value || 0
                        );
                }, 0);

        const tasksDone =
            state.tasks.filter(function (item) {
                return item.status === "completed";
            }).length;

        const taskRate =
            state.tasks.length
                ? (
                    tasksDone /
                    state.tasks.length
                ) * 100
                : 0;

        const won =
            state.leads.filter(function (item) {
                return item.status === "won";
            }).length;

        const conversionRate =
            state.leads.length
                ? (
                    won /
                    state.leads.length
                ) * 100
                : 0;

        const leadStages = [
            "new",
            "contacted",
            "interested",
            "proposal sent",
            "negotiating",
            "won",
            "lost"
        ].map(function (status) {
            return {
                label:
                    status.replace(
                        /\b\w/g,
                        function (match) {
                            return match.toUpperCase();
                        }
                    ),
                value:
                    state.leads.filter(function (lead) {
                        return lead.status === status;
                    }).length
            };
        }).filter(function (item) {
            return item.value > 0;
        });

        const projectStages = [
            "planning",
            "in progress",
            "review",
            "completed",
            "paused",
            "cancelled"
        ].map(function (status) {
            return {
                label:
                    status.replace(
                        /\b\w/g,
                        function (match) {
                            return match.toUpperCase();
                        }
                    ),
                value:
                    state.projects.filter(function (project) {
                        return project.status === status;
                    }).length
            };
        }).filter(function (item) {
            return item.value > 0;
        });

        const services = {};

        state.enquiries.forEach(function (item) {
            const key =
                item.service ||
                "Unspecified";

            services[key] =
                (services[key] || 0) + 1;
        });

        state.leads.forEach(function (item) {
            const key =
                item.service_interest ||
                "Unspecified";

            services[key] =
                (services[key] || 0) + 1;
        });

        const serviceDemand =
            Object.keys(services)
                .map(function (key) {
                    return {
                        label: key,
                        value: services[key]
                    };
                })
                .sort(function (a, b) {
                    return b.value - a.value;
                })
                .slice(0, 6);

        return (
            heading(
                '<button type="button" class="sway-workspace-button" data-refresh-workspace>Refresh data</button>'
            ) +
            '<div class="sway-live-toolbar">' +
                "<div>" +
                    "<strong>Real-time business intelligence</strong>" +
                    "<span>" +
                        esc(liveUpdateText()) +
                    "</span>" +
                "</div>" +
                liveBadge() +
            "</div>" +

            '<div class="sway-workspace-grid">' +
                '<div class="sway-stat-card">' +
                    '<span class="label">Cash collected</span>' +
                    '<div class="value">' +
                        esc(money(paid)) +
                    "</div>" +
                    '<div class="hint">Recorded paid payments.</div>' +
                "</div>" +
                '<div class="sway-stat-card">' +
                    '<span class="label">Invoiced</span>' +
                    '<div class="value">' +
                        esc(money(
                            state.invoices
                                .filter(function (invoice) {
                                    return invoice.status !== "cancelled";
                                })
                                .reduce(function (sum, invoice) {
                                    return sum + Number(invoice.total || 0);
                                }, 0)
                        )) +
                    "</div>" +
                    '<div class="hint">All non-cancelled invoices.</div>' +
                "</div>" +
                '<div class="sway-stat-card">' +
                    '<span class="label">Outstanding invoices</span>' +
                    '<div class="value">' +
                        esc(money(
                            state.invoices
                                .filter(function (invoice) {
                                    return ![
                                        "paid",
                                        "cancelled"
                                    ].includes(invoice.status);
                                })
                                .reduce(function (sum, invoice) {
                                    return sum + Number(invoice.total || 0);
                                }, 0)
                        )) +
                    "</div>" +
                    '<div class="hint">Invoices not fully paid.</div>' +
                "</div>" +
                '<div class="sway-stat-card">' +
                    '<span class="label">Active pipeline</span>' +
                    '<div class="value">' +
                        esc(money(activePipeline)) +
                    "</div>" +
                    '<div class="hint">Open lead estimated value.</div>' +
                "</div>" +
                '<div class="sway-stat-card">' +
                    '<span class="label">Lead conversion</span>' +
                    '<div class="value">' +
                        conversionRate.toFixed(0) +
                        "%" +
                    "</div>" +
                    '<div class="hint">Current won leads / total leads.</div>' +
                "</div>" +
            "</div>" +

            '<div class="sway-workspace-grid">' +
                '<div class="sway-stat-card">' +
                    '<span class="label">Task completion</span>' +
                    '<div class="value">' +
                        taskRate.toFixed(0) +
                        "%" +
                    "</div>" +
                    '<div class="hint">Completed / total tasks.</div>' +
                "</div>" +
                '<div class="sway-stat-card">' +
                    '<span class="label">Active projects</span>' +
                    '<div class="value">' +
                        state.projects.filter(function (project) {
                            return ![
                                "completed",
                                "cancelled"
                            ].includes(project.status);
                        }).length +
                    "</div>" +
                    '<div class="hint">Projects currently in motion.</div>' +
                "</div>" +
                '<div class="sway-stat-card">' +
                    '<span class="label">Outstanding invoices</span>' +
                    '<div class="value">' +
                        state.invoices.filter(function (invoice) {
                            return ![
                                "paid",
                                "cancelled"
                            ].includes(invoice.status);
                        }).length +
                    "</div>" +
                    '<div class="hint">Invoices still requiring collection.</div>' +
                "</div>" +
                '<div class="sway-stat-card">' +
                    '<span class="label">Active clients</span>' +
                    '<div class="value">' +
                        state.clients.filter(function (item) {
                            return item.status === "active";
                        }).length +
                    "</div>" +
                    '<div class="hint">Current client relationships.</div>' +
                "</div>" +
            "</div>" +

            '<div class="sway-insight-grid">' +
                insightPanel(
                    "Revenue movement",
                    "Cash collected from paid payments.",
                    trendChart(
                        data.revenue,
                        labels,
                        "#002096",
                        "Revenue movement"
                    )
                ) +
                insightPanel(
                    "Billed value movement",
                    "Invoice value issued by month.",
                    trendChart(
                        data.invoiced,
                        labels,
                        "#2C91FC",
                        "Billed value movement"
                    )
                ) +
            '</div>' +

            '<div class="sway-insight-grid">' +
                insightPanel(
                    "Pipeline movement",
                    "Estimated value of newly created leads.",
                    trendChart(
                        data.pipeline,
                        labels,
                        "#0152F4",
                        "Pipeline movement"
                    )
                ) +
            "</div>" +

            '<div class="sway-insight-grid">' +
                insightPanel(
                    "Website demand",
                    "Enquiries received by month.",
                    barChartSimple(
                        data.enquiries,
                        labels,
                        "#2C91FC",
                        "Website enquiry movement"
                    )
                ) +
                insightPanel(
                    "Delivery throughput",
                    "Tasks created by month.",
                    barChartSimple(
                        data.tasksCreated,
                        labels,
                        "#77C1FC",
                        "Task creation movement"
                    )
                ) +
            "</div>" +

            '<div class="sway-insight-grid">' +
                insightPanel(
                    "Lead funnel",
                    "Current distribution across pipeline stages.",
                    simpleBars(
                        leadStages,
                        "#0152F4"
                    )
                ) +
                insightPanel(
                    "Project workload",
                    "Current distribution across project stages.",
                    simpleBars(
                        projectStages,
                        "#2C91FC"
                    )
                ) +
            "</div>" +

            '<div class="sway-insight-grid">' +
                insightPanel(
                    "Financial position",
                    "Current paid versus outstanding amounts.",
                    simpleBars(
                        [
                            {
                                label: "Paid",
                                value: paid,
                                currency: true
                            },
                            {
                                label: "Outstanding",
                                value: outstanding,
                                currency: true
                            }
                        ],
                        "#002096"
                    )
                ) +
                insightPanel(
                    "Service demand",
                    "Combined enquiry and lead interest volume.",
                    simpleBars(
                        serviceDemand,
                        "#0152F4"
                    )
                ) +
            "</div>" +

            '<div class="sway-insight-grid">' +
                insightPanel(
                    "Task throughput",
                    "Created versus completed tasks by month.",
                    '<div class="sway-chart-legend">' +
                        '<span class="sway-chart-legend-item"><i style="background:#77C1FC"></i>Created</span>' +
                        '<span class="sway-chart-legend-item"><i style="background:#002096"></i>Completed</span>' +
                    "</div>" +
                    '<div class="sway-mini-bar-series">' +
                        data.tasksCreated.map(function (value, index) {
                            const created =
                                Number(value || 0);
                            const completed =
                                Number(
                                    data.tasksCompleted[index] ||
                                    0
                                );
                            const max =
                                Math.max(
                                    created,
                                    completed,
                                    1
                                );

                            return (
                                '<div class="sway-mini-bar-group">' +
                                    '<span class="sway-mini-bar created" style="height:' +
                                        (
                                            created /
                                            max *
                                            100
                                        ) +
                                        '%"></span>' +
                                    '<span class="sway-mini-bar completed" style="height:' +
                                        (
                                            completed /
                                            max *
                                            100
                                        ) +
                                        '%"></span>' +
                                    '<small>' +
                                        esc(
                                            labels[index]
                                        ) +
                                    "</small>" +
                                "</div>"
                            );
                        }).join("") +
                    "</div>"
                ) +
                insightPanel(
                    "Live activity pulse",
                    "Operational activity recorded in the last 24 hours.",
                    (function () {
                        const now =
                            new Date();

                        const currentHour =
                            new Date(
                                now.getTime()
                            );

                        currentHour.setMinutes(
                            0,
                            0,
                            0
                        );

                        const labels24 = [];
                        const values24 = [];

                        for (let i = 23; i >= 0; i -= 1) {
                            const point =
                                new Date(
                                    currentHour.getTime() -
                                    i * 60 * 60 * 1000
                                );

                            const key =
                                dashboardHourKey(
                                    point
                                );

                            labels24.push(
                                point.toLocaleTimeString(
                                    "en-ZA",
                                    {
                                        timeZone:
                                            SOUTH_AFRICA_TIME_ZONE,
                                        hour: "2-digit",
                                        minute: "2-digit"
                                    }
                                )
                            );

                            values24.push(
                                state.activities.filter(function (item) {
                                    return (
                                        dashboardHourKey(
                                            item.created_at
                                        ) === key
                                    );
                                }).length
                            );
                        }

                        return trendChart(
                            values24,
                            labels24,
                            "#002096",
                            "Live activity pulse"
                        );
                    })()
                ) +
            "</div>" +

            '<div class="sway-insight-note">' +
                "<strong>Data note:</strong> " +
                "Charts update from the records currently stored in Swayphics. " +
                "Because the current lead table stores the latest stage rather than a stage-history timeline, " +
                "conversion movement is a current-record view, not a historical stage-change audit." +
            "</div>"
        );
    }

    function setupRealtime() {
        if (
            !window.supabase ||
            typeof window.supabase.createClient !== "function"
        ) {
            state.realtimeStatus = "polling";
            return;
        }

        const accessToken = token();

        if (!accessToken) {
            state.realtimeStatus = "polling";
            return;
        }

        try {
            const client =
                window.supabase.createClient(
                    SUPABASE_URL,
                    SUPABASE_PUBLISHABLE_KEY,
                    {
                        auth: {
                            persistSession: false,
                            autoRefreshToken: false,
                            detectSessionInUrl: false
                        }
                    }
                );

            client.realtime.setAuth(
                accessToken
            );

            const channel =
                client.channel(
                    "swayphics-admin-live"
                );

            const tables = [
                "admin_users",
                "clients",
                "leads",
                "client_projects",
                "tasks",
                "follow_ups",
                "quotes",
                "payments",
                "invoices",
                "invoice_items",
                "services",
                "invoice_settings",
                "website_enquiries",
                "site_announcements",
                "activity_log"
            ];

            let refreshTimer = null;

            const queueRefresh = function () {
                if (refreshTimer) {
                    clearTimeout(refreshTimer);
                }

                refreshTimer =
                    setTimeout(
                        async function () {
                            refreshTimer = null;

                            try {
                                await refreshData();

                                state.lastLiveUpdate =
                                    Date.now();

                                renderShell();
                                renderView();
                            } catch (error) {
                                console.warn(
                                    "Live workspace refresh failed.",
                                    error
                                );
                            }
                        },
                        300
                    );
            };

            tables.forEach(function (table) {
                channel.on(
                    "postgres_changes",
                    {
                        event: "*",
                        schema: "public",
                        table: table
                    },
                    queueRefresh
                );
            });

            channel.subscribe(
                function (status, error) {
                    if (
                        status === "SUBSCRIBED"
                    ) {
                        state.realtimeStatus =
                            "live";

                        state.lastLiveUpdate =
                            Date.now();

                        if (
                            state.currentView === "overview" ||
                            state.currentView === "insights"
                        ) {
                            renderView();
                        }
                    }

                    if (
                        status === "CHANNEL_ERROR" ||
                        status === "TIMED_OUT"
                    ) {
                        state.realtimeStatus =
                            "polling";

                        console.warn(
                            "Swayphics Realtime unavailable:",
                            error
                        );

                        if (
                            state.currentView === "overview" ||
                            state.currentView === "insights"
                        ) {
                            renderView();
                        }
                    }
                }
            );

            window.setInterval(
                async function () {
                    if (
                        state.realtimeStatus !== "live"
                    ) {
                        try {
                            await refreshData();

                            state.lastLiveUpdate =
                                Date.now();

                            renderShell();
                            renderView();
                        } catch (error) {
                            console.warn(
                                "Workspace sync failed.",
                                error
                            );
                        }
                    }
                },
                30000
            );

            state.realtimeClient =
                client;

        } catch (error) {
            state.realtimeStatus =
                "polling";

            console.warn(
                "Unable to initialise Swayphics Realtime.",
                error
            );
        }
    }


    function renderOverview() {
        const today =
            dashboardTodayISO();

        const myOpenTasks =
            state.tasks.filter(function (item) {
                return (
                    item.status !== "completed" &&
                    item.assigned_to === state.currentUser.id
                );
            });

        const tasksToday =
            myOpenTasks.filter(function (item) {
                return dateInput(item.due_date) === today;
            }).length;

        const followupsToday =
            state.followups.filter(function (item) {
                return (
                    item.status === "pending" &&
                    dateInput(item.scheduled_for) === today
                );
            }).length;

        const outstanding =
            state.payments
                .filter(function (item) {
                    return item.status !== "paid";
                })
                .reduce(function (sum, item) {
                    return sum + Number(item.amount || 0);
                }, 0);

        const pipeline =
            state.leads
                .filter(function (item) {
                    return !["won", "lost"].includes(item.status);
                })
                .reduce(function (sum, item) {
                    return sum + Number(item.estimated_value || 0);
                }, 0);

        const recentWork =
            myOpenTasks
                .slice()
                .sort(function (a, b) {
                    return String(
                        a.due_date || "9999-12-31"
                    ).localeCompare(
                        String(b.due_date || "9999-12-31")
                    );
                })
                .slice(0, 6);

        const activities =
            state.activities.slice(0, 8);

        return (
            heading(
                '<button type="button" class="sway-workspace-button primary" data-quick="task">+ New task</button>' +
                '<button type="button" class="sway-workspace-button" data-quick="lead">+ New lead</button>'
            ) +

            renderInsightsOverview() +

            '<div class="sway-inline-note" style="margin-bottom:2px;">' +
                "Good day, " +
                "<strong>" +
                esc(currentUserName()) +
                "</strong>" +
                ". Here is what needs attention." +
            "</div>" +

            '<div class="sway-workspace-grid">' +

                '<div class="sway-stat-card">' +
                    '<span class="label">My open tasks</span>' +
                    '<div class="value">' +
                        myOpenTasks.length +
                    "</div>" +
                    '<div class="hint">' +
                        tasksToday +
                        " due today." +
                    "</div>" +
                "</div>" +

                '<div class="sway-stat-card">' +
                    '<span class="label">Follow-ups today</span>' +
                    '<div class="value">' +
                        followupsToday +
                    "</div>" +
                    '<div class="hint">Keep active opportunities moving.</div>' +
                "</div>" +

                '<div class="sway-stat-card">' +
                    '<span class="label">Open pipeline</span>' +
                    '<div class="value">' +
                        esc(money(pipeline)) +
                    "</div>" +
                    '<div class="hint">' +
                        state.leads.filter(function (item) {
                            return !["won", "lost"].includes(item.status);
                        }).length +
                        " active leads." +
                    "</div>" +
                "</div>" +

                '<div class="sway-stat-card">' +
                    '<span class="label">Outstanding</span>' +
                    '<div class="value">' +
                        esc(money(outstanding)) +
                    "</div>" +
                    '<div class="hint">' +
                        state.payments.filter(function (item) {
                            return item.status !== "paid";
                        }).length +
                        " payment items." +
                    "</div>" +
                "</div>" +

            "</div>" +

            panel(
                "My work",
                "Tasks assigned to you that are not complete.",
                recentWork.length
                    ? (
                        '<div class="sway-table-wrap">' +
                            '<table class="sway-table">' +
                                "<thead>" +
                                    "<tr>" +
                                        "<th>Task</th>" +
                                        "<th>Client</th>" +
                                        "<th>Due</th>" +
                                        "<th>Status</th>" +
                                        "<th></th>" +
                                    "</tr>" +
                                "</thead>" +
                                "<tbody>" +
                                    recentWork.map(function (item) {
                                        return (
                                            "<tr>" +
                                                "<td><strong>" +
                                                    esc(item.title) +
                                                "</strong></td>" +
                                                "<td>" +
                                                    esc(clientName(item.client_id)) +
                                                "</td>" +
                                                '<td class="' +
                                                    (
                                                        isOverdue(item.due_date) &&
                                                        item.status !== "completed"
                                                            ? "sway-due-overdue"
                                                            : ""
                                                    ) +
                                                '">' +
                                                    esc(date(item.due_date)) +
                                                "</td>" +
                                                "<td>" +
                                                    chip(item.status) +
                                                "</td>" +
                                                "<td>" +
                                                    '<div class="sway-row-actions">' +
                                                        '<button class="sway-row-action" data-edit="tasks" data-id="' +
                                                            esc(item.id) +
                                                        '">Edit</button>' +
                                                    "</div>" +
                                                "</td>" +
                                            "</tr>"
                                        );
                                    }).join("") +
                                "</tbody>" +
                            "</table>" +
                        "</div>"
                    )
                    : empty("Nothing is currently assigned to you.")
            ) +

            '<div class="sway-overview-split">' +

                panel(
                    "Recent activity",
                    "What the team changed recently.",
                    activities.length
                        ? activities.map(function (item) {
                            return (
                                '<div class="sway-inline-note" style="margin-bottom:8px;">' +
                                    "<strong>" +
                                        esc(
                                            item.action ||
                                            "Activity"
                                        ) +
                                    "</strong><br>" +
                                    esc(
                                        item.actor_id
                                            ? adminName(item.actor_id)
                                            : "System"
                                    ) +
                                    " · " +
                                    esc(
                                        item.entity_type ||
                                        "workspace"
                                    ) +
                                    " · " +
                                    esc(
                                        date(item.created_at)
                                    ) +
                                "</div>"
                            );
                        }).join("")
                        : empty("No activity recorded yet.")
                ) +

                panel(
                    "Quick actions",
                    "Jump directly into the next operational step.",
                    '<div class="sway-quick-actions">' +
                        quickButton(
                            "+ Add client",
                            "client"
                        ) +
                        quickButton(
                            "+ Add project",
                            "project"
                        ) +
                        quickButton(
                            "+ Add follow-up",
                            "followup"
                        ) +
                        quickButton(
                            "+ New invoice",
                            "invoice"
                        ) +
                        '<button class="sway-quick-action" type="button" data-view-target="enquiries">View enquiries</button>' +
                    "</div>"
                ) +

            "</div>"
        );
    }

    function renderTasks() {
        const rows =
            state.tasks.map(function (item) {
                return (
                    "<tr>" +
                        "<td>" +
                            "<strong>" +
                                esc(item.title) +
                            "</strong>" +
                            (
                                item.description
                                    ? '<br><span style="color:var(--text-muted);font-size:.58rem;">' +
                                      esc(item.description) +
                                      "</span>"
                                    : ""
                            ) +
                        "</td>" +
                        "<td>" +
                            esc(
                                adminName(
                                    item.assigned_to
                                )
                            ) +
                        "</td>" +
                        "<td>" +
                            esc(
                                clientName(
                                    item.client_id
                                )
                            ) +
                        "</td>" +
                        "<td>" +
                            chip(item.priority) +
                        "</td>" +
                        "<td>" +
                            (
                                item.due_date && isOverdue(item.due_date) && item.status !== "completed"
                                    ? chip("overdue")
                                    : esc(date(item.due_date))
                            ) +
                        "</td>" +
                        "<td>" +
                            chip(item.status) +
                        "</td>" +
                        "<td>" +
                            '<div class="sway-row-actions">' +
                                (
                                    item.status !== "completed"
                                        ? '<button class="sway-row-action" data-complete-task="' +
                                          esc(item.id) +
                                          '">Complete</button>'
                                        : ""
                                ) +
                                '<button class="sway-row-action" data-edit="tasks" data-id="' +
                                    esc(item.id) +
                                '">Edit</button>' +
                                '<button class="sway-row-action danger" data-delete="tasks" data-id="' +
                                    esc(item.id) +
                                '">Delete</button>' +
                            "</div>" +
                        "</td>" +
                    "</tr>"
                );
            }).join("");

        return (
            heading(
                '<button class="sway-workspace-button primary" data-add="tasks">+ New task</button>'
            ) +
            panel(
                "All tasks",
                "Assignments, deadlines and delivery status.",
                state.tasks.length
                    ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Task</th><th>Assigned</th><th>Client</th><th>Priority</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>' +
                      rows +
                      "</tbody></table></div>"
                    : empty("No tasks yet.")
            )
        );
    }

    function renderLeads() {
        const rows =
            state.leads.map(function (item) {
                return (
                    "<tr>" +
                        "<td>" +
                            "<strong>" +
                                esc(
                                    item.business_name ||
                                    "Unnamed business"
                                ) +
                            "</strong>" +
                            (
                                item.contact_name
                                    ? '<br><span style="color:var(--text-muted);font-size:.58rem;">' +
                                      esc(item.contact_name) +
                                      "</span>"
                                    : ""
                            ) +
                        "</td>" +
                        "<td>" +
                            esc(
                                item.service_interest ||
                                "—"
                            ) +
                        "</td>" +
                        "<td>" +
                            chip(item.status) +
                        "</td>" +
                        "<td>" +
                            esc(
                                money(
                                    item.estimated_value
                                )
                            ) +
                        "</td>" +
                        "<td>" +
                            esc(
                                date(
                                    item.next_follow_up
                                )
                            ) +
                        "</td>" +
                        "<td>" +
                            '<div class="sway-row-actions">' +
                                '<button class="sway-row-action" data-edit="leads" data-id="' +
                                    esc(item.id) +
                                '">Edit</button>' +
                                (
                                    item.status !== "won"
                                        ? '<button class="sway-row-action" data-convert-lead="' +
                                          esc(item.id) +
                                          '">Convert</button>'
                                        : ""
                                ) +
                                '<button class="sway-row-action danger" data-delete="leads" data-id="' +
                                    esc(item.id) +
                                '">Delete</button>' +
                            "</div>" +
                        "</td>" +
                    "</tr>"
                );
            }).join("");

        return (
            heading(
                '<button class="sway-workspace-button primary" data-add="leads">+ New lead</button>'
            ) +
            panel(
                "Lead pipeline",
                "Capture opportunities from email, WhatsApp, calls, social media and referrals.",
                state.leads.length
                    ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Business</th><th>Service</th><th>Status</th><th>Value</th><th>Follow-up</th><th></th></tr></thead><tbody>' +
                      rows +
                      "</tbody></table></div>"
                    : empty("No leads yet.")
            )
        );
    }

    function renderFollowups() {
        const rows =
            state.followups.map(function (item) {
                const subject =
                    item.lead_id
                        ? leadName(item.lead_id)
                        : clientName(item.client_id);

                return (
                    "<tr>" +
                        "<td>" +
                            "<strong>" +
                                esc(subject) +
                            "</strong>" +
                            '<br><span style="color:var(--text-muted);font-size:.58rem;">' +
                                esc(
                                    item.channel ||
                                    "—"
                                ) +
                            "</span>" +
                        "</td>" +
                        "<td>" +
                            (
                                isOverdue(item.scheduled_for) &&
                                item.status === "pending"
                                    ? chip("overdue")
                                    : esc(
                                        date(
                                            item.scheduled_for
                                        )
                                    )
                            ) +
                        "</td>" +
                        "<td>" +
                            esc(
                                adminName(
                                    item.assigned_to
                                )
                            ) +
                        "</td>" +
                        "<td>" +
                            chip(item.status) +
                        "</td>" +
                        "<td>" +
                            '<div class="sway-row-actions">' +
                                (
                                    item.status === "pending"
                                        ? '<button class="sway-row-action" data-complete-followup="' +
                                          esc(item.id) +
                                          '">Complete</button>'
                                        : ""
                                ) +
                                '<button class="sway-row-action" data-edit="followups" data-id="' +
                                    esc(item.id) +
                                '">Edit</button>' +
                                '<button class="sway-row-action danger" data-delete="followups" data-id="' +
                                    esc(item.id) +
                                '">Delete</button>' +
                            "</div>" +
                        "</td>" +
                    "</tr>"
                );
            }).join("");

        return (
            heading(
                '<button class="sway-workspace-button primary" data-add="followups">+ New follow-up</button>'
            ) +
            panel(
                "Follow-up queue",
                "Keep outreach and client communication from falling through the cracks.",
                state.followups.length
                    ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Contact</th><th>Scheduled</th><th>Assigned</th><th>Status</th><th></th></tr></thead><tbody>' +
                      rows +
                      "</tbody></table></div>"
                    : empty("No follow-ups scheduled.")
            )
        );
    }

    function renderClients() {
        const rows =
            state.clients.map(function (item) {
                const count =
                    state.projects.filter(function (project) {
                        return project.client_id === item.id;
                    }).length;

                return (
                    "<tr>" +
                        "<td>" +
                            "<strong>" +
                                esc(item.business_name) +
                            "</strong>" +
                            (
                                item.contact_name
                                    ? '<br><span style="color:var(--text-muted);font-size:.58rem;">' +
                                      esc(item.contact_name) +
                                      "</span>"
                                    : ""
                            ) +
                        "</td>" +
                        "<td>" +
                            esc(
                                item.email ||
                                item.phone ||
                                "—"
                            ) +
                        "</td>" +
                        "<td>" +
                            esc(
                                adminName(
                                    item.assigned_to
                                )
                            ) +
                        "</td>" +
                        "<td>" +
                            count +
                        "</td>" +
                        "<td>" +
                            chip(item.status) +
                        "</td>" +
                        "<td>" +
                            '<div class="sway-row-actions">' +
                                '<button class="sway-row-action" data-edit="clients" data-id="' +
                                    esc(item.id) +
                                '">Edit</button>' +
                                '<button class="sway-row-action danger" data-delete="clients" data-id="' +
                                    esc(item.id) +
                                '">Delete</button>' +
                            "</div>" +
                        "</td>" +
                    "</tr>"
                );
            }).join("");

        return (
            heading(
                '<button class="sway-workspace-button primary" data-add="clients">+ New client</button>'
            ) +
            panel(
                "Clients",
                "Keep client contact details, ownership and internal notes together.",
                state.clients.length
                    ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Business</th><th>Contact</th><th>Owner</th><th>Projects</th><th>Status</th><th></th></tr></thead><tbody>' +
                      rows +
                      "</tbody></table></div>"
                    : empty("No clients yet.")
            )
        );
    }

    function renderProjects() {
        const rows =
            state.projects.map(function (item) {
                return (
                    "<tr>" +
                        "<td>" +
                            "<strong>" +
                                esc(item.name) +
                            "</strong>" +
                            (
                                item.service
                                    ? '<br><span style="color:var(--text-muted);font-size:.58rem;">' +
                                      esc(item.service) +
                                      "</span>"
                                    : ""
                            ) +
                        "</td>" +
                        "<td>" +
                            esc(
                                clientName(
                                    item.client_id
                                )
                            ) +
                        "</td>" +
                        "<td>" +
                            esc(
                                adminName(
                                    item.assigned_to
                                )
                            ) +
                        "</td>" +
                        "<td>" +
                            chip(item.status) +
                        "</td>" +
                        "<td>" +
                            (
                                item.due_date && isOverdue(item.due_date) && item.status !== "completed"
                                    ? chip("overdue")
                                    : esc(date(item.due_date))
                            ) +
                        "</td>" +
                        "<td>" +
                            chip(item.payment_status) +
                        "</td>" +
                        "<td>" +
                            esc(
                                money(item.value)
                            ) +
                        "</td>" +
                        "<td>" +
                            '<div class="sway-row-actions">' +
                                '<button class="sway-row-action" data-edit="projects" data-id="' +
                                    esc(item.id) +
                                '">Edit</button>' +
                                '<button class="sway-row-action danger" data-delete="projects" data-id="' +
                                    esc(item.id) +
                                '">Delete</button>' +
                            "</div>" +
                        "</td>" +
                    "</tr>"
                );
            }).join("");

        return (
            heading(
                '<button class="sway-workspace-button primary" data-add="projects">+ New project</button>'
            ) +
            panel(
                "Projects",
                "Track delivery, ownership, deadlines and payment state.",
                state.projects.length
                    ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Project</th><th>Client</th><th>Owner</th><th>Status</th><th>Due</th><th>Payment</th><th>Value</th><th></th></tr></thead><tbody>' +
                      rows +
                      "</tbody></table></div>"
                    : empty("No projects yet.")
            )
        );
    }

    function renderQuotes() {
        const rows =
            state.quotes.map(function (item) {
                const contact =
                    item.client_id
                        ? clientName(item.client_id)
                        : leadName(item.lead_id);

                return (
                    "<tr>" +
                        "<td>" +
                            "<strong>" +
                                esc(
                                    item.quote_number ||
                                    "Unnumbered"
                                ) +
                            "</strong>" +
                            (
                                item.title
                                    ? '<br><span style="color:var(--text-muted);font-size:.58rem;">' +
                                      esc(item.title) +
                                      "</span>"
                                    : ""
                            ) +
                        "</td>" +
                        "<td>" +
                            esc(contact) +
                        "</td>" +
                        "<td>" +
                            esc(
                                money(
                                    item.amount
                                )
                            ) +
                        "</td>" +
                        "<td>" +
                            chip(item.status) +
                        "</td>" +
                        "<td>" +
                            esc(
                                date(
                                    item.valid_until
                                )
                            ) +
                        "</td>" +
                        "<td>" +
                            '<div class="sway-row-actions">' +
                                '<button class="sway-row-action" data-edit="quotes" data-id="' +
                                    esc(item.id) +
                                '">Edit</button>' +
                                '<button class="sway-row-action danger" data-delete="quotes" data-id="' +
                                    esc(item.id) +
                                '">Delete</button>' +
                            "</div>" +
                        "</td>" +
                    "</tr>"
                );
            }).join("");

        return (
            heading(
                '<button class="sway-workspace-button primary" data-add="quotes">+ New quote</button>'
            ) +
            panel(
                "Quotes",
                "Track proposals and expected work value.",
                state.quotes.length
                    ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Quote</th><th>Contact</th><th>Amount</th><th>Status</th><th>Valid until</th><th></th></tr></thead><tbody>' +
                      rows +
                      "</tbody></table></div>"
                    : empty("No quotes yet.")
            )
        );
    }


    function invoiceServicePrice(service) {
        if (!service) {
            return 0;
        }

        if (
            service.default_price !== null &&
            service.default_price !== undefined &&
            Number(service.default_price) >= 0
        ) {
            return Number(service.default_price);
        }

        if (
            service.minimum_price !== null &&
            service.minimum_price !== undefined
        ) {
            return Number(service.minimum_price);
        }

        return 0;
    }

    function invoiceServiceLabel(service) {
        if (!service) {
            return "Custom item";
        }

        return (
            service.name +
            (
                service.price_label
                    ? " — " +
                      service.price_label
                    : ""
            )
        );
    }

    function invoiceTotals(lines, discount, vatRate) {
        const subtotal =
            lines.reduce(function (sum, line) {
                return sum +
                    (
                        Number(line.quantity || 0) *
                        Number(line.unit_price || 0)
                    );
            }, 0);

        const safeDiscount =
            Math.min(
                Math.max(
                    Number(discount || 0),
                    0
                ),
                subtotal
            );

        const taxable =
            subtotal -
            safeDiscount;

        const safeVatRate =
            Math.max(
                0,
                Number(vatRate || 0)
            );

        const vatAmount =
            taxable *
            safeVatRate /
            100;

        return {
            subtotal: subtotal,
            discount: safeDiscount,
            vatRate: safeVatRate,
            vatAmount: vatAmount,
            total:
                taxable +
                vatAmount
        };
    }

    async function fetchInvoiceItems(invoiceId) {
        return await api(
            "/rest/v1/invoice_items?select=id,invoice_id,service_id,description,quantity,unit_price,line_total&invoice_id=eq." +
            encodeURIComponent(invoiceId) +
            "&order=created_at.asc"
        );
    }

    function invoiceModalMarkup(invoice, lines) {
        const settings =
            state.invoiceSettings || {};

        const clientOptions =
            '<option value="">Select client...</option>' +
            state.clients
                .filter(function (client) {
                    return client.status !== "archived";
                })
                .map(function (client) {
                    return (
                        '<option value="' +
                        esc(client.id) +
                        '"' +
                        (
                            invoice &&
                            invoice.client_id === client.id
                                ? " selected"
                                : ""
                        ) +
                        ">" +
                        esc(client.business_name) +
                        "</option>"
                    );
                }).join("");

        const projectOptions =
            '<option value="">No project</option>' +
            state.projects.map(function (project) {
                return (
                    '<option value="' +
                    esc(project.id) +
                    '"' +
                    (
                        invoice &&
                        invoice.project_id === project.id
                            ? " selected"
                            : ""
                    ) +
                    ">" +
                    esc(project.name) +
                    "</option>"
                );
            }).join("");

        return (
            '<div class="sway-modal sway-invoice-modal">' +
                '<div class="sway-modal-backdrop" data-invoice-close></div>' +
                '<div class="sway-modal-card sway-invoice-builder-card" role="dialog" aria-modal="true">' +
                    '<div class="sway-modal-header">' +
                        '<div>' +
                            '<span class="admin-label">Swayphics billing</span>' +
                            '<h3>' +
                                esc(
                                    invoice
                                        ? "Edit invoice " + invoice.invoice_number
                                        : "Create invoice"
                                ) +
                            "</h3>" +
                            '<p class="sway-invoice-modal-subtitle">' +
                                "Select services. Prices and totals are calculated automatically." +
                            "</p>" +
                        "</div>" +
                        '<button class="sway-modal-close" type="button" data-invoice-close aria-label="Close">×</button>' +
                    "</div>" +

                    '<form id="sway-invoice-form">' +
                        '<div class="sway-form-grid">' +
                            '<div class="sway-form-field">' +
                                '<label for="sway-invoice-client">Client</label>' +
                                '<select id="sway-invoice-client" required>' +
                                    clientOptions +
                                "</select>" +
                            "</div>" +

                            '<div class="sway-form-field">' +
                                '<label for="sway-invoice-project">Project</label>' +
                                '<select id="sway-invoice-project">' +
                                    projectOptions +
                                "</select>" +
                            "</div>" +

                            '<div class="sway-form-field">' +
                                '<label for="sway-invoice-issue-date">Issue date</label>' +
                                '<input id="sway-invoice-issue-date" type="date" value="' +
                                    esc(
                                        invoice
                                            ? dateInput(invoice.issue_date)
                                            : dashboardTodayISO()
                                    ) +
                                    '" required>' +
                            "</div>" +

                            '<div class="sway-form-field">' +
                                '<label for="sway-invoice-due-date">Due date</label>' +
                                '<input id="sway-invoice-due-date" type="date" value="' +
                                    esc(
                                        invoice
                                            ? dateInput(invoice.due_date)
                                            : ""
                                    ) +
                                '">' +
                            "</div>" +
                        "</div>" +

                        '<div class="sway-invoice-lines-header">' +
                            '<div>' +
                                '<strong>Invoice items</strong>' +
                                '<span>Choose from the active service catalogue or use a custom line.</span>' +
                            "</div>" +
                            '<button type="button" class="sway-workspace-button" id="sway-invoice-add-line">+ Add service</button>' +
                        "</div>" +

                        '<div class="sway-invoice-lines">' +
                            '<div class="sway-invoice-line-head">' +
                                "<span>Service</span>" +
                                "<span>Description</span>" +
                                "<span>Qty</span>" +
                                "<span>Unit price</span>" +
                                "<span>Total</span>" +
                                "<span></span>" +
                            "</div>" +
                            '<div id="sway-invoice-line-list"></div>' +
                        "</div>" +

                        '<div class="sway-invoice-add-custom">' +
                            '<button type="button" class="sway-row-action" id="sway-invoice-add-custom">+ Add custom item</button>' +
                        "</div>" +

                        '<div class="sway-invoice-financials">' +
                            '<div class="sway-form-grid">' +
                                '<div class="sway-form-field">' +
                                    '<label for="sway-invoice-discount">Discount (ZAR)</label>' +
                                    '<input id="sway-invoice-discount" type="number" min="0" step="0.01" value="' +
                                        esc(
                                            invoice
                                                ? Number(invoice.discount || 0)
                                                : 0
                                        ) +
                                    '">' +
                                "</div>" +
                                '<div class="sway-form-field">' +
                                    '<label for="sway-invoice-vat-rate">VAT rate (%)</label>' +
                                    '<input id="sway-invoice-vat-rate" type="number" min="0" step="0.01" value="' +
                                        esc(
                                            invoice
                                                ? Number(invoice.vat_rate || 0)
                                                : (
                                                    settings.vat_registered
                                                        ? 15
                                                        : 0
                                                )
                                        ) +
                                    '">' +
                                    '<small>' +
                                        (
                                            settings.vat_registered
                                                ? "VAT is enabled in Invoice settings."
                                                : "VAT is currently disabled in Invoice settings."
                                        ) +
                                    "</small>" +
                                "</div>" +
                                '<div class="sway-form-field full">' +
                                    '<label for="sway-invoice-notes">Notes</label>' +
                                    '<textarea id="sway-invoice-notes" rows="3">' +
                                        esc(
                                            invoice &&
                                            invoice.notes
                                                ? invoice.notes
                                                : "Thank you for choosing Swayphics."
                                        ) +
                                    "</textarea>" +
                                "</div>" +
                            "</div>" +

                            '<div class="sway-invoice-summary">' +
                                '<div><span>Subtotal</span><strong id="sway-invoice-subtotal">R0.00</strong></div>' +
                                '<div><span>Discount</span><strong id="sway-invoice-discount-total">R0.00</strong></div>' +
                                '<div><span>VAT</span><strong id="sway-invoice-vat-total">R0.00</strong></div>' +
                                '<div class="total"><span>Total</span><strong id="sway-invoice-total">R0.00</strong></div>' +
                            "</div>" +
                        "</div>" +

                        '<div class="sway-modal-actions">' +
                            '<button type="button" class="sway-workspace-button" data-invoice-close>Cancel</button>' +
                            '<button type="button" class="sway-workspace-button" id="sway-invoice-save">Save draft</button>' +
                            '<button type="button" class="sway-workspace-button primary" id="sway-invoice-send">Generate &amp; Send</button>' +
                        "</div>" +
                    "</form>" +
                "</div>" +
            "</div>"
        );
    }

    async function openInvoiceBuilder(invoiceId) {
        const invoice =
            invoiceId
                ? state.invoices.find(function (item) {
                    return item.id === invoiceId;
                })
                : null;

        if (
            invoice &&
            invoice.status !== "draft"
        ) {
            swayAlert(
                "Only draft invoices can be edited. Use a new invoice for changes after sending."
            );
            return;
        }

        let lines = [];

        if (invoiceId) {
            try {
                lines = await fetchInvoiceItems(invoiceId);
            } catch (error) {
                swayAlert(
                    error.message ||
                    "Unable to load invoice items."
                );
                return;
            }
        }

        const modal =
            document.createElement("div");

        modal.innerHTML =
            invoiceModalMarkup(
                invoice,
                lines
            );

        document.body.appendChild(
            modal.firstElementChild
        );

        const root =
            document.body.lastElementChild;

        const lineList =
            root.querySelector(
                "#sway-invoice-line-list"
            );

        const discountInput =
            root.querySelector(
                "#sway-invoice-discount"
            );

        const vatRateInput =
            root.querySelector(
                "#sway-invoice-vat-rate"
            );

        const subtotalOutput =
            root.querySelector(
                "#sway-invoice-subtotal"
            );

        const discountOutput =
            root.querySelector(
                "#sway-invoice-discount-total"
            );

        const vatOutput =
            root.querySelector(
                "#sway-invoice-vat-total"
            );

        const totalOutput =
            root.querySelector(
                "#sway-invoice-total"
            );

        let localLines =
            (lines || []).map(function (line) {
                return {
                    service_id:
                        line.service_id || "",
                    description:
                        line.description || "",
                    quantity:
                        Number(line.quantity || 1),
                    unit_price:
                        Number(line.unit_price || 0)
                };
            });

        function closeModal() {
            root.remove();
        }

        function serviceOptions(selectedId) {
            return (
                '<option value="">Custom item</option>' +
                state.services
                    .filter(function (service) {
                        return service.active;
                    })
                    .map(function (service) {
                        return (
                            '<option value="' +
                            esc(service.id) +
                            '"' +
                            (
                                selectedId === service.id
                                    ? " selected"
                                    : ""
                            ) +
                            ">" +
                            esc(
                                invoiceServiceLabel(
                                    service
                                )
                            ) +
                            "</option>"
                        );
                    }).join("")
            );
        }

        function renderLines() {
            lineList.innerHTML =
                localLines.length
                    ? localLines.map(function (line, index) {
                        return (
                            '<div class="sway-invoice-line" data-line-index="' +
                            index +
                            '">' +
                                '<select data-line-service>' +
                                    serviceOptions(
                                        line.service_id
                                    ) +
                                "</select>" +
                                '<input type="text" data-line-description value="' +
                                    esc(line.description) +
                                '">' +
                                '<input type="number" min="0.01" step="0.01" data-line-qty value="' +
                                    esc(line.quantity) +
                                '">' +
                                '<input type="number" min="0" step="0.01" data-line-price value="' +
                                    esc(line.unit_price) +
                                '">' +
                                '<strong data-line-total>' +
                                    esc(
                                        money(
                                            Number(line.quantity || 0) *
                                            Number(line.unit_price || 0)
                                        )
                                    ) +
                                "</strong>" +
                                '<button type="button" class="sway-row-action danger" data-remove-line aria-label="Remove item">×</button>' +
                                (
                                    line.service_id
                                        ? '<small class="sway-invoice-line-hint">' +
                                          esc(
                                              (
                                                  state.services.find(function (service) {
                                                      return service.id === line.service_id;
                                                  }) || {}
                                              ).price_label ||
                                              ""
                                          ) +
                                          "</small>"
                                        : '<small class="sway-invoice-line-hint">Custom amount</small>'
                                ) +
                            "</div>"
                        );
                    }).join("")
                    : empty(
                        "No invoice items yet. Add a service to begin."
                    );

            root
                .querySelectorAll("[data-line-service]")
                .forEach(function (select) {
                    select.addEventListener(
                        "change",
                        function () {
                            const index =
                                Number(
                                    select.closest(
                                        "[data-line-index]"
                                    ).dataset.lineIndex
                                );

                            const line =
                                localLines[index];

                            const service =
                                state.services.find(function (item) {
                                    return item.id === select.value;
                                });

                            line.service_id =
                                service
                                    ? service.id
                                    : "";

                            if (service) {
                                line.description =
                                    service.name;

                                line.unit_price =
                                    invoiceServicePrice(
                                        service
                                    );

                                const lineRoot =
                                    select.closest(
                                        "[data-line-index]"
                                    );

                                const priceInput =
                                    lineRoot.querySelector(
                                        "[data-line-price]"
                                    );

                                if (priceInput) {
                                    priceInput.value =
                                        line.unit_price;
                                }
                            }

                            renderLines();
                            updateTotals();
                        }
                    );
                });

            root
                .querySelectorAll("[data-line-description]")
                .forEach(function (input) {
                    input.addEventListener(
                        "input",
                        function () {
                            const index =
                                Number(
                                    input.closest(
                                        "[data-line-index]"
                                    ).dataset.lineIndex
                                );

                            localLines[index].description =
                                input.value;
                        }
                    );
                });

            root
                .querySelectorAll("[data-line-qty]")
                .forEach(function (input) {
                    input.addEventListener(
                        "input",
                        function () {
                            const index =
                                Number(
                                    input.closest(
                                        "[data-line-index]"
                                    ).dataset.lineIndex
                                );

                            localLines[index].quantity =
                                Math.max(
                                    0.01,
                                    Number(
                                        input.value ||
                                        0.01
                                    )
                                );

                            const total =
                                (
                                    localLines[index].quantity *
                                    localLines[index].unit_price
                                );

                            const output =
                                input.closest(
                                    "[data-line-index]"
                                ).querySelector(
                                    "[data-line-total]"
                                );

                            if (output) {
                                output.textContent =
                                    money(total);
                            }

                            updateTotals();
                        }
                    );
                });

            root
                .querySelectorAll("[data-line-price]")
                .forEach(function (input) {
                    input.addEventListener(
                        "input",
                        function () {
                            const index =
                                Number(
                                    input.closest(
                                        "[data-line-index]"
                                    ).dataset.lineIndex
                                );

                            localLines[index].unit_price =
                                Math.max(
                                    0,
                                    Number(
                                        input.value ||
                                        0
                                    )
                                );

                            const total =
                                (
                                    localLines[index].quantity *
                                    localLines[index].unit_price
                                );

                            const output =
                                input.closest(
                                    "[data-line-index]"
                                ).querySelector(
                                    "[data-line-total]"
                                );

                            if (output) {
                                output.textContent =
                                    money(total);
                            }

                            updateTotals();
                        }
                    );
                });

            root
                .querySelectorAll("[data-remove-line]")
                .forEach(function (button) {
                    button.addEventListener(
                        "click",
                        function () {
                            const index =
                                Number(
                                    button.closest(
                                        "[data-line-index]"
                                    ).dataset.lineIndex
                                );

                            localLines.splice(
                                index,
                                1
                            );

                            renderLines();
                            updateTotals();
                        }
                    );
                });
        }

        function updateTotals() {
            const totals =
                invoiceTotals(
                    localLines,
                    discountInput.value,
                    vatRateInput.value
                );

            subtotalOutput.textContent =
                money(totals.subtotal);

            discountOutput.textContent =
                money(totals.discount);

            vatOutput.textContent =
                money(totals.vatAmount);

            totalOutput.textContent =
                money(totals.total);
        }

        function addLine(serviceId) {
            const service =
                state.services.find(function (item) {
                    return item.id === serviceId;
                });

            localLines.push({
                service_id:
                    service
                        ? service.id
                        : "",
                description:
                    service
                        ? service.name
                        : "Custom item",
                quantity: 1,
                unit_price:
                    service
                        ? invoiceServicePrice(
                            service
                        )
                        : 0
            });

            renderLines();
            updateTotals();
        }

        root.querySelector(
            "#sway-invoice-add-line"
        ).addEventListener(
            "click",
            function () {
                addLine("");
            }
        );

        root.querySelector(
            "#sway-invoice-add-custom"
        ).addEventListener(
            "click",
            function () {
                addLine("");
            }
        );

        [
            discountInput,
            vatRateInput
        ].forEach(function (input) {
            input.addEventListener(
                "input",
                updateTotals
            );
        });

        root.querySelectorAll(
            "[data-invoice-close]"
        ).forEach(function (button) {
            button.addEventListener(
                "click",
                closeModal
            );
        });

        async function saveInvoice(
            shouldSend
        ) {
            const clientId =
                root.querySelector(
                    "#sway-invoice-client"
                ).value;

            const projectId =
                root.querySelector(
                    "#sway-invoice-project"
                ).value;

            const issueDate =
                root.querySelector(
                    "#sway-invoice-issue-date"
                ).value;

            const dueDate =
                root.querySelector(
                    "#sway-invoice-due-date"
                ).value;

            const notes =
                root.querySelector(
                    "#sway-invoice-notes"
                ).value.trim();

            if (!clientId) {
                swayAlert("Select a client.");
                return;
            }

            if (!localLines.length) {
                swayAlert("Add at least one invoice item.");
                return;
            }

            if (
                localLines.some(function (line) {
                    return (
                        !line.description.trim() ||
                        Number(line.quantity) <= 0 ||
                        Number(line.unit_price) < 0
                    );
                })
            ) {
                swayAlert(
                    "Every invoice item needs a description, quantity and valid price."
                );
                return;
            }

            const totals =
                invoiceTotals(
                    localLines,
                    discountInput.value,
                    vatRateInput.value
                );

            const invoicePayload = {
                client_id: clientId,
                project_id:
                    projectId || null,
                issue_date:
                    issueDate ||
                    dashboardTodayISO(),
                due_date:
                    dueDate || null,
                status:
                    invoice
                        ? invoice.status
                        : "draft",
                subtotal:
                    totals.subtotal,
                discount:
                    totals.discount,
                vat_rate:
                    totals.vatRate,
                vat_amount:
                    totals.vatAmount,
                total:
                    totals.total,
                notes:
                    notes || null,
                created_by:
                    state.currentUser.id
            };

            const saveButton =
                root.querySelector(
                    "#sway-invoice-save"
                );

            const sendButton =
                root.querySelector(
                    "#sway-invoice-send"
                );

            saveButton.disabled = true;
            sendButton.disabled = true;

            try {
                let savedId =
                    invoice
                        ? invoice.id
                        : null;

                let savedInvoice =
                    invoice;

                if (savedId) {
                    await api(
                        "/rest/v1/invoices?id=eq." +
                        encodeURIComponent(savedId),
                        {
                            method: "PATCH",
                            headers: headers({
                                "Prefer":
                                    "return=representation"
                            }),
                            body:
                                JSON.stringify(
                                    invoicePayload
                                )
                        }
                    );

                    await api(
                        "/rest/v1/invoice_items?invoice_id=eq." +
                        encodeURIComponent(savedId),
                        {
                            method: "DELETE",
                            headers: headers({
                                "Prefer":
                                    "return=minimal"
                            })
                        }
                    );
                } else {
                    const created =
                        await api(
                            "/rest/v1/invoices",
                            {
                                method: "POST",
                                headers: headers({
                                    "Prefer":
                                        "return=representation"
                                }),
                                body:
                                    JSON.stringify(
                                        invoicePayload
                                    )
                            }
                        );

                    savedInvoice =
                        Array.isArray(created)
                            ? created[0]
                            : created;

                    savedId =
                        savedInvoice &&
                        savedInvoice.id;

                    if (!savedId) {
                        throw new Error(
                            "Invoice could not be created."
                        );
                    }
                }

                await api(
                    "/rest/v1/invoice_items",
                    {
                        method: "POST",
                        headers: headers({
                            "Prefer":
                                "return=minimal"
                        }),
                        body:
                            JSON.stringify(
                                localLines.map(function (line) {
                                    return {
                                        invoice_id:
                                            savedId,
                                        service_id:
                                            line.service_id ||
                                            null,
                                        description:
                                            line.description.trim(),
                                        quantity:
                                            Number(
                                                line.quantity
                                            ),
                                        unit_price:
                                            Number(
                                                line.unit_price
                                            )
                                    };
                                })
                            )
                    }
                );

                await logActivity(
                    (
                        invoice
                            ? "Updated "
                            : "Created "
                    ) +
                    "invoice " +
                    (
                        savedInvoice &&
                        savedInvoice.invoice_number
                            ? savedInvoice.invoice_number
                            : savedId
                    ),
                    "invoices",
                    savedId
                );

                if (shouldSend) {
                    await sendInvoiceById(
                        savedId,
                        false
                    );

                    await logActivity(
                        "Sent invoice " +
                        (
                            savedInvoice &&
                            savedInvoice.invoice_number
                                ? savedInvoice.invoice_number
                                : savedId
                        ),
                        "invoices",
                        savedId
                    );
                }

                closeModal();

                await refreshData();
                renderShell();
                renderView();

            } catch (error) {
                swayAlert(
                    error.message ||
                    "Unable to save invoice."
                );

                saveButton.disabled = false;
                sendButton.disabled = false;
            }
        }

        root.querySelector(
            "#sway-invoice-save"
        ).addEventListener(
            "click",
            function () {
                saveInvoice(false);
            }
        );

        root.querySelector(
            "#sway-invoice-send"
        ).addEventListener(
            "click",
            function () {
                saveInvoice(true);
            }
        );

        renderLines();
        updateTotals();
    }

    function base64ToBytes(base64) {
        const binary =
            atob(base64);

        const bytes =
            new Uint8Array(
                binary.length
            );

        for (
            let index = 0;
            index < binary.length;
            index += 1
        ) {
            bytes[index] =
                binary.charCodeAt(index);
        }

        return bytes;
    }

    async function invokeInvoiceFunction(
        invoiceId,
        action
    ) {
        const response =
            await fetch(
                SUPABASE_URL +
                "/functions/v1/generate-invoice",
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json",
                        "apikey":
                            SUPABASE_PUBLISHABLE_KEY,
                        "Authorization":
                            "Bearer " +
                            token()
                    },
                    body:
                        JSON.stringify({
                            invoice_id:
                                invoiceId,
                            action:
                                action
                        })
                }
            );

        const responseText =
            await response.text();

        let result = null;

        try {
            result =
                responseText
                    ? JSON.parse(
                        responseText
                    )
                    : null;
        } catch {
            result = {
                error:
                    responseText
            };
        }

        if (!response.ok) {
            throw new Error(
                result &&
                result.error
                    ? result.error
                    : (
                        "Invoice function failed with " +
                        response.status
                    )
            );
        }

        return result;
    }

    async function downloadInvoicePdf(
        invoiceId
    ) {
        const result =
            await invokeInvoiceFunction(
                invoiceId,
                "pdf"
            );

        const bytes =
            base64ToBytes(
                result.pdf_base64
            );

        const blob =
            new Blob(
                [bytes],
                {
                    type:
                        "application/pdf"
                }
            );

        const url =
            URL.createObjectURL(
                blob
            );

        const link =
            document.createElement("a");

        link.href =
            url;

        link.download =
            result.filename ||
            "Swayphics-Invoice.pdf";

        document.body.appendChild(
            link
        );

        link.click();
        link.remove();

        URL.revokeObjectURL(
            url
        );
    }

    async function sendInvoiceById(
        invoiceId,
        confirmFirst
    ) {
        let invoice =
            state.invoices.find(function (item) {
                return item.id === invoiceId;
            });

        if (!invoice) {
            const fetched =
                await api(
                    "/rest/v1/invoices?id=eq." +
                    encodeURIComponent(invoiceId) +
                    "&select=*"
                );

            invoice =
                Array.isArray(fetched)
                    ? fetched[0]
                    : fetched;
        }

        if (!invoice) {
            throw new Error(
                "Invoice could not be found."
            );
        }

        const client =
            state.clients.find(function (item) {
                return item.id === invoice.client_id;
            });

        if (
            !client ||
            !client.email
        ) {
            throw new Error(
                "This client does not have an email address."
            );
        }

        if (
            confirmFirst &&
            !(await swayConfirm(
                "Send invoice " +
                invoice.invoice_number +
                " to " +
                client.email +
                "?"
            ))
        ) {
            return;
        }

        const result =
            await invokeInvoiceFunction(
                invoiceId,
                "send"
            );

        await refreshData();

        return result;
    }

    function renderInvoices() {
        const totalBilled =
            state.invoices.reduce(function (sum, invoice) {
                return sum +
                    Number(invoice.total || 0);
            }, 0);

        const totalSent =
            state.invoices
                .filter(function (invoice) {
                    return [
                        "sent",
                        "partially paid",
                        "paid",
                        "overdue"
                    ].includes(invoice.status);
                })
                .reduce(function (sum, invoice) {
                    return sum +
                        Number(invoice.total || 0);
                }, 0);

        const overdue =
            state.invoices.filter(function (invoice) {
                return (
                    invoice.status !== "paid" &&
                    invoice.status !== "cancelled" &&
                    invoice.due_date &&
                    isOverdue(invoice.due_date)
                );
            });

        const rows =
            state.invoices.map(function (item) {
                const overdueNow =
                    item.status !== "paid" &&
                    item.status !== "cancelled" &&
                    isOverdue(item.due_date);

                return (
                    "<tr>" +
                        "<td>" +
                            "<strong>" +
                                esc(item.invoice_number) +
                            "</strong>" +
                            '<br><span style="color:var(--text-muted);font-size:.58rem;">' +
                                esc(
                                    clientName(
                                        item.client_id
                                    )
                                ) +
                            "</span>" +
                        "</td>" +
                        "<td>" +
                            esc(
                                money(
                                    item.total
                                )
                            ) +
                        "</td>" +
                        "<td>" +
                            chip(
                                overdueNow
                                    ? "overdue"
                                    : item.status
                            ) +
                        "</td>" +
                        "<td>" +
                            esc(
                                date(
                                    item.due_date
                                )
                            ) +
                        "</td>" +
                        "<td>" +
                            chip(
                                item.email_status
                            ) +
                        "</td>" +
                        "<td>" +
                            '<div class="sway-row-actions">' +
                                (
                                    item.status === "draft"
                                        ? '<button class="sway-row-action" data-invoice-action="edit" data-id="' +
                                          esc(item.id) +
                                          '">Edit</button>'
                                        : ""
                                ) +
                                '<button class="sway-row-action" data-invoice-action="pdf" data-id="' +
                                    esc(item.id) +
                                '">PDF</button>' +
                                (
                                    item.status !== "paid" &&
                                    item.status !== "cancelled"
                                        ? '<button class="sway-row-action" data-invoice-action="send" data-id="' +
                                          esc(item.id) +
                                          '">' +
                                          (
                                              item.email_status === "sent"
                                                  ? "Resend"
                                                  : "Send"
                                          ) +
                                          "</button>"
                                        : ""
                                ) +
                                (
                                    item.status === "draft"
                                        ? '<button class="sway-row-action danger" data-invoice-action="delete" data-id="' +
                                          esc(item.id) +
                                          '">Delete</button>'
                                        : ""
                                ) +
                            "</div>" +
                        "</td>" +
                    "</tr>"
                );
            }).join("");

        return (
            heading(
                '<button class="sway-workspace-button" data-view-target="services">Manage services</button>' +
                '<button class="sway-workspace-button primary" data-add-invoice>+ New invoice</button>'
            ) +

            '<div class="sway-workspace-grid">' +
                '<div class="sway-stat-card">' +
                    '<span class="label">Total billed</span>' +
                    '<div class="value">' +
                        esc(
                            money(
                                totalBilled
                            )
                        ) +
                    "</div>" +
                    '<div class="hint">' +
                        state.invoices.length +
                        " invoices recorded." +
                    "</div>" +
                "</div>" +
                '<div class="sway-stat-card">' +
                    '<span class="label">Sent value</span>' +
                    '<div class="value">' +
                        esc(
                            money(
                                totalSent
                            )
                        ) +
                    "</div>" +
                    '<div class="hint">Invoices that reached sent status.</div>' +
                "</div>" +
                '<div class="sway-stat-card">' +
                    '<span class="label">Overdue invoices</span>' +
                    '<div class="value">' +
                        overdue.length +
                    "</div>" +
                    '<div class="hint">Past due and not fully paid.</div>' +
                "</div>" +
                '<div class="sway-stat-card">' +
                    '<span class="label">Catalogue services</span>' +
                    '<div class="value">' +
                        state.services.filter(function (service) {
                            return service.active;
                        }).length +
                    "</div>" +
                    '<div class="hint">Active services available for billing.</div>' +
                "</div>" +
            "</div>" +

            panel(
                "Invoices",
                "Branded invoice records connected to clients and the finance layer.",
                state.invoices.length
                    ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Invoice</th><th>Total</th><th>Status</th><th>Due</th><th>Email</th><th></th></tr></thead><tbody>' +
                      rows +
                      "</tbody></table></div>"
                    : empty(
                        "No invoices yet. Create the first invoice from the button above."
                    )
            )
        );
    }

    function renderServices() {
        const rows =
            state.services.map(function (item) {
                const pricing =
                    item.price_label ||
                    (
                        item.default_price !== null
                            ? money(item.default_price)
                            : "Custom"
                    );

                return (
                    "<tr>" +
                        "<td>" +
                            "<strong>" +
                                esc(item.name) +
                            "</strong>" +
                            (
                                item.description
                                    ? '<br><span style="color:var(--text-muted);font-size:.58rem;">' +
                                      esc(item.description) +
                                      "</span>"
                                    : ""
                            ) +
                        "</td>" +
                        "<td>" +
                            esc(
                                item.category ||
                                "—"
                            ) +
                        "</td>" +
                        "<td>" +
                            esc(pricing) +
                        "</td>" +
                        "<td>" +
                            chip(item.active ? "active" : "inactive") +
                        "</td>" +
                        "<td>" +
                            '<div class="sway-row-actions">' +
                                (
                                    state.currentAdmin.role === "owner"
                                        ? '<button class="sway-row-action" data-edit="services" data-id="' +
                                          esc(item.id) +
                                          '">Edit</button>' +
                                          '<button class="sway-row-action danger" data-delete="services" data-id="' +
                                          esc(item.id) +
                                          '">Delete</button>'
                                        : ""
                                ) +
                            "</div>" +
                        "</td>" +
                    "</tr>"
                );
            }).join("");

        return (
            heading(
                '<button class="sway-workspace-button" data-view-target="invoice-settings">Invoice settings</button>' +
                (
                    state.currentAdmin.role === "owner"
                        ? '<button class="sway-workspace-button primary" data-add="services">+ New service</button>'
                        : ""
                )
            ) +
            panel(
                "Service catalogue",
                "These prices feed directly into the invoice builder. Owner access controls price changes.",
                state.services.length
                    ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Service</th><th>Category</th><th>Price</th><th>Status</th><th></th></tr></thead><tbody>' +
                      rows +
                      "</tbody></table></div>"
                    : empty("No services configured.")
            )
        );
    }

    async function editInvoiceSettings() {
        if (
            state.currentAdmin.role !== "owner"
        ) {
            swayAlert(
                "Only the owner can change invoice settings."
            );
            return;
        }

        const settings =
            state.invoiceSettings || {
                id: 1
            };

        showModal(
            "Invoice settings",
            [
                {
                    key: "business_name",
                    label: "Business name",
                    type: "text",
                    required: true,
                    value: settings.business_name
                },
                {
                    key: "slogan",
                    label: "Slogan",
                    type: "text",
                    value: settings.slogan
                },
                {
                    key: "email",
                    label: "Business email",
                    type: "email",
                    value:
                        settings.email ||
                        "info@swayphics.co.za"
                },
                {
                    key: "phone",
                    label: "Business phone",
                    type: "text",
                    value: settings.phone
                },
                {
                    key: "website",
                    label: "Website",
                    type: "url",
                    value:
                        settings.website ||
                        "https://swayphics.co.za"
                },
                {
                    key: "address",
                    label: "Business address",
                    type: "textarea",
                    full: true,
                    value: settings.address
                },
                {
                    key: "bank_name",
                    label: "Bank",
                    type: "text",
                    value: settings.bank_name
                },
                {
                    key: "account_name",
                    label: "Account name",
                    type: "text",
                    value: settings.account_name
                },
                {
                    key: "account_number",
                    label: "Account number",
                    type: "text",
                    value: settings.account_number
                },
                {
                    key: "account_type",
                    label: "Account type",
                    type: "text",
                    value: settings.account_type
                },
                {
                    key: "branch_code",
                    label: "Branch code",
                    type: "text",
                    value: settings.branch_code
                },
                {
                    key: "payment_instructions",
                    label: "Payment instructions",
                    type: "textarea",
                    full: true,
                    value: settings.payment_instructions
                },
                {
                    key: "vat_registered",
                    label: "VAT registered",
                    type: "select",
                    options:
                        '<option value="false"' +
                        (
                            settings.vat_registered
                                ? ""
                                : " selected"
                        ) +
                        ">No</option>" +
                        '<option value="true"' +
                        (
                            settings.vat_registered
                                ? " selected"
                                : ""
                        ) +
                        ">Yes</option>"
                },
                {
                    key: "vat_number",
                    label: "VAT number",
                    type: "text",
                    value: settings.vat_number
                }
            ],
            async function (payload) {
                payload.id = 1;

                await api(
                    "/rest/v1/invoice_settings?id=eq.1",
                    {
                        method: "PATCH",
                        headers: headers({
                            "Prefer":
                                "return=minimal"
                        }),
                        body:
                            JSON.stringify(
                                payload
                            )
                    }
                );

                await logActivity(
                    "Updated invoice settings",
                    "invoice_settings",
                    null
                );
            }
        );
    }

    function renderInvoiceSettings() {
        const s =
            state.invoiceSettings || {};

        return (
            heading(
                '<button class="sway-workspace-button" data-view-target="services">Services</button>' +
                (
                    state.currentAdmin.role === "owner"
                        ? '<button class="sway-workspace-button primary" data-settings-edit>Edit settings</button>'
                        : ""
                )
            ) +
            panel(
                "Invoice settings",
                "These details are inserted into the branded PDF and the invoice email.",
                '<div class="sway-settings-grid">' +
                    '<div><span>Business</span><strong>' +
                        esc(s.business_name || "Swayphics") +
                    "</strong></div>" +
                    '<div><span>Email</span><strong>' +
                        esc(s.email || "info@swayphics.co.za") +
                    "</strong></div>" +
                    '<div><span>Phone</span><strong>' +
                        esc(s.phone || "Not configured") +
                    "</strong></div>" +
                    '<div><span>Website</span><strong>' +
                        esc(s.website || "https://swayphics.co.za") +
                    "</strong></div>" +
                    '<div class="full"><span>Address</span><strong>' +
                        esc(s.address || "Not configured") +
                    "</strong></div>" +
                    '<div><span>Bank</span><strong>' +
                        esc(s.bank_name || "Not configured") +
                    "</strong></div>" +
                    '<div><span>Account name</span><strong>' +
                        esc(s.account_name || "Not configured") +
                    "</strong></div>" +
                    '<div><span>Account number</span><strong>' +
                        esc(s.account_number || "Not configured") +
                    "</strong></div>" +
                    '<div><span>Account type</span><strong>' +
                        esc(s.account_type || "Not configured") +
                    "</strong></div>" +
                    '<div><span>Branch code</span><strong>' +
                        esc(s.branch_code || "Not configured") +
                    "</strong></div>" +
                    '<div class="full"><span>Payment instructions</span><strong>' +
                        esc(s.payment_instructions || "Not configured") +
                    "</strong></div>" +
                    '<div><span>VAT status</span><strong>' +
                        (
                            s.vat_registered
                                ? "VAT registered"
                                : "Not VAT registered"
                        ) +
                    "</strong></div>" +
                    '<div><span>VAT number</span><strong>' +
                        esc(s.vat_number || "Not configured") +
                    "</strong></div>" +
                "</div>"
            )
        );
    }

    function renderPayments() {
        const rows =
            state.payments.map(function (item) {
                return (
                    "<tr>" +
                        "<td>" +
                            "<strong>" +
                                esc(
                                    clientName(
                                        item.client_id
                                    )
                                ) +
                            "</strong>" +
                            '<br><span style="color:var(--text-muted);font-size:.58rem;">' +
                                esc(
                                    projectName(
                                        item.project_id
                                    )
                                ) +
                            "</span>" +
                        "</td>" +
                        "<td>" +
                            esc(
                                money(
                                    item.amount
                                )
                            ) +
                        "</td>" +
                        "<td>" +
                            chip(item.status) +
                        "</td>" +
                        "<td>" +
                            (
                                item.due_date && isOverdue(item.due_date) && item.status !== "paid"
                                    ? chip("overdue")
                                    : esc(date(item.due_date))
                            ) +
                        "</td>" +
                        "<td>" +
                            esc(
                                item.method ||
                                "—"
                            ) +
                        "</td>" +
                        "<td>" +
                            '<div class="sway-row-actions">' +
                                '<button class="sway-row-action" data-edit="payments" data-id="' +
                                    esc(item.id) +
                                '">Edit</button>' +
                                '<button class="sway-row-action danger" data-delete="payments" data-id="' +
                                    esc(item.id) +
                                '">Delete</button>' +
                            "</div>" +
                        "</td>" +
                    "</tr>"
                );
            }).join("");

        return (
            heading(
                '<button class="sway-workspace-button primary" data-add="payments">+ New payment</button>'
            ) +
            panel(
                "Payments",
                "Track cash collection without replacing proper accounting records.",
                state.payments.length
                    ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Client / project</th><th>Amount</th><th>Status</th><th>Due</th><th>Method</th><th></th></tr></thead><tbody>' +
                      rows +
                      "</tbody></table></div>"
                    : empty("No payment records yet.")
            )
        );
    }

    function renderEnquiries() {
        const rows =
            state.enquiries.map(function (item) {
                return (
                    "<tr>" +
                        "<td>" +
                            "<strong>" +
                                esc(
                                    item.business_name ||
                                    item.name ||
                                    "Website visitor"
                                ) +
                            "</strong>" +
                            (
                                item.email
                                    ? '<br><span style="color:var(--text-muted);font-size:.58rem;">' +
                                      esc(item.email) +
                                      "</span>"
                                    : ""
                            ) +
                        "</td>" +
                        "<td>" +
                            esc(
                                item.service ||
                                "—"
                            ) +
                        "</td>" +
                        "<td>" +
                            chip(item.status) +
                        "</td>" +
                        "<td>" +
                            esc(
                                date(
                                    item.created_at
                                )
                            ) +
                        "</td>" +
                        "<td>" +
                            '<div class="sway-row-actions">' +
                                '<button class="sway-row-action" data-enquiry-status="' +
                                    esc(item.id) +
                                    '" data-status-next="contacted">Contacted</button>' +
                                '<button class="sway-row-action" data-enquiry-status="' +
                                    esc(item.id) +
                                    '" data-status-next="converted">Converted</button>' +
                                '<button class="sway-row-action danger" data-enquiry-status="' +
                                    esc(item.id) +
                                    '" data-status-next="closed">Close</button>' +
                            "</div>" +
                        "</td>" +
                    "</tr>"
                );
            }).join("");

        return (
            heading(
                '<button class="sway-workspace-button" data-view-target="leads">Open lead pipeline</button>'
            ) +
            panel(
                "Website enquiries",
                "New contact-form submissions can be worked from here.",
                state.enquiries.length
                    ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Enquirer</th><th>Service</th><th>Status</th><th>Received</th><th></th></tr></thead><tbody>' +
                      rows +
                      "</tbody></table></div>"
                    : empty(
                        "No website enquiries are currently stored. Your existing submit-enquiry function still needs to write records into website_enquiries."
                    )
            )
        );
    }

    function renderContent() {
        const rows =
            state.announcements.map(function (item) {
                return (
                    "<tr>" +
                        "<td>" +
                            "<strong>" +
                                esc(item.title) +
                            "</strong>" +
                            (
                                item.message
                                    ? '<br><span style="color:var(--text-muted);font-size:.58rem;">' +
                                      esc(item.message) +
                                      "</span>"
                                    : ""
                            ) +
                        "</td>" +
                        "<td>" +
                            chip(
                                item.published
                                    ? "published"
                                    : "draft"
                            ) +
                        "</td>" +
                        "<td>" +
                            esc(
                                date(
                                    item.created_at
                                )
                            ) +
                        "</td>" +
                        "<td>" +
                            '<div class="sway-row-actions">' +
                                '<button class="sway-row-action" data-edit="announcements" data-id="' +
                                    esc(item.id) +
                                '">Edit</button>' +
                                '<button class="sway-row-action danger" data-delete="announcements" data-id="' +
                                    esc(item.id) +
                                '">Delete</button>' +
                            "</div>" +
                        "</td>" +
                    "</tr>"
                );
            }).join("");

        return (
            heading(
                '<button class="sway-workspace-button primary" data-add="announcements">+ New announcement</button>'
            ) +
            panel(
                "Website announcements",
                "Reusable notices for future public-site placements.",
                state.announcements.length
                    ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Announcement</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>' +
                      rows +
                      "</tbody></table></div>"
                    : empty("No announcements yet.")
            ) +
            '<div class="sway-inline-note">Portfolio and testimonials remain connected to the existing public-site managers below. This workspace does not change your current public pricing.</div>'
        );
    }

    function renderActivity() {
        const rows =
            state.activities.map(function (item) {
                return (
                    "<tr>" +
                        "<td>" +
                            esc(
                                date(
                                    item.created_at
                                )
                            ) +
                        "</td>" +
                        "<td>" +
                            esc(
                                adminName(
                                    item.actor_id
                                )
                            ) +
                        "</td>" +
                        "<td>" +
                            esc(
                                item.action ||
                                "—"
                            ) +
                        "</td>" +
                        "<td>" +
                            esc(
                                item.entity_type ||
                                "—"
                            ) +
                        "</td>" +
                    "</tr>"
                );
            }).join("");

        return (
            heading() +
            panel(
                "Activity log",
                "A shared history of changes made inside the workspace.",
                rows
                    ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Area</th></tr></thead><tbody>' +
                      rows +
                      "</tbody></table></div>"
                    : empty("No activity recorded.")
            )
        );
    }

    function renderTeam() {
        const rows =
            state.admins.map(function (item) {
                const isCurrent =
                    item.user_id === state.currentUser.id;

                return (
                    "<tr>" +
                        "<td>" +
                            "<strong>" +
                                esc(
                                    item.full_name ||
                                    "Unnamed member"
                                ) +
                            "</strong>" +
                            '<br><span style="color:var(--text-muted);font-size:.58rem;">' +
                                esc(
                                    item.email ||
                                    item.user_id
                                ) +
                            "</span>" +
                        "</td>" +
                        "<td>" +
                            chip(item.role) +
                        "</td>" +
                        "<td>" +
                            chip(
                                item.active
                                    ? "active"
                                    : "inactive"
                            ) +
                        "</td>" +
                        "<td>" +
                            esc(
                                date(
                                    item.created_at
                                )
                            ) +
                        "</td>" +
                        "<td>" +
                            (
                                state.currentAdmin.role === "owner" &&
                                !isCurrent
                                    ? '<div class="sway-row-actions">' +
                                      '<button class="sway-row-action" data-toggle-admin="' +
                                          esc(item.user_id) +
                                      '">' +
                                          (
                                              item.active
                                                  ? "Deactivate"
                                                  : "Activate"
                                          ) +
                                      "</button>" +
                                      '<button class="sway-row-action" data-edit="team" data-id="' +
                                          esc(item.user_id) +
                                      '">Edit</button>' +
                                      "</div>"
                                    : "—"
                            ) +
                        "</td>" +
                    "</tr>"
                );
            }).join("");

        const actions =
            state.currentAdmin.role === "owner"
                ? '<button class="sway-workspace-button primary" data-add="team">+ Add team member</button>'
                : "";

        return (
            heading(actions) +
            panel(
                "Team access",
                "Create the account in Supabase Authentication, then add that user's UUID here.",
                rows
                    ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Member</th><th>Role</th><th>Status</th><th>Added</th><th></th></tr></thead><tbody>' +
                      rows +
                      "</tbody></table></div>"
                    : empty(
                        "No active Swayphics team members are configured."
                    )
            ) +
            '<div class="sway-inline-note">Owner access controls who can activate, deactivate or edit team members. Team members can operate the shared business workspace but do not manage team access.</div>'
        );
    }

    const configs = {
        tasks: {
            table: "tasks",
            title: "Task",
            fields: function (item) {
                return [
                    {
                        key: "title",
                        label: "Task title",
                        type: "text",
                        required: true,
                        value: item.title
                    },
                    {
                        key: "description",
                        label: "Description",
                        type: "textarea",
                        full: true,
                        value: item.description
                    },
                    {
                        key: "assigned_to",
                        label: "Assigned to",
                        type: "select",
                        options:
                            '<option value="">Unassigned</option>' +
                            state.admins
                                .filter(function (admin) {
                                    return admin.active;
                                })
                                .map(function (admin) {
                                    return (
                                        '<option value="' +
                                        esc(admin.user_id) +
                                        '"' +
                                        (
                                            admin.user_id === item.assigned_to
                                                ? " selected"
                                                : ""
                                        ) +
                                        ">" +
                                        esc(
                                            admin.full_name ||
                                            admin.email ||
                                            admin.user_id
                                        ) +
                                        "</option>"
                                    );
                                }).join("")
                    },
                    {
                        key: "priority",
                        label: "Priority",
                        type: "select",
                        options:
                            ["low", "medium", "high", "urgent"]
                                .map(function (value) {
                                    return (
                                        '<option value="' +
                                        value +
                                        '"' +
                                        (
                                            value === item.priority
                                                ? " selected"
                                                : ""
                                        ) +
                                        ">" +
                                        value +
                                        "</option>"
                                    );
                                }).join("")
                    },
                    {
                        key: "status",
                        label: "Status",
                        type: "select",
                        options:
                            ["todo", "in progress", "review", "completed"]
                                .map(function (value) {
                                    return (
                                        '<option value="' +
                                        value +
                                        '"' +
                                        (
                                            value === item.status
                                                ? " selected"
                                                : ""
                                        ) +
                                        ">" +
                                        value +
                                        "</option>"
                                    );
                                }).join("")
                    },
                    {
                        key: "due_date",
                        label: "Due date",
                        type: "date",
                        value: dateInput(item.due_date)
                    },
                    {
                        key: "client_id",
                        label: "Client",
                        type: "select",
                        options:
                            '<option value="">No client</option>' +
                            state.clients.map(function (client) {
                                return (
                                    '<option value="' +
                                    esc(client.id) +
                                    '"' +
                                    (
                                        client.id === item.client_id
                                            ? " selected"
                                            : ""
                                    ) +
                                    ">" +
                                    esc(client.business_name) +
                                    "</option>"
                                );
                            }).join("")
                    },
                    {
                        key: "project_id",
                        label: "Project",
                        type: "select",
                        options:
                            '<option value="">No project</option>' +
                            state.projects.map(function (project) {
                                return (
                                    '<option value="' +
                                    esc(project.id) +
                                    '"' +
                                    (
                                        project.id === item.project_id
                                            ? " selected"
                                            : ""
                                    ) +
                                    ">" +
                                    esc(project.name) +
                                    "</option>"
                                );
                            }).join("")
                    },
                    {
                        key: "lead_id",
                        label: "Lead",
                        type: "select",
                        options:
                            '<option value="">No lead</option>' +
                            state.leads.map(function (lead) {
                                return (
                                    '<option value="' +
                                    esc(lead.id) +
                                    '"' +
                                    (
                                        lead.id === item.lead_id
                                            ? " selected"
                                            : ""
                                    ) +
                                    ">" +
                                    esc(lead.business_name) +
                                    "</option>"
                                );
                            }).join("")
                    }
                ];
            }
        },

        leads: {
            table: "leads",
            title: "Lead",
            fields: function (item) {
                return [
                    {
                        key: "business_name",
                        label: "Business name",
                        type: "text",
                        required: true,
                        value: item.business_name
                    },
                    {
                        key: "contact_name",
                        label: "Contact person",
                        type: "text",
                        value: item.contact_name
                    },
                    {
                        key: "email",
                        label: "Email",
                        type: "email",
                        value: item.email
                    },
                    {
                        key: "phone",
                        label: "Phone / WhatsApp",
                        type: "text",
                        value: item.phone
                    },
                    {
                        key: "service_interest",
                        label: "Service interest",
                        type: "text",
                        value: item.service_interest
                    },
                    {
                        key: "source",
                        label: "Source",
                        type: "select",
                        options:
                            [
                                "Email",
                                "WhatsApp",
                                "Phone",
                                "Facebook",
                                "Instagram",
                                "TikTok",
                                "Website",
                                "Referral",
                                "Other"
                            ].map(function (value) {
                                return (
                                    '<option value="' +
                                    value +
                                    '"' +
                                    (
                                        value === item.source
                                            ? " selected"
                                            : ""
                                    ) +
                                    ">" +
                                    value +
                                    "</option>"
                                );
                            }).join("")
                    },
                    {
                        key: "status",
                        label: "Status",
                        type: "select",
                        options:
                            [
                                "new",
                                "contacted",
                                "interested",
                                "proposal sent",
                                "negotiating",
                                "won",
                                "lost"
                            ].map(function (value) {
                                return (
                                    '<option value="' +
                                    value +
                                    '"' +
                                    (
                                        value === item.status
                                            ? " selected"
                                            : ""
                                    ) +
                                    ">" +
                                    value +
                                    "</option>"
                                );
                            }).join("")
                    },
                    {
                        key: "estimated_value",
                        label: "Estimated value (ZAR)",
                        type: "number",
                        value: item.estimated_value
                    },
                    {
                        key: "assigned_to",
                        label: "Assigned to",
                        type: "select",
                        options:
                            '<option value="">Unassigned</option>' +
                            state.admins
                                .filter(function (admin) {
                                    return admin.active;
                                })
                                .map(function (admin) {
                                    return (
                                        '<option value="' +
                                        esc(admin.user_id) +
                                        '"' +
                                        (
                                            admin.user_id === item.assigned_to
                                                ? " selected"
                                                : ""
                                        ) +
                                        ">" +
                                        esc(
                                            admin.full_name ||
                                            admin.email ||
                                            admin.user_id
                                        ) +
                                        "</option>"
                                    );
                                }).join("")
                    },
                    {
                        key: "next_follow_up",
                        label: "Next follow-up",
                        type: "date",
                        value: dateInput(item.next_follow_up)
                    },
                    {
                        key: "notes",
                        label: "Internal notes",
                        type: "textarea",
                        full: true,
                        value: item.notes
                    }
                ];
            }
        },

        followups: {
            table: "follow_ups",
            title: "Follow-up",
            fields: function (item) {
                return [
                    {
                        key: "lead_id",
                        label: "Lead",
                        type: "select",
                        options:
                            '<option value="">No lead</option>' +
                            state.leads.map(function (lead) {
                                return (
                                    '<option value="' +
                                    esc(lead.id) +
                                    '"' +
                                    (
                                        lead.id === item.lead_id
                                            ? " selected"
                                            : ""
                                    ) +
                                    ">" +
                                    esc(lead.business_name) +
                                    "</option>"
                                );
                            }).join("")
                    },
                    {
                        key: "client_id",
                        label: "Client",
                        type: "select",
                        options:
                            '<option value="">No client</option>' +
                            state.clients.map(function (client) {
                                return (
                                    '<option value="' +
                                    esc(client.id) +
                                    '"' +
                                    (
                                        client.id === item.client_id
                                            ? " selected"
                                            : ""
                                    ) +
                                    ">" +
                                    esc(client.business_name) +
                                    "</option>"
                                );
                            }).join("")
                    },
                    {
                        key: "assigned_to",
                        label: "Assigned to",
                        type: "select",
                        options:
                            '<option value="">Unassigned</option>' +
                            state.admins
                                .filter(function (admin) {
                                    return admin.active;
                                })
                                .map(function (admin) {
                                    return (
                                        '<option value="' +
                                        esc(admin.user_id) +
                                        '"' +
                                        (
                                            admin.user_id === item.assigned_to
                                                ? " selected"
                                                : ""
                                        ) +
                                        ">" +
                                        esc(
                                            admin.full_name ||
                                            admin.email ||
                                            admin.user_id
                                        ) +
                                        "</option>"
                                    );
                                }).join("")
                    },
                    {
                        key: "scheduled_for",
                        label: "Scheduled date",
                        type: "date",
                        value: dateInput(item.scheduled_for)
                    },
                    {
                        key: "channel",
                        label: "Channel",
                        type: "select",
                        options:
                            [
                                "WhatsApp",
                                "Phone",
                                "Email",
                                "Meeting",
                                "Other"
                            ].map(function (value) {
                                return (
                                    '<option value="' +
                                    value +
                                    '"' +
                                    (
                                        value === item.channel
                                            ? " selected"
                                            : ""
                                    ) +
                                    ">" +
                                    value +
                                    "</option>"
                                );
                            }).join("")
                    },
                    {
                        key: "status",
                        label: "Status",
                        type: "select",
                        options:
                            ["pending", "completed", "skipped"]
                                .map(function (value) {
                                    return (
                                        '<option value="' +
                                        value +
                                        '"' +
                                        (
                                            value === item.status
                                                ? " selected"
                                                : ""
                                        ) +
                                        ">" +
                                        value +
                                        "</option>"
                                    );
                                }).join("")
                    },
                    {
                        key: "note",
                        label: "Note",
                        type: "textarea",
                        full: true,
                        value: item.note
                    }
                ];
            }
        },

        clients: {
            table: "clients",
            title: "Client",
            fields: function (item) {
                return [
                    {
                        key: "business_name",
                        label: "Business name",
                        type: "text",
                        required: true,
                        value: item.business_name
                    },
                    {
                        key: "contact_name",
                        label: "Contact person",
                        type: "text",
                        value: item.contact_name
                    },
                    {
                        key: "email",
                        label: "Email",
                        type: "email",
                        value: item.email
                    },
                    {
                        key: "phone",
                        label: "Phone / WhatsApp",
                        type: "text",
                        value: item.phone
                    },
                    {
                        key: "status",
                        label: "Status",
                        type: "select",
                        options:
                            ["active", "archived"]
                                .map(function (value) {
                                    return (
                                        '<option value="' +
                                        value +
                                        '"' +
                                        (
                                            value === item.status
                                                ? " selected"
                                                : ""
                                        ) +
                                        ">" +
                                        value +
                                        "</option>"
                                    );
                                }).join("")
                    },
                    {
                        key: "assigned_to",
                        label: "Account owner",
                        type: "select",
                        options:
                            '<option value="">Unassigned</option>' +
                            state.admins
                                .filter(function (admin) {
                                    return admin.active;
                                })
                                .map(function (admin) {
                                    return (
                                        '<option value="' +
                                        esc(admin.user_id) +
                                        '"' +
                                        (
                                            admin.user_id === item.assigned_to
                                                ? " selected"
                                                : ""
                                        ) +
                                        ">" +
                                        esc(
                                            admin.full_name ||
                                            admin.email ||
                                            admin.user_id
                                        ) +
                                        "</option>"
                                    );
                                }).join("")
                    },
                    {
                        key: "notes",
                        label: "Internal notes",
                        type: "textarea",
                        full: true,
                        value: item.notes
                    }
                ];
            }
        },

        projects: {
            table: "client_projects",
            title: "Project",
            fields: function (item) {
                return [
                    {
                        key: "name",
                        label: "Project name",
                        type: "text",
                        required: true,
                        value: item.name
                    },
                    {
                        key: "client_id",
                        label: "Client",
                        type: "select",
                        options:
                            '<option value="">No client</option>' +
                            state.clients.map(function (client) {
                                return (
                                    '<option value="' +
                                    esc(client.id) +
                                    '"' +
                                    (
                                        client.id === item.client_id
                                            ? " selected"
                                            : ""
                                    ) +
                                    ">" +
                                    esc(client.business_name) +
                                    "</option>"
                                );
                            }).join("")
                    },
                    {
                        key: "service",
                        label: "Service",
                        type: "text",
                        value: item.service
                    },
                    {
                        key: "status",
                        label: "Status",
                        type: "select",
                        options:
                            [
                                "planning",
                                "in progress",
                                "review",
                                "completed",
                                "paused",
                                "cancelled"
                            ].map(function (value) {
                                return (
                                    '<option value="' +
                                    value +
                                    '"' +
                                    (
                                        value === item.status
                                            ? " selected"
                                            : ""
                                    ) +
                                    ">" +
                                    value +
                                    "</option>"
                                );
                            }).join("")
                    },
                    {
                        key: "value",
                        label: "Project value (ZAR)",
                        type: "number",
                        value: item.value
                    },
                    {
                        key: "due_date",
                        label: "Due date",
                        type: "date",
                        value: dateInput(item.due_date)
                    },
                    {
                        key: "assigned_to",
                        label: "Assigned to",
                        type: "select",
                        options:
                            '<option value="">Unassigned</option>' +
                            state.admins
                                .filter(function (admin) {
                                    return admin.active;
                                })
                                .map(function (admin) {
                                    return (
                                        '<option value="' +
                                        esc(admin.user_id) +
                                        '"' +
                                        (
                                            admin.user_id === item.assigned_to
                                                ? " selected"
                                                : ""
                                        ) +
                                        ">" +
                                        esc(
                                            admin.full_name ||
                                            admin.email ||
                                            admin.user_id
                                        ) +
                                        "</option>"
                                    );
                                }).join("")
                    },
                    {
                        key: "payment_status",
                        label: "Payment status",
                        type: "select",
                        options:
                            [
                                "not invoiced",
                                "invoice sent",
                                "partially paid",
                                "paid",
                                "overdue"
                            ].map(function (value) {
                                return (
                                    '<option value="' +
                                    value +
                                    '"' +
                                    (
                                        value === item.payment_status
                                            ? " selected"
                                            : ""
                                    ) +
                                    ">" +
                                    value +
                                    "</option>"
                                );
                            }).join("")
                    },
                    {
                        key: "description",
                        label: "Description",
                        type: "textarea",
                        full: true,
                        value: item.description
                    }
                ];
            }
        },

        quotes: {
            table: "quotes",
            title: "Quote",
            fields: function (item) {
                return [
                    {
                        key: "quote_number",
                        label: "Quote number",
                        type: "text",
                        value: item.quote_number
                    },
                    {
                        key: "title",
                        label: "Title",
                        type: "text",
                        required: true,
                        value: item.title
                    },
                    {
                        key: "lead_id",
                        label: "Lead",
                        type: "select",
                        options:
                            '<option value="">No lead</option>' +
                            state.leads.map(function (lead) {
                                return (
                                    '<option value="' +
                                    esc(lead.id) +
                                    '"' +
                                    (
                                        lead.id === item.lead_id
                                            ? " selected"
                                            : ""
                                    ) +
                                    ">" +
                                    esc(lead.business_name) +
                                    "</option>"
                                );
                            }).join("")
                    },
                    {
                        key: "client_id",
                        label: "Client",
                        type: "select",
                        options:
                            '<option value="">No client</option>' +
                            state.clients.map(function (client) {
                                return (
                                    '<option value="' +
                                    esc(client.id) +
                                    '"' +
                                    (
                                        client.id === item.client_id
                                            ? " selected"
                                            : ""
                                    ) +
                                    ">" +
                                    esc(client.business_name) +
                                    "</option>"
                                );
                            }).join("")
                    },
                    {
                        key: "invoice_id",
                        label: "Invoice",
                        type: "select",
                        options:
                            '<option value="">No invoice</option>' +
                            state.invoices.map(function (invoice) {
                                return (
                                    '<option value="' +
                                    esc(invoice.id) +
                                    '"' +
                                    (
                                        invoice.id === item.invoice_id
                                            ? " selected"
                                            : ""
                                    ) +
                                    ">" +
                                    esc(invoice.invoice_number) +
                                    " — " +
                                    esc(clientName(invoice.client_id)) +
                                    "</option>"
                                );
                            }).join("")
                    },
                    {
                        key: "amount",
                        label: "Amount (ZAR)",
                        type: "number",
                        required: true,
                        value: item.amount
                    },
                    {
                        key: "status",
                        label: "Status",
                        type: "select",
                        options:
                            [
                                "draft",
                                "sent",
                                "accepted",
                                "rejected",
                                "expired"
                            ].map(function (value) {
                                return (
                                    '<option value="' +
                                    value +
                                    '"' +
                                    (
                                        value === item.status
                                            ? " selected"
                                            : ""
                                    ) +
                                    ">" +
                                    value +
                                    "</option>"
                                );
                            }).join("")
                    },
                    {
                        key: "valid_until",
                        label: "Valid until",
                        type: "date",
                        value: dateInput(item.valid_until)
                    },
                    {
                        key: "notes",
                        label: "Notes",
                        type: "textarea",
                        full: true,
                        value: item.notes
                    }
                ];
            }
        },

        payments: {
            table: "payments",
            title: "Payment",
            fields: function (item) {
                return [
                    {
                        key: "client_id",
                        label: "Client",
                        type: "select",
                        options:
                            '<option value="">No client</option>' +
                            state.clients.map(function (client) {
                                return (
                                    '<option value="' +
                                    esc(client.id) +
                                    '"' +
                                    (
                                        client.id === item.client_id
                                            ? " selected"
                                            : ""
                                    ) +
                                    ">" +
                                    esc(client.business_name) +
                                    "</option>"
                                );
                            }).join("")
                    },
                    {
                        key: "project_id",
                        label: "Project",
                        type: "select",
                        options:
                            '<option value="">No project</option>' +
                            state.projects.map(function (project) {
                                return (
                                    '<option value="' +
                                    esc(project.id) +
                                    '"' +
                                    (
                                        project.id === item.project_id
                                            ? " selected"
                                            : ""
                                    ) +
                                    ">" +
                                    esc(project.name) +
                                    "</option>"
                                );
                            }).join("")
                    },
                    {
                        key: "amount",
                        label: "Amount (ZAR)",
                        type: "number",
                        required: true,
                        value: item.amount
                    },
                    {
                        key: "status",
                        label: "Status",
                        type: "select",
                        options:
                            [
                                "due",
                                "partially paid",
                                "paid",
                                "overdue"
                            ].map(function (value) {
                                return (
                                    '<option value="' +
                                    value +
                                    '"' +
                                    (
                                        value === item.status
                                            ? " selected"
                                            : ""
                                    ) +
                                    ">" +
                                    value +
                                    "</option>"
                                );
                            }).join("")
                    },
                    {
                        key: "method",
                        label: "Method",
                        type: "select",
                        options:
                            [
                                "EFT",
                                "Cash",
                                "Card",
                                "PayFast",
                                "Other"
                            ].map(function (value) {
                                return (
                                    '<option value="' +
                                    value +
                                    '"' +
                                    (
                                        value === item.method
                                            ? " selected"
                                            : ""
                                    ) +
                                    ">" +
                                    value +
                                    "</option>"
                                );
                            }).join("")
                    },
                    {
                        key: "reference",
                        label: "Reference",
                        type: "text",
                        value: item.reference
                    },
                    {
                        key: "due_date",
                        label: "Due date",
                        type: "date",
                        value: dateInput(item.due_date)
                    },
                    {
                        key: "paid_at",
                        label: "Paid at",
                        type: "date",
                        value: dateInput(item.paid_at)
                    },
                    {
                        key: "notes",
                        label: "Notes",
                        type: "textarea",
                        full: true,
                        value: item.notes
                    }
                ];
            }
        },


        services: {
            table: "services",
            title: "Service",
            fields: function (item) {
                return [
                    {
                        key: "name",
                        label: "Service name",
                        type: "text",
                        required: true,
                        value: item.name
                    },
                    {
                        key: "category",
                        label: "Category",
                        type: "text",
                        value: item.category
                    },
                    {
                        key: "description",
                        label: "Description",
                        type: "textarea",
                        full: true,
                        value: item.description
                    },
                    {
                        key: "pricing_type",
                        label: "Pricing type",
                        type: "select",
                        options:
                            ["fixed", "range", "from", "custom"]
                                .map(function (value) {
                                    return (
                                        '<option value="' +
                                        value +
                                        '"' +
                                        (
                                            value === item.pricing_type
                                                ? " selected"
                                                : ""
                                        ) +
                                        ">" +
                                        value.charAt(0).toUpperCase() +
                                        value.slice(1) +
                                        "</option>"
                                    );
                                }).join("")
                    },
                    {
                        key: "default_price",
                        label: "Default invoice price (ZAR)",
                        type: "number",
                        value: item.default_price
                    },
                    {
                        key: "minimum_price",
                        label: "Minimum price (ZAR)",
                        type: "number",
                        value: item.minimum_price
                    },
                    {
                        key: "maximum_price",
                        label: "Maximum price (ZAR)",
                        type: "number",
                        value: item.maximum_price
                    },
                    {
                        key: "price_label",
                        label: "Customer-facing price label",
                        type: "text",
                        value: item.price_label
                    },
                    {
                        key: "recurring_interval",
                        label: "Recurring",
                        type: "select",
                        options:
                            ["none", "monthly", "yearly"]
                                .map(function (value) {
                                    return (
                                        '<option value="' +
                                        value +
                                        '"' +
                                        (
                                            value === item.recurring_interval
                                                ? " selected"
                                                : ""
                                        ) +
                                        ">" +
                                        (
                                            value === "none"
                                                ? "None"
                                                : value.charAt(0).toUpperCase() +
                                                  value.slice(1)
                                        ) +
                                        "</option>"
                                    );
                                }).join("")
                    },
                    {
                        key: "active",
                        label: "Active",
                        type: "select",
                        options:
                            '<option value="true"' +
                            (
                                item.active !== false
                                    ? " selected"
                                    : ""
                            ) +
                            ">Active</option>" +
                            '<option value="false"' +
                            (
                                item.active === false
                                    ? " selected"
                                    : ""
                            ) +
                            ">Inactive</option>"
                    }
                ];
            }
        },

        announcements: {
            table: "site_announcements",
            title: "Announcement",
            fields: function (item) {
                return [
                    {
                        key: "title",
                        label: "Title",
                        type: "text",
                        required: true,
                        value: item.title
                    },
                    {
                        key: "message",
                        label: "Message",
                        type: "textarea",
                        full: true,
                        value: item.message
                    },
                    {
                        key: "published",
                        label: "Published",
                        type: "select",
                        options:
                            '<option value="true"' +
                            (
                                item.published
                                    ? " selected"
                                    : ""
                            ) +
                            ">Yes</option>" +
                            '<option value="false"' +
                            (
                                !item.published
                                    ? " selected"
                                    : ""
                            ) +
                            ">Draft</option>"
                    }
                ];
            }
        },

        team: {
            table: "admin_users",
            title: "Team member",
            fields: function (item) {
                return [
                    {
                        key: "user_id",
                        label: "Supabase Auth user UUID",
                        type: "text",
                        required: true,
                        value: item.user_id,
                        help:
                            "Create the user in Supabase Authentication first, then paste the user's UUID here."
                    },
                    {
                        key: "full_name",
                        label: "Full name",
                        type: "text",
                        required: true,
                        value: item.full_name
                    },
                    {
                        key: "email",
                        label: "Email",
                        type: "email",
                        value: item.email
                    },
                    {
                        key: "role",
                        label: "Role",
                        type: "select",
                        options:
                            '<option value="team_member"' +
                            (
                                item.role === "team_member"
                                    ? " selected"
                                    : ""
                            ) +
                            ">Team member</option>" +
                            '<option value="owner"' +
                            (
                                item.role === "owner"
                                    ? " selected"
                                    : ""
                            ) +
                            ">Owner</option>"
                    },
                    {
                        key: "active",
                        label: "Access",
                        type: "select",
                        options:
                            '<option value="true"' +
                            (
                                item.active !== false
                                    ? " selected"
                                    : ""
                            ) +
                            ">Active</option>" +
                            '<option value="false"' +
                            (
                                item.active === false
                                    ? " selected"
                                    : ""
                            ) +
                            ">Inactive</option>"
                    }
                ];
            }
        }
    };

    function showModal(title, fields, onSubmit) {
        const modal =
            document.createElement("div");

        modal.className = "sway-modal";

        modal.innerHTML =
            '<div class="sway-modal-backdrop"></div>' +
            '<div class="sway-modal-card" role="dialog" aria-modal="true">' +
                '<div class="sway-modal-header">' +
                    '<div>' +
                        '<span class="admin-label">Swayphics workspace</span>' +
                        '<h3>' +
                            esc(title) +
                        "</h3>" +
                    "</div>" +
                    '<button class="sway-modal-close" type="button" aria-label="Close">×</button>' +
                "</div>" +
                '<form class="sway-form-grid" id="sway-dynamic-form"></form>' +
            "</div>";

        document.body.appendChild(modal);

        const form =
            modal.querySelector(
                "#sway-dynamic-form"
            );

        form.innerHTML =
            fields.map(function (field) {
                let control = "";

                const value =
                    field.value == null
                        ? ""
                        : field.value;

                if (field.type === "textarea") {
                    control =
                        '<textarea id="sway-field-' +
                        esc(field.key) +
                        '" rows="4">' +
                        esc(value) +
                        "</textarea>";
                } else if (field.type === "select") {
                    control =
                        '<select id="sway-field-' +
                        esc(field.key) +
                        '">' +
                        field.options +
                        "</select>";
                } else {
                    control =
                        '<input id="sway-field-' +
                        esc(field.key) +
                        '" type="' +
                        esc(
                            field.type ||
                            "text"
                        ) +
                        '" value="' +
                        esc(value) +
                        '"' +
                        (
                            field.required
                                ? " required"
                                : ""
                        ) +
                        ">";
                }

                return (
                    '<div class="sway-form-field ' +
                    (
                        field.full
                            ? "full"
                            : ""
                    ) +
                    '">' +
                        '<label for="sway-field-' +
                            esc(field.key) +
                        '">' +
                            esc(field.label) +
                        "</label>" +
                        control +
                        (
                            field.help
                                ? "<small>" +
                                  esc(field.help) +
                                  "</small>"
                                : ""
                        ) +
                    "</div>"
                );
            }).join("") +

            '<div class="sway-form-field full">' +
                '<div class="sway-modal-actions">' +
                    '<button type="button" class="sway-workspace-button" data-close>Cancel</button>' +
                    '<button type="submit" class="sway-workspace-button primary">Save</button>' +
                "</div>" +
            "</div>";

        function close() {
            modal.remove();
        }

        modal
            .querySelector("[data-close]")
            .addEventListener(
                "click",
                close
            );

        modal
            .querySelector(".sway-modal-close")
            .addEventListener(
                "click",
                close
            );

        modal
            .querySelector(".sway-modal-backdrop")
            .addEventListener(
                "click",
                close
            );

        form.addEventListener(
            "submit",
            async function (event) {
                event.preventDefault();

                const payload = {};

                fields.forEach(function (field) {
                    const element =
                        form.querySelector(
                            "#sway-field-" +
                            CSS.escape(
                                field.key
                            )
                        );

                    if (!element) return;

                    let value = element.value;

                    if (field.type === "number") {
                        value =
                            value === ""
                                ? null
                                : Number(value);
                    }

                    if (
                        field.type === "select" &&
                        ["published", "active", "vat_registered"].includes(field.key)
                    ) {
                        value =
                            value === "true";
                    }

                    if (
                        [
                            "assigned_to",
                            "client_id",
                            "project_id",
                            "lead_id",
                            "invoice_id"
                        ].includes(field.key) &&
                        value === ""
                    ) {
                        value = null;
                    }

                    payload[field.key] = value;
                });

                if (
                    title.toLowerCase().includes("task") &&
                    !payload.assigned_to
                ) {
                    payload.assigned_to =
                        state.currentUser.id;
                }

                const submitButton =
                    form.querySelector(
                        'button[type="submit"]'
                    );

                submitButton.disabled = true;
                submitButton.textContent = "Saving...";

                try {
                    await onSubmit(payload);
                    close();
                    await refreshData();
                    renderShell();
                    renderView();
                } catch (error) {
                    swayAlert(
                        error.message ||
                        "Unable to save record."
                    );

                    submitButton.disabled = false;
                    submitButton.textContent = "Save";
                }
            }
        );
    }

    async function createOrEdit(type, id) {
        const config = configs[type];

        if (!config) return;

        if (
            type === "team" &&
            state.currentAdmin.role !== "owner"
        ) {
            swayAlert(
                "Only the owner can manage team access."
            );
            return;
        }

        const list =
            type === "projects"
                ? state.projects
                : type === "team"
                    ? state.admins
                    : state[type];

        const item =
            id
                ? (
                    list.find(function (entry) {
                        return (
                            entry.id === id ||
                            entry.user_id === id
                        );
                    }) || {}
                )
                : {};

        const fields =
            config.fields(item);

        showModal(
            (id ? "Edit " : "New ") +
            config.title,
            fields,
            async function (payload) {
                if (
                    type === "team" &&
                    state.currentAdmin.role !== "owner"
                ) {
                    throw new Error(
                        "Only the owner can manage team access."
                    );
                }

                if (
                    type === "team" &&
                    id
                ) {
                    await api(
                        "/rest/v1/admin_users?user_id=eq." +
                        encodeURIComponent(id),
                        {
                            method: "PATCH",
                            headers: headers({
                                "Prefer":
                                    "return=minimal"
                            }),
                            body:
                                JSON.stringify(
                                    payload
                                )
                        }
                    );
                } else {
                    const endpoint =
                        "/rest/v1/" +
                        config.table +
                        (
                            id
                                ? "?id=eq." +
                                  encodeURIComponent(id)
                                : ""
                        );

                    await api(
                        endpoint,
                        {
                            method:
                                id
                                    ? "PATCH"
                                    : "POST",
                            headers: headers({
                                "Prefer":
                                    id
                                        ? "return=minimal"
                                        : "return=representation"
                            }),
                            body:
                                JSON.stringify(
                                    payload
                                )
                        }
                    );
                }

                await logActivity(
                    (
                        id
                            ? "Updated "
                            : "Created "
                    ) +
                    config.title.toLowerCase(),
                    config.table,
                    id || null
                );
            }
        );
    }

    async function removeRecord(type, id) {
        const config = configs[type];

        if (!config) return;

        if (
            type === "team"
        ) {
            if (
                state.currentAdmin.role !== "owner"
            ) {
                swayAlert(
                    "Only the owner can manage team access."
                );
                return;
            }

            swayAlert(
                "Use Activate, Deactivate or Edit for team members. Team members are not deleted from this workspace."
            );
            return;
        }

        if (
            !(await swayConfirm(
                "Delete this " +
                config.title.toLowerCase() +
                "?"
            ))
        ) {
            return;
        }

        await api(
            "/rest/v1/" +
            config.table +
            "?id=eq." +
            encodeURIComponent(id),
            {
                method: "DELETE",
                headers: headers({
                    "Prefer":
                        "return=minimal"
                })
            }
        );

        await logActivity(
            "Deleted " +
            config.title.toLowerCase(),
            config.table,
            id
        );

        await refreshData();
        renderShell();
        renderView();
    }

    async function completeTask(id) {
        await api(
            "/rest/v1/tasks?id=eq." +
            encodeURIComponent(id),
            {
                method: "PATCH",
                headers: headers({
                    "Prefer":
                        "return=minimal"
                }),
                body:
                    JSON.stringify({
                        status: "completed",
                        completed_at:
                            new Date().toISOString()
                    })
            }
        );

        await logActivity(
            "Completed task",
            "tasks",
            id
        );

        await refreshData();
        renderShell();
        renderView();
    }

    async function completeFollowup(id) {
        await api(
            "/rest/v1/follow_ups?id=eq." +
            encodeURIComponent(id),
            {
                method: "PATCH",
                headers: headers({
                    "Prefer":
                        "return=minimal"
                }),
                body:
                    JSON.stringify({
                        status: "completed",
                        completed_at:
                            new Date().toISOString()
                    })
            }
        );

        await logActivity(
            "Completed follow-up",
            "follow_ups",
            id
        );

        await refreshData();
        renderShell();
        renderView();
    }

    async function convertLead(id) {
        const lead =
            state.leads.find(function (item) {
                return item.id === id;
            });

        if (!lead) return;

        if (
            !(await swayConfirm(
                "Convert " +
                lead.business_name +
                " into a client?"
            ))
        ) {
            return;
        }

        let clientId = null;

        const existing =
            state.clients.find(function (item) {
                return (
                    item.email &&
                    lead.email &&
                    item.email.toLowerCase() ===
                    lead.email.toLowerCase()
                );
            });

        if (existing) {
            clientId = existing.id;
        } else {
            const created =
                await api(
                    "/rest/v1/clients",
                    {
                        method: "POST",
                        headers: headers({
                            "Prefer":
                                "return=representation"
                        }),
                        body:
                            JSON.stringify({
                                business_name:
                                    lead.business_name,
                                contact_name:
                                    lead.contact_name,
                                email:
                                    lead.email,
                                phone:
                                    lead.phone,
                                assigned_to:
                                    lead.assigned_to ||
                                    state.currentAdmin.user_id,
                                status:
                                    "active",
                                notes:
                                    lead.notes
                            })
                    }
                );

            clientId =
                Array.isArray(created) &&
                created[0]
                    ? created[0].id
                    : null;
        }

        await api(
            "/rest/v1/leads?id=eq." +
            encodeURIComponent(id),
            {
                method: "PATCH",
                headers: headers({
                    "Prefer":
                        "return=minimal"
                }),
                body:
                    JSON.stringify({
                        status: "won",
                        converted_client_id:
                            clientId
                    })
            }
        );

        await logActivity(
            "Converted lead to client",
            "leads",
            id
        );

        await refreshData();
        renderShell();
        renderView();
    }

    async function updateEnquiryStatus(
        id,
        status
    ) {
        await api(
            "/rest/v1/website_enquiries?id=eq." +
            encodeURIComponent(id),
            {
                method: "PATCH",
                headers: headers({
                    "Prefer":
                        "return=minimal"
                }),
                body:
                    JSON.stringify({
                        status: status
                    })
            }
        );

        await logActivity(
            "Updated website enquiry to " +
            status,
            "website_enquiries",
            id
        );

        await refreshData();
        renderShell();
        renderView();
    }

    async function toggleAdmin(id) {
        if (
            state.currentAdmin.role !== "owner"
        ) {
            return;
        }

        const member =
            state.admins.find(function (item) {
                return item.user_id === id;
            });

        if (!member) return;

        await api(
            "/rest/v1/admin_users?user_id=eq." +
            encodeURIComponent(id),
            {
                method: "PATCH",
                headers: headers({
                    "Prefer":
                        "return=minimal"
                }),
                body:
                    JSON.stringify({
                        active:
                            !member.active
                    })
            }
        );

        await logActivity(
            (
                member.active
                    ? "Deactivated "
                    : "Activated "
            ) +
            "team member",
            "admin_users",
            id
        );

        await refreshData();
        renderShell();
        renderView();
    }

    async function logActivity(
        action,
        entityType,
        entityId
    ) {
        try {
            await api(
                "/rest/v1/activity_log",
                {
                    method: "POST",
                    headers: headers({
                        "Prefer":
                            "return=minimal"
                    }),
                    body:
                        JSON.stringify({
                            actor_id:
                                state.currentUser.id,
                            action:
                                action,
                            entity_type:
                                entityType,
                            entity_id:
                                entityId ||
                                null
                        })
                }
            );
        } catch (error) {
            console.warn(
                "Activity log write failed.",
                error
            );
        }
    }

    function renderView() {
        const main =
            document.getElementById(
                "sway-workspace-main"
            );

        if (!main) return;

        try {
            if (state.currentView === "overview") {
                main.innerHTML =
                    renderOverview();
            }

            if (state.currentView === "insights") {
                main.innerHTML =
                    renderInsights();
            }

            if (state.currentView === "tasks") {
                main.innerHTML =
                    renderTasks();
            }

            if (state.currentView === "leads") {
                main.innerHTML =
                    renderLeads();
            }

            if (state.currentView === "followups") {
                main.innerHTML =
                    renderFollowups();
            }

            if (state.currentView === "clients") {
                main.innerHTML =
                    renderClients();
            }

            if (state.currentView === "projects") {
                main.innerHTML =
                    renderProjects();
            }

            if (state.currentView === "quotes") {
                main.innerHTML =
                    renderQuotes();
            }

            if (state.currentView === "payments") {
                main.innerHTML =
                    renderPayments();
            }

            if (state.currentView === "invoices") {
                main.innerHTML =
                    renderInvoices();
            }

            if (state.currentView === "services") {
                main.innerHTML =
                    renderServices();
            }

            if (state.currentView === "invoice-settings") {
                main.innerHTML =
                    renderInvoiceSettings();
            }

            if (state.currentView === "enquiries") {
                main.innerHTML =
                    renderEnquiries();
            }

            if (state.currentView === "content") {
                main.innerHTML =
                    renderContent();
            }

            if (state.currentView === "activity") {
                main.innerHTML =
                    renderActivity();
            }

            if (state.currentView === "team") {
                main.innerHTML =
                    renderTeam();
            }

            bindViewActions();
        } catch (error) {
            main.innerHTML =
                '<div class="sway-error">' +
                esc(error.message) +
                "</div>";
        }
    }

    function bindViewActions() {

        workspace
            .querySelectorAll("[data-refresh-workspace]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    async function () {
                        button.disabled = true;
                        const originalText =
                            button.textContent;

                        button.textContent =
                            "Refreshing...";

                        try {
                            await refreshData();

                            state.lastLiveUpdate =
                                Date.now();

                            renderShell();
                            renderView();
                        } catch (error) {
                            swayAlert(
                                error.message ||
                                "Unable to refresh workspace data."
                            );

                            button.disabled = false;
                            button.textContent =
                                originalText;
                        }
                    }
                );
            });

        workspace
            .querySelectorAll("[data-invoice-action]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    async function () {
                        const action =
                            button.dataset.invoiceAction;

                        const id =
                            button.dataset.id;

                        try {
                            button.disabled = true;

                            if (action === "edit") {
                                await openInvoiceBuilder(id);
                            }

                            if (action === "pdf") {
                                await downloadInvoicePdf(id);
                            }

                            if (action === "send") {
                                await sendInvoiceById(
                                    id,
                                    true
                                );

                                await logActivity(
                                    "Sent invoice",
                                    "invoices",
                                    id
                                );

                                await refreshData();
                                renderShell();
                                renderView();
                            }

                            if (action === "delete") {
                                if (
                                    !(await swayConfirm(
                                        "Delete this draft invoice? This cannot be undone."
                                    ))
                                ) {
                                    return;
                                }

                                await api(
                                    "/rest/v1/invoice_items?invoice_id=eq." +
                                    encodeURIComponent(id),
                                    {
                                        method: "DELETE",
                                        headers: headers({
                                            "Prefer":
                                                "return=minimal"
                                        })
                                    }
                                );

                                await api(
                                    "/rest/v1/invoices?id=eq." +
                                    encodeURIComponent(id),
                                    {
                                        method: "DELETE",
                                        headers: headers({
                                            "Prefer":
                                                "return=minimal"
                                        })
                                    }
                                );

                                await logActivity(
                                    "Deleted invoice draft",
                                    "invoices",
                                    id
                                );

                                await refreshData();
                                renderShell();
                                renderView();
                            }
                        } catch (error) {
                            swayAlert(
                                error.message ||
                                "Unable to process invoice."
                            );
                        } finally {
                            button.disabled = false;
                        }
                    }
                );
            });

        workspace
            .querySelectorAll("[data-add-invoice]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        openInvoiceBuilder(null);
                    }
                );
            });

        workspace
            .querySelectorAll("[data-settings-edit]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        editInvoiceSettings();
                    }
                );
            });

        workspace
            .querySelectorAll("[data-add]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        createOrEdit(
                            button.dataset.add,
                            null
                        );
                    }
                );
            });

        workspace
            .querySelectorAll("[data-edit]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        createOrEdit(
                            button.dataset.edit,
                            button.dataset.id
                        );
                    }
                );
            });

        workspace
            .querySelectorAll("[data-delete]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        removeRecord(
                            button.dataset.delete,
                            button.dataset.id
                        );
                    }
                );
            });

        workspace
            .querySelectorAll("[data-complete-task]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        completeTask(
                            button.dataset.completeTask
                        );
                    }
                );
            });

        workspace
            .querySelectorAll("[data-complete-followup]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        completeFollowup(
                            button.dataset.completeFollowup
                        );
                    }
                );
            });

        workspace
            .querySelectorAll("[data-convert-lead]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        convertLead(
                            button.dataset.convertLead
                        );
                    }
                );
            });

        workspace
            .querySelectorAll("[data-enquiry-status]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        updateEnquiryStatus(
                            button.dataset.enquiryStatus,
                            button.dataset.statusNext
                        );
                    }
                );
            });

        workspace
            .querySelectorAll("[data-toggle-admin]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        toggleAdmin(
                            button.dataset.toggleAdmin
                        );
                    }
                );
            });

        workspace
            .querySelectorAll("[data-quick]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        const type =
                            button.dataset.quick;

                        if (type === "task") {
                            createOrEdit(
                                "tasks",
                                null
                            );
                        }

                        if (type === "lead") {
                            createOrEdit(
                                "leads",
                                null
                            );
                        }

                        if (type === "client") {
                            createOrEdit(
                                "clients",
                                null
                            );
                        }

                        if (type === "project") {
                            createOrEdit(
                                "projects",
                                null
                            );
                        }


                        if (type === "followup") {
                            createOrEdit(
                                "followups",
                                null
                            );
                        }

                        if (type === "invoice") {
                            openInvoiceBuilder(
                                null
                            );
                        }
                    }
                );
            });

        workspace
            .querySelectorAll("[data-view-target]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        state.currentView =
                            button.dataset.viewTarget;

                        renderShell();
                        renderView();
                    }
                );
            });
    }

    async function boot() {
        workspace.innerHTML =
            '<div class="sway-loading">Loading the Swayphics workspace...</div>';

        try {
            await loadState();

            state.lastLiveUpdate =
                Date.now();

            renderShell();
            renderView();
            setupRealtime();
        } catch (error) {
            workspace.innerHTML =
                '<div class="sway-error">' +
                    esc(error.message) +
                    '<br><br><strong>Workspace setup:</strong> confirm that the Swayphics admin SQL has been run in Supabase and that your account exists in admin_users.' +
                "</div>";

            console.error(
                "Swayphics workspace failed to load:",
                error
            );
        }
    }

    boot();
})();
