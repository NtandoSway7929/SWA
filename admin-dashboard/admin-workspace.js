
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
        realtimeClient: null,
        syncInFlight: false,
        syncQueued: false,
        backgroundSyncTimer: null,
        initialDataLoaded: false,
        initialDataLoading: false,
        initialDataError: null,
        communications: [],
        documents: [],
        leadStageHistory: [],
        portalRequests: [],
        portalTokens: [],
        socialAccounts: [],
        socialPosts: [],
        socialMetrics: []
    };

    const navGroups = [
        {
            id: "overview",
            label: "Overview",
            icon: "grid",
            items: [
                ["overview", "Overview"],
                ["insights", "Insights"],
                ["reminders", "Automated reminders"]
            ]
        },
        {
            id: "crm",
            label: "Clients & Pipeline",
            icon: "users",
            items: [
                ["enquiries", "Enquiries"],
                ["leads", "Leads"],
                ["clients", "Clients"],
                ["communications", "Communication log"],
                ["email", "Email"],
                ["documents", "Documents"],
                ["followups", "Follow-ups"]
            ]
        },
        {
            id: "delivery",
            label: "Work & Portfolio",
            icon: "briefcase",
            items: [
                ["projects", "Projects"],
                ["tasks", "Tasks"],
                ["portfolio", "Portfolio"]
            ]
        },
        {
            id: "billing",
            label: "Sales & Billing",
            icon: "receipt",
            items: [
                ["quotes", "Quotes"],
                ["invoices", "Invoices"],
                ["payments", "Payments"],
                ["services", "Services"],
                ["invoice-settings", "Invoice settings"]
            ]
        },
        {
            id: "website",
            label: "Website",
            icon: "globe",
            items: [
                ["content", "Website content"],
                ["testimonials", "Testimonials"]
            ]
        },
        {
            id: "admin",
            label: "Administration",
            icon: "settings",
            items: [
                ["activity", "Activity"],
                ["portal-requests", "Portal requests"],
                ["data-export", "Data & backup"],
                ["team", "Team"]
            ]
        }
    ];

    const nav = navGroups.reduce(function (all, group) {
        return all.concat(group.items);
    }, []);

    function navGroupIcon(name) {
        const icons = {
            grid:
                '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1"></rect><rect x="14" y="4" width="6" height="6" rx="1"></rect><rect x="4" y="14" width="6" height="6" rx="1"></rect><rect x="14" y="14" width="6" height="6" rx="1"></rect></svg>',
            users:
                '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"></circle><path d="M3.8 19c.5-3.2 2.3-4.8 5.2-4.8s4.7 1.6 5.2 4.8"></path><path d="M15 5.4c2.5-.2 4.1 1.5 4.1 3.5 0 1.5-.8 2.7-2.1 3.2"></path><path d="M16.1 14.2c2.4.4 3.8 2 4.1 4.8"></path></svg>',
            briefcase:
                '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="7" width="17" height="12.5" rx="2"></rect><path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7"></path><path d="M3.8 11h16.4"></path><path d="M10 11v2h4v-2"></path></svg>',
            receipt:
                '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.8h12v16.4l-3-1.7-3 1.7-3-1.7-3 1.7z"></path><path d="M9 8h6"></path><path d="M9 11.5h6"></path><path d="M9 15h3.5"></path></svg>',
            globe:
                '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"></circle><path d="M3.7 12h16.6"></path><path d="M12 3.5c2.2 2.3 3.3 5.1 3.3 8.5s-1.1 6.2-3.3 8.5c-2.2-2.3-3.3-5.1-3.3-8.5S9.8 5.8 12 3.5z"></path></svg>',
            share:
                '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6.5" cy="12" r="2.5"></circle><circle cx="17.5" cy="5.5" r="2.5"></circle><circle cx="17.5" cy="18.5" r="2.5"></circle><path d="M8.7 10.8l6.5-3.8"></path><path d="M8.7 13.2l6.5 3.8"></path></svg>',
            settings:
                '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.8l1.2 1.9 2.3.5 2 .2.7 2.2-.9 2.1 1.1 2 2 .9-.7 2.2-2.1.2-1.7 1.6.1 2.1-2 1.1-1.8-1.1-2.1.1-1.1 2-2.2-.7-.2-2.1-1.7-1.7-2.1-.2-.9-2.1 2-1.1 1-2-.9-2.1.7-2.2 2-.2 2.1.5L12 3.8z"></path><circle cx="12" cy="12" r="2.8"></circle></svg>'
        };

        return icons[name] || icons.grid;
    }

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

    async function optionalApi(path, fallback) {
        try {
            return await api(path);
        } catch (error) {
            console.warn("Optional workspace resource unavailable:", path, error);
            return fallback == null ? [] : fallback;
        }
    }

    function esc(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }


    function formatDisplayText(value) {
        return String(value == null ? "" : value)
            .replace(/_/g, " ")
            .replace(/\s+/g, " ")
            .replace(/\b([a-z])/g, function (match, character) {
                return character.toUpperCase();
            });
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

    function dateTimeInput(value) {
        const parsed = parseDashboardDate(value);

        if (!parsed) return "";

        const parts =
            new Intl.DateTimeFormat(
                "en-CA",
                {
                    timeZone: SOUTH_AFRICA_TIME_ZONE,
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
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
            "T" +
            map.hour +
            ":" +
            map.minute
        );
    }

    function socialDateTimeInput(value) {
        if (!value) {
            return "";
        }

        const parsed = new Date(value);

        if (Number.isNaN(parsed.getTime())) {
            return String(value).slice(0, 16);
        }

        const offset =
            parsed.getTimezoneOffset() * 60000;

        return new Date(
            parsed.getTime() - offset
        ).toISOString().slice(0, 16);
    }

    function dateTime(value) {
        if (!value) return "—";

        const parsed = parseDashboardDate(value);

        if (!parsed) {
            return String(value);
        }

        return parsed.toLocaleString(
            "en-ZA",
            {
                timeZone: SOUTH_AFRICA_TIME_ZONE,
                day: "2-digit",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hourCycle: "h23"
            }
        );
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

    function leadAssessmentStatus(item) {
        const value = item || {};

        const completed =
            [
                value.business_assessment,
                value.research_findings,
                value.swayphics_solution,
                value.recommended_services
            ].filter(function (entry) {
                return String(entry || "").trim().length > 0;
            }).length;

        return completed >= 3
            ? "Assessed"
            : completed > 0
                ? "In progress"
                : "Needs research";
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
                "interested",
                "follow-up"
            ].includes(lower)
        ) {
            className = "warning";
        }

        return (
            '<span class="sway-chip ' +
            className +
            '">' +
            esc(formatDisplayText(text)) +
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

    function decodeAccessTokenUser() {
        const accessToken = token();

        if (!accessToken) {
            return null;
        }

        try {
            const parts = accessToken.split(".");

            if (parts.length < 2) {
                return null;
            }

            const payload =
                parts[1]
                    .replace(/-/g, "+")
                    .replace(/_/g, "/");

            const padded =
                payload +
                "=".repeat(
                    (4 - payload.length % 4) % 4
                );

            const claims =
                JSON.parse(
                    atob(padded)
                );

            if (!claims.sub) {
                return null;
            }

            return {
                id: claims.sub,
                email: claims.email || ""
            };
        } catch (error) {
            return null;
        }
    }


    function workspaceCacheKey() {
        return (
            "swayphics_admin_workspace_snapshot_" +
            String(
                state.currentUser && state.currentUser.id
                    ? state.currentUser.id
                    : "guest"
            )
        );
    }

    function saveWorkspaceSnapshot() {
        if (
            !state.currentUser ||
            !state.currentUser.id
        ) {
            return;
        }

        try {
            sessionStorage.setItem(
                workspaceCacheKey(),
                JSON.stringify({
                    version: 1,
                    saved_at: Date.now(),
                    admins: state.admins,
                    tasks: state.tasks,
                    leads: state.leads,
                    followups: state.followups,
                    clients: state.clients,
                    projects: state.projects,
                    quotes: state.quotes,
                    payments: state.payments,
                    enquiries: state.enquiries,
                    activities: state.activities,
                    announcements: state.announcements,
                    services: state.services,
                    invoices: state.invoices,
                    invoiceSettings: state.invoiceSettings,
                    communications: state.communications,
                    documents: state.documents,
                    leadStageHistory: state.leadStageHistory,
                    portalRequests: state.portalRequests,
                    portalTokens: state.portalTokens
                })
            );
        } catch (error) {
            // Cache is an optimisation only.
        }
    }

    function restoreWorkspaceSnapshot() {
        if (
            !state.currentUser ||
            !state.currentUser.id
        ) {
            return false;
        }

        try {
            const raw =
                sessionStorage.getItem(
                    workspaceCacheKey()
                );

            if (!raw) {
                return false;
            }

            const snapshot =
                JSON.parse(raw);

            if (
                !snapshot ||
                snapshot.version !== 1
            ) {
                return false;
            }

            const collections = [
                "admins",
                "tasks",
                "leads",
                "followups",
                "clients",
                "projects",
                "quotes",
                "payments",
                "enquiries",
                "activities",
                "announcements",
                "services",
                "invoices",
                "communications",
                "documents",
                "leadStageHistory",
                "portalRequests",
                "portalTokens"
            ];

            collections.forEach(function (key) {
                if (Array.isArray(snapshot[key])) {
                    state[key] =
                        snapshot[key];
                }
            });

            if (
                Object.prototype.hasOwnProperty.call(
                    snapshot,
                    "invoiceSettings"
                )
            ) {
                state.invoiceSettings =
                    snapshot.invoiceSettings;
            }

            state.currentAdmin =
                state.admins.find(function (item) {
                    return (
                        item.user_id === state.currentUser.id &&
                        item.active === true
                    );
                }) || state.currentAdmin;

            state.initialDataLoaded = true;
            state.initialDataLoading = false;

            return true;
        } catch (error) {
            return false;
        }
    }

    async function loadState() {
        const decodedUser =
            decodeAccessTokenUser();

        if (decodedUser) {
            state.currentUser =
                decodedUser;
        } else {
            const currentUserResponse =
                await api(
                    "/auth/v1/user",
                    {
                        method: "GET"
                    }
                );

            state.currentUser =
                currentUserResponse;
        }

        const admins =
            await api(
                "/rest/v1/admin_users?select=user_id,full_name,email,role,active,created_at&order=created_at.asc"
            );

        state.admins =
            Array.isArray(admins)
                ? admins
                : [];

        state.currentAdmin =
            state.admins.find(function (item) {
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

        // Do not render stale session data during startup. The workspace
        // should load the current Supabase records rather than briefly showing
        // an older snapshot and then replacing it.
    }

    async function refreshData() {
        const results = await Promise.all([
            api("/rest/v1/tasks?select=*&order=created_at.desc"),
            api("/rest/v1/leads?select=*&order=created_at.desc"),
            api("/rest/v1/follow_ups?select=*&order=scheduled_for.asc"),
            api("/rest/v1/clients?select=*&order=created_at.desc"),
            api("/rest/v1/client_projects?select=*&order=created_at.desc"),
            api("/rest/v1/quotes?select=*&order=created_at.desc"),
            api("/rest/v1/payments?select=*&order=created_at.desc"),
            api("/rest/v1/website_enquiries?select=*&order=created_at.desc"),
            api("/rest/v1/activity_log?select=*&order=created_at.desc&limit=20"),
            api("/rest/v1/site_announcements?select=*&order=created_at.desc"),
            api("/rest/v1/invoices?select=*&order=created_at.desc")
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
        state.invoices = results[10] || [];

        state.initialDataLoaded = true;
        state.initialDataLoading = false;
        state.initialDataError = null;

        state.currentAdmin =
            state.admins.find(function (item) {
                return (
                    item.user_id === state.currentUser.id &&
                    item.active === true
                );
            }) || state.currentAdmin;

        saveWorkspaceSnapshot();
    }

    async function refreshSecondaryData() {
        const results = await Promise.all([
            optionalApi(
                "/rest/v1/communication_logs?select=*&order=contacted_at.desc",
                []
            ),
            optionalApi(
                "/rest/v1/client_documents?select=*&order=created_at.desc",
                []
            ),
            optionalApi(
                "/rest/v1/lead_stage_history?select=*&order=changed_at.asc",
                []
            ),
            optionalApi(
                "/rest/v1/client_portal_requests?select=*&order=created_at.desc",
                []
            ),
            optionalApi(
                "/rest/v1/client_portal_tokens?select=id,client_id,active,expires_at,last_used_at,created_at&order=created_at.desc",
                []
            ),
        ]);

        state.communications = results[0] || [];
        state.documents = results[1] || [];
        state.leadStageHistory = results[2] || [];
        state.portalRequests = results[3] || [];
        state.portalTokens = results[4] || [];
        saveWorkspaceSnapshot();
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
            reminders: [
                "Automated reminders",
                "Keep stale leads, quotes and invoices from going quiet."
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
            "portal-requests": [
                "Portal requests",
                "Review requests submitted by clients from their private portal."
            ],
            "data-export": [
                "Data & backup",
                "Export Swayphics workspace records for offline backup."
            ],
            team: [
                "Team",
                "Manage who can use the Swayphics workspace."
            ],
            communications: [
                "Communication log",
                "Record and review every important client and lead interaction."
            ],
            email: [
                "Email",
                "Send branded Swayphics emails from info@swayphics.co.za and automatically record them."
            ],
            documents: [
                "Documents",
                "Keep private client and project files attached to the work they belong to."
            ],
            portfolio: [
                "Portfolio",
                "Manage public Swayphics portfolio work."
            ],
            testimonials: [
                "Testimonials",
                "Review client feedback connected to the website."
            ],
            "social-overview": [
                "Social media",
                "Bring your Swayphics social accounts, publishing workflow and performance into one workspace."
            ],
            "social-content": [
                "Social content",
                "Prepare, organise and track content before it is published through the official platform integrations."
            ],
            "social-analytics": [
                "Social performance",
                "Monitor audience growth, reach, engagement and traffic once platform integrations are connected."
            ]
        };

        return meta[view] || meta.overview;
    }

    function navButton(item) {
        const view = item[0];
        let count = "";

        if (view === "tasks" && state.currentUser && state.currentUser.id) {
            count = state.tasks.filter(function (item) {
                return (
                    item.status !== "completed" &&
                    item.assigned_to === state.currentUser.id
                );
            }).length;
        }

        if (view === "leads") {
            count = state.leads.filter(function (item) {
                return !["won", "lost", "follow-up"].includes(item.status);
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

        if (view === "portal-requests") {
            count = state.portalRequests.filter(function (item) {
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
            esc(formatDisplayText(item[1])) +
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

    function setStandaloneManagerVisibility(view) {
        const portfolioManager = document.querySelector(".portfolio-manager");
        const testimonialsSection = document.getElementById("testimonials-admin-section");

        if (portfolioManager) {
            const showPortfolio = view === "portfolio";
            portfolioManager.hidden = !showPortfolio;
            portfolioManager.setAttribute("aria-hidden", String(!showPortfolio));
        }

        if (testimonialsSection) {
            const showTestimonials = view === "testimonials";
            testimonialsSection.hidden = !showTestimonials;
            testimonialsSection.setAttribute("aria-hidden", String(!showTestimonials));
        }
    }

    function searchRecordTitle(item, type) {
        const value = item || {};

        return (
            value.business_name ||
            value.name ||
            value.title ||
            value.subject ||
            value.invoice_number ||
            value.quote_number ||
            value.reference ||
            value.email ||
            value.full_name ||
            value.description ||
            "Untitled record"
        );
    }

    function searchRecordMeta(item, type) {
        const value = item || {};
        const parts = [];

        if (value.status) {
            parts.push(formatDisplayText(value.status));
        }

        if (type === "enquiries" && value.email) {
            parts.push(value.email);
        }

        if (type === "leads" && value.email) {
            parts.push(value.email);
        }

        if (type === "clients" && value.email) {
            parts.push(value.email);
        }

        if (type === "projects" && value.client_id) {
            parts.push(clientName(value.client_id));
        }

        if (type === "tasks") {
            if (value.client_id) {
                parts.push(clientName(value.client_id));
            } else if (value.project_id) {
                parts.push(projectName(value.project_id));
            }
        }

        if (type === "quotes" && value.client_id) {
            parts.push(clientName(value.client_id));
        }

        if (type === "invoices" && value.client_id) {
            parts.push(clientName(value.client_id));
        }

        if (type === "payments") {
            if (value.client_id) {
                parts.push(clientName(value.client_id));
            }
            if (value.invoice_id) {
                const invoice = state.invoices.find(function (entry) {
                    return entry.id === value.invoice_id;
                });

                if (invoice && invoice.invoice_number) {
                    parts.push(invoice.invoice_number);
                }
            }
        }

        if (type === "followups" && value.client_id) {
            parts.push(clientName(value.client_id));
        }

        if (type === "activities" && value.entity_type) {
            parts.push(formatDisplayText(value.entity_type));
        }

        if (type === "communications") {
            if (value.client_id) {
                parts.push(clientName(value.client_id));
            } else if (value.lead_id) {
                parts.push(leadName(value.lead_id));
            }

            if (value.channel) {
                parts.push(value.channel);
            }
        }

        return parts.filter(Boolean).slice(0, 2).join(" · ");
    }

    function searchRecordData() {
        const sources = [
            ["enquiries", "Enquiry", state.enquiries],
            ["leads", "Lead", state.leads],
            ["clients", "Client", state.clients],
            ["followups", "Follow-up", state.followups],
            ["projects", "Project", state.projects],
            ["tasks", "Task", state.tasks],
            ["quotes", "Quote", state.quotes],
            ["invoices", "Invoice", state.invoices],
            ["payments", "Payment", state.payments],
            ["communications", "Communication", state.communications],
            ["email", "Email", state.communications],
            ["documents", "Document", state.documents],
            ["portal-requests", "Portal request", state.portalRequests],
            ["services", "Service", state.services],
            ["announcements", "Announcement", state.announcements],
            ["social-accounts", "Social account", state.socialAccounts],
            ["social-posts", "Social post", state.socialPosts],
            ["activities", "Activity", state.activities],
            ["admins", "Team member", state.admins]
        ];

        return sources.reduce(function (all, source) {
            const type = source[0];
            const label = source[1];
            const records = Array.isArray(source[2]) ? source[2] : [];

            records.forEach(function (item) {
                const title = searchRecordTitle(item, type);
                const meta = searchRecordMeta(item, type);
                const searchable =
                    [
                        title,
                        meta,
                        Object.values(item || {}).join(" ")
                    ]
                    .join(" ")
                    .toLowerCase();

                all.push({
                    type: type,
                    label: label,
                    id: item && item.id ? item.id : "",
                    title: String(title),
                    meta: meta,
                    searchable: searchable
                });
            });

            return all;
        }, []);
    }

    function searchWorkspace(query) {
        const normalized = String(query || "")
            .trim()
            .toLowerCase();

        if (!normalized) return [];

        const words = normalized
            .split(/\s+/)
            .filter(Boolean);

        return searchRecordData()
            .map(function (record) {
                let score = 0;

                words.forEach(function (word) {
                    if (record.title.toLowerCase().includes(word)) {
                        score += 10;
                    } else if (record.meta.toLowerCase().includes(word)) {
                        score += 5;
                    } else if (record.searchable.includes(word)) {
                        score += 2;
                    }
                });

                return Object.assign({ score: score }, record);
            })
            .filter(function (record) {
                return record.score > 0;
            })
            .sort(function (a, b) {
                if (b.score !== a.score) {
                    return b.score - a.score;
                }

                return a.title.localeCompare(b.title);
            })
            .slice(0, 12);
    }

    function searchResultIcon(type) {
        const icons = {
            enquiries: "?",
            leads: "L",
            clients: "C",
            followups: "F",
            projects: "P",
            tasks: "T",
            quotes: "Q",
            invoices: "I",
            payments: "R",
            communications: "C",
            "portal-requests": "R",
            services: "S",
            announcements: "A",
            activities: "↗",
            "social-accounts": "S",
            "social-posts": "P",
            admins: "T"
        };

        return icons[type] || "•";
    }

    function searchResultView(type) {
        return type === "enquiries"
            ? "enquiries"
            : type === "leads"
                ? "leads"
                : type === "clients"
                    ? "clients"
                    : type === "followups"
                        ? "followups"
                        : type === "projects"
                            ? "projects"
                            : type === "tasks"
                                ? "tasks"
                                : type === "quotes"
                                    ? "quotes"
                                    : type === "invoices"
                                        ? "invoices"
                                        : type === "payments"
                                            ? "payments"
                                            : type === "communications"
                                                ? "communications"
                                                : type === "email"
                                                    ? "email"
                                                    : type === "documents"
                                                    ? "documents"
                                                : type === "portal-requests"
                                                    ? "portal-requests"
                                                : type === "services"
                                                ? "services"
                                                : type === "announcements"
                                                    ? "content"
                                                    : type === "activities"
                                                        ? "activity"
                                                        : type === "social-accounts" ||
                                                  type === "social-posts"
                                                    ? "social-content"
                                                    : type === "admins"
                                                        ? "team"
                                                        : "overview";
    }

    function renderGlobalSearchResults(results, query) {
        const resultsBox =
            document.getElementById(
                "admin-global-search-results"
            );

        if (!resultsBox) return;

        if (!String(query || "").trim()) {
            resultsBox.innerHTML =
                '<div class="admin-global-search-hint">' +
                    "Search clients, leads, projects, tasks, quotes, invoices and more." +
                "</div>";

            resultsBox.hidden = false;
            return;
        }

        if (!results.length) {
            resultsBox.innerHTML =
                '<div class="admin-global-search-empty">' +
                    "No matching workspace records found." +
                "</div>";

            resultsBox.hidden = false;
            return;
        }

        resultsBox.innerHTML = results.map(function (result, index) {
            return (
                '<button type="button" class="admin-global-search-result" role="option" data-search-index="' +
                    index +
                '">' +
                    '<span class="admin-global-search-result-icon" aria-hidden="true">' +
                        esc(searchResultIcon(result.type)) +
                    "</span>" +
                    '<span class="admin-global-search-result-copy">' +
                        '<span class="admin-global-search-result-title">' +
                            esc(formatDisplayText(result.title)) +
                        "</span>" +
                        '<span class="admin-global-search-result-meta">' +
                            esc(result.meta || "Workspace record") +
                        "</span>" +
                    "</span>" +
                    '<span class="admin-global-search-result-type">' +
                        esc(result.label) +
                    "</span>" +
                "</button>"
            );
        }).join("");

        resultsBox.hidden = false;
    }

    function closeQuickCreateMenu() {
        const wrapper =
            document.querySelector(".sway-quick-create");

        if (!wrapper) return;

        const menu =
            wrapper.querySelector(".sway-quick-create-menu");

        const toggle =
            wrapper.querySelector(".sway-quick-create-toggle");

        if (menu) {
            menu.hidden = true;
        }

        if (toggle) {
            toggle.setAttribute(
                "aria-expanded",
                "false"
            );
        }

        wrapper.classList.remove("open");
    }

    function closeGlobalSearch() {
        const input = document.getElementById("admin-global-search-input");
        const resultsBox = document.getElementById("admin-global-search-results");

        if (resultsBox) {
            resultsBox.hidden = true;
        }

        if (input) {
            input.setAttribute("aria-expanded", "false");
        }
    }

    function openGlobalSearch() {
        const input = document.getElementById("admin-global-search-input");
        const resultsBox = document.getElementById("admin-global-search-results");

        if (!input) return;

        input.focus();
        renderGlobalSearchResults(
            searchWorkspace(input.value),
            input.value
        );

        if (resultsBox) {
            resultsBox.hidden = false;
        }

        input.setAttribute("aria-expanded", "true");
    }

    function setupGlobalSearch() {
        const input =
            document.getElementById("admin-global-search-input");

        const resultsBox =
            document.getElementById("admin-global-search-results");

        const wrapper =
            document.getElementById("admin-global-search");

        if (!input || !resultsBox || !wrapper) return;

        input.addEventListener("input", function () {
            renderGlobalSearchResults(
                searchWorkspace(input.value),
                input.value
            );

            input.setAttribute("aria-expanded", "true");
        });

        input.addEventListener("focus", function () {
            renderGlobalSearchResults(
                searchWorkspace(input.value),
                input.value
            );

            input.setAttribute("aria-expanded", "true");
        });

        input.addEventListener("keydown", function (event) {
            if (
                event.key === "Escape"
            ) {
                closeGlobalSearch();
                input.blur();
                return;
            }

            if (event.key === "Enter") {
                const first =
                    resultsBox.querySelector(
                        "[data-search-index='0']"
                    );

                if (first) {
                    first.click();
                    event.preventDefault();
                }
            }
        });

        resultsBox.addEventListener("click", function (event) {
            const resultButton =
                event.target.closest(
                    "[data-search-index]"
                );

            if (!resultButton) return;

            const results =
                searchWorkspace(input.value);

            const result =
                results[
                    Number(
                        resultButton.dataset.searchIndex
                    )
                ];

            if (!result) return;

            const view =
                searchResultView(result.type);

            const navButton =
                workspace.querySelector(
                    '[data-view="' +
                    view +
                    '"]'
                );

            if (navButton) {
                navButton.click();
            }

            closeGlobalSearch();
            input.value = "";
        });

        document.addEventListener("click", function (event) {
            if (!wrapper.contains(event.target)) {
                closeGlobalSearch();
            }

            const quickCreate =
                document.querySelector(".sway-quick-create");

            if (
                quickCreate &&
                !quickCreate.contains(event.target)
            ) {
                closeQuickCreateMenu();
            }
        });

        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape") {
                closeQuickCreateMenu();

                const client360Modal =
                    document.getElementById(
                        "sway-client360-modal"
                    );

                if (client360Modal) {
                    client360Modal.remove();
                }
            }

            const isShortcut =
                (event.ctrlKey || event.metaKey) &&
                String(event.key).toLowerCase() === "k";

            if (isShortcut) {
                event.preventDefault();
                openGlobalSearch();
            }
        });
    }



    function notificationReadStorageKey() {
        return (
            "swayphics_admin_notifications_read_" +
            String(
                state.currentUser && state.currentUser.id
                    ? state.currentUser.id
                    : "guest"
            )
        );
    }

    function notificationReadKeys() {
        try {
            const stored =
                JSON.parse(
                    localStorage.getItem(
                        notificationReadStorageKey()
                    ) || "[]"
                );

            return new Set(
                Array.isArray(stored)
                    ? stored.map(String)
                    : []
            );
        } catch (error) {
            return new Set();
        }
    }

    function saveNotificationReadKeys(keys) {
        try {
            localStorage.setItem(
                notificationReadStorageKey(),
                JSON.stringify(
                    Array.from(keys).slice(-250)
                )
            );
        } catch (error) {
            // Notifications remain functional even if localStorage is unavailable.
        }
    }

    function notificationDateValue(item) {
        if (!item) {
            return "";
        }

        return (
            item.created_at ||
            item.updated_at ||
            item.due_date ||
            item.scheduled_for ||
            item.valid_until ||
            ""
        );
    }

    function notificationTimeValue(item) {
        const raw =
            typeof item === "string" ||
            typeof item === "number"
                ? item
                : notificationDateValue(item);

        const time = new Date(raw).getTime();

        return Number.isFinite(time)
            ? time
            : 0;
    }

    function workspaceNotifications() {
        const today = dashboardTodayISO();
        const notifications = [];

        state.enquiries.forEach(function (item) {
            if (item.status !== "new") {
                return;
            }

            notifications.push({
                key:
                    "enquiry:" +
                    String(item.id) +
                    ":new",
                type: "info",
                icon: "?",
                title: "New website enquiry",
                detail:
                    (
                        item.business_name ||
                        item.name ||
                        "Website visitor"
                    ) +
                    (
                        item.service
                            ? " · " +
                              formatDisplayText(item.service)
                            : ""
                    ),
                timestamp:
                    notificationTimeValue(item),
                view: "enquiries"
            });
        });

        state.tasks.forEach(function (item) {
            if (
                item.status === "completed" ||
                item.assigned_to !== state.currentUser.id ||
                !item.due_date
            ) {
                return;
            }

            const due = dashboardDateKey(item.due_date);

            if (!due || due > today) {
                return;
            }

            const overdue = due < today;

            notifications.push({
                key:
                    "task:" +
                    String(item.id) +
                    ":" +
                    due,
                type: overdue ? "danger" : "warning",
                icon: "T",
                title:
                    overdue
                        ? "Task overdue"
                        : "Task due today",
                detail:
                    (item.title || "Untitled task") +
                    (
                        item.client_id
                            ? " · " +
                              clientName(item.client_id)
                            : ""
                    ),
                timestamp:
                    notificationTimeValue(item.due_date),
                view: "tasks"
            });
        });

        state.followups.forEach(function (item) {
            if (
                item.status !== "pending" ||
                item.assigned_to !== state.currentUser.id ||
                !item.scheduled_for
            ) {
                return;
            }

            const scheduled =
                dashboardDateKey(item.scheduled_for);

            if (
                !scheduled ||
                scheduled > today
            ) {
                return;
            }

            const overdue = scheduled < today;
            const contact =
                item.client_id
                    ? clientName(item.client_id)
                    : leadName(item.lead_id);

            notifications.push({
                key:
                    "followup:" +
                    String(item.id) +
                    ":" +
                    scheduled,
                type: overdue ? "danger" : "warning",
                icon: "F",
                title:
                    overdue
                        ? "Follow-up overdue"
                        : "Follow-up due today",
                detail:
                    contact ||
                    "Contact needs follow-up",
                timestamp:
                    notificationTimeValue(item.scheduled_for),
                view: "followups"
            });
        });

        state.invoices.forEach(function (invoice) {
            if (
                invoice.archived === true ||
                invoice.status === "cancelled" ||
                invoice.status === "paid"
            ) {
                return;
            }

            const outstanding = Number(
                invoice.amount_outstanding != null
                    ? invoice.amount_outstanding
                    : invoice.total || 0
            );

            if (outstanding <= 0) {
                return;
            }

            const due =
                dashboardDateKey(invoice.due_date);

            if (
                invoice.status === "overdue" ||
                (due && due < today)
            ) {
                notifications.push({
                    key:
                        "invoice:" +
                        String(invoice.id) +
                        ":overdue:" +
                        due +
                        ":" +
                        outstanding,
                    type: "danger",
                    icon: "I",
                    title: "Invoice overdue",
                    detail:
                        (
                            invoice.invoice_number ||
                            "Outstanding invoice"
                        ) +
                        " · " +
                        clientName(invoice.client_id) +
                        " · " +
                        money(outstanding),
                    timestamp:
                        notificationTimeValue(
                            invoice.due_date ||
                            invoice.updated_at
                        ),
                    view: "invoices"
                });

                return;
            }

            if (due === today) {
                notifications.push({
                    key:
                        "invoice:" +
                        String(invoice.id) +
                        ":today:" +
                        outstanding,
                    type: "warning",
                    icon: "I",
                    title: "Invoice due today",
                    detail:
                        (
                            invoice.invoice_number ||
                            "Invoice"
                        ) +
                        " · " +
                        clientName(invoice.client_id) +
                        " · " +
                        money(outstanding),
                    timestamp:
                        notificationTimeValue(
                            invoice.due_date
                        ),
                    view: "invoices"
                });
            }
        });

        state.portalRequests.forEach(function (item) {
            if (item.status !== "new") {
                return;
            }

            notifications.push({
                key:
                    "portal-request:" +
                    String(item.id) +
                    ":" +
                    String(item.status),
                type: "info",
                icon: "R",
                title: "New client portal request",
                detail:
                    clientName(item.client_id) +
                    " · " +
                    (item.subject || "Client request"),
                timestamp:
                    notificationTimeValue(item.created_at),
                view: "portal-requests"
            });
        });

        state.quotes.forEach(function (quote) {
            if (quote.status !== "sent") {
                return;
            }

            const validUntil =
                dashboardDateKey(quote.valid_until);

            const expired =
                validUntil &&
                validUntil < today;

            notifications.push({
                key:
                    "quote:" +
                    String(quote.id) +
                    ":" +
                    (validUntil || "sent"),
                type: expired ? "warning" : "info",
                icon: "Q",
                title:
                    expired
                        ? "Quote validity expired"
                        : "Quote awaiting response",
                detail:
                    (
                        quote.quote_number ||
                        quote.title ||
                        "Quote"
                    ) +
                    " · " +
                    clientName(quote.client_id) +
                    " · " +
                    money(quote.amount),
                timestamp:
                    notificationTimeValue(
                        quote.updated_at ||
                        quote.created_at ||
                        quote.valid_until
                    ),
                view: "quotes"
            });
        });

        const recentPaymentCutoff =
            Date.now() -
            (3 * 24 * 60 * 60 * 1000);

        state.payments.forEach(function (payment) {
            const timestamp =
                notificationTimeValue(payment);

            if (
                !timestamp ||
                timestamp < recentPaymentCutoff
            ) {
                return;
            }

            notifications.push({
                key:
                    "payment:" +
                    String(payment.id) +
                    ":" +
                    String(payment.amount),
                type: "success",
                icon: "✓",
                title: "Payment received",
                detail:
                    (
                        payment.reference ||
                        payment.payment_reference ||
                        "Client payment"
                    ) +
                    " · " +
                    money(payment.amount) +
                    (
                        payment.client_id
                            ? " · " +
                              clientName(payment.client_id)
                            : ""
                    ),
                timestamp: timestamp,
                view: "payments"
            });
        });

        const priority = {
            danger: 0,
            warning: 1,
            info: 2,
            success: 3
        };

        notifications.sort(function (a, b) {
            const priorityDifference =
                (priority[a.type] || 9) -
                (priority[b.type] || 9);

            if (priorityDifference !== 0) {
                return priorityDifference;
            }

            return b.timestamp - a.timestamp;
        });

        return notifications.slice(0, 24);
    }

    function notificationIconClass(type) {
        return (
            "sway-notification-item-" +
            String(type || "info")
        );
    }

    function renderNotificationPanel() {
        const list =
            document.getElementById(
                "sway-notification-list"
            );

        const badge =
            document.getElementById(
                "sway-notification-badge"
            );

        const empty =
            document.getElementById(
                "sway-notification-empty"
            );

        if (!list || !badge || !empty) {
            return;
        }

        const notifications =
            workspaceNotifications();

        const readKeys =
            notificationReadKeys();

        const unread =
            notifications.filter(function (item) {
                return !readKeys.has(item.key);
            }).length;

        badge.textContent =
            unread > 99
                ? "99+"
                : String(unread);

        badge.hidden = unread === 0;

        if (!notifications.length) {
            list.hidden = true;
            empty.hidden = false;
            list.innerHTML = "";
            return;
        }

        empty.hidden = true;
        list.hidden = false;

        list.innerHTML =
            notifications.map(function (item) {
                const isRead =
                    readKeys.has(item.key);

                return (
                    '<button type="button" class="sway-notification-item ' +
                        notificationIconClass(item.type) +
                        (isRead ? " is-read" : "") +
                        '" data-notification-key="' +
                        esc(item.key) +
                        '" data-notification-view="' +
                        esc(item.view) +
                        '">' +
                        '<span class="sway-notification-icon" aria-hidden="true">' +
                            esc(item.icon) +
                        "</span>" +
                        '<span class="sway-notification-copy">' +
                            "<strong>" +
                                esc(item.title) +
                            "</strong>" +
                            "<span>" +
                                esc(item.detail) +
                            "</span>" +
                            (
                                isRead
                                    ? ""
                                    : '<i aria-label="Unread"></i>'
                            ) +
                        "</span>" +
                        '<span class="sway-notification-arrow" aria-hidden="true">›</span>' +
                    "</button>"
                );
            }).join("");
    }

    function updateNotificationCenter() {
        renderNotificationPanel();
    }

    function closeNotificationCenter() {
        const panel =
            document.getElementById(
                "sway-notification-panel"
            );

        const button =
            document.getElementById(
                "sway-notification-toggle"
            );

        if (!panel || !button) {
            return;
        }

        panel.hidden = true;
        button.setAttribute(
            "aria-expanded",
            "false"
        );
    }

    function toggleNotificationCenter() {
        const panel =
            document.getElementById(
                "sway-notification-panel"
            );

        const button =
            document.getElementById(
                "sway-notification-toggle"
            );

        if (!panel || !button) {
            return;
        }

        const shouldOpen =
            panel.hidden;

        panel.hidden = !shouldOpen;
        button.setAttribute(
            "aria-expanded",
            String(shouldOpen)
        );

        if (shouldOpen) {
            renderNotificationPanel();
        }
    }

    function markNotificationRead(key) {
        const keys =
            notificationReadKeys();

        keys.add(String(key));
        saveNotificationReadKeys(keys);
        renderNotificationPanel();
    }

    function markAllNotificationsRead() {
        const keys =
            notificationReadKeys();

        workspaceNotifications().forEach(function (item) {
            keys.add(item.key);
        });

        saveNotificationReadKeys(keys);
        renderNotificationPanel();
    }

    function openNotificationTarget(view) {
        const button =
            workspace.querySelector(
                '[data-view="' +
                String(view) +
                '"]'
            );

        if (button) {
            button.click();
        }
    }

    function applyAdminTheme(theme) {
        const isDark =
            theme === "dark";

        document.body.classList.toggle(
            "sway-dark-mode",
            isDark
        );

        const button =
            document.getElementById(
                "admin-theme-toggle"
            );

        if (button) {
            button.setAttribute(
                "aria-pressed",
                String(isDark)
            );

            button.setAttribute(
                "aria-label",
                isDark
                    ? "Switch to light mode"
                    : "Switch to dark mode"
            );

            button.setAttribute(
                "title",
                isDark
                    ? "Switch to light mode"
                    : "Switch to dark mode"
            );

            const text =
                button.querySelector(
                    ".admin-theme-toggle-text"
                );

            const icon =
                button.querySelector(
                    ".admin-theme-toggle-icon"
                );

            if (text) {
                text.textContent =
                    isDark
                        ? "Light"
                        : "Dark";
            }

            if (icon) {
                icon.innerHTML =
                    isDark
                        ? '<svg class="admin-theme-icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 15.1A8.5 8.5 0 0 1 8.9 3.8a8.1 8.1 0 1 0 11.3 11.3Z"></path></svg>'
                        : '<svg class="admin-theme-icon-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2.5v2"></path><path d="M12 19.5v2"></path><path d="m4.58 4.58 1.42 1.42"></path><path d="m18 18 1.42 1.42"></path><path d="M2.5 12h2"></path><path d="M19.5 12h2"></path><path d="m4.58 19.42 1.42-1.42"></path><path d="m18 6 1.42-1.42"></path></svg>';
            }
        }
    }

    function setupAdminThemeToggle() {
        const stored =
            localStorage.getItem(
                "swayphics_admin_theme"
            );

        const theme =
            stored === "dark"
                ? "dark"
                : "light";

        applyAdminTheme(theme);

        const button =
            document.getElementById(
                "admin-theme-toggle"
            );

        if (!button) {
            return;
        }

        button.onclick = function (event) {
            event.preventDefault();
            event.stopPropagation();

            const isDark =
                document.body.classList.contains(
                    "sway-dark-mode"
                );

            const nextTheme =
                isDark
                    ? "light"
                    : "dark";

            localStorage.setItem(
                "swayphics_admin_theme",
                nextTheme
            );

            applyAdminTheme(nextTheme);
        };
    }

    function setupNotificationCenter() {
        const button =
            document.getElementById(
                "sway-notification-toggle"
            );

        const panel =
            document.getElementById(
                "sway-notification-panel"
            );

        const list =
            document.getElementById(
                "sway-notification-list"
            );

        const markAll =
            document.getElementById(
                "sway-notification-mark-all"
            );

        if (!button || !panel || !list) {
            return;
        }

        button.onclick = function (event) {
            event.preventDefault();
            event.stopPropagation();
            toggleNotificationCenter();
        };

        list.onclick = function (event) {
            const item =
                event.target.closest(
                    "[data-notification-key]"
                );

            if (!item) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            const key =
                item.dataset.notificationKey;

            const view =
                item.dataset.notificationView;

            markNotificationRead(key);
            openNotificationTarget(view);
            closeNotificationCenter();
        };

        if (markAll) {
            markAll.onclick = function (event) {
                event.preventDefault();
                event.stopPropagation();
                markAllNotificationsRead();
            };
        }

        document.addEventListener(
            "click",
            function (event) {
                if (
                    !panel.contains(event.target) &&
                    !button.contains(event.target)
                ) {
                    closeNotificationCenter();
                }
            }
        );

        document.addEventListener(
            "keydown",
            function (event) {
                if (event.key === "Escape") {
                    closeNotificationCenter();
                }
            }
        );

        updateNotificationCenter();
    }


    function setMobileSidebarOpen(open) {
        const sidebar =
            workspace.querySelector(
                ".sway-workspace-sidebar"
            );

        const toggle =
            workspace.querySelector(
                ".sway-workspace-mobile-toggle"
            );

        if (!sidebar || window.innerWidth > 760) {
            return;
        }

        sidebar.classList.toggle(
            "mobile-open",
            Boolean(open)
        );

        workspace.classList.toggle(
            "nav-open",
            Boolean(open)
        );

        if (toggle) {
            toggle.setAttribute(
                "aria-expanded",
                String(Boolean(open))
            );
        }
    }

    function setupMobileSidebarInteractions(
        sidebarElement,
        mobileToggle,
        mobileClose
    ) {
        if (!sidebarElement) {
            return;
        }

        if (mobileToggle) {
            mobileToggle.setAttribute(
                "aria-expanded",
                String(
                    sidebarElement.classList.contains(
                        "mobile-open"
                    )
                )
            );

            mobileToggle.onclick = function (event) {
                event.preventDefault();
                event.stopPropagation();

                setMobileSidebarOpen(
                    !sidebarElement.classList.contains(
                        "mobile-open"
                    )
                );
            };
        }

        if (mobileClose) {
            mobileClose.onclick = function (event) {
                event.preventDefault();
                event.stopPropagation();

                setMobileSidebarOpen(false);
            };
        }

        let startX = 0;
        let startY = 0;
        let trackingSwipe = false;

        sidebarElement.addEventListener(
            "touchstart",
            function (event) {
                if (
                    window.innerWidth > 760 ||
                    !event.touches ||
                    event.touches.length !== 1
                ) {
                    trackingSwipe = false;
                    return;
                }

                const touch =
                    event.touches[0];

                startX = touch.clientX;
                startY = touch.clientY;
                trackingSwipe = true;
            },
            {
                passive: true
            }
        );

        sidebarElement.addEventListener(
            "touchend",
            function (event) {
                if (
                    !trackingSwipe ||
                    window.innerWidth > 760 ||
                    !event.changedTouches ||
                    !event.changedTouches.length
                ) {
                    trackingSwipe = false;
                    return;
                }

                const touch =
                    event.changedTouches[0];

                const deltaX =
                    touch.clientX - startX;

                const deltaY =
                    touch.clientY - startY;

                trackingSwipe = false;

                if (
                    Math.abs(deltaX) < 70 ||
                    Math.abs(deltaX) < Math.abs(deltaY) * 1.35
                ) {
                    return;
                }

                if (deltaX < 0) {
                    setMobileSidebarOpen(false);
                }
            },
            {
                passive: true
            }
        );

        let edgeStartX = 0;
        let edgeStartY = 0;
        let trackingEdgeSwipe = false;

        workspace.ontouchstart = function (event) {
            if (
                window.innerWidth > 760 ||
                workspace.classList.contains("nav-open") ||
                !event.touches ||
                event.touches.length !== 1
            ) {
                trackingEdgeSwipe = false;
                return;
            }

            const touch =
                event.touches[0];

            if (touch.clientX > 26) {
                trackingEdgeSwipe = false;
                return;
            }

            edgeStartX = touch.clientX;
            edgeStartY = touch.clientY;
            trackingEdgeSwipe = true;
        };

        workspace.ontouchend = function (event) {
            if (
                !trackingEdgeSwipe ||
                window.innerWidth > 760 ||
                !event.changedTouches ||
                !event.changedTouches.length
            ) {
                trackingEdgeSwipe = false;
                return;
            }

            const touch =
                event.changedTouches[0];

            const deltaX =
                touch.clientX - edgeStartX;

            const deltaY =
                touch.clientY - edgeStartY;

            trackingEdgeSwipe = false;

            if (
                deltaX < 70 ||
                Math.abs(deltaX) < Math.abs(deltaY) * 1.35
            ) {
                return;
            }

            setMobileSidebarOpen(true);
        };
    }

function renderShell() {
        const preserveMobileNavOpen =
            workspace.classList.contains("nav-open");

        const existingNavScroll =
            workspace.querySelector(
                ".sway-workspace-nav-scroll"
            );

        const preserveSidebarScrollTop =
            existingNavScroll
                ? existingNavScroll.scrollTop
                : 0;

        let openGroups = {};

        try {
            openGroups =
                JSON.parse(
                    localStorage.getItem(
                        "swayphics_admin_nav_groups"
                    ) || "{}"
                );
        } catch (error) {
            openGroups = {};
        }

        const sidebar =
            '<div class="sway-workspace-sidebar-head">' +
                '<div class="sway-workspace-sidebar-brand">' +
                    '<span class="sway-workspace-sidebar-kicker">SWAYPHICS</span>' +
                    '<strong>Workspace</strong>' +
                '</div>' +
                '<button type="button" class="sway-workspace-mobile-close" aria-label="Close navigation">×</button>' +
            '</div>' +
            '<div class="sway-workspace-nav-scroll">' +
                navGroups.map(function (group) {
                    const containsCurrent =
                        group.items.some(function (item) {
                            return item[0] === state.currentView;
                        });

                    const isOpen =
                        containsCurrent ||
                        openGroups[group.id] === true;

                    return (
                        '<section class="sway-workspace-nav-group ' +
                        (isOpen ? "open" : "collapsed") +
                        '" data-nav-group="' +
                        esc(group.id) +
                        '">' +
                            '<button type="button" class="sway-workspace-nav-group-toggle" aria-expanded="' +
                                (isOpen ? "true" : "false") +
                                '" data-nav-group-toggle="' +
                                esc(group.id) +
                            '">' +
                                '<span class="sway-workspace-nav-group-label">' +
                                    '<span class="sway-workspace-nav-group-icon">' +
                                        navGroupIcon(group.icon) +
                                    '</span>' +
                                    '<span>' +
                                        esc(formatDisplayText(group.label)) +
                                    '</span>' +
                                '</span>' +
                                '<i aria-hidden="true">⌄</i>' +
                            '</button>' +
                            '<div class="sway-workspace-nav-items">' +
                                group.items.map(navButton).join("") +
                            '</div>' +
                        '</section>'
                    );
                }).join("") +
            '</div>';

        workspace.innerHTML =
            '<div class="sway-workspace-shell">' +
                '<aside class="sway-workspace-sidebar" aria-label="Admin workspace navigation">' +
                    sidebar +
                "</aside>" +
                '<div class="sway-workspace-main" id="sway-workspace-main"></div>' +
                '<div class="sway-quick-create">' +
                    '<button type="button" class="sway-quick-create-toggle" aria-expanded="false" aria-controls="sway-quick-create-menu">' +
                        '<span class="sway-quick-create-plus" aria-hidden="true">+</span>' +
                        '<span>New</span>' +
                    '</button>' +
                    '<div class="sway-quick-create-menu" id="sway-quick-create-menu" hidden>' +
                        '<div class="sway-quick-create-heading">' +
                            '<span>Quick actions</span>' +
                            '<small>Create a new record</small>' +
                        '</div>' +
                        '<div class="sway-quick-create-grid">' +
                            '<button type="button" class="sway-quick-create-item" data-global-quick="client">Client</button>' +
                            '<button type="button" class="sway-quick-create-item" data-global-quick="lead">Lead</button>' +
                            '<button type="button" class="sway-quick-create-item" data-global-quick="project">Project</button>' +
                            '<button type="button" class="sway-quick-create-item" data-global-quick="task">Task</button>' +
                            '<button type="button" class="sway-quick-create-item" data-global-quick="followup">Follow-up</button>' +
                            '<button type="button" class="sway-quick-create-item" data-global-quick="communication">Communication</button>' +
                            '<button type="button" class="sway-quick-create-item" data-global-quick="quote">Quote</button>' +
                            '<button type="button" class="sway-quick-create-item" data-global-quick="invoice">Invoice</button>' +
                            '<button type="button" class="sway-quick-create-item" data-global-quick="payment">Payment</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<button type="button" class="sway-workspace-mobile-toggle" aria-label="Open workspace navigation">' +
                    '<span></span><span></span><span></span>' +
                '</button>' +
            "</div>";

        const newNavScroll =
            workspace.querySelector(
                ".sway-workspace-nav-scroll"
            );

        if (newNavScroll) {
            newNavScroll.scrollTop =
                preserveSidebarScrollTop;
        }

        const mobileToggle =
            workspace.querySelector(
                ".sway-workspace-mobile-toggle"
            );

        const mobileClose =
            workspace.querySelector(
                ".sway-workspace-mobile-close"
            );

        const sidebarElement =
            workspace.querySelector(
                ".sway-workspace-sidebar"
            );

        if (
            preserveMobileNavOpen &&
            sidebarElement &&
            window.innerWidth <= 760
        ) {
            sidebarElement.classList.add(
                "sway-sidebar-restoring"
            );

            sidebarElement.classList.add(
                "mobile-open"
            );

            workspace.classList.add(
                "nav-open"
            );

            window.requestAnimationFrame(
                function () {
                    sidebarElement.classList.remove(
                        "sway-sidebar-restoring"
                    );
                }
            );
        }

        const quickCreate =
            workspace.querySelector(
                ".sway-quick-create"
            );

        const quickCreateToggle =
            workspace.querySelector(
                ".sway-quick-create-toggle"
            );

        const quickCreateMenu =
            workspace.querySelector(
                ".sway-quick-create-menu"
            );

        if (
            quickCreateToggle &&
            quickCreateMenu &&
            quickCreate
        ) {
            quickCreateToggle.addEventListener(
                "click",
                function () {
                    const isOpen =
                        !quickCreateMenu.hidden;

                    quickCreateMenu.hidden =
                        isOpen;

                    quickCreateToggle.setAttribute(
                        "aria-expanded",
                        String(!isOpen)
                    );

                    quickCreate.classList.toggle(
                        "open",
                        !isOpen
                    );
                }
            );

            workspace
                .querySelectorAll("[data-global-quick]")
                .forEach(function (button) {
                    button.addEventListener(
                        "click",
                        function () {
                            const type =
                                button.dataset.globalQuick;

                            quickCreateMenu.hidden = true;
                            quickCreateToggle.setAttribute(
                                "aria-expanded",
                                "false"
                            );
                            quickCreate.classList.remove(
                                "open"
                            );

                            if (type === "invoice") {
                                openInvoiceBuilder(null);
                                return;
                            }

                            if (type === "client") {
                                createOrEdit("clients", null);
                                return;
                            }

                            if (type === "lead") {
                                createOrEdit("leads", null);
                                return;
                            }

                            if (type === "project") {
                                createOrEdit("projects", null);
                                return;
                            }

                            if (type === "task") {
                                createOrEdit("tasks", null);
                                return;
                            }

                            if (type === "followup") {
                                createOrEdit("followups", null);
                                return;
                            }

                            if (type === "communication") {
                                createOrEdit("communications", null);
                                return;
                            }

                            if (type === "quote") {
                                createOrEdit("quotes", null);
                                return;
                            }

                            if (type === "payment") {
                                createOrEdit("payments", null);
                            }
                        }
                    );
                });
        }

        setupMobileSidebarInteractions(
            sidebarElement,
            mobileToggle,
            mobileClose
        );

        workspace
            .querySelectorAll("[data-nav-group-toggle]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        const group =
                            button.closest(
                                "[data-nav-group]"
                            );

                        if (!group) return;

                        const groupId =
                            button.dataset.navGroupToggle;

                        const isOpen =
                            group.classList.contains(
                                "open"
                            );

                        group.classList.toggle(
                            "open",
                            !isOpen
                        );

                        group.classList.toggle(
                            "collapsed",
                            isOpen
                        );

                        button.setAttribute(
                            "aria-expanded",
                            String(!isOpen)
                        );

                        let saved = {};

                        try {
                            saved =
                                JSON.parse(
                                    localStorage.getItem(
                                        "swayphics_admin_nav_groups"
                                    ) || "{}"
                                );
                        } catch (error) {
                            saved = {};
                        }

                        saved[groupId] = !isOpen;

                        localStorage.setItem(
                            "swayphics_admin_nav_groups",
                            JSON.stringify(saved)
                        );
                    }
                );
            });

        workspace
            .querySelectorAll("[data-view]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        const view =
                            button.dataset.view;

                        state.currentView =
                            view;

                        if (window.innerWidth <= 760) {
                            setMobileSidebarOpen(false);
                        }

                        setStandaloneManagerVisibility(view);

                        if (
                            view === "portfolio" ||
                            view === "testimonials"
                        ) {
                            const target =
                                document.querySelector(
                                    view === "portfolio"
                                        ? ".portfolio-manager"
                                        : "#testimonials-admin-section"
                                );

                            if (target) {
                                target.scrollIntoView({
                                    behavior: "smooth",
                                    block: "start"
                                });
                            }

                            renderShell();
                            return;
                        }

                        renderShell();
                        renderView();
                    }
                );
            });
    }

    function heading(extraActions) {
        const meta = viewMeta(state.currentView);

        return (
            '<div class="sway-workspace-heading">' +
                '<div class="sway-workspace-heading-copy">' +
                    '<span class="admin-label">' +
                        esc(formatDisplayText(meta[0])) +
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
                            esc(formatDisplayText(title)) +
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

    function formatChartValue(value, currency) {
        const numeric = Number(value || 0);

        if (currency) {
            return money(numeric);
        }

        return new Intl.NumberFormat(
            "en-ZA",
            {
                maximumFractionDigits: 0
            }
        ).format(numeric);
    }

    function formatChartAxisValue(value, currency) {
        const numeric = Number(value || 0);
        const absolute = Math.abs(numeric);

        if (currency) {
            if (absolute >= 1000000) {
                return "R" + (numeric / 1000000).toFixed(absolute >= 10000000 ? 0 : 1) + "m";
            }

            if (absolute >= 1000) {
                return "R" + (numeric / 1000).toFixed(absolute >= 10000 ? 0 : 1) + "k";
            }

            return money(numeric);
        }

        if (absolute >= 1000) {
            return (numeric / 1000).toFixed(absolute >= 10000 ? 0 : 1) + "k";
        }

        return new Intl.NumberFormat("en-ZA", {
            maximumFractionDigits: 0
        }).format(numeric);
    }

    function compactChartPeriodLabel(label, index, total) {
        const value = String(label || "");
        if (total <= 6) return value;
        return index % 2 === 0 || index === total - 1
            ? value
            : "";
    }

    function chartReading(values, labels, currency, label) {
        const numbers = values.map(function (value) {
            return Number(value || 0);
        });

        if (!numbers.length) {
            return {
                latest: 0,
                previous: null,
                average: 0,
                peakValue: 0,
                peakIndex: -1,
                total: 0,
                changePercent: null,
                direction: "No movement",
                detail: "There is no recorded activity in the selected period."
            };
        }

        const latest = numbers[numbers.length - 1];
        const previous = numbers.length > 1
            ? numbers[numbers.length - 2]
            : null;

        const total = numbers.reduce(function (sum, value) {
            return sum + value;
        }, 0);

        const average = total / numbers.length;
        const peakValue = Math.max.apply(null, numbers.concat([0]));
        const peakIndex = numbers.indexOf(peakValue);

        let changePercent = null;
        let direction = "Holding steady";
        let detail = "The latest period is in line with recent activity.";

        if (previous !== null) {
            if (previous === 0 && latest > 0) {
                direction = "New activity";
                detail = "The latest period started from zero activity.";
            } else if (previous === 0 && latest === 0) {
                direction = "Still quiet";
                detail = "Both of the latest periods recorded no activity.";
            } else if (previous !== 0) {
                changePercent =
                    ((latest - previous) / Math.abs(previous)) * 100;

                if (Math.abs(changePercent) < 0.5) {
                    direction = "Holding steady";
                    detail = "The latest period is broadly in line with the previous one.";
                } else if (changePercent > 0) {
                    direction = "Up " + Math.abs(changePercent).toFixed(0) + "%";
                    detail = "The latest period increased compared with the previous period.";
                } else {
                    direction = "Down " + Math.abs(changePercent).toFixed(0) + "%";
                    detail = "The latest period decreased compared with the previous period.";
                }
            }
        }

        if (average > 0 && latest > average) {
            detail += " It is above the period average.";
        } else if (average > 0 && latest < average) {
            detail += " It is below the period average.";
        }

        return {
            latest: latest,
            previous: previous,
            average: average,
            peakValue: peakValue,
            peakIndex: peakIndex,
            total: total,
            changePercent: changePercent,
            direction: direction,
            detail: detail
        };
    }

    function chartPeriodBreakdown(values, labels, currency) {
        const numbers = values.map(function (value) {
            return Number(value || 0);
        });

        const maxValue = Math.max.apply(
            null,
            numbers.concat([1])
        );

        return (
            '<div class="sway-chart-periods" aria-label="Period breakdown">' +
                labels.map(function (periodLabel, index) {
                    const value = numbers[index] || 0;
                    const width =
                        value > 0
                            ? Math.max(
                                7,
                                (value / maxValue) * 100
                            )
                            : 0;

                    return (
                        '<div class="sway-chart-period" title="' +
                            esc(
                                String(periodLabel || "Period") +
                                ": " +
                                formatChartValue(value, currency)
                            ) +
                        '">' +
                            '<div class="sway-chart-period-label">' +
                                esc(periodLabel || "Period") +
                            "</div>" +
                            '<div class="sway-chart-period-track">' +
                                '<span style="width:' +
                                    width +
                                '%"></span>' +
                            "</div>" +
                            '<strong>' +
                                esc(
                                    formatChartValue(
                                        value,
                                        currency
                                    )
                                ) +
                            "</strong>" +
                        "</div>"
                    );
                }).join("") +
            "</div>"
        );
    }

    function chartSummary(values, labels, currency, label) {
        const reading =
            chartReading(
                values,
                labels,
                currency,
                label
            );

        const peakLabel =
            reading.peakIndex >= 0 &&
            labels[reading.peakIndex]
                ? labels[reading.peakIndex]
                : "No peak yet";

        const comparison =
            reading.previous !== null
                ? formatChartValue(reading.previous, currency)
                : "First period";

        return (
            '<div class="sway-chart-summary">' +
                '<div class="sway-chart-summary-item">' +
                    "<span>Latest</span>" +
                    "<strong>" +
                        esc(
                            formatChartValue(
                                reading.latest,
                                currency
                            )
                        ) +
                    "</strong>" +
                    '<small>' +
                        esc(
                            labels.length
                                ? labels[labels.length - 1]
                                : "Current period"
                        ) +
                    "</small>" +
                "</div>" +
                '<div class="sway-chart-summary-item">' +
                    "<span>Vs previous</span>" +
                    "<strong>" +
                        esc(
                            reading.changePercent === null
                                ? comparison
                                : (
                                    reading.changePercent >= 0
                                        ? "↑ "
                                        : "↓ "
                                ) +
                                Math.abs(
                                    reading.changePercent
                                ).toFixed(0) +
                                "%"
                        ) +
                    "</strong>" +
                    "<small>Previous: " +
                        esc(comparison) +
                    "</small>" +
                "</div>" +
                '<div class="sway-chart-summary-item">' +
                    "<span>Average</span>" +
                    "<strong>" +
                        esc(
                            formatChartValue(
                                reading.average,
                                currency
                            )
                        ) +
                    "</strong>" +
                    "<small>Across all periods</small>" +
                "</div>" +
                '<div class="sway-chart-summary-item">' +
                    "<span>Peak</span>" +
                    "<strong>" +
                        esc(
                            formatChartValue(
                                reading.peakValue,
                                currency
                            )
                        ) +
                    "</strong>" +
                    "<small>" +
                        esc(peakLabel) +
                    "</small>" +
                "</div>" +
            "</div>" +
            '<div class="sway-chart-reading">' +
                '<div class="sway-chart-reading-title">' +
                    '<span>What this tells you</span>' +
                    '<strong>' +
                        esc(reading.direction) +
                    "</strong>" +
                "</div>" +
                "<p>" +
                    esc(reading.detail) +
                "</p>" +
                chartPeriodBreakdown(
                    values,
                    labels,
                    currency
                ) +
            "</div>"
        );
    }

    function trendChart(values, labels, color, label, currency) {
        const width = 900;
        const height = 390;
        const left = 88;
        const right = 30;
        const top = 42;
        const bottom = 76;
        const plotWidth = width - left - right;
        const plotHeight = height - top - bottom;

        const numbers =
            values.map(function (value) {
                return Number(value || 0);
            });

        const maxValue =
            Math.max.apply(
                null,
                numbers.concat([1])
            ) || 1;

        const paddedMax =
            maxValue === 1
                ? 1
                : maxValue * 1.18;

        const points =
            numbers.map(function (value, index) {
                const x =
                    numbers.length === 1
                        ? left + plotWidth / 2
                        : left +
                          (
                              index /
                              (numbers.length - 1)
                          ) *
                          plotWidth;

                const y =
                    top +
                    plotHeight -
                    (
                        value /
                        paddedMax
                    ) *
                    plotHeight;

                return {
                    x: x,
                    y: y,
                    value: value,
                    index: index
                };
            });

        const pointString =
            points.map(function (point) {
                return point.x + "," + point.y;
            }).join(" ");

        let grid = "";

        for (let i = 0; i <= 5; i += 1) {
            const ratio = i / 5;
            const y =
                top +
                plotHeight -
                ratio *
                plotHeight;

            const axisValue =
                paddedMax *
                ratio;

            grid +=
                '<line x1="' +
                left +
                '" y1="' +
                y +
                '" x2="' +
                (width - right) +
                '" y2="' +
                y +
                '" class="sway-chart-grid-line"></line>' +
                '<text x="' +
                (left - 15) +
                '" y="' +
                (y + 4) +
                '" text-anchor="end" class="sway-chart-y-label">' +
                    esc(
                        formatChartAxisValue(
                            axisValue,
                            currency
                        )
                    ) +
                "</text>";
        }

        const peakValue =
            Math.max.apply(null, numbers.concat([0]));
        const latestIndex =
            numbers.length - 1;
        const peakIndex =
            numbers.indexOf(peakValue);

        const pointMarks =
            points.map(function (point, index) {
                const isPeak =
                    index === peakIndex &&
                    peakValue > 0;

                const isLatest =
                    index === latestIndex;

                const showValue =
                    isPeak ||
                    isLatest ||
                    numbers.length <= 5;

                const labelY =
                    Math.max(
                        20,
                        point.y -
                        (
                            isPeak || isLatest
                                ? 15
                                : 10
                        )
                    );

                return (
                    '<g class="sway-chart-point-group" tabindex="0" role="img" aria-label="' +
                        esc(
                            String(
                                labels[index] ||
                                "Period"
                            ) +
                            ": " +
                            formatChartValue(
                                point.value,
                                currency
                            )
                        ) +
                    '">' +
                        (
                            isLatest
                                ? '<line x1="' +
                                  point.x +
                                  '" y1="' +
                                  top +
                                  '" x2="' +
                                  point.x +
                                  '" y2="' +
                                  (top + plotHeight) +
                                  '" class="sway-chart-current-guide"></line>'
                                : ""
                        ) +
                        '<circle cx="' +
                            point.x +
                        '" cy="' +
                            point.y +
                        '" r="' +
                            (
                                isPeak || isLatest
                                    ? 7
                                    : 5
                            ) +
                        '" fill="' +
                            color +
                        '" class="sway-chart-point">' +
                            "<title>" +
                                esc(
                                    String(
                                        labels[index] ||
                                        "Period"
                                    ) +
                                    " · " +
                                    formatChartValue(
                                        point.value,
                                        currency
                                    )
                                ) +
                            "</title>" +
                        "</circle>" +
                        (
                            showValue
                                ? '<text x="' +
                                  point.x +
                                  '" y="' +
                                  labelY +
                                  '" text-anchor="middle" class="sway-chart-value-label">' +
                                  esc(
                                      formatChartValue(
                                          point.value,
                                          currency
                                      )
                                  ) +
                                  "</text>"
                                : ""
                        ) +
                    "</g>"
                );
            }).join("");

        const xLabels =
            labels.map(function (item, index) {
                return (
                    '<text x="' +
                    points[index].x +
                    '" y="' +
                    (height - 25) +
                    '" text-anchor="middle" class="sway-chart-axis-label">' +
                        esc(
                            compactChartPeriodLabel(
                                item,
                                index,
                                labels.length
                            )
                        ) +
                    "</text>"
                );
            }).join("");

        return (
            '<div class="sway-chart-wrap">' +
                '<div class="sway-chart-stage">' +
                    '<div class="sway-chart-guide">' +
                        "<span>Higher is more activity</span>" +
                        "<span>" +
                            esc(
                                currency
                                    ? "ZAR values"
                                    : "Count of records"
                            ) +
                        "</span>" +
                    "</div>" +
                    '<svg class="sway-chart" viewBox="0 0 ' +
                        width +
                        " " +
                        height +
                        '" role="img" aria-label="' +
                        esc(label) +
                        '">' +
                        grid +
                        (
                            points.length > 1
                                ? '<polygon points="' +
                                  left +
                                  "," +
                                  (top + plotHeight) +
                                  " " +
                                  pointString +
                                  " " +
                                  points[points.length - 1].x +
                                  "," +
                                  (top + plotHeight) +
                                  '" fill="' +
                                  color +
                                  '" fill-opacity="0.045" class="sway-chart-area"></polygon>'
                                : ""
                        ) +
                        '<line x1="' +
                            left +
                            '" y1="' +
                            (top + plotHeight) +
                            '" x2="' +
                            (width - right) +
                            '" y2="' +
                            (top + plotHeight) +
                            '" class="sway-chart-baseline"></line>' +
                        '<polyline points="' +
                            pointString +
                            '" fill="none" stroke="' +
                            color +
                            '" class="sway-chart-line"></polyline>' +
                        pointMarks +
                        xLabels +
                    "</svg>" +
                "</div>" +
                chartSummary(
                    numbers,
                    labels,
                    currency,
                    label
                ) +
            "</div>"
        );
    }

    function barChartSimple(values, labels, color, label, currency) {
        const width = 900;
        const height = 390;
        const left = 88;
        const right = 30;
        const top = 42;
        const bottom = 76;
        const plotWidth = width - left - right;
        const plotHeight = height - top - bottom;

        const numbers =
            values.map(function (value) {
                return Number(value || 0);
            });

        const maxValue =
            Math.max.apply(
                null,
                numbers.concat([1])
            ) || 1;

        const paddedMax =
            maxValue === 1
                ? 1
                : maxValue * 1.18;

        const groupWidth =
            plotWidth /
            Math.max(
                1,
                numbers.length
            );

        let grid = "";

        for (let i = 0; i <= 5; i += 1) {
            const ratio = i / 5;
            const y =
                top +
                plotHeight -
                ratio *
                plotHeight;

            const axisValue =
                paddedMax *
                ratio;

            grid +=
                '<line x1="' +
                left +
                '" y1="' +
                y +
                '" x2="' +
                (width - right) +
                '" y2="' +
                y +
                '" class="sway-chart-grid-line"></line>' +
                '<text x="' +
                (left - 15) +
                '" y="' +
                (y + 4) +
                '" text-anchor="end" class="sway-chart-y-label">' +
                    esc(
                        formatChartAxisValue(
                            axisValue,
                            currency
                        )
                    ) +
                "</text>";
        }

        const peakValue =
            Math.max.apply(null, numbers.concat([0]));

        const peakIndex =
            numbers.indexOf(peakValue);

        const latestIndex =
            numbers.length - 1;

        const bars =
            numbers.map(function (value, index) {
                const barHeight =
                    (
                        value /
                        paddedMax
                    ) *
                    plotHeight;

                const x =
                    left +
                    index * groupWidth +
                    groupWidth * 0.16;

                const barWidth =
                    Math.max(
                        12,
                        groupWidth * 0.68
                    );

                const y =
                    top +
                    plotHeight -
                    barHeight;

                const isPeak =
                    index === peakIndex &&
                    peakValue > 0;

                const isLatest =
                    index === latestIndex;

                const showValue =
                    isPeak ||
                    isLatest ||
                    numbers.length <= 5;

                return (
                    '<g class="sway-chart-bar-group" tabindex="0" role="img" aria-label="' +
                        esc(
                            String(
                                labels[index] ||
                                "Period"
                            ) +
                            ": " +
                            formatChartValue(
                                value,
                                currency
                            )
                        ) +
                    '">' +
                        (
                            isLatest
                                ? '<line x1="' +
                                  (x + barWidth / 2) +
                                  '" y1="' +
                                  top +
                                  '" x2="' +
                                  (x + barWidth / 2) +
                                  '" y2="' +
                                  (top + plotHeight) +
                                  '" class="sway-chart-current-guide"></line>'
                                : ""
                        ) +
                        '<rect x="' +
                            x +
                        '" y="' +
                            y +
                        '" width="' +
                            barWidth +
                        '" height="' +
                            Math.max(
                                5,
                                barHeight
                            ) +
                        '" rx="9" fill="' +
                            color +
                        '" class="sway-chart-bar">' +
                            "<title>" +
                                esc(
                                    String(
                                        labels[index] ||
                                        "Period"
                                    ) +
                                    " · " +
                                    formatChartValue(
                                        value,
                                        currency
                                    )
                                ) +
                            "</title>" +
                        "</rect>" +
                        (
                            showValue
                                ? '<text x="' +
                                  (x + barWidth / 2) +
                                  '" y="' +
                                  Math.max(
                                      20,
                                      y - 9
                                  ) +
                                  '" text-anchor="middle" class="sway-chart-value-label">' +
                                  esc(
                                      formatChartValue(
                                          value,
                                          currency
                                      )
                                  ) +
                                  "</text>"
                                : ""
                        ) +
                        '<text x="' +
                            (x + barWidth / 2) +
                            '" y="' +
                            (height - 25) +
                            '" text-anchor="middle" class="sway-chart-axis-label">' +
                            esc(
                                compactChartPeriodLabel(
                                    labels[index],
                                    index,
                                    labels.length
                                )
                            ) +
                        "</text>" +
                    "</g>"
                );
            }).join("");

        return (
            '<div class="sway-chart-wrap">' +
                '<div class="sway-chart-stage">' +
                    '<div class="sway-chart-guide">' +
                        "<span>Higher bars mean more activity</span>" +
                        "<span>" +
                            esc(
                                currency
                                    ? "ZAR values"
                                    : "Count of records"
                            ) +
                        "</span>" +
                    "</div>" +
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
                "</div>" +
                chartSummary(
                    numbers,
                    labels,
                    currency,
                    label
                ) +
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

    function renderRevenuePipeline() {
        const stages = [
            "new",
            "contacted",
            "interested",
            "proposal sent",
            "negotiating",
            "won"
        ].map(function (status) {
            const leads = state.leads.filter(function (lead) {
                return lead.status === status;
            });

            return {
                status: status,
                label: formatDisplayText(status),
                count: leads.length,
                value: leads.reduce(function (sum, lead) {
                    return sum + Number(lead.estimated_value || 0);
                }, 0)
            };
        });

        const openValue = stages
            .filter(function (stage) {
                return stage.status !== "won";
            })
            .reduce(function (sum, stage) {
                return sum + stage.value;
            }, 0);

        const wonValue = stages
            .filter(function (stage) {
                return stage.status === "won";
            })
            .reduce(function (sum, stage) {
                return sum + stage.value;
            }, 0);

        const quoteStats = [
            "sent",
            "accepted",
            "rejected",
            "expired"
        ].map(function (status) {
            const quotes = state.quotes.filter(function (quote) {
                return quote.status === status;
            });

            return {
                label: formatDisplayText(status),
                count: quotes.length,
                value: quotes.reduce(function (sum, quote) {
                    return sum + Number(quote.amount || 0);
                }, 0)
            };
        });

        const maxValue = Math.max.apply(
            null,
            stages.map(function (stage) {
                return stage.value;
            }).concat([1])
        );

        return (
            '<section class="sway-revenue-pipeline">' +
                '<div class="sway-revenue-pipeline-head">' +
                    '<div>' +
                        '<span class="admin-label">Sales pipeline</span>' +
                        "<h3>Revenue pipeline</h3>" +
                        "<p>Estimated value across current lead stages, with quote checkpoints alongside it.</p>" +
                    "</div>" +
                    '<div class="sway-revenue-pipeline-totals">' +
                        '<div><span>Open opportunity</span><strong>' +
                            esc(money(openValue)) +
                        "</strong></div>" +
                        '<div><span>Won value</span><strong>' +
                            esc(money(wonValue)) +
                        "</strong></div>" +
                    "</div>" +
                "</div>" +

                '<div class="sway-revenue-pipeline-layout">' +
                    '<div class="sway-revenue-pipeline-stages">' +
                        stages.map(function (stage) {
                            const width =
                                stage.value > 0
                                    ? Math.max(
                                        6,
                                        stage.value / maxValue * 100
                                    )
                                    : 0;

                            return (
                                '<button type="button" class="sway-revenue-stage" data-view-target="leads">' +
                                    '<div class="sway-revenue-stage-top">' +
                                        "<span>" +
                                            esc(stage.label) +
                                        "</span>" +
                                        "<strong>" +
                                            esc(money(stage.value)) +
                                        "</strong>" +
                                    "</div>" +
                                    '<div class="sway-revenue-stage-track">' +
                                        '<span style="width:' +
                                            width +
                                        '%"></span>' +
                                    "</div>" +
                                    '<div class="sway-revenue-stage-foot">' +
                                        "<small>" +
                                            stage.count +
                                            (
                                                stage.count === 1
                                                    ? " lead"
                                                    : " leads"
                                            ) +
                                        "</small>" +
                                        "<small>Current stage</small>" +
                                    "</div>" +
                                "</button>"
                            );
                        }).join("") +
                    "</div>" +

                    '<div class="sway-revenue-quotes">' +
                        '<div class="sway-revenue-quotes-head">' +
                            "<h4>Quote checkpoint</h4>" +
                            '<button type="button" class="sway-row-action" data-view-target="quotes">View quotes</button>' +
                        "</div>" +
                        '<div class="sway-revenue-quote-list">' +
                            quoteStats.map(function (item) {
                                return (
                                    '<button type="button" class="sway-revenue-quote-row" data-view-target="quotes">' +
                                        "<span>" +
                                            "<strong>" +
                                                esc(item.label) +
                                            "</strong>" +
                                            "<small>" +
                                                item.count +
                                                (
                                                    item.count === 1
                                                        ? " quote"
                                                        : " quotes"
                                                ) +
                                            "</small>" +
                                        "</span>" +
                                        "<b>" +
                                            esc(money(item.value)) +
                                        "</b>" +
                                    "</button>"
                                );
                            }).join("") +
                        "</div>" +
                        '<div class="sway-revenue-pipeline-note">Lead stages are a current-state view because stage-change history is not stored.</div>' +
                    "</div>" +
                "</div>" +
            "</section>"
        );
    }

    function cashFlowMonths() {
        const now = dashboardNow();
        const months = [];

        for (let offset = -5; offset <= 5; offset += 1) {
            const point = new Date(
                now.getFullYear(),
                now.getMonth() + offset,
                1
            );

            months.push({
                key:
                    point.getFullYear() +
                    "-" +
                    String(point.getMonth() + 1).padStart(2, "0"),
                label:
                    point.toLocaleDateString(
                        "en-ZA",
                        {
                            timeZone:
                                SOUTH_AFRICA_TIME_ZONE,
                            month: "short",
                            year: "2-digit"
                        }
                    )
            });
        }

        return months;
    }

    function renderCashFlow() {
        const today = dashboardTodayISO();
        const todayDate = new Date(
            today + "T00:00:00+02:00"
        );

        const cashCollected =
            state.payments
                .filter(function (payment) {
                    return (
                        payment.status === "paid" &&
                        dashboardMonthKey(
                            payment.paid_at ||
                            payment.created_at
                        ) === today.slice(0, 7)
                    );
                })
                .reduce(function (sum, payment) {
                    return sum +
                        Number(payment.amount || 0);
                }, 0);

        const outstandingInvoices =
            state.invoices.filter(function (invoice) {
                return (
                    invoice.archived !== true &&
                    invoice.status !== "paid" &&
                    invoice.status !== "cancelled" &&
                    Number(
                        invoice.amount_outstanding != null
                            ? invoice.amount_outstanding
                            : invoice.total || 0
                    ) > 0
                );
            });

        const outstanding =
            outstandingInvoices.reduce(function (sum, invoice) {
                return sum +
                    Number(
                        invoice.amount_outstanding != null
                            ? invoice.amount_outstanding
                            : invoice.total || 0
                    );
            }, 0);

        const overdue =
            outstandingInvoices.filter(function (invoice) {
                return (
                    invoice.due_date &&
                    dashboardDateKey(invoice.due_date) < today
                );
            });

        const overdueValue =
            overdue.reduce(function (sum, invoice) {
                return sum +
                    Number(
                        invoice.amount_outstanding != null
                            ? invoice.amount_outstanding
                            : invoice.total || 0
                    );
            }, 0);

        const next30 =
            new Date(todayDate.getTime());

        next30.setDate(
            next30.getDate() + 30
        );

        const next30Key =
            dashboardDateKey(next30.toISOString());

        const dueNext30Invoices =
            outstandingInvoices.filter(function (invoice) {
                const due =
                    dashboardDateKey(invoice.due_date);

                return (
                    due &&
                    due >= today &&
                    due <= next30Key
                );
            });

        const dueNext30 =
            dueNext30Invoices.reduce(function (sum, invoice) {
                return sum +
                    Number(
                        invoice.amount_outstanding != null
                            ? invoice.amount_outstanding
                            : invoice.total || 0
                    );
            }, 0);

        const months = cashFlowMonths();

        const monthLabels =
            months.map(function (month) {
                return month.label;
            });

        const collectedSeries =
            months.map(function (month) {
                return state.payments
                    .filter(function (payment) {
                        return (
                            payment.status === "paid" &&
                            dashboardMonthKey(
                                payment.paid_at ||
                                payment.created_at
                            ) === month.key
                        );
                    })
                    .reduce(function (sum, payment) {
                        return sum +
                            Number(payment.amount || 0);
                    }, 0);
            });

        const dueSeries =
            months.map(function (month) {
                return outstandingInvoices
                    .filter(function (invoice) {
                        return (
                            dashboardMonthKey(
                                invoice.due_date
                            ) === month.key
                        );
                    })
                    .reduce(function (sum, invoice) {
                        return sum +
                            Number(
                                invoice.amount_outstanding != null
                                    ? invoice.amount_outstanding
                                    : invoice.total || 0
                            );
                    }, 0);
            });

        const invoiceSeries =
            months.map(function (month) {
                return state.invoices
                    .filter(function (invoice) {
                        return (
                            invoice.status !== "cancelled" &&
                            dashboardMonthKey(
                                invoice.issue_date ||
                                invoice.created_at
                            ) === month.key
                        );
                    })
                    .reduce(function (sum, invoice) {
                        return sum +
                            Number(invoice.total || 0);
                    }, 0);
            });

        const nextDue =
            outstandingInvoices
                .filter(function (invoice) {
                    return (
                        invoice.due_date &&
                        dashboardDateKey(invoice.due_date) >= today
                    );
                })
                .sort(function (a, b) {
                    return String(a.due_date)
                        .localeCompare(String(b.due_date));
                })
                .slice(0, 5);

        return (
            '<section class="sway-cash-flow">' +
                '<div class="sway-cash-flow-head">' +
                    '<div>' +
                        '<span class="admin-label">Cash flow</span>' +
                        "<h3>Money movement</h3>" +
                        "<p>Actual payments received, outstanding invoice balances and scheduled collections. This is a cash-collection view, not a profit statement.</p>" +
                    "</div>" +
                "</div>" +

                '<div class="sway-cash-flow-stats">' +
                    '<div class="sway-cash-flow-stat">' +
                        "<span>Collected this month</span>" +
                        "<strong>" +
                            esc(money(cashCollected)) +
                        "</strong>" +
                        "<small>Paid payments recorded this month.</small>" +
                    "</div>" +
                    '<div class="sway-cash-flow-stat">' +
                        "<span>Due next 30 days</span>" +
                        "<strong>" +
                            esc(money(dueNext30)) +
                        "</strong>" +
                        "<small>" +
                            dueNext30Invoices.length +
                            (
                                dueNext30Invoices.length === 1
                                    ? " invoice"
                                    : " invoices"
                            ) +
                            " currently scheduled.</small>" +
                    "</div>" +
                    '<div class="sway-cash-flow-stat danger">' +
                        "<span>Overdue</span>" +
                        "<strong>" +
                            esc(money(overdueValue)) +
                        "</strong>" +
                        "<small>" +
                            overdue.length +
                            (
                                overdue.length === 1
                                    ? " overdue invoice"
                                    : " overdue invoices"
                            ) +
                            " requiring collection.</small>" +
                    "</div>" +
                    '<div class="sway-cash-flow-stat">' +
                        "<span>Outstanding</span>" +
                        "<strong>" +
                            esc(money(outstanding)) +
                        "</strong>" +
                        "<small>Unpaid balance across open invoices.</small>" +
                    "</div>" +
                "</div>" +

                '<div class="sway-cash-flow-charts">' +
                    insightPanel(
                        "Cash collected",
                        "Paid payments across the last six months and next six-month window.",
                        trendChart(
                            collectedSeries,
                            monthLabels,
                            "#002096",
                            "Cash collected",
                            true
                        )
                    ) +
                    insightPanel(
                        "Invoice due schedule",
                        "Outstanding balances by invoice due month.",
                        trendChart(
                            dueSeries,
                            monthLabels,
                            "#0152F4",
                            "Invoice due schedule",
                            true
                        )
                    ) +
                "</div>" +

                '<div class="sway-cash-flow-lower">' +
                    '<div class="sway-cash-flow-table">' +
                        '<div class="sway-cash-flow-table-head">' +
                            '<div>' +
                                "<h4>Next collections</h4>" +
                                "<p>Upcoming invoice balances with known due dates.</p>" +
                            "</div>" +
                            '<button type="button" class="sway-row-action" data-view-target="invoices">View invoices</button>' +
                        "</div>" +
                        (
                            nextDue.length
                                ? '<div class="sway-cash-flow-due-list">' +
                                    nextDue.map(function (invoice) {
                                        const balance =
                                            Number(
                                                invoice.amount_outstanding != null
                                                    ? invoice.amount_outstanding
                                                    : invoice.total || 0
                                            );

                                        return (
                                            '<button type="button" class="sway-cash-flow-due-row" data-view-target="invoices">' +
                                                "<span>" +
                                                    "<strong>" +
                                                        esc(invoice.invoice_number) +
                                                    "</strong>" +
                                                    "<small>" +
                                                        esc(clientName(invoice.client_id)) +
                                                        " · " +
                                                        esc(date(invoice.due_date)) +
                                                    "</small>" +
                                                "</span>" +
                                                "<b>" +
                                                    esc(money(balance)) +
                                                "</b>" +
                                            "</button>"
                                        );
                                    }).join("") +
                                  "</div>"
                                : '<div class="sway-client360-empty">No future invoice due dates are currently recorded.</div>'
                        ) +
                    "</div>" +

                    insightPanel(
                        "Invoice value issued",
                        "Invoice value issued by month.",
                        trendChart(
                            invoiceSeries,
                            monthLabels,
                            "#2C91FC",
                            "Invoice value issued",
                            true
                        )
                    ) +
                "</div>" +
            "</section>"
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

            renderCashFlow() +

            renderLeadSourceAnalytics() +

            renderLeadConversionAnalytics() +

            renderServiceProfitability() +

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

            renderRevenuePipeline() +

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

    async function syncWorkspaceData(options) {
        const settings = options || {};

        if (state.syncInFlight) {
            state.syncQueued = true;
            return;
        }

        state.syncInFlight = true;

        try {
            await refreshData();

            let remindersCreated = 0;

            if (state.currentUser && state.currentUser.id) {
                remindersCreated =
                    await processAutomatedReminders();

                if (remindersCreated) {
                    await refreshData();
                }
            }

            updateNotificationCenter();

            state.lastLiveUpdate = Date.now();

            if (settings.status) {
                state.realtimeStatus = settings.status;
            }

            const editingModalOpen = Boolean(
                document.querySelector(
                    ".sway-modal:not([hidden]), .portfolio-modal:not([hidden])"
                )
            );

            if (
                settings.render !== false &&
                !editingModalOpen
            ) {
                renderShell();

                if (
                    state.currentView !== "portfolio" &&
                    state.currentView !== "testimonials"
                ) {
                    renderView();
                }

                setStandaloneManagerVisibility(
                    state.currentView
                );
            }
        } catch (error) {
            if (settings.fallbackToPolling) {
                state.realtimeStatus = "polling";
            }

            throw error;
        } finally {
            state.syncInFlight = false;

            if (state.syncQueued) {
                state.syncQueued = false;
                window.setTimeout(function () {
                    syncWorkspaceData({ fallbackToPolling: true }).catch(function (error) {
                        console.warn("Queued workspace sync failed.", error);
                    });
                }, 0);
            }
        }
    }

    function setupRealtime() {
        const beginBackgroundSync = function () {
            if (state.backgroundSyncTimer) {
                window.clearInterval(state.backgroundSyncTimer);
            }

            state.backgroundSyncTimer = window.setInterval(function () {
                if (document.visibilityState !== "visible") {
                    return;
                }

                syncWorkspaceData({ fallbackToPolling: true }).catch(function (error) {
                    console.warn("Background workspace sync failed.", error);
                });
            }, 10000);
        };

        const syncOnReturn = function () {
            if (document.visibilityState !== "visible") {
                return;
            }

            syncWorkspaceData({ fallbackToPolling: true }).catch(function (error) {
                console.warn("Workspace sync after tab return failed.", error);
            });
        };

        document.addEventListener("visibilitychange", syncOnReturn);
        window.addEventListener("online", syncOnReturn);

        beginBackgroundSync();

        if (
            !window.supabase ||
            typeof window.supabase.createClient !== "function"
        ) {
            state.realtimeStatus = "polling";
            syncOnReturn();
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

            if (
                client.realtime &&
                typeof client.realtime.setAuth === "function"
            ) {
                client.realtime.setAuth(accessToken);
            }

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
                "activity_log",
                "communication_logs",
                "portfolio_projects",
                "testimonials",
                "social_accounts",
                "social_posts",
                "social_metrics"
            ];

            let refreshTimer = null;

            const queueRefresh = function () {
                if (refreshTimer) {
                    clearTimeout(refreshTimer);
                }

                refreshTimer =
                    setTimeout(
                        function () {
                            refreshTimer = null;

                            syncWorkspaceData({
                                fallbackToPolling: true
                            }).catch(function (error) {
                                console.warn(
                                    "Live workspace refresh failed.",
                                    error
                                );
                            });
                        },
                        250
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
                    if (status === "SUBSCRIBED") {
                        state.realtimeStatus = "live";
                        state.lastLiveUpdate = Date.now();

                        syncWorkspaceData({ status: "live" }).catch(function (syncError) {
                            console.warn(
                                "Initial live workspace sync failed.",
                                syncError
                            );
                        });

                        return;
                    }

                    if (
                        status === "CHANNEL_ERROR" ||
                        status === "TIMED_OUT" ||
                        status === "CLOSED"
                    ) {
                        state.realtimeStatus = "polling";

                        console.warn(
                            "Swayphics Realtime unavailable:",
                            error
                        );
                    }
                }
            );

            state.realtimeClient = client;
        } catch (error) {
            state.realtimeStatus = "polling";

            console.warn(
                "Unable to initialise Swayphics Realtime.",
                error
            );
        }
    }


    function attentionDateLabel(value, today) {
        if (!value) return "";

        const key = dashboardDateKey(value);

        if (key === today) {
            return "Due today";
        }

        if (key && key < today) {
            return "Overdue";
        }

        return "Due " + date(value);
    }

    function renderNeedsAttention() {
        const today = dashboardTodayISO();
        const items = [];

        state.tasks.forEach(function (item) {
            if (
                item.assigned_to !== state.currentUser.id ||
                item.status === "completed" ||
                !item.due_date
            ) {
                return;
            }

            const due = dashboardDateKey(item.due_date);

            if (due && due <= today) {
                items.push({
                    priority: due < today ? "danger" : "warning",
                    icon: "T",
                    title: item.title || "Untitled task",
                    detail:
                        clientName(item.client_id) +
                        " · " +
                        attentionDateLabel(item.due_date, today),
                    view: "tasks",
                    sort: due < today ? 0 : 1
                });
            }
        });

        state.followups.forEach(function (item) {
            if (
                item.assigned_to !== state.currentUser.id ||
                item.status !== "pending" ||
                !item.scheduled_for
            ) {
                return;
            }

            const scheduled = dashboardDateKey(item.scheduled_for);

            if (scheduled && scheduled <= today) {
                items.push({
                    priority: scheduled < today ? "danger" : "warning",
                    icon: "F",
                    title: "Follow-up due",
                    detail:
                        (
                            item.client_id
                                ? clientName(item.client_id)
                                : leadName(item.lead_id)
                        ) +
                        " · " +
                        attentionDateLabel(item.scheduled_for, today),
                    view: "followups",
                    sort: scheduled < today ? 0 : 1
                });
            }
        });

        state.invoices.forEach(function (invoice) {
            if (
                invoice.status === "cancelled" ||
                invoice.status === "paid"
            ) {
                return;
            }

            const outstanding = Number(
                invoice.amount_outstanding != null
                    ? invoice.amount_outstanding
                    : invoice.total || 0
            );

            if (outstanding <= 0) {
                return;
            }

            const due = dashboardDateKey(invoice.due_date);

            if (
                invoice.status === "overdue" ||
                (due && due < today)
            ) {
                items.push({
                    priority: "danger",
                    icon: "I",
                    title:
                        invoice.invoice_number ||
                        "Outstanding invoice",
                    detail:
                        clientName(invoice.client_id) +
                        " · " +
                        money(outstanding) +
                        " outstanding",
                    view: "invoices",
                    sort: 0
                });
            } else if (due === today) {
                items.push({
                    priority: "warning",
                    icon: "I",
                    title:
                        invoice.invoice_number ||
                        "Invoice due today",
                    detail:
                        clientName(invoice.client_id) +
                        " · " +
                        money(outstanding) +
                        " due today",
                    view: "invoices",
                    sort: 1
                });
            }
        });

        state.enquiries.forEach(function (item) {
            if (item.status !== "new") {
                return;
            }

            items.push({
                priority: "info",
                icon: "?",
                title:
                    item.business_name ||
                    item.name ||
                    "New website enquiry",
                detail:
                    (
                        item.service
                            ? formatDisplayText(item.service) + " · "
                            : ""
                    ) +
                    "Received " +
                    date(item.created_at),
                view: "enquiries",
                sort: 2
            });
        });

        state.quotes.forEach(function (quote) {
            if (quote.status !== "sent") {
                return;
            }

            const validUntil = dashboardDateKey(quote.valid_until);

            items.push({
                priority:
                    validUntil &&
                    validUntil < today
                        ? "danger"
                        : "info",
                icon: "Q",
                title:
                    quote.quote_number ||
                    quote.title ||
                    "Quote awaiting response",
                detail:
                    clientName(quote.client_id) +
                    " · " +
                    money(quote.amount) +
                    " · Awaiting response",
                view: "quotes",
                sort:
                    validUntil &&
                    validUntil < today
                        ? 1
                        : 2
            });
        });

        items.sort(function (a, b) {
            return a.sort - b.sort;
        });

        const visibleItems = items.slice(0, 8);
        const total = items.length;

        if (!total) {
            return (
                panel(
                    "Today",
                    "Nothing currently requires immediate attention.",
                    '<div class="sway-attention-clear">' +
                        '<span class="sway-attention-clear-icon">✓</span>' +
                        '<div>' +
                            "<strong>You're all caught up.</strong>" +
                            "<p>No overdue tasks, due follow-ups, unpaid invoices or new enquiries need action right now.</p>" +
                        "</div>" +
                    "</div>"
                )
            );
        }

        return (
            '<section class="sway-attention-panel">' +
                '<div class="sway-attention-header">' +
                    '<div>' +
                        '<span class="admin-label">Today</span>' +
                        "<h3>Needs attention</h3>" +
                        "<p>The next actions that should not be missed.</p>" +
                    "</div>" +
                    '<span class="sway-attention-count">' +
                        total +
                        (total === 1 ? " item" : " items") +
                    "</span>" +
                "</div>" +
                '<div class="sway-attention-list">' +
                    visibleItems.map(function (item) {
                        return (
                            '<button type="button" class="sway-attention-item ' +
                                esc(item.priority) +
                                '" data-view-target="' +
                                esc(item.view) +
                            '">' +
                                '<span class="sway-attention-icon" aria-hidden="true">' +
                                    esc(item.icon) +
                                "</span>" +
                                '<span class="sway-attention-copy">' +
                                    '<strong>' +
                                        esc(formatDisplayText(item.title)) +
                                    "</strong>" +
                                    "<span>" +
                                        esc(item.detail) +
                                    "</span>" +
                                "</span>" +
                                '<span class="sway-attention-action">Open</span>' +
                            "</button>"
                        );
                    }).join("") +
                "</div>" +
                (
                    total > visibleItems.length
                        ? '<div class="sway-attention-more">' +
                            "Showing " +
                            visibleItems.length +
                            " of " +
                            total +
                            " items. Use the relevant workspace section to view the rest." +
                          "</div>"
                        : ""
                ) +
            "</section>"
        );
    }

    function addDashboardDays(value, days) {
        const key = dashboardDateKey(value || dashboardTodayISO());

        if (!key) {
            return dashboardTodayISO();
        }

        const parsed = new Date(
            key + "T00:00:00+02:00"
        );

        parsed.setDate(
            parsed.getDate() + Number(days || 0)
        );

        return (
            parsed.getFullYear() +
            "-" +
            String(parsed.getMonth() + 1).padStart(2, "0") +
            "-" +
            String(parsed.getDate()).padStart(2, "0")
        );
    }

    function dashboardDaysSince(value) {
        const key = dashboardDateKey(value);

        if (!key) return 0;

        const start = new Date(
            key + "T00:00:00+02:00"
        );

        const today = new Date(
            dashboardTodayISO() + "T00:00:00+02:00"
        );

        return Math.floor(
            (
                today.getTime() -
                start.getTime()
            ) /
            86400000
        );
    }

    function hasPendingFollowupForContact(clientId, leadId) {
        return state.followups.some(function (item) {
            return (
                item.status === "pending" &&
                (
                    (clientId && item.client_id === clientId) ||
                    (leadId && item.lead_id === leadId)
                )
            );
        });
    }

    function followupAutomationSuggestions() {
        const suggestions = [];

        state.quotes.forEach(function (quote) {
            if (
                quote.status !== "sent" ||
                !quote.client_id ||
                hasPendingFollowupForContact(
                    quote.client_id,
                    quote.lead_id
                )
            ) {
                return;
            }

            const referenceDate =
                quote.updated_at ||
                quote.created_at;

            const daysSince =
                dashboardDaysSince(referenceDate);

            if (daysSince < 3) {
                return;
            }

            suggestions.push({
                kind: "quote",
                priority: daysSince >= 7 ? "danger" : "warning",
                icon: "Q",
                title:
                    quote.quote_number ||
                    quote.title ||
                    "Quote follow-up",
                contact:
                    clientName(quote.client_id),
                reason:
                    "Quote sent " +
                    daysSince +
                    " days ago with no pending follow-up.",
                suggestedDate:
                    addDashboardDays(
                        dashboardTodayISO(),
                        0
                    ),
                note:
                    "Follow up on " +
                    (
                        quote.quote_number ||
                        "the quote"
                    ) +
                    " and confirm whether the client would like to proceed.",
                clientId:
                    quote.client_id,
                leadId:
                    quote.lead_id || null,
                actionLabel: "Schedule"
            });
        });

        state.invoices.forEach(function (invoice) {
            if (
                !invoice.client_id ||
                invoice.status === "paid" ||
                invoice.status === "cancelled" ||
                hasPendingFollowupForContact(
                    invoice.client_id,
                    null
                )
            ) {
                return;
            }

            const outstanding =
                Number(
                    invoice.amount_outstanding != null
                        ? invoice.amount_outstanding
                        : invoice.total || 0
                );

            if (outstanding <= 0) {
                return;
            }

            const overdue =
                invoice.status === "overdue" ||
                (
                    invoice.due_date &&
                    isOverdue(invoice.due_date)
                );

            const daysSinceSent =
                dashboardDaysSince(
                    invoice.sent_at ||
                    invoice.updated_at ||
                    invoice.created_at
                );

            if (!overdue && daysSinceSent < 7) {
                return;
            }

            suggestions.push({
                kind: "invoice",
                priority: overdue ? "danger" : "warning",
                icon: "I",
                title:
                    invoice.invoice_number ||
                    "Payment follow-up",
                contact:
                    clientName(invoice.client_id),
                reason:
                    overdue
                        ? "Invoice is overdue with " +
                          money(outstanding) +
                          " outstanding."
                        : "Invoice has been outstanding for " +
                          daysSinceSent +
                          " days.",
                suggestedDate:
                    dashboardTodayISO(),
                note:
                    overdue
                        ? "Follow up on " +
                          (
                              invoice.invoice_number ||
                              "the invoice"
                          ) +
                          " regarding the outstanding balance of " +
                          money(outstanding) +
                          "."
                        : "Check in on " +
                          (
                              invoice.invoice_number ||
                              "the invoice"
                          ) +
                          " and confirm the payment timeline.",
                clientId:
                    invoice.client_id,
                leadId: null,
                actionLabel: "Schedule"
            });
        });

        state.leads.forEach(function (lead) {
            if (
                !lead.assigned_to ||
                lead.assigned_to !== state.currentUser.id ||
                ["won", "lost", "follow-up"].includes(lead.status) ||
                hasPendingFollowupForContact(
                    lead.converted_client_id || null,
                    lead.id
                )
            ) {
                return;
            }

            const daysSince =
                dashboardDaysSince(
                    lead.updated_at ||
                    lead.created_at
                );

            if (
                daysSince < 3 ||
                ![
                    "contacted",
                    "interested",
                    "proposal sent",
                    "negotiating"
                ].includes(lead.status)
            ) {
                return;
            }

            suggestions.push({
                kind: "lead",
                priority:
                    daysSince >= 7
                        ? "danger"
                        : "info",
                icon: "L",
                title:
                    lead.business_name ||
                    "Lead follow-up",
                contact:
                    lead.contact_name ||
                    "Prospect",
                reason:
                    "No pending follow-up and the lead has been active for " +
                    daysSince +
                    " days.",
                suggestedDate:
                    dashboardTodayISO(),
                note:
                    "Follow up with " +
                    (
                        lead.business_name ||
                        "the prospect"
                    ) +
                    " regarding their " +
                    (
                        lead.service_interest ||
                        "requested service"
                    ) +
                    " interest.",
                clientId: null,
                leadId: lead.id,
                actionLabel: "Schedule"
            });
        });

        state.projects.forEach(function (project) {
            if (
                !project.client_id ||
                ["completed", "cancelled"].includes(project.status) ||
                !project.due_date ||
                hasPendingFollowupForContact(
                    project.client_id,
                    null
                )
            ) {
                return;
            }

            const due =
                dashboardDateKey(project.due_date);

            if (!due) {
                return;
            }

            const today =
                dashboardTodayISO();

            const daysUntil =
                Math.round(
                    (
                        new Date(due + "T00:00:00+02:00").getTime() -
                        new Date(today + "T00:00:00+02:00").getTime()
                    ) /
                    (24 * 60 * 60 * 1000)
                );

            if (daysUntil < 0 || daysUntil > 3) {
                return;
            }

            suggestions.push({
                kind: "project",
                priority:
                    daysUntil <= 1
                        ? "danger"
                        : "warning",
                icon: "P",
                title:
                    project.name ||
                    "Project deadline",
                contact:
                    clientName(project.client_id),
                reason:
                    "Project deadline is " +
                    (
                        daysUntil === 0
                            ? "today."
                            : daysUntil === 1
                                ? "tomorrow."
                                : "within " + daysUntil + " days."
                    ),
                suggestedDate:
                    today,
                note:
                    "Check in with " +
                    clientName(project.client_id) +
                    " about " +
                    (
                        project.name ||
                        "the project"
                    ) +
                    " before the delivery deadline.",
                clientId:
                    project.client_id,
                leadId: null,
                actionLabel: "Schedule"
            });
        });

        const priorityRank = {
            danger: 0,
            warning: 1,
            info: 2
        };

        suggestions.sort(function (a, b) {
            return (
                priorityRank[a.priority] -
                priorityRank[b.priority]
            );
        });

        return suggestions.slice(0, 8);
    }

    function renderFollowupAutomation() {
        const suggestions =
            followupAutomationSuggestions();

        if (!suggestions.length) {
            return "";
        }

        return (
            '<section class="sway-followup-automation">' +
                '<div class="sway-followup-automation-head">' +
                    '<div>' +
                        '<span class="admin-label">Automation</span>' +
                        "<h3>Recommended follow-ups</h3>" +
                        "<p>Based on activity and outstanding client actions, these contacts are ready for a follow-up.</p>" +
                    "</div>" +
                    '<span class="sway-followup-automation-badge">' +
                        suggestions.length +
                        " suggested" +
                    "</span>" +
                "</div>" +
                '<div class="sway-followup-automation-list">' +
                    suggestions.map(function (item, index) {
                        return (
                            '<div class="sway-followup-automation-item ' +
                                esc(item.priority) +
                                '">' +
                                '<span class="sway-followup-automation-icon" aria-hidden="true">' +
                                    esc(item.icon) +
                                "</span>" +
                                '<div class="sway-followup-automation-copy">' +
                                    "<strong>" +
                                        esc(formatDisplayText(item.title)) +
                                    "</strong>" +
                                    "<span>" +
                                        esc(item.contact) +
                                    "</span>" +
                                    "<small>" +
                                        esc(item.reason) +
                                    "</small>" +
                                "</div>" +
                                '<button type="button" class="sway-row-action" data-automation-followup="' +
                                    index +
                                '">Schedule</button>' +
                            "</div>"
                        );
                    }).join("") +
                "</div>" +
            "</section>"
        );
    }


    function socialPlatformIcon(platform) {
        const icons = {
            Instagram: "IG",
            Facebook: "FB",
            TikTok: "TK"
        };

        return icons[platform] || "SM";
    }

    function socialAccountFor(platform) {
        return state.socialAccounts.find(function (item) {
            return item.platform === platform;
        }) || null;
    }

    function socialLatestMetric(accountId) {
        return state.socialMetrics
            .filter(function (item) {
                return item.social_account_id === accountId;
            })
            .sort(function (a, b) {
                return String(b.metric_date || "").localeCompare(
                    String(a.metric_date || "")
                );
            })[0] || null;
    }

    function socialNumber(value) {
        const number = Number(value || 0);

        if (number >= 1000000) {
            return (
                (number / 1000000)
                    .toFixed(number >= 10000000 ? 0 : 1)
                    .replace(/\.0$/, "") +
                "M"
            );
        }

        if (number >= 1000) {
            return (
                (number / 1000)
                    .toFixed(number >= 100000 ? 0 : 1)
                    .replace(/\.0$/, "") +
                "K"
            );
        }

        return new Intl.NumberFormat("en-ZA").format(number);
    }

    function renderSocialOverview() {
        const platforms = [
            "Instagram",
            "Facebook",
            "TikTok"
        ];

        const connectedCount =
            state.socialAccounts.filter(function (item) {
                return item.status === "connected";
            }).length;

        const recentPosts =
            state.socialPosts
                .slice()
                .sort(function (a, b) {
                    return (
                        String(b.created_at || "")
                            .localeCompare(
                                String(a.created_at || "")
                            )
                    );
                })
                .slice(0, 5);

        const accountCards =
            platforms.map(function (platform) {
                const account =
                    socialAccountFor(platform);

                const metric =
                    account
                        ? socialLatestMetric(account.id)
                        : null;

                return (
                    '<article class="sway-social-account-card">' +
                        '<div class="sway-social-account-top">' +
                            '<span class="sway-social-platform-icon">' +
                                esc(socialPlatformIcon(platform)) +
                            "</span>" +
                            '<div class="sway-social-account-heading">' +
                                "<strong>" +
                                    esc(platform) +
                                "</strong>" +
                                "<span>" +
                                    esc(
                                        account
                                            ? (
                                                account.handle
                                                    ? "@" + account.handle
                                                    : account.account_name
                                            )
                                            : "No account connected"
                                    ) +
                                "</span>" +
                            "</div>" +
                            '<span class="sway-social-account-status ' +
                                (
                                    account &&
                                    account.status === "connected"
                                        ? "connected"
                                        : ""
                                ) +
                            '">' +
                                (
                                    account
                                        ? formatDisplayText(account.status)
                                        : "Not configured"
                                ) +
                            "</span>" +
                        "</div>" +
                        '<div class="sway-social-account-stats">' +
                            "<div><span>Followers</span><strong>" +
                                esc(
                                    metric
                                        ? socialNumber(metric.followers)
                                        : "—"
                                ) +
                            "</strong></div>" +
                            "<div><span>Reach</span><strong>" +
                                esc(
                                    metric
                                        ? socialNumber(metric.reach)
                                        : "—"
                                ) +
                            "</strong></div>" +
                            "<div><span>Views</span><strong>" +
                                esc(
                                    metric
                                        ? socialNumber(metric.views)
                                        : "—"
                                ) +
                            "</strong></div>" +
                        "</div>" +
                        '<div class="sway-social-account-actions">' +
                            (
                                account
                                    ? '<button type="button" class="sway-row-action" data-edit="socialAccounts" data-id="' +
                                      esc(account.id) +
                                      '">Edit account</button>'
                                    : '<button type="button" class="sway-row-action" data-social-add-account="' +
                                      esc(platform) +
                                      '">Add account</button>'
                            ) +
                            (
                                account && account.profile_url
                                    ? '<a class="sway-row-action sway-social-profile-link" href="' +
                                      esc(account.profile_url) +
                                      '" target="_blank" rel="noopener noreferrer">Open profile</a>'
                                    : ""
                            ) +
                        "</div>" +
                    "</article>"
                );
            }).join("");

        return (
            heading(
                '<button type="button" class="sway-workspace-button" data-add="socialAccounts">+ Add account</button>' +
                '<button type="button" class="sway-workspace-button primary" data-add="socialPosts">+ New post</button>'
            ) +

            '<section class="sway-social-summary">' +
                '<div>' +
                    '<span class="admin-label">Social control centre</span>' +
                    "<h3>One view of Swayphics social.</h3>" +
                    "<p>Accounts, publishing work and performance are being brought into the same operating system as your clients and sales pipeline.</p>" +
                "</div>" +
                '<div class="sway-social-summary-stats">' +
                    '<div><span>Connected accounts</span><strong>' +
                        connectedCount +
                    "</strong></div>" +
                    '<div><span>Content records</span><strong>' +
                        state.socialPosts.length +
                    "</strong></div>" +
                    '<div><span>Metric snapshots</span><strong>' +
                        state.socialMetrics.length +
                    "</strong></div>" +
                "</div>" +
            "</section>" +

            '<div class="sway-social-account-grid">' +
                accountCards +
            "</div>" +

            panel(
                "Recent content",
                "The dashboard queue for content that has been drafted, scheduled or published.",
                recentPosts.length
                    ? '<div class="sway-social-recent-list">' +
                        recentPosts.map(function (post) {
                            return (
                                '<button type="button" class="sway-social-recent-item" data-view-target="social-content">' +
                                    '<span class="sway-social-recent-icon">' +
                                        esc(
                                            socialPlatformIcon(
                                                post.platform
                                            )
                                        ) +
                                    "</span>" +
                                    '<span class="sway-social-recent-copy">' +
                                        "<strong>" +
                                            esc(
                                                post.title ||
                                                post.caption ||
                                                "Untitled post"
                                            ) +
                                        "</strong>" +
                                        "<small>" +
                                            esc(
                                                formatDisplayText(
                                                    post.status
                                                ) +
                                                " · " +
                                                formatDisplayText(
                                                    post.platform
                                                )
                                            ) +
                                        "</small>" +
                                    "</span>" +
                                    '<span class="sway-social-recent-date">' +
                                        esc(
                                            post.published_at
                                                ? date(post.published_at)
                                                : post.scheduled_for
                                                    ? dateTime(post.scheduled_for)
                                                    : date(post.created_at)
                                        ) +
                                    "</span>" +
                                "</button>"
                            );
                        }).join("") +
                      "</div>"
                    : empty(
                        "No social content has been created yet."
                    )
            ) +

            '<div class="sway-social-integration-note">' +
                "<strong>Live platform connection</strong>" +
                "<p>Official Meta and TikTok authentication will populate the account status, publishing results and performance snapshots here. No access tokens are stored in the dashboard tables.</p>" +
            "</div>"
        );
    }

    function renderSocialContent() {
        const rows =
            state.socialPosts.map(function (post) {
                return (
                    "<tr>" +
                        "<td>" +
                            "<strong>" +
                                esc(
                                    post.title ||
                                    post.caption ||
                                    "Untitled post"
                                ) +
                            "</strong>" +
                            (
                                post.caption &&
                                post.title
                                    ? '<br><span style="color:var(--text-muted);font-size:.58rem;">' +
                                      esc(
                                          post.caption
                                              .slice(0, 100)
                                      ) +
                                      (
                                          post.caption.length > 100
                                              ? "..."
                                              : ""
                                      ) +
                                      "</span>"
                                    : ""
                            ) +
                        "</td>" +
                        "<td>" +
                            esc(formatDisplayText(post.platform)) +
                        "</td>" +
                        "<td>" +
                            chip(post.status) +
                        "</td>" +
                        "<td>" +
                            esc(
                                post.published_at
                                    ? dateTime(post.published_at)
                                    : post.scheduled_for
                                        ? dateTime(post.scheduled_for)
                                        : dateTime(post.created_at)
                            ) +
                        "</td>" +
                        "<td>" +
                            '<div class="sway-row-actions">' +
                                '<button type="button" class="sway-row-action" data-edit="socialPosts" data-id="' +
                                    esc(post.id) +
                                '">Edit</button>' +
                                (
                                    post.external_post_url
                                        ? '<a class="sway-row-action" href="' +
                                          esc(post.external_post_url) +
                                          '" target="_blank" rel="noopener noreferrer">Open</a>'
                                        : ""
                                ) +
                                '<button type="button" class="sway-row-action danger" data-delete="socialPosts" data-id="' +
                                    esc(post.id) +
                                '">Delete</button>' +
                            "</div>" +
                        "</td>" +
                    "</tr>"
                );
            }).join("");

        return (
            heading(
                '<button type="button" class="sway-workspace-button primary" data-add="socialPosts">+ New social post</button>'
            ) +

            '<div class="sway-social-content-toolbar">' +
                '<div>' +
                    "<strong>Publishing queue</strong>" +
                    "<span>" +
                        state.socialPosts.filter(function (item) {
                            return item.status === "scheduled";
                        }).length +
                        " scheduled · " +
                        state.socialPosts.filter(function (item) {
                            return item.status === "draft";
                        }).length +
                        " drafts" +
                    "</span>" +
                "</div>" +
                '<span>Publishing automation comes with the official platform connections.</span>' +
            "</div>" +

            panel(
                "Content library",
                "Prepare captions and media references now; authenticated publishing will use the same records.",
                rows
                    ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Content</th><th>Platform</th><th>Status</th><th>Timing</th><th></th></tr></thead><tbody>' +
                      rows +
                      "</tbody></table></div>"
                    : empty(
                        "No social posts yet. Create the first piece of content."
                    )
            )
        );
    }

    function renderSocialAnalytics() {
        const accounts =
            state.socialAccounts;

        const latestByAccount =
            accounts.map(function (account) {
                return {
                    account: account,
                    metric: socialLatestMetric(account.id)
                };
            });

        const followers =
            latestByAccount.reduce(function (sum, item) {
                return (
                    sum +
                    Number(
                        item.metric
                            ? item.metric.followers
                            : 0
                    )
                );
            }, 0);

        const cutoff =
            new Date(
                Date.now() -
                (30 * 24 * 60 * 60 * 1000)
            );

        const recentMetrics =
            state.socialMetrics.filter(function (item) {
                const parsed =
                    new Date(
                        String(item.metric_date || "") +
                        "T23:59:59+02:00"
                    );

                return (
                    !Number.isNaN(parsed.getTime()) &&
                    parsed >= cutoff
                );
            });

        const reach =
            recentMetrics.reduce(function (sum, item) {
                return sum + Number(item.reach || 0);
            }, 0);

        const views =
            recentMetrics.reduce(function (sum, item) {
                return sum + Number(item.views || 0);
            }, 0);

        const engagement =
            recentMetrics.reduce(function (sum, item) {
                return (
                    sum +
                    Number(item.likes || 0) +
                    Number(item.comments || 0) +
                    Number(item.shares || 0)
                );
            }, 0);

        const engagementRate =
            reach > 0
                ? engagement / reach * 100
                : 0;

        const labels =
            chartMonths().map(function (item) {
                return item.label;
            });

        const keys =
            chartMonths().map(function (item) {
                return item.key;
            });

        const reachByMonth =
            keys.map(function (key) {
                return recentMetrics
                    .filter(function (item) {
                        return dashboardMonthKey(item.metric_date) === key;
                    })
                    .reduce(function (sum, item) {
                        return sum + Number(item.reach || 0);
                    }, 0);
            });

        const viewsByMonth =
            keys.map(function (key) {
                return recentMetrics
                    .filter(function (item) {
                        return dashboardMonthKey(item.metric_date) === key;
                    })
                    .reduce(function (sum, item) {
                        return sum + Number(item.views || 0);
                    }, 0);
            });

        return (
            heading(
                '<button type="button" class="sway-workspace-button" data-refresh-workspace>Refresh</button>'
            ) +

            '<div class="sway-workspace-grid">' +
                '<div class="sway-stat-card"><span class="label">Followers</span><div class="value">' +
                    esc(
                        accounts.length
                            ? socialNumber(followers)
                            : "—"
                    ) +
                "</div><div class=\"hint\">Latest synced audience across connected accounts.</div></div>" +
                '<div class="sway-stat-card"><span class="label">30-day reach</span><div class="value">' +
                    esc(socialNumber(reach)) +
                "</div><div class=\"hint\">Sum of daily reach snapshots in the current window.</div></div>" +
                '<div class="sway-stat-card"><span class="label">30-day views</span><div class="value">' +
                    esc(socialNumber(views)) +
                "</div><div class=\"hint\">Video or content views reported by the connected platforms.</div></div>" +
                '<div class="sway-stat-card"><span class="label">Engagement rate</span><div class="value">' +
                    esc(
                        engagementRate
                            ? engagementRate.toFixed(1) + "%"
                            : "—"
                    ) +
                "</div><div class=\"hint\">Likes + comments + shares divided by reach.</div></div>" +
            "</div>" +

            (
                state.socialMetrics.length
                    ? (
                        '<div class="sway-insight-grid">' +
                            insightPanel(
                                "Reach",
                                "Monthly reach from synced social metric snapshots.",
                                barChartSimple(
                                    reachByMonth,
                                    labels,
                                    "#0152F4",
                                    "Social reach"
                                )
                            ) +
                            insightPanel(
                                "Views",
                                "Monthly views from synced social metric snapshots.",
                                trendChart(
                                    viewsByMonth,
                                    labels,
                                    "#2C91FC",
                                    "Social views",
                                    false
                                )
                            ) +
                        "</div>"
                    )
                    : panel(
                        "Waiting for synced metrics",
                        "Performance data will appear here after the official platform connections begin writing daily snapshots.",
                        '<div class="sway-social-analytics-empty">' +
                            '<span>01</span><div><strong>Connect your accounts</strong><p>Once authentication and platform permissions are configured, follower, reach, view and engagement data can be pulled into this screen.</p></div>' +
                        "</div>"
                    )
            ) +

            panel(
                "Account performance",
                "Latest available snapshot for each configured account.",
                accounts.length
                    ? '<div class="sway-social-performance-list">' +
                        latestByAccount.map(function (item) {
                            const metric = item.metric;

                            return (
                                '<div class="sway-social-performance-row">' +
                                    '<div><span class="sway-social-platform-icon">' +
                                        esc(
                                            socialPlatformIcon(
                                                item.account.platform
                                            )
                                        ) +
                                    "</span><strong>" +
                                        esc(item.account.account_name) +
                                    "</strong><small>" +
                                        esc(
                                            item.account.handle
                                                ? "@" + item.account.handle
                                                : item.account.platform
                                        ) +
                                    "</small></div>" +
                                    "<span>" +
                                        esc(
                                            metric
                                                ? socialNumber(metric.followers)
                                                : "—"
                                        ) +
                                        "<small>followers</small>" +
                                    "</span>" +
                                    "<span>" +
                                        esc(
                                            metric
                                                ? socialNumber(metric.reach)
                                                : "—"
                                        ) +
                                        "<small>reach</small>" +
                                    "</span>" +
                                    "<span>" +
                                        esc(
                                            metric
                                                ? socialNumber(
                                                    Number(metric.likes || 0) +
                                                    Number(metric.comments || 0) +
                                                    Number(metric.shares || 0)
                                                )
                                                : "—"
                                        ) +
                                        "<small>engagements</small>" +
                                    "</span>" +
                                "</div>"
                            );
                        }).join("") +
                      "</div>"
                    : empty(
                        "Add the Swayphics social accounts first."
                    )
            )
        );
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
            state.invoices
                .filter(function (invoice) {
                    return invoice.status !== "cancelled";
                })
                .reduce(function (sum, invoice) {
                    return (
                        sum +
                        Number(
                            invoice.amount_outstanding != null
                                ? invoice.amount_outstanding
                                : invoice.total || 0
                        )
                    );
                }, 0);

        const pipeline =
            state.leads
                .filter(function (item) {
                    return !["won", "lost", "follow-up"].includes(item.status);
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

            renderNeedsAttention() +

            renderFollowupAutomation() +

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
                                        formatDisplayText(
                                            item.entity_type ||
                                            "workspace"
                                        )
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
                            clientHealthChip(item.id) +
                        "</td>" +
                        "<td>" +
                            chip(item.status) +
                        "</td>" +
                        "<td>" +
                            '<div class="sway-row-actions">' +
                                '<button class="sway-row-action" data-client-portal="' +
                                    esc(item.id) +
                                '">Portal</button>' +
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
        const visibleLeads =
            state.leads.filter(function (item) {
                return item.status !== "follow-up";
            });

        const rows =
            visibleLeads.map(function (item) {
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
                                formatDisplayText(
                                    item.source ||
                                    "Unspecified"
                                )
                            ) +
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
                            '<span class="sway-lead-assessment-status ' +
                                (
                                    leadAssessmentStatus(item) === "Assessed"
                                        ? "complete"
                                        : leadAssessmentStatus(item) === "In progress"
                                            ? "partial"
                                            : "empty"
                                ) +
                            '">' +
                                esc(leadAssessmentStatus(item)) +
                            "</span>" +
                        "</td>" +
                        "<td>" +
                            '<div class="sway-row-actions">' +
                                '<button class="sway-row-action" data-edit="leads" data-id="' +
                                    esc(item.id) +
                                '">Edit</button>' +
                                (
                                    item.email
                                        ? '<button class="sway-row-action" data-send-email-type="lead" data-send-email-id="' +
                                          esc(item.id) +
                                          '">Email</button>'
                                        : ""
                                ) +
                                (
                                    !["won", "lost"].includes(item.status)
                                        ? '<button class="sway-row-action" data-convert-lead="' +
                                          esc(item.id) +
                                          '">Convert to client</button>'
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
                "Active prospects only. Leads needing extra attention automatically move to Follow-ups after the no-response window.",
                state.leads.length
                    ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Business</th><th>Service</th><th>Status</th><th>Source</th><th>Value</th><th>Follow-up</th><th>Assessment</th><th></th></tr></thead><tbody>' +
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
            renderFollowupAutomation() +
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

    function client360List(items, emptyMessage, renderer) {
        if (!items.length) {
            return '<div class="sway-client360-empty">' +
                esc(emptyMessage) +
                "</div>";
        }

        return '<div class="sway-client360-list">' +
            items.slice(0, 6).map(renderer).join("") +
            "</div>";
    }

    function openClient360(clientId) {
        const client = state.clients.find(function (item) {
            return item.id === clientId;
        });

        if (!client) return;

        const projects = state.projects.filter(function (item) {
            return item.client_id === clientId;
        });

        const tasks = state.tasks.filter(function (item) {
            return item.client_id === clientId &&
                item.status !== "completed";
        });

        const followups = state.followups.filter(function (item) {
            return item.client_id === clientId;
        });

        const quotes = state.quotes.filter(function (item) {
            return item.client_id === clientId;
        });

        const invoices = state.invoices.filter(function (item) {
            return item.client_id === clientId;
        });

        const payments = state.payments.filter(function (item) {
            return item.client_id === clientId;
        });

        const leads = state.leads.filter(function (item) {
            return item.converted_client_id === clientId;
        });

        const activities = state.activities.filter(function (item) {
            return item.entity_id === clientId;
        });

        const communications = state.communications.filter(function (item) {
            return item.client_id === clientId;
        });

        const projectValue = projects.reduce(function (sum, item) {
            return sum + Number(item.value || 0);
        }, 0);

        const invoiceOutstanding = invoices.reduce(function (sum, item) {
            return sum + Number(
                item.amount_outstanding != null
                    ? item.amount_outstanding
                    : item.total || 0
            );
        }, 0);

        const paymentTotal = payments.reduce(function (sum, item) {
            return sum + Number(item.amount || 0);
        }, 0);

        const modalId = "sway-client360-modal";

        document.getElementById(modalId)?.remove();

        const modal = document.createElement("div");
        modal.className = "sway-client360-modal";
        modal.id = modalId;

        modal.innerHTML =
            '<div class="sway-client360-backdrop" data-close-client360></div>' +
            '<section class="sway-client360-card" role="dialog" aria-modal="true" aria-labelledby="sway-client360-title">' +
                '<div class="sway-client360-head">' +
                    '<div class="sway-client360-head-copy">' +
                        '<span class="admin-label">Client 360</span>' +
                        '<h3 id="sway-client360-title">' +
                            esc(client.business_name || "Client") +
                        "</h3>" +
                        (
                            client.contact_name
                                ? "<p>" + esc(client.contact_name) + "</p>"
                                : ""
                        ) +
                    "</div>" +
                    '<div class="sway-client360-head-actions">' +
                        (
                            client.email
                                ? '<button type="button" class="sway-workspace-button" data-send-email-type="client" data-send-email-id="' +
                                  esc(client.id) +
                                  '">Send email</button>'
                                : ""
                        ) +
                        '<button type="button" class="sway-workspace-button" data-edit="clients" data-id="' +
                            esc(client.id) +
                        '">Edit client</button>' +
                        '<button type="button" class="sway-client360-close" data-close-client360 aria-label="Close client details">×</button>' +
                    "</div>" +
                "</div>" +

                '<div class="sway-client360-contact">' +
                    '<span>' + esc(client.email || "No email") + "</span>" +
                    '<span>' + esc(client.phone || "No phone") + "</span>" +
                    '<span>' + esc(adminName(client.assigned_to)) + "</span>" +
                    clientHealthChip(client.id) +
                    '<button type="button" class="sway-row-action" data-client-portal="' +
                        esc(client.id) +
                    '">Portal link</button>' +
                "</div>" +

                '<div class="sway-client360-stats">' +
                    '<div><span>Projects</span><strong>' + projects.length + "</strong></div>" +
                    '<div><span>Open tasks</span><strong>' + tasks.length + "</strong></div>" +
                    '<div><span>Project value</span><strong>' + esc(money(projectValue)) + "</strong></div>" +
                    '<div><span>Outstanding</span><strong>' + esc(money(invoiceOutstanding)) + "</strong></div>" +
                    '<div><span>Recorded payments</span><strong>' + esc(money(paymentTotal)) + "</strong></div>" +
                "</div>" +

                '<div class="sway-client360-grid">' +

                    '<section class="sway-client360-section">' +
                        '<div class="sway-client360-section-head"><h4>Projects</h4><span>' + projects.length + "</span></div>" +
                        client360List(projects, "No projects linked to this client.", function (item) {
                            return '<button type="button" class="sway-client360-list-item" data-view-target="projects">' +
                                '<span><strong>' + esc(item.name) + '</strong><small>' +
                                esc((item.service ? formatDisplayText(item.service) + " · " : "") + formatDisplayText(item.status)) +
                                "</small></span><b>" + esc(money(item.value)) + "</b></button>";
                        }) +
                    "</section>" +

                    '<section class="sway-client360-section">' +
                        '<div class="sway-client360-section-head"><h4>Tasks</h4><span>' + tasks.length + "</span></div>" +
                        client360List(tasks, "No open tasks for this client.", function (item) {
                            return '<button type="button" class="sway-client360-list-item" data-view-target="tasks">' +
                                '<span><strong>' + esc(item.title) + '</strong><small>' +
                                esc(
                                    formatDisplayText(item.status) +
                                    (item.due_date ? " · " + date(item.due_date) : "")
                                ) +
                                "</small></span><b>" + esc(formatDisplayText(item.priority || "normal")) + "</b></button>";
                        }) +
                    "</section>" +

                    '<section class="sway-client360-section">' +
                        '<div class="sway-client360-section-head"><h4>Follow-ups</h4><span>' + followups.length + "</span></div>" +
                        client360List(followups, "No follow-ups recorded.", function (item) {
                            return '<button type="button" class="sway-client360-list-item" data-view-target="followups">' +
                                '<span><strong>' + esc(item.channel || "Follow-up") + '</strong><small>' +
                                esc(
                                    formatDisplayText(item.status) +
                                    (item.scheduled_for ? " · " + date(item.scheduled_for) : "")
                                ) +
                                "</small></span><b>" +
                                esc(item.lead_id ? "Lead" : "Client") +
                                "</b></button>";
                        }) +
                    "</section>" +

                    '<section class="sway-client360-section">' +
                        '<div class="sway-client360-section-head"><h4>Quotes</h4><span>' + quotes.length + "</span></div>" +
                        client360List(quotes, "No quotes for this client.", function (item) {
                            return '<button type="button" class="sway-client360-list-item" data-view-target="quotes">' +
                                '<span><strong>' + esc(item.quote_number || item.title || "Quote") + '</strong><small>' +
                                esc(formatDisplayText(item.status)) +
                                "</small></span><b>" + esc(money(item.amount)) + "</b></button>";
                        }) +
                    "</section>" +

                    '<section class="sway-client360-section">' +
                        '<div class="sway-client360-section-head"><h4>Invoices</h4><span>' + invoices.length + "</span></div>" +
                        client360List(invoices, "No invoices for this client.", function (item) {
                            const balance = Number(
                                item.amount_outstanding != null
                                    ? item.amount_outstanding
                                    : item.total || 0
                            );

                            return '<button type="button" class="sway-client360-list-item" data-view-target="invoices">' +
                                '<span><strong>' + esc(item.invoice_number) + '</strong><small>' +
                                esc(formatDisplayText(item.status)) +
                                "</small></span><b>" + esc(money(balance)) + "</b></button>";
                        }) +
                    "</section>" +

                    '<section class="sway-client360-section">' +
                        '<div class="sway-client360-section-head"><h4>Payments</h4><span>' + payments.length + "</span></div>" +
                        client360List(payments, "No payments recorded.", function (item) {
                            return '<button type="button" class="sway-client360-list-item" data-view-target="payments">' +
                                '<span><strong>' + esc(money(item.amount)) + '</strong><small>' +
                                esc(
                                    formatDisplayText(item.status) +
                                    (item.method ? " · " + item.method : "")
                                ) +
                                "</small></span><b>" + esc(date(item.paid_at || item.created_at)) + "</b></button>";
                        }) +
                    "</section>" +

                "</div>" +

                '<div class="sway-client360-communications">' +
                    '<section class="sway-client360-section">' +
                        '<div class="sway-client360-section-head"><h4>Communication log</h4><span>' +
                            state.communications.filter(function (item) {
                                return item.client_id === clientId;
                            }).length +
                        "</span></div>" +
                        (
                            state.communications.filter(function (item) {
                                return item.client_id === clientId;
                            }).length
                                ? '<div class="sway-client360-list">' +
                                    state.communications
                                        .filter(function (item) {
                                            return item.client_id === clientId;
                                        })
                                        .slice(0, 8)
                                        .map(function (item) {
                                            return (
                                                '<div class="sway-client360-list-item">' +
                                                    "<span><strong>" +
                                                        esc(
                                                            item.subject ||
                                                            item.channel ||
                                                            "Communication"
                                                        ) +
                                                    "</strong><small>" +
                                                        esc(
                                                            formatDisplayText(item.channel || "Other") +
                                                            " · " +
                                                            formatDisplayText(item.direction || "outbound")
                                                        ) +
                                                    "</small></span><b>" +
                                                        esc(dateTime(item.contacted_at)) +
                                                    "</b>" +
                                                "</div>"
                                            );
                                        }).join("") +
                                  "</div>"
                                : '<div class="sway-client360-empty">No communications have been logged for this client.</div>'
                        ) +
                        '<div style="margin-top:12px;">' +
                            '<button type="button" class="sway-workspace-button" data-add-communication-client="' +
                                esc(clientId) +
                            '">+ Log communication</button>' +
                        "</div>" +
                    "</section>" +
                "</div>" +

                '<div class="sway-client360-communications">' +
                    '<section class="sway-client360-section">' +
                        '<div class="sway-client360-section-head"><h4>Documents</h4><span>' +
                            state.documents.filter(function (item) {
                                return item.client_id === clientId;
                            }).length +
                        "</span></div>" +
                        (
                            state.documents.filter(function (item) {
                                return item.client_id === clientId;
                            }).length
                                ? '<div class="sway-client360-list">' +
                                    state.documents.filter(function (item) {
                                        return item.client_id === clientId;
                                    }).slice(0, 8).map(function (item) {
                                        return (
                                            '<div class="sway-client360-list-item">' +
                                                "<span><strong>" +
                                                    esc(item.file_name) +
                                                "</strong><small>" +
                                                    esc(
                                                        item.project_id
                                                            ? projectName(item.project_id)
                                                            : "Client document"
                                                    ) +
                                                "</small></span>" +
                                                '<button type="button" class="sway-row-action" data-download-document="' +
                                                    esc(item.id) +
                                                '">Download</button>' +
                                            "</div>"
                                        );
                                    }).join("") +
                                  "</div>"
                                : '<div class="sway-client360-empty">No documents uploaded for this client yet.</div>'
                        ) +
                        '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">' +
                            '<button type="button" class="sway-workspace-button" data-upload-client-document="' +
                                esc(clientId) +
                            '">+ Upload document</button>' +
                        "</div>" +
                    "</section>" +
                "</div>" +

                '<div class="sway-client360-lower">' +
                    '<section class="sway-client360-notes">' +
                        '<div class="sway-client360-section-head"><h4>Client notes</h4></div>' +
                        '<div class="sway-client360-note-body">' +
                            esc(client.notes || "No client notes have been added.") +
                        "</div>" +
                    "</section>" +

                    '<section class="sway-client360-history sway-client360-communications">' +
                        '<div class="sway-client360-section-head"><h4>Communications</h4><span>' + communications.length + "</span></div>" +
                        (
                            communications.length
                                ? '<div class="sway-client360-history-list">' +
                                    communications.slice(0, 8).map(function (item) {
                                        return '<div class="sway-client360-history-item">' +
                                            "<strong>" +
                                                esc(
                                                    (item.channel || "Communication") +
                                                    (item.direction ? " · " + formatDisplayText(item.direction) : "")
                                                ) +
                                            "</strong>" +
                                            "<span>" +
                                                esc(item.subject || item.message || "No subject") +
                                                " · " +
                                                esc(dateTime(item.contacted_at)) +
                                            "</span>" +
                                        "</div>";
                                    }).join("") +
                                  "</div>"
                                : '<div class="sway-client360-empty">No communications have been logged for this client yet.</div>'
                        ) +
                    "</section>" +

                    '<section class="sway-client360-history">' +
                        '<div class="sway-client360-section-head"><h4>Relationship history</h4><span>' + activities.length + "</span></div>" +
                        (
                            activities.length
                                ? '<div class="sway-client360-history-list">' +
                                    activities.slice(0, 8).map(function (item) {
                                        return '<div class="sway-client360-history-item">' +
                                            "<strong>" + esc(item.action || "Activity") + "</strong>" +
                                            "<span>" +
                                                esc(
                                                    item.actor_id
                                                        ? adminName(item.actor_id)
                                                        : "System"
                                                ) +
                                                " · " +
                                                esc(dateTime(item.created_at)) +
                                            "</span>" +
                                        "</div>";
                                    }).join("") +
                                  "</div>"
                                : '<div class="sway-client360-empty">No activity is directly linked to this client yet.</div>'
                        ) +
                    "</section>" +
                "</div>" +

                '<div class="sway-client360-footer">' +
                    '<button type="button" class="sway-workspace-button" data-new-project-client="' + esc(client.id) + '">+ Project</button>' +
                    '<button type="button" class="sway-workspace-button" data-new-invoice-client="' + esc(client.id) + '">+ Invoice</button>' +
                    '<button type="button" class="sway-workspace-button" data-new-communication-client="' + esc(client.id) + '">+ Communication</button>' +
                    '<button type="button" class="sway-workspace-button primary" data-close-client360>Done</button>' +
                "</div>" +
            "</section>";

        workspace.appendChild(modal);

        modal
            .querySelectorAll("[data-send-email-type]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        openEmailComposer(
                            button.dataset.sendEmailType,
                            button.dataset.sendEmailId
                        );
                    }
                );
            });

        modal.querySelectorAll("[data-edit]").forEach(function (button) {
            button.addEventListener("click", function () {
                const id = button.dataset.id;
                modal.remove();
                state.currentView = "clients";
                renderShell();
                renderView();

                window.setTimeout(function () {
                    const editButton = workspace.querySelector(
                        '[data-edit="clients"][data-id="' + id + '"]'
                    );

                    if (editButton) {
                        editButton.click();
                    }
                }, 0);
            });
        });

        modal.querySelectorAll("[data-new-project-client]").forEach(function (button) {
            button.addEventListener("click", function () {
                const id = button.dataset.newProjectClient;
                modal.remove();
                createOrEdit("projects", null, { client_id: id });
            });
        });

        modal.querySelectorAll("[data-new-invoice-client]").forEach(function (button) {
            button.addEventListener("click", function () {
                const id = button.dataset.newInvoiceClient;
                modal.remove();
                openInvoiceBuilder(null, id);
            });
        });

        modal.querySelectorAll("[data-new-communication-client]").forEach(function (button) {
            button.addEventListener("click", function () {
                const id = button.dataset.newCommunicationClient;
                modal.remove();
                createOrEdit("communications", null, {
                    client_id: id,
                    assigned_to: state.currentUser.id
                });
            });
        });

        modal.querySelectorAll("[data-client-portal]").forEach(function (button) {
            button.addEventListener("click", function () {
                createClientPortalLink(button.dataset.clientPortal);
            });
        });

        modal.querySelectorAll("[data-download-document]").forEach(function (button) {
            button.addEventListener("click", function () {
                downloadClientDocument(button.dataset.downloadDocument);
            });
        });

        modal.querySelectorAll("[data-upload-client-document]").forEach(function (button) {
            button.addEventListener("click", function () {
                openDocumentUploadModal(
                    button.dataset.uploadClientDocument
                );
            });
        });

        modal.querySelectorAll("[data-close-client360]").forEach(function (button) {
            button.addEventListener("click", function () {
                modal.remove();
            });
        });
    }


    function clientHealth(clientId) {
        const today = dashboardTodayISO();

        const projects = state.projects.filter(function (project) {
            return project.client_id === clientId &&
                project.status !== "cancelled";
        });

        const activeProjects = projects.filter(function (project) {
            return !["completed", "cancelled"].includes(project.status);
        });

        const overdueInvoices = state.invoices.filter(function (invoice) {
            if (
                invoice.client_id !== clientId ||
                invoice.status === "paid" ||
                invoice.status === "cancelled"
            ) {
                return false;
            }

            const outstanding = Number(
                invoice.amount_outstanding != null
                    ? invoice.amount_outstanding
                    : invoice.total || 0
            );

            if (outstanding <= 0) {
                return false;
            }

            const due = dashboardDateKey(invoice.due_date);

            return (
                invoice.status === "overdue" ||
                (due && due < today)
            );
        });

        const pendingFollowups = state.followups.filter(function (item) {
            return (
                item.client_id === clientId &&
                item.status === "pending"
            );
        });

        const recentCommunication = state.communications
            .filter(function (item) {
                return item.client_id === clientId;
            })
            .sort(function (a, b) {
                return notificationTimeValue(b) - notificationTimeValue(a);
            })[0];

        const activityTimes = state.activities
            .filter(function (item) {
                return item.entity_id === clientId;
            })
            .map(notificationTimeValue);

        const lastActivity = Math.max(
            notificationTimeValue(recentCommunication),
            ...activityTimes,
            0
        );

        const daysSinceActivity = lastActivity
            ? Math.max(
                0,
                Math.floor(
                    (Date.now() - lastActivity) / 86400000
                )
            )
            : Infinity;

        const reasons = [];
        let level = "healthy";

        if (overdueInvoices.length) {
            level = "at-risk";
            reasons.push(
                overdueInvoices.length === 1
                    ? "1 overdue invoice"
                    : overdueInvoices.length + " overdue invoices"
            );
        }

        if (
            activeProjects.some(function (project) {
                const due = dashboardDateKey(project.due_date);
                return Boolean(due && due < today);
            })
        ) {
            level = "at-risk";
            reasons.push("overdue project work");
        }

        if (
            level !== "at-risk" &&
            !pendingFollowups.length &&
            activeProjects.length &&
            daysSinceActivity >= 21
        ) {
            level = "needs-attention";
            reasons.push("no recent relationship activity");
        }

        if (
            level !== "at-risk" &&
            !pendingFollowups.length &&
            daysSinceActivity >= 14
        ) {
            level = "needs-attention";
            reasons.push("no recent communication");
        }

        if (!reasons.length) {
            reasons.push(
                activeProjects.length ||
                recentCommunication ||
                pendingFollowups.length
                    ? "active relationship"
                    : "no immediate issues detected"
            );
        }

        return {
            level: level,
            label:
                level === "at-risk"
                    ? "At risk"
                    : level === "needs-attention"
                        ? "Needs attention"
                        : "Healthy",
            reasons: reasons
        };
    }

    function clientHealthChip(clientId) {
        const health = clientHealth(clientId);

        return (
            '<span class="sway-client-health-chip ' +
                esc(health.level) +
                '" title="' +
                esc(health.reasons.join(" · ")) +
            '">' +
                esc(health.label) +
            "</span>"
        );
    }


    function automaticReminderExists(ruleKey, clientId, leadId) {
        const marker = "[Automatic reminder:" + ruleKey + "]";
        const cutoff = Date.now() - (14 * 24 * 60 * 60 * 1000);

        return state.followups.some(function (item) {
            if (item.status === "skipped") {
                return false;
            }

            if (clientId && item.client_id !== clientId) {
                return false;
            }

            if (leadId && item.lead_id !== leadId) {
                return false;
            }

            if (!String(item.note || "").includes(marker)) {
                return false;
            }

            return notificationTimeValue(item) >= cutoff;
        });
    }

    function automaticReminderCandidates() {
        const today = dashboardTodayISO();
        const candidates = [];

        state.leads.forEach(function (lead) {
            if (
                !["contacted", "interested", "proposal sent", "negotiating"].includes(
                    lead.status
                )
            ) {
                return;
            }

            const daysSince = dashboardDaysSince(
                lead.updated_at || lead.created_at
            );

            if (
                daysSince < 3 ||
                automaticReminderExists("lead", null, lead.id) ||
                hasPendingFollowupForContact(null, lead.id)
            ) {
                return;
            }

            candidates.push({
                ruleKey: "lead",
                clientId: null,
                leadId: lead.id,
                assignedTo: lead.assigned_to || state.currentUser.id,
                scheduledFor: today,
                channel: "WhatsApp",
                contact: leadName(lead.id),
                reason:
                    "Lead has been in " +
                    formatDisplayText(lead.status) +
                    " for " +
                    daysSince +
                    " days.",
                note:
                    "[Automatic reminder:lead] Follow up on " +
                    (lead.business_name || "this lead") +
                    " and move the conversation forward."
            });
        });

        state.quotes.forEach(function (quote) {
            if (
                quote.status !== "sent" ||
                !quote.client_id ||
                automaticReminderExists("quote", quote.client_id, null) ||
                hasPendingFollowupForContact(quote.client_id, quote.lead_id)
            ) {
                return;
            }

            const daysSince = dashboardDaysSince(
                quote.updated_at || quote.created_at
            );

            if (daysSince < 3) {
                return;
            }

            candidates.push({
                ruleKey: "quote",
                clientId: quote.client_id,
                leadId: quote.lead_id || null,
                assignedTo: quote.assigned_to || state.currentUser.id,
                scheduledFor: today,
                channel: "WhatsApp",
                contact: clientName(quote.client_id),
                reason:
                    "Quote has been awaiting a response for " +
                    daysSince +
                    " days.",
                note:
                    "[Automatic reminder:quote] Follow up on " +
                    (quote.quote_number || "the quote") +
                    " and confirm whether the client would like to proceed."
            });
        });

        state.invoices.forEach(function (invoice) {
            if (
                invoice.status === "paid" ||
                invoice.status === "cancelled" ||
                !invoice.client_id
            ) {
                return;
            }

            const outstanding = Number(
                invoice.amount_outstanding != null
                    ? invoice.amount_outstanding
                    : invoice.total || 0
            );

            if (outstanding <= 0) {
                return;
            }

            const daysSinceIssue = dashboardDaysSince(
                invoice.issue_date || invoice.created_at
            );

            const due = dashboardDateKey(invoice.due_date);
            const overdue =
                invoice.status === "overdue" ||
                Boolean(due && due < today);

            if (!overdue && daysSinceIssue < 7) {
                return;
            }

            if (
                automaticReminderExists("invoice", invoice.client_id, null) ||
                hasPendingFollowupForContact(invoice.client_id, null)
            ) {
                return;
            }

            candidates.push({
                ruleKey: "invoice",
                clientId: invoice.client_id,
                leadId: null,
                assignedTo: invoice.assigned_to || state.currentUser.id,
                scheduledFor: today,
                channel: "Email",
                contact: clientName(invoice.client_id),
                reason:
                    overdue
                        ? "Invoice is overdue."
                        : "Invoice has been outstanding for " +
                          daysSinceIssue +
                          " days.",
                note:
                    "[Automatic reminder:invoice] Follow up on " +
                    (invoice.invoice_number || "the outstanding invoice") +
                    " for " +
                    money(outstanding) +
                    " outstanding."
            });
        });

        return candidates.slice(0, 12);
    }

    async function processAutomatedReminders() {
        const candidates = automaticReminderCandidates();
        let created = 0;

        for (const item of candidates) {
            try {
                await api(
                    "/rest/v1/follow_ups",
                    {
                        method: "POST",
                        headers: headers({
                            "Prefer": "return=minimal"
                        }),
                        body: JSON.stringify({
                            lead_id: item.leadId,
                            client_id: item.clientId,
                            assigned_to: item.assignedTo,
                            scheduled_for: item.scheduledFor,
                            channel: item.channel,
                            status: "pending",
                            note: item.note
                        })
                    }
                );

                created += 1;
            } catch (error) {
                console.warn(
                    "Automatic reminder could not be created.",
                    error
                );
            }
        }

        if (created) {
            try {
                await logActivity(
                    "Created automatic reminder" +
                    (created === 1 ? "" : "s"),
                    "follow_ups",
                    null
                );
            } catch (error) {
                console.warn(
                    "Automatic reminder activity could not be logged.",
                    error
                );
            }
        }

        return created;
    }

    function renderAutomatedReminders() {
        const candidates = automaticReminderCandidates();
        const active = state.followups.filter(function (item) {
            return (
                item.status === "pending" &&
                String(item.note || "").includes(
                    "[Automatic reminder:"
                )
            );
        });

        return (
            '<section class="sway-automated-reminders">' +
                '<div class="sway-automated-reminders-head">' +
                    '<div>' +
                        '<span class="admin-label">Automation</span>' +
                        "<h3>Automated reminders</h3>" +
                        "<p>Internal follow-up reminders are created automatically when leads, quotes or invoices go quiet.</p>" +
                    "</div>" +
                    '<button type="button" class="sway-workspace-button primary" data-run-automated-reminders>Run now</button>' +
                "</div>" +
                '<div class="sway-automated-reminders-stats">' +
                    '<div><span>Ready to create</span><strong>' +
                        candidates.length +
                    "</strong></div>" +
                    '<div><span>Active automatic reminders</span><strong>' +
                        active.length +
                    "</strong></div>" +
                "</div>" +
                (
                    candidates.length
                        ? '<div class="sway-automated-reminders-list">' +
                            candidates.map(function (item) {
                                return (
                                    '<div class="sway-automated-reminder-item">' +
                                        '<span class="sway-automated-reminder-icon">↗</span>' +
                                        '<div>' +
                                            "<strong>" +
                                                esc(item.contact) +
                                            "</strong>" +
                                            "<small>" +
                                                esc(item.reason) +
                                            "</small>" +
                                        "</div>" +
                                    "</div>"
                                );
                            }).join("") +
                          "</div>"
                        : '<div class="sway-automated-reminders-clear">' +
                            "<strong>Automation is up to date.</strong>" +
                            "<span>No new automatic reminders are currently due.</span>" +
                          "</div>"
                ) +
            "</section>"
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
                            clientHealthChip(item.id) +
                        "</td>" +
                        "<td>" +
                            chip(item.status) +
                        "</td>" +
                        "<td>" +
                            '<div class="sway-row-actions">' +
                                '<button class="sway-row-action" data-client-portal="' +
                                    esc(item.id) +
                                '">Portal</button>' +
                                '<button class="sway-row-action" data-client360="' +
                                    esc(item.id) +
                                '">View</button>' +
                                '<button class="sway-row-action" data-edit="clients" data-id="' +
                                    esc(item.id) +
                                '">Edit</button>' +
                                (
                                    item.email
                                        ? '<button class="sway-row-action" data-send-email-type="client" data-send-email-id="' +
                                          esc(item.id) +
                                          '">Email</button>'
                                        : ""
                                ) +
                                '<button class="sway-row-action" data-new-project-client="' +
                                    esc(item.id) +
                                '">Project</button>' +
                                '<button class="sway-row-action" data-new-invoice-client="' +
                                    esc(item.id) +
                                '">Invoice</button>' +
                                (
                                    item.status === "archived"
                                        ? '<button class="sway-row-action" data-restore-client="' +
                                          esc(item.id) +
                                          '">Restore</button>'
                                        : '<button class="sway-row-action" data-archive-client="' +
                                          esc(item.id) +
                                          '">Archive</button>'
                                ) +
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
                "Manage active and archived client relationships. Delete permanently when a client record and its linked history should be removed.",
                state.clients.length
                    ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Business</th><th>Contact</th><th>Owner</th><th>Projects</th><th>Health</th><th>Status</th><th></th></tr></thead><tbody>' +
                      rows +
                      "</tbody></table></div>"
                    : empty("No clients yet.")
            )
        );
    }

    function renderProjects() {
        const rows =
            state.projects.map(function (item) {
                const projectReviewAction =
                    item.status === "completed" &&
                    item.review_email_status !== "sent"
                        ? '<button class="sway-row-action" data-request-review="' +
                          esc(item.id) +
                          '">' +
                          (
                              item.review_email_status === "failed"
                                  ? "Retry review"
                                  : "Send review"
                          ) +
                          "</button>"
                        : "";

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
                            (
                                Number(item.estimated_cost || 0)
                                    ? esc(money(item.estimated_cost))
                                    : "—"
                            ) +
                        "</td>" +
                        "<td>" +
                            (
                                item.status === "completed"
                                    ? chip(
                                        item.review_email_status === "sent"
                                            ? "review sent"
                                            : item.review_email_status === "failed"
                                                ? "review failed"
                                                : "review queued"
                                    )
                                    : "—"
                            ) +
                        "</td>" +
                        "<td>" +
                            '<div class="sway-row-actions">' +
                                '<button class="sway-row-action" data-project-timeline="' +
                                    esc(item.id) +
                                '">Timeline</button>' +
                                '<button class="sway-row-action" data-edit="projects" data-id="' +
                                    esc(item.id) +
                                '">Edit</button>' +
                                projectReviewAction +
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
                    ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Project</th><th>Client</th><th>Owner</th><th>Status</th><th>Due</th><th>Payment</th><th>Value</th><th>Cost</th><th>Review</th><th></th></tr></thead><tbody>' +
                      rows +
                      "</tbody></table></div>"
                    : empty("No projects yet.")
            )
        );
    }

    function renderQuotes() {
        const rows =
            state.quotes.map(function (item) {
                const contactDetails =
                    communicationContactDetails(item);

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
                                (
                                    item.status === "accepted" && !item.invoice_id
                                        ? '<button class="sway-row-action" data-create-invoice-from-quote="' +
                                          esc(item.id) +
                                          '">Create invoice</button>'
                                        : item.invoice_id
                                            ? '<span class="sway-chip success">Invoice linked</span>'
                                            : ""
                                ) +
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

    function invoiceModalMarkup(
        invoice,
        lines,
        prefillClientId
    ) {
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
                            (
                                invoice
                                    ? invoice.client_id
                                    : prefillClientId
                            ) === client.id
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

    async function openInvoiceBuilder(
        invoiceId,
        prefillClientId
    ) {
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
                lines,
                prefillClientId
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


    function generateEmailSubject(type, item) {
        const contact = item || {};
        const business = String(
            contact.business_name ||
            "Business correspondence"
        ).trim();

        const service =
            type === "lead"
                ? String(
                    contact.service_interest ||
                    ""
                ).trim()
                : "";

        return (
            "Swayphics | " +
            business +
            (
                service
                    ? " | " +
                      formatDisplayText(service)
                    : ""
            )
        ).slice(0, 180);
    }

    function emailContactRecords(type) {
        const source =
            type === "lead"
                ? state.leads
                : state.clients;

        return (
            Array.isArray(source)
                ? source
                : []
        ).filter(function (item) {
            return String(item.email || "").trim();
        });
    }

    function emailContactOptions(type, selectedId) {
        const records =
            emailContactRecords(type);

        if (!records.length) {
            return '<option value="">No contacts with email addresses</option>';
        }

        return (
            '<option value="">Select ' +
            (
                type === "lead"
                    ? "lead"
                    : "client"
            ) +
            "...</option>" +
            records.map(function (item) {
                return (
                    '<option value="' +
                    esc(item.id) +
                    '"' +
                    (
                        item.id === selectedId
                            ? " selected"
                            : ""
                    ) +
                    ">" +
                    esc(
                        item.contact_name ||
                        item.business_name ||
                        item.email
                    ) +
                    (
                        item.contact_name &&
                        item.business_name
                            ? " · " +
                              esc(item.business_name)
                            : " · " +
                              esc(item.email)
                    ) +
                    "</option>"
                );
            }).join("")
        );
    }

    async function invokeEmailFunction(
        contactType,
        contactId,
        recipientEmail,
        subject,
        message
    ) {
        const recipientMatch =
            String(recipientEmail || "").match(
                /[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/i
            );

        const normalizedRecipientEmail =
            (
                recipientMatch
                    ? recipientMatch[0]
                    : String(recipientEmail || "").trim()
            ).toLowerCase();

        const response =
            await fetch(
                SUPABASE_URL +
                "/functions/v1/send-email",
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
                            contact_type:
                                contactType,
                            contact_id:
                                contactId,
                            recipient_email:
                                normalizedRecipientEmail,
                            subject:
                                subject,
                            message:
                                message
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
        } catch (error) {
            result = {
                error:
                    responseText
            };
        }

        if (!response.ok) {
            const errorMessage =
                result &&
                result.error
                    ? String(result.error)
                    : "";

            if (
                response.status === 500 &&
                errorMessage.includes(
                    "The selected recipient could not be found in the Swayphics contacts"
                ) &&
                normalizedRecipientEmail
            ) {
                const retryResponse =
                    await fetch(
                        SUPABASE_URL +
                        "/functions/v1/send-email",
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
                                    contact_type:
                                        contactType,
                                    contact_id:
                                        "",
                                    recipient_email:
                                        normalizedRecipientEmail,
                                    subject:
                                        subject,
                                    message:
                                        message
                                })
                        }
                    );

                const retryText =
                    await retryResponse.text();

                let retryResult = null;

                try {
                    retryResult =
                        retryText
                            ? JSON.parse(
                                retryText
                            )
                            : null;
                } catch (error) {
                    retryResult = {
                        error:
                            retryText
                    };
                }

                if (retryResponse.ok) {
                    return retryResult;
                }

                throw new Error(
                    retryResult &&
                    retryResult.error
                        ? retryResult.error
                        : (
                            "Email sending failed with " +
                            retryResponse.status +
                            "."
                        )
                );
            }

            throw new Error(
                errorMessage ||
                (
                    "Email sending failed with " +
                    response.status +
                    "."
                )
            );
        }

        return result;
    }

    function renderEmailWorkspace() {
        const sentEmails =
            state.communications
                .filter(function (item) {
                    return (
                        item.channel === "Email" &&
                        item.direction === "outbound"
                    );
                })
                .slice(0, 8);

        const recentRows =
            sentEmails.map(function (item) {
                const contactDetails =
                    communicationContactDetails(item);

                return (
                    "<tr>" +
                        "<td><strong>" +
                            esc(contactDetails.primary) +
                        "</strong>" +
                        (
                            contactDetails.secondary
                                ? '<br><span style="color:var(--text-muted);font-size:.58rem;">' +
                                  esc(contactDetails.secondary) +
                                  "</span>"
                                : ""
                        ) +
                        (
                            item.subject
                                ? '<br><span style="color:var(--text-muted);font-size:.58rem;">' +
                                  esc(item.subject) +
                                  "</span>"
                                : ""
                        ) +
                        "</td>" +
                        "<td>" +
                            '<div class="sway-communication-message">' +
                                esc(item.message || "—") +
                            "</div>" +
                        "</td>" +
                        "<td>" +
                            esc(dateTime(item.contacted_at)) +
                        "</td>" +
                        "<td>" +
                            esc(adminName(item.created_by)) +
                        "</td>" +
                    "</tr>"
                );
            }).join("");

        return (
            heading(
                '<button type="button" class="sway-workspace-button primary" data-compose-email>+ Compose email</button>'
            ) +
            '<section class="sway-email-summary">' +
                '<div class="sway-email-summary-copy">' +
                    '<span class="admin-label">Swayphics mail</span>' +
                    "<h3>Send from info@swayphics.co.za</h3>" +
                    "<p>Every message uses the Swayphics branded email wrapper. The greeting and signature are added automatically, while your message remains completely under your control.</p>" +
                "</div>" +
                '<div class="sway-email-summary-grid">' +
                    '<div><span>From</span><strong>info@swayphics.co.za</strong></div>' +
                    '<div><span>Template</span><strong>Branded</strong></div>' +
                    '<div><span>Logging</span><strong>Automatic</strong></div>' +
                "</div>" +
            "</section>" +
            panel(
                "Recent sent emails",
                "Outbound emails sent by Swayphics admins from the built-in composer.",
                recentRows
                    ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Contact</th><th>Message</th><th>Date &amp; time</th><th>Sent by</th></tr></thead><tbody>' +
                      recentRows +
                      "</tbody></table></div>"
                    : empty(
                        "No sent emails yet. Compose the first one from the button above or directly from a lead or client."
                    )
            ) +
            '<div class="sway-inline-note">' +
                "<strong>Automatic communication log:</strong> every successful email is added to the relationship history used by Client 360 and the Communication Log." +
            "</div>"
        );
    }

    function openEmailComposer(contactType, contactId) {
        const modalId =
            "sway-email-composer";

        document.getElementById(modalId)?.remove();

        let selectedType =
            contactType === "client" ||
            contactType === "lead"
                ? contactType
                : (
                    emailContactRecords("lead").length
                        ? "lead"
                        : "client"
                );

        let selectedId =
            contactId || "";

        if (
            !emailContactRecords(
                selectedType
            ).some(function (item) {
                return item.id === selectedId;
            })
        ) {
            selectedId = "";
        }

        const modal =
            document.createElement("div");

        modal.className =
            "sway-email-composer";

        modal.id =
            modalId;

        modal.innerHTML =
            '<div class="sway-email-composer-backdrop" data-close-email-composer></div>' +
            '<section class="sway-email-composer-card" role="dialog" aria-modal="true" aria-labelledby="sway-email-composer-title">' +
                '<div class="sway-email-composer-head">' +
                    '<div>' +
                        '<span class="admin-label">Swayphics mail</span>' +
                        '<h3 id="sway-email-composer-title">Compose email</h3>' +
                        '<p>From <strong>info@swayphics.co.za</strong>. Your greeting, Swayphics branding and signature are handled automatically.</p>' +
                    "</div>" +
                    '<button type="button" class="sway-client360-close" data-close-email-composer aria-label="Close email composer">×</button>' +
                "</div>" +
                '<form class="sway-email-composer-form">' +
                    '<div class="sway-email-composer-recipient-grid">' +
                        '<div class="sway-email-field">' +
                            '<label for="sway-email-contact-type">Recipient type</label>' +
                            '<select id="sway-email-contact-type">' +
                                '<option value="lead"' +
                                    (selectedType === "lead" ? " selected" : "") +
                                '>Lead</option>' +
                                '<option value="client"' +
                                    (selectedType === "client" ? " selected" : "") +
                                '>Client</option>' +
                            "</select>" +
                        "</div>" +
                        '<div class="sway-email-field">' +
                            '<label for="sway-email-contact-id">Recipient</label>' +
                            '<select id="sway-email-contact-id">' +
                                emailContactOptions(
                                    selectedType,
                                    selectedId
                                ) +
                            "</select>" +
                        "</div>" +
                    "</div>" +
                    '<div class="sway-email-recipient-preview" id="sway-email-recipient-preview">Select a recipient to continue.</div>' +
                    '<div class="sway-email-field">' +
                        '<div class="sway-email-label-row">' +
                            '<label for="sway-email-subject">Subject</label>' +
                            '<span>Auto-generated</span>' +
                        "</div>" +
                        '<input id="sway-email-subject" type="text" maxlength="180" autocomplete="off">' +
                    "</div>" +
                    '<div class="sway-email-field">' +
                        '<label for="sway-email-message">Message</label>' +
                        '<textarea id="sway-email-message" rows="11" maxlength="10000" placeholder="Type what you want to say. Your greeting and Swayphics signature will be added automatically." required></textarea>' +
                    "</div>" +
                    '<div class="sway-email-composer-note">' +
                        '<strong>Branded template</strong>' +
                        "<span>Blue Swayphics header · automatic greeting · your message · automatic sign-off · Swayphics contact footer</span>" +
                    "</div>" +
                    '<div class="sway-email-composer-actions">' +
                        '<button type="button" class="sway-workspace-button" data-close-email-composer>Cancel</button>' +
                        '<button type="submit" class="sway-workspace-button primary" id="sway-email-send-button">Send email</button>' +
                    "</div>" +
                "</form>" +
            "</section>";

        document.body.appendChild(modal);

        const form = modal.querySelector(".sway-email-composer-form");
        const typeInput = modal.querySelector("#sway-email-contact-type");
        const contactInput = modal.querySelector("#sway-email-contact-id");
        const recipientPreview = modal.querySelector("#sway-email-recipient-preview");
        const subjectInput = modal.querySelector("#sway-email-subject");
        const messageInput = modal.querySelector("#sway-email-message");
        const sendButton = modal.querySelector("#sway-email-send-button");

        let selectedTypeState = selectedType;
        let selectedIdState = selectedId;
        let lastAutoSubject = "";
        let subjectWasEdited = false;

        function selectedContact() {
            return (
                emailContactRecords(
                    selectedTypeState
                ).find(function (item) {
                    return item.id === selectedIdState;
                }) || null
            );
        }

        function updateRecipient() {
            selectedTypeState =
                typeInput.value === "client"
                    ? "client"
                    : "lead";

            const records =
                emailContactRecords(
                    selectedTypeState
                );

            if (
                contactInput.value &&
                records.some(function (item) {
                    return item.id === contactInput.value;
                })
            ) {
                selectedIdState =
                    contactInput.value;
            } else if (
                selectedIdState &&
                records.some(function (item) {
                    return item.id === selectedIdState;
                })
            ) {
                selectedIdState =
                    selectedIdState;
            } else {
                selectedIdState = "";
            }

            contactInput.innerHTML =
                emailContactOptions(
                    selectedTypeState,
                    selectedIdState
                );

            contactInput.value =
                selectedIdState;

            const contact =
                selectedContact();

            if (!contact) {
                recipientPreview.innerHTML =
                    "No contact with an email address is available for this type.";

                subjectInput.value = "";
                lastAutoSubject = "";
                sendButton.disabled = true;
                return;
            }

            recipientPreview.innerHTML =
                '<span>To</span><strong>' +
                    esc(
                        contact.contact_name ||
                        contact.business_name ||
                        "Recipient"
                    ) +
                "</strong><b>" +
                    esc(contact.email) +
                "</b>";

            const autoSubject =
                generateEmailSubject(
                    selectedTypeState,
                    contact
                );

            if (
                !subjectWasEdited ||
                subjectInput.value ===
                    lastAutoSubject
            ) {
                subjectInput.value =
                    autoSubject;

                subjectWasEdited = false;
            }

            lastAutoSubject =
                autoSubject;

            sendButton.disabled = false;
        }

        typeInput.addEventListener(
            "change",
            function () {
                subjectWasEdited = false;
                updateRecipient();
            }
        );

        contactInput.addEventListener(
            "change",
            function () {
                selectedIdState =
                    contactInput.value;

                if (
                    subjectInput.value ===
                    lastAutoSubject
                ) {
                    subjectWasEdited = false;
                }

                updateRecipient();
            }
        );

        subjectInput.addEventListener(
            "input",
            function () {
                subjectWasEdited =
                    subjectInput.value !==
                    lastAutoSubject;
            }
        );

        form.addEventListener(
            "submit",
            async function (event) {
                event.preventDefault();

                const contact =
                    selectedContact();

                const message =
                    messageInput.value.trim();

                const subject =
                    subjectInput.value.trim() ||
                    generateEmailSubject(
                        selectedTypeState,
                        contact
                    );

                if (!contact) {
                    swayAlert(
                        "Select a lead or client with an email address."
                    );
                    return;
                }

                if (!message) {
                    swayAlert(
                        "Type the message you want to send."
                    );
                    messageInput.focus();
                    return;
                }

                sendButton.disabled = true;
                sendButton.textContent =
                    "Sending...";

                try {
                    const result =
                        await invokeEmailFunction(
                            selectedTypeState,
                            contact.id,
                            contact.email,
                            subject,
                            message
                        );

                    modal.remove();

                    await refreshSecondaryData();
                    renderView();

                    if (
                        result &&
                        result.communication_logged === false
                    ) {
                        swayAlert(
                            "Email sent to " +
                            contact.email +
                            ", but the communication log could not be saved." +
                            (
                                result.communication_log_error
                                    ? " " +
                                      result.communication_log_error
                                    : ""
                            )
                        );
                    } else {
                        swayAlert(
                            "Email sent to " +
                            contact.email +
                            "."
                        );
                    }
                } catch (error) {
                    swayAlert(
                        error.message ||
                        "Unable to send the email."
                    );

                    sendButton.disabled = false;
                    sendButton.textContent =
                        "Send email";
                }
            }
        );

        modal
            .querySelectorAll(
                "[data-close-email-composer]"
            )
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        modal.remove();
                    }
                );
            });

        updateRecipient();
        messageInput.focus();
    }

    function renderInvoices() {
        const showArchived =
            localStorage.getItem(
                "swayphics_show_archived_invoices"
            ) === "true";

        const activeInvoices =
            state.invoices.filter(function (invoice) {
                return invoice.archived !== true;
            });

        const archivedInvoices =
            state.invoices.filter(function (invoice) {
                return invoice.archived === true;
            });

        const visibleInvoices =
            showArchived
                ? archivedInvoices
                : activeInvoices;

        const totalBilled =
            activeInvoices.reduce(function (sum, invoice) {
                return sum +
                    Number(invoice.total || 0);
            }, 0);

        const totalSent =
            activeInvoices
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
            activeInvoices.filter(function (invoice) {
                return (
                    invoice.status !== "paid" &&
                    invoice.status !== "cancelled" &&
                    invoice.due_date &&
                    isOverdue(invoice.due_date)
                );
            });

        const rows =
            visibleInvoices.map(function (item) {
                const overdueNow =
                    !item.archived &&
                    item.status !== "paid" &&
                    item.status !== "cancelled" &&
                    isOverdue(item.due_date);

                const outstanding =
                    Number(
                        item.amount_outstanding != null
                            ? item.amount_outstanding
                            : item.total || 0
                    );

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
                            esc(money(item.total)) +
                        "</td>" +
                        "<td>" +
                            esc(
                                money(
                                    item.amount_paid != null
                                        ? item.amount_paid
                                        : 0
                                )
                            ) +
                        "</td>" +
                        "<td>" +
                            esc(money(outstanding)) +
                        "</td>" +
                        "<td>" +
                            (
                                item.archived
                                    ? chip("archived")
                                    : chip(
                                        overdueNow
                                            ? "overdue"
                                            : item.status
                                    )
                            ) +
                        "</td>" +
                        "<td>" +
                            esc(date(item.due_date)) +
                        "</td>" +
                        "<td>" +
                            (
                                item.archived
                                    ? "—"
                                    : chip(item.email_status)
                            ) +
                        "</td>" +
                        "<td>" +
                            '<div class="sway-row-actions">' +
                                (
                                    item.archived
                                        ? '<button class="sway-row-action" data-invoice-action="restore" data-id="' +
                                          esc(item.id) +
                                          '">Restore</button>'
                                        : ""
                                ) +
                                (
                                    !item.archived &&
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
                                    !item.archived &&
                                    item.status !== "paid" &&
                                    item.status !== "cancelled"
                                        ? '<button class="sway-row-action" data-new-payment-invoice="' +
                                          esc(item.id) +
                                        '">Payment</button>'
                                        : ""
                                ) +
                                (
                                    !item.archived &&
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
                                    !item.archived
                                        ? '<button class="sway-row-action" data-invoice-action="archive" data-id="' +
                                          esc(item.id) +
                                          '">Archive</button>'
                                        : ""
                                ) +
                                (
                                    item.status === "draft" ||
                                    item.archived
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
                (
                    archivedInvoices.length
                        ? '<button class="sway-workspace-button" data-invoice-filter="archived">' +
                          (
                              showArchived
                                  ? "Show active invoices"
                                  : "Show archived (" +
                                    archivedInvoices.length +
                                    ")"
                          ) +
                          "</button>"
                        : ""
                ) +
                '<button class="sway-workspace-button primary" data-add-invoice>+ New invoice</button>'
            ) +

            '<div class="sway-workspace-grid">' +
                '<div class="sway-stat-card">' +
                    '<span class="label">Total billed</span>' +
                    '<div class="value">' +
                        esc(money(totalBilled)) +
                    "</div>" +
                    '<div class="hint">' +
                        activeInvoices.length +
                        " active invoices recorded." +
                    "</div>" +
                "</div>" +
                '<div class="sway-stat-card">' +
                    '<span class="label">Sent value</span>' +
                    '<div class="value">' +
                        esc(money(totalSent)) +
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
                    '<span class="label">Invoice archive</span>' +
                    '<div class="value">' +
                        archivedInvoices.length +
                    "</div>" +
                    '<div class="hint">Archived records are kept separately from active billing.</div>' +
                "</div>" +
            "</div>" +

            panel(
                showArchived
                    ? "Archived invoices"
                    : "Invoices",
                showArchived
                    ? "Historical invoices kept out of the active billing workspace."
                    : "Branded invoice records connected to clients and the finance layer.",
                visibleInvoices.length
                    ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Invoice</th><th>Total</th><th>Paid</th><th>Outstanding</th><th>Status</th><th>Due</th><th>Email</th><th></th></tr></thead><tbody>' +
                      rows +
                      "</tbody></table></div>"
                    : empty(
                        showArchived
                            ? "No archived invoices."
                            : "No active invoices yet. Create the first invoice from the button above."
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
                    label: "Account holder",
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
                    key: "swift_bic",
                    label: "SWIFT / BIC",
                    type: "text",
                    value: settings.swift_bic
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
                    '<div><span>Account holder</span><strong>' +
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
                    '<div><span>SWIFT / BIC</span><strong>' +
                        esc(s.swift_bic || "Not configured") +
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
                const invoice =
                    state.invoices.find(function (entry) {
                        return entry.id === item.invoice_id;
                    });

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
                                invoice
                                    ? invoice.invoice_number
                                    : "No invoice"
                            ) +
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
                                item.due_date &&
                                isOverdue(item.due_date) &&
                                item.status !== "paid"
                                    ? chip("overdue")
                                    : esc(
                                        date(
                                            item.due_date
                                        )
                                    )
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
                "Every payment must be attached to a specific invoice. The invoice balance decreases automatically as money is recorded.",
                state.payments.length
                    ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Client / project</th><th>Invoice</th><th>Amount received</th><th>Status</th><th>Due</th><th>Method</th><th></th></tr></thead><tbody>' +
                      rows +
                      "</tbody></table></div>"
                    : empty("No payment records yet.")
            )
        );
    }

    function renderEnquiries() {
        const activeEnquiries =
            state.enquiries.filter(function (item) {
                return item.status === "new";
            });

        const rows =
            activeEnquiries.map(function (item) {
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
                            '<span class="sway-activity-datetime">' +
                                esc(
                                    dateTime(
                                        item.created_at
                                    )
                                ) +
                            "</span>" +
                        "</td>" +
                        "<td>" +
                            '<div class="sway-row-actions">' +
                                '<button class="sway-row-action" data-enquiry-status="' +
                                    esc(item.id) +
                                    '" data-status-next="contacted">Contacted → Lead</button>' +
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
                "New enquiries are your inbox. Contacting one moves it directly into Leads.",
                activeEnquiries.length
                    ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Enquirer</th><th>Service</th><th>Status</th><th>Received</th><th></th></tr></thead><tbody>' +
                      rows +
                      "</tbody></table></div>"
                    : empty(
                        "No new enquiries. Contacted enquiries now live in Leads."
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
                            esc(
                                formatDisplayText(
                                    item.placement || "top-bar"
                                )
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
                    ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Announcement</th><th>Placement</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>' +
                      rows +
                      "</tbody></table></div>"
                    : empty("No announcements yet.")
            ) +
            '<div class="sway-inline-note">Portfolio and testimonials remain connected to the existing public-site managers below. This workspace does not change your current public pricing.</div>'
        );
    }

    function communicationContactDetails(item) {
        const record = item || {};

        const client =
            record.client_id
                ? state.clients.find(function (entry) {
                    return entry.id === record.client_id;
                })
                : null;

        const lead =
            record.lead_id
                ? state.leads.find(function (entry) {
                    return entry.id === record.lead_id;
                })
                : null;

        if (client && !lead) {
            return {
                primary:
                    client.contact_name ||
                    client.business_name ||
                    client.email ||
                    "Client",
                secondary:
                    client.contact_name &&
                    client.business_name
                        ? client.business_name
                        : client.email || "",
                ambiguous: false
            };
        }

        if (lead && !client) {
            return {
                primary:
                    lead.contact_name ||
                    lead.business_name ||
                    lead.email ||
                    "Lead",
                secondary:
                    lead.contact_name &&
                    lead.business_name
                        ? lead.business_name
                        : lead.email || "",
                ambiguous: false
            };
        }

        if (client && lead) {
            return {
                primary:
                    client.contact_name ||
                    client.business_name ||
                    "Client",
                secondary:
                    (
                        client.business_name ||
                        "Client"
                    ) +
                    " · also linked to " +
                    (
                        lead.business_name ||
                        "another lead"
                    ),
                ambiguous: true
            };
        }

        return {
            primary: "Unlinked contact",
            secondary: "This communication needs to be linked to a client or lead.",
            ambiguous: true
        };
    }

    function renderCommunications() {
        const rows =
            state.communications.map(function (item) {
                const contactDetails =
                    communicationContactDetails(item);

                return (
                    "<tr>" +
                        "<td>" +
                            "<strong>" +
                                esc(contactDetails.primary) +
                            "</strong>" +
                            (
                                contactDetails.secondary
                                    ? '<br><span style="color:var(--text-muted);font-size:.58rem;">' +
                                      esc(contactDetails.secondary) +
                                      "</span>"
                                    : ""
                            ) +
                            (
                                contactDetails.ambiguous
                                    ? '<br><span style="color:#B42318;font-size:.54rem;font-weight:800;">Needs contact review</span>'
                                    : ""
                            ) +
                            (
                                item.subject
                                    ? '<br><span style="color:var(--text-muted);font-size:.58rem;">' +
                                      esc(item.subject) +
                                      "</span>"
                                    : ""
                            ) +
                        "</td>" +
                        "<td>" +
                            esc(item.channel || "—") +
                        "</td>" +
                        "<td>" +
                            chip(item.direction || "outbound") +
                        "</td>" +
                        "<td>" +
                            esc(dateTime(item.contacted_at)) +
                        "</td>" +
                        "<td>" +
                            '<div class="sway-communication-message">' +
                                esc(item.message || "—") +
                            "</div>" +
                        "</td>" +
                        "<td>" +
                            esc(adminName(item.created_by)) +
                        "</td>" +
                        "<td>" +
                            '<div class="sway-row-actions">' +
                                '<button class="sway-row-action" data-edit="communications" data-id="' +
                                    esc(item.id) +
                                '">Edit</button>' +
                                '<button class="sway-row-action danger" data-delete="communications" data-id="' +
                                    esc(item.id) +
                                '">Delete</button>' +
                            "</div>" +
                        "</td>" +
                    "</tr>"
                );
            }).join("");

        return (
            heading(
                '<button type="button" class="sway-workspace-button" data-compose-email>+ Send email</button>' +
                '<button class="sway-workspace-button primary" data-add="communications">+ Log communication</button>'
            ) +
            panel(
                "Communication log",
                "Keep a durable record of important client and lead conversations across every channel.",
                state.communications.length
                    ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Contact</th><th>Channel</th><th>Direction</th><th>Date &amp; time</th><th>Notes</th><th>Logged by</th><th></th></tr></thead><tbody>' +
                      rows +
                      "</tbody></table></div>"
                    : empty("No communications logged yet. Use “Log communication” to start the relationship history.")
            )
        );
    }

    function renderActivity() {
        const rows =
            state.activities.map(function (item) {
                return (
                    "<tr>" +
                        "<td>" +
                            '<span class="sway-activity-datetime">' +
                                esc(
                                    dateTime(
                                        item.created_at
                                    )
                                ) +
                            "</span>" +
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
                    ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Date &amp; time</th><th>Who</th><th>Action</th><th>Area</th></tr></thead><tbody>' +
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


    function clientHealth(clientId) {
        const today = dashboardTodayISO();
        const client =
            state.clients.find(function (item) {
                return item.id === clientId;
            });

        if (!client) {
            return {
                label: "Unknown",
                tone: "neutral",
                reason: "Client record unavailable."
            };
        }

        const overdueInvoices =
            state.invoices.filter(function (invoice) {
                if (
                    invoice.client_id !== clientId ||
                    invoice.status === "cancelled" ||
                    invoice.status === "paid"
                ) {
                    return false;
                }

                const outstanding = Number(
                    invoice.amount_outstanding != null
                        ? invoice.amount_outstanding
                        : invoice.total || 0
                );

                return (
                    outstanding > 0 &&
                    (
                        invoice.status === "overdue" ||
                        (
                            dashboardDateKey(invoice.due_date) &&
                            dashboardDateKey(invoice.due_date) < today
                        )
                    )
                );
            }).length;

        if (overdueInvoices) {
            return {
                label: "Needs attention",
                tone: "danger",
                reason:
                    overdueInvoices +
                    " overdue invoice" +
                    (overdueInvoices === 1 ? "" : "s") +
                    " still require collection."
            };
        }

        const activeProjects =
            state.projects.filter(function (project) {
                return (
                    project.client_id === clientId &&
                    !["completed", "cancelled"].includes(project.status)
                );
            });

        const clientCommunications =
            state.communications
                .filter(function (item) {
                    return item.client_id === clientId;
                })
                .slice()
                .sort(function (a, b) {
                    return (
                        notificationTimeValue(b.contacted_at) -
                        notificationTimeValue(a.contacted_at)
                    );
                });

        const daysSinceCommunication =
            clientCommunications.length
                ? Math.floor(
                    (
                        Date.now() -
                        notificationTimeValue(
                            clientCommunications[0].contacted_at
                        )
                    ) /
                    (24 * 60 * 60 * 1000)
                )
                : null;

        if (
            activeProjects.length &&
            (
                daysSinceCommunication === null ||
                daysSinceCommunication >= 14
            )
        ) {
            return {
                label: "Needs attention",
                tone: "warning",
                reason:
                    "An active project has had no recorded communication for " +
                    (
                        daysSinceCommunication === null
                            ? "14+"
                            : daysSinceCommunication
                    ) +
                    " days."
            };
        }

        if (
            !activeProjects.length &&
            (
                daysSinceCommunication === null ||
                daysSinceCommunication >= 30
            )
        ) {
            return {
                label:
                    client.created_at &&
                    dashboardDateKey(client.created_at) === today
                        ? "New"
                        : "Quiet",
                tone: "neutral",
                reason:
                    daysSinceCommunication === null
                        ? "No communication has been logged yet."
                        : "No communication has been logged in the last 30 days."
            };
        }

        return {
            label: "Active",
            tone: "success",
            reason:
                activeProjects.length
                    ? "Active work and recent relationship activity are recorded."
                    : "Recent relationship activity is recorded."
        };
    }

    function clientHealthChip(clientId) {
        const health = clientHealth(clientId);

        return (
            '<span class="sway-client-health-chip ' +
                esc(health.tone) +
            '">' +
                esc(health.label) +
            "</span>"
        );
    }


    function renderLeadConversionAnalytics() {
        const stages = [
            "new",
            "contacted",
            "interested",
            "proposal sent",
            "negotiating",
            "won",
            "lost"
        ];

        const stageCounts = {};

        stages.forEach(function (stage) {
            stageCounts[stage] = new Set();
        });

        state.leadStageHistory.forEach(function (entry) {
            if (
                entry.lead_id &&
                stageCounts[entry.to_status]
            ) {
                stageCounts[entry.to_status].add(
                    entry.lead_id
                );
            }
        });

        const rows =
            stages.map(function (stage) {
                const historical =
                    stageCounts[stage].size;

                const current =
                    state.leads.filter(function (lead) {
                        return lead.status === stage;
                    }).length;

                return {
                    stage: stage,
                    historical: historical,
                    current: current
                };
            }).filter(function (item) {
                return (
                    item.historical ||
                    item.current
                );
            });

        return (
            '<section class="sway-lead-conversion-panel">' +
                '<div class="sway-lead-source-head">' +
                    '<div>' +
                        '<span class="admin-label">Pipeline movement</span>' +
                        "<h3>Lead conversion analytics</h3>" +
                        "<p>Historical stage entries are counted from the point stage tracking was enabled.</p>" +
                    "</div>" +
                "</div>" +
                '<div class="sway-table-wrap">' +
                    '<table class="sway-table">' +
                        "<thead><tr><th>Stage</th><th>Leads ever entering stage</th><th>Currently here</th></tr></thead>" +
                        "<tbody>" +
                            rows.map(function (item) {
                                return (
                                    "<tr>" +
                                        "<td><strong>" +
                                            esc(formatDisplayText(item.stage)) +
                                        "</strong></td>" +
                                        "<td>" +
                                            item.historical +
                                        "</td>" +
                                        "<td>" +
                                            item.current +
                                        "</td>" +
                                    "</tr>"
                                );
                            }).join("") +
                        "</tbody>" +
                    "</table>" +
                "</div>" +
            "</section>"
        );
    }

    function renderLeadSourceAnalytics() {
        const buckets = {};

        state.leads.forEach(function (lead) {
            const key =
                lead.source ||
                "Unspecified";

            if (!buckets[key]) {
                buckets[key] = {
                    source: key,
                    leads: 0,
                    won: 0,
                    pipeline: 0,
                    wonValue: 0
                };
            }

            buckets[key].leads += 1;
            buckets[key].pipeline += Number(
                lead.estimated_value || 0
            );

            if (lead.status === "won") {
                buckets[key].won += 1;
                buckets[key].wonValue += Number(
                    lead.estimated_value || 0
                );
            }
        });

        const rows =
            Object.keys(buckets)
                .map(function (key) {
                    const item = buckets[key];

                    return {
                        source: item.source,
                        leads: item.leads,
                        won: item.won,
                        rate:
                            item.leads
                                ? item.won /
                                  item.leads *
                                  100
                                : 0,
                        pipeline: item.pipeline,
                        wonValue: item.wonValue
                    };
                })
                .sort(function (a, b) {
                    if (b.wonValue !== a.wonValue) {
                        return b.wonValue - a.wonValue;
                    }

                    return b.leads - a.leads;
                });

        if (!rows.length) {
            return panel(
                "Lead source intelligence",
                "Track where prospects are entering the pipeline.",
                empty("No lead-source data yet.")
            );
        }

        return (
            '<section class="sway-lead-source-panel">' +
                '<div class="sway-lead-source-head">' +
                    '<div>' +
                        '<span class="admin-label">Acquisition</span>' +
                        "<h3>Lead source intelligence</h3>" +
                        "<p>Compare volume, current conversion and estimated value by recorded lead source.</p>" +
                    "</div>" +
                "</div>" +
                '<div class="sway-table-wrap">' +
                    '<table class="sway-table">' +
                        "<thead><tr>" +
                            "<th>Source</th>" +
                            "<th>Leads</th>" +
                            "<th>Won</th>" +
                            "<th>Conversion</th>" +
                            "<th>Pipeline</th>" +
                            "<th>Won value</th>" +
                        "</tr></thead>" +
                        "<tbody>" +
                            rows.map(function (item) {
                                return (
                                    "<tr>" +
                                        "<td><strong>" +
                                            esc(formatDisplayText(item.source)) +
                                        "</strong></td>" +
                                        "<td>" + item.leads + "</td>" +
                                        "<td>" + item.won + "</td>" +
                                        "<td>" + item.rate.toFixed(0) + "%</td>" +
                                        "<td>" + esc(money(item.pipeline)) + "</td>" +
                                        "<td>" + esc(money(item.wonValue)) + "</td>" +
                                    "</tr>"
                                );
                            }).join("") +
                        "</tbody>" +
                    "</table>" +
                "</div>" +
            "</section>"
        );
    }

    function renderServiceProfitability() {
        const buckets = {};

        state.projects.forEach(function (project) {
            const service =
                project.service ||
                "Unspecified";

            if (!buckets[service]) {
                buckets[service] = {
                    service: service,
                    projects: 0,
                    revenue: 0,
                    cost: 0
                };
            }

            buckets[service].projects += 1;
            buckets[service].revenue += Number(
                project.value || 0
            );
            buckets[service].cost += Math.max(
                0,
                Number(project.estimated_cost || 0)
            );
        });

        const rows =
            Object.keys(buckets)
                .map(function (key) {
                    const item = buckets[key];
                    const profit =
                        item.revenue -
                        item.cost;

                    return {
                        service: item.service,
                        projects: item.projects,
                        revenue: item.revenue,
                        cost: item.cost,
                        profit: profit,
                        margin:
                            item.revenue
                                ? profit /
                                  item.revenue *
                                  100
                                : 0
                    };
                })
                .sort(function (a, b) {
                    return b.profit - a.profit;
                });

        return (
            '<section class="sway-service-profitability">' +
                '<div class="sway-service-profitability-head">' +
                    '<div>' +
                        '<span class="admin-label">Economics</span>' +
                        "<h3>Service profitability</h3>" +
                        "<p>Estimated revenue less the internal project cost you record against each service.</p>" +
                    "</div>" +
                "</div>" +
                (
                    rows.length
                        ? '<div class="sway-table-wrap">' +
                            '<table class="sway-table">' +
                                "<thead><tr>" +
                                    "<th>Service</th>" +
                                    "<th>Projects</th>" +
                                    "<th>Revenue</th>" +
                                    "<th>Cost</th>" +
                                    "<th>Gross profit</th>" +
                                    "<th>Margin</th>" +
                                "</tr></thead>" +
                                "<tbody>" +
                                    rows.map(function (item) {
                                        return (
                                            "<tr>" +
                                                "<td><strong>" +
                                                    esc(formatDisplayText(item.service)) +
                                                "</strong></td>" +
                                                "<td>" + item.projects + "</td>" +
                                                "<td>" + esc(money(item.revenue)) + "</td>" +
                                                "<td>" + (
                                                    item.cost
                                                        ? esc(money(item.cost))
                                                        : '<span style="color:var(--text-muted);">Not recorded</span>'
                                                ) + "</td>" +
                                                "<td>" + esc(money(item.profit)) + "</td>" +
                                                "<td>" + item.margin.toFixed(0) + "%</td>" +
                                            "</tr>"
                                        );
                                    }).join("") +
                                "</tbody>" +
                            "</table>" +
                          "</div>"
                        : empty("No project service data yet.")
                ) +
                '<div class="sway-inline-note" style="margin-top:12px;">' +
                    "<strong>Important:</strong> profitability depends on the estimated internal costs recorded on projects. Revenue without cost records is not a true margin calculation." +
                "</div>" +
            "</section>"
        );
    }

    function projectTimelineStage(status) {
        const stages = [
            "planning",
            "in progress",
            "review",
            "completed"
        ];

        const index = stages.indexOf(status);

        return {
            stages: stages,
            currentIndex:
                index >= 0
                    ? index
                    : status === "paused"
                        ? Math.max(0, stages.indexOf("in progress"))
                        : -1
        };
    }

    function openProjectTimeline(projectId) {
        const project =
            state.projects.find(function (item) {
                return item.id === projectId;
            });

        if (!project) return;

        const timeline =
            projectTimelineStage(project.status);

        document.getElementById(
            "sway-project-timeline-modal"
        )?.remove();

        const modal =
            document.createElement("div");

        modal.className =
            "sway-project-timeline-modal";

        modal.id =
            "sway-project-timeline-modal";

        modal.innerHTML =
            '<div class="sway-project-timeline-backdrop" data-close-project-timeline></div>' +
            '<section class="sway-project-timeline-card" role="dialog" aria-modal="true" aria-labelledby="sway-project-timeline-title">' +
                '<div class="sway-project-timeline-head">' +
                    '<div>' +
                        '<span class="admin-label">Project timeline</span>' +
                        '<h3 id="sway-project-timeline-title">' +
                            esc(project.name) +
                        "</h3>" +
                        '<p>' +
                            esc(clientName(project.client_id)) +
                            (
                                project.service
                                    ? " · " + esc(project.service)
                                    : ""
                            ) +
                        "</p>" +
                    "</div>" +
                    '<button type="button" class="sway-client360-close" data-close-project-timeline aria-label="Close">×</button>' +
                "</div>" +
                (
                    ["paused", "cancelled"].includes(project.status)
                        ? '<div class="sway-project-timeline-special">' +
                            chip(project.status) +
                            "<span>This project is outside the active delivery path. Edit the project to resume or close it.</span>" +
                          "</div>"
                        : '<div class="sway-project-timeline-track">' +
                            timeline.stages.map(function (stage, index) {
                                const complete =
                                    timeline.currentIndex >= index;

                                return (
                                    '<div class="sway-project-timeline-step ' +
                                        (complete ? "complete" : "") +
                                        (
                                            timeline.currentIndex === index &&
                                            stage !== "completed"
                                                ? " current"
                                                : ""
                                        ) +
                                    '">' +
                                        '<span class="sway-project-timeline-node">' +
                                            (complete ? "✓" : String(index + 1)) +
                                        "</span>" +
                                        '<strong>' +
                                            esc(formatDisplayText(stage)) +
                                        "</strong>" +
                                        (
                                            timeline.currentIndex === index
                                                ? "<small>Current stage</small>"
                                                : ""
                                        ) +
                                    "</div>"
                                );
                            }).join("") +
                          "</div>"
                ) +
                '<div class="sway-project-timeline-meta">' +
                    '<div><span>Due</span><strong>' +
                        esc(
                            project.due_date
                                ? date(project.due_date)
                                : "No deadline"
                        ) +
                    "</strong></div>" +
                    '<div><span>Project value</span><strong>' +
                        esc(money(project.value)) +
                    "</strong></div>" +
                    '<div><span>Estimated cost</span><strong>' +
                        esc(
                            Number(project.estimated_cost || 0)
                                ? money(project.estimated_cost)
                                : "Not recorded"
                        ) +
                    "</strong></div>" +
                    '<div><span>Payment</span>' +
                        chip(project.payment_status) +
                    "</div>" +
                "</div>" +
                '<div class="sway-project-timeline-footer">' +
                    '<button type="button" class="sway-workspace-button" data-edit="projects" data-id="' +
                        esc(project.id) +
                    '">Edit project</button>' +
                    '<button type="button" class="sway-workspace-button primary" data-close-project-timeline>Close</button>' +
                "</div>" +
            "</section>";

        document.body.appendChild(modal);

        modal
            .querySelectorAll("[data-close-project-timeline]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        modal.remove();
                    }
                );
            });

        modal
            .querySelector("[data-edit='projects']")
            ?.addEventListener(
                "click",
                function () {
                    modal.remove();
                    createOrEdit(
                        "projects",
                        project.id
                    );
                }
            );
    }

    async function createInvoiceFromQuote(quoteId) {
        const quote =
            state.quotes.find(function (item) {
                return item.id === quoteId;
            });

        if (!quote) return;

        if (quote.status !== "accepted") {
            swayAlert(
                "Only accepted quotes can be converted into invoices."
            );
            return;
        }

        if (quote.invoice_id) {
            swayAlert(
                "This quote is already linked to an invoice."
            );
            return;
        }

        if (!quote.client_id) {
            swayAlert(
                "Convert the lead to a client before creating the invoice."
            );
            return;
        }

        try {
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
                            JSON.stringify({
                                client_id: quote.client_id,
                                issue_date: dashboardTodayISO(),
                                status: "draft",
                                currency: "ZAR",
                                subtotal: Number(quote.amount || 0),
                                total: Number(quote.amount || 0),
                                notes:
                                    "Created from " +
                                    (
                                        quote.quote_number ||
                                        "accepted quote"
                                    ) +
                                    "."
                            })
                    }
                );

            const invoiceId =
                Array.isArray(created)
                    ? created[0]?.id
                    : created?.id;

            if (!invoiceId) {
                throw new Error(
                    "The invoice was not created."
                );
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
                        JSON.stringify({
                            invoice_id: invoiceId,
                            description:
                                quote.title ||
                                "Quoted services",
                            quantity: 1,
                            unit_price:
                                Number(quote.amount || 0)
                        })
                }
            );

            await api(
                "/rest/v1/quotes?id=eq." +
                encodeURIComponent(quote.id),
                {
                    method: "PATCH",
                    headers: headers({
                        "Prefer":
                            "return=minimal"
                    }),
                    body:
                        JSON.stringify({
                            invoice_id: invoiceId,
                            updated_at: new Date().toISOString()
                        })
                }
            );

            await logActivity(
                "Created invoice from accepted quote",
                "invoices",
                invoiceId
            );

            await refreshData();
            renderShell();
            renderView();

            await openInvoiceBuilder(invoiceId);
        } catch (error) {
            swayAlert(
                error.message ||
                "Unable to create the invoice from this quote."
            );
        }
    }


    async function revokeClientPortalLinks(clientId) {
        try {
            await api(
                "/rest/v1/client_portal_tokens?client_id=eq." +
                encodeURIComponent(clientId) +
                "&active=eq.true",
                {
                    method: "PATCH",
                    headers: headers({
                        "Prefer": "return=minimal"
                    }),
                    body: JSON.stringify({
                        active: false
                    })
                }
            );

            await logActivity(
                "Revoked client portal links",
                "clients",
                clientId
            );

            await refreshData();

            swayAlert(
                "All active portal links for this client have been revoked."
            );
        } catch (error) {
            swayAlert(
                error.message ||
                "Unable to revoke the client portal links."
            );
        }
    }

    function randomPortalToken() {
        const bytes =
            new Uint8Array(32);

        window.crypto.getRandomValues(bytes);

        return Array.from(bytes)
            .map(function (byte) {
                return byte
                    .toString(16)
                    .padStart(2, "0");
            })
            .join("");
    }

    async function sha256Hex(value) {
        if (
            !window.crypto ||
            !window.crypto.subtle
        ) {
            throw new Error(
                "Your browser does not support the secure portal link generator."
            );
        }

        const encoded =
            new TextEncoder().encode(
                String(value)
            );

        const digest =
            await window.crypto.subtle.digest(
                "SHA-256",
                encoded
            );

        return Array.from(
            new Uint8Array(digest)
        ).map(function (byte) {
            return byte.toString(16).padStart(2, "0");
        }).join("");
    }

    async function createClientPortalLink(clientId) {
        const client =
            state.clients.find(function (item) {
                return item.id === clientId;
            });

        if (!client) return;

        try {
            const rawToken =
                randomPortalToken();

            const hash =
                await sha256Hex(rawToken);

            const expires =
                new Date(
                    Date.now() +
                    90 * 24 * 60 * 60 * 1000
                ).toISOString();

            await api(
                "/rest/v1/client_portal_tokens",
                {
                    method: "POST",
                    headers: headers({
                        "Prefer":
                            "return=minimal"
                    }),
                    body:
                        JSON.stringify({
                            client_id: clientId,
                            token_hash: hash,
                            active: true,
                            expires_at: expires,
                            created_by:
                                state.currentUser.id
                        })
                }
            );

            const base =
                window.location.origin +
                window.location.pathname
                    .split("/admin-dashboard/")[0]
                    .replace(/\/$/, "");

            const link =
                base +
                "/client-portal/?token=" +
                encodeURIComponent(rawToken);

            openClientPortalLinkModal(
                client,
                link,
                expires
            );

            await logActivity(
                "Created client portal link",
                "clients",
                clientId
            );

            await refreshData();
        } catch (error) {
            swayAlert(
                error.message ||
                "Unable to create a secure client portal link."
            );
        }
    }

    function openClientPortalLinkModal(client, link, expires) {
        document.getElementById(
            "sway-client-portal-link-modal"
        )?.remove();

        const modal =
            document.createElement("div");

        modal.className =
            "sway-client-portal-link-modal";

        modal.id =
            "sway-client-portal-link-modal";

        modal.innerHTML =
            '<div class="sway-client-portal-link-backdrop" data-close-client-portal-link></div>' +
            '<section class="sway-client-portal-link-card" role="dialog" aria-modal="true" aria-labelledby="sway-client-portal-link-title">' +
                '<div class="sway-project-timeline-head">' +
                    '<div>' +
                        '<span class="admin-label">Client portal</span>' +
                        '<h3 id="sway-client-portal-link-title">Secure access link</h3>' +
                        '<p>' +
                            esc(client.business_name) +
                            " · expires " +
                            esc(dateTime(expires)) +
                        "</p>" +
                    "</div>" +
                    '<button type="button" class="sway-client360-close" data-close-client-portal-link aria-label="Close">×</button>' +
                "</div>" +
                '<div class="sway-form-field">' +
                    '<label for="sway-client-portal-link-input">Portal link</label>' +
                    '<input id="sway-client-portal-link-input" type="text" readonly value="' +
                        esc(link) +
                    '">' +
                "</div>" +
                '<div class="sway-client-portal-link-note">' +
                    "<strong>Keep this link private.</strong> Anyone who has it can access this client's portal until it expires or is revoked." +
                "</div>" +
                '<div class="sway-project-timeline-footer">' +
                    '<button type="button" class="sway-workspace-button" data-close-client-portal-link>Close</button>' +
                    '<button type="button" class="sway-workspace-button" id="sway-revoke-client-portal-link">Revoke all links</button>' +
                    '<button type="button" class="sway-workspace-button primary" id="sway-copy-client-portal-link">Copy link</button>' +
                "</div>" +
            "</section>";

        document.body.appendChild(modal);

        modal
            .querySelectorAll("[data-close-client-portal-link]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        modal.remove();
                    }
                );
            });

        modal
            .querySelector("#sway-revoke-client-portal-link")
            ?.addEventListener(
                "click",
                async function () {
                    if (
                        !(await swayConfirm(
                            "Revoke all active portal links for this client?"
                        ))
                    ) {
                        return;
                    }

                    await revokeClientPortalLinks(client.id);
                    modal.remove();
                }
            );

        modal
            .querySelector("#sway-copy-client-portal-link")
            ?.addEventListener(
                "click",
                async function () {
                    try {
                        await navigator.clipboard.writeText(
                            link
                        );
                        swayAlert("Portal link copied.");
                    } catch (error) {
                        const input =
                            modal.querySelector(
                                "#sway-client-portal-link-input"
                            );

                        input.select();
                        document.execCommand("copy");
                        swayAlert("Portal link copied.");
                    }
                }
            );
    }

    function csvCell(value) {
        return '"' +
            String(value == null ? "" : value)
                .replace(/"/g, '""') +
            '"';
    }

    function downloadTextFile(filename, content, type) {
        const blob =
            new Blob(
                [content],
                {
                    type:
                        type ||
                        "text/plain;charset=utf-8"
                }
            );

        const url =
            URL.createObjectURL(blob);

        const anchor =
            document.createElement("a");

        anchor.href = url;
        anchor.download = filename;

        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();

        window.setTimeout(function () {
            URL.revokeObjectURL(url);
        }, 1000);
    }

    function exportWorkspaceJson() {
        const payload = {
            exported_at: new Date().toISOString(),
            note: "Operational Swayphics workspace backup. Private invoice bank settings are intentionally excluded.",
            admins: state.admins,
            clients: state.clients,
            leads: state.leads,
            lead_stage_history: state.leadStageHistory,
            projects: state.projects,
            tasks: state.tasks,
            followups: state.followups,
            communications: state.communications,
            quotes: state.quotes,
            payments: state.payments,
            invoices: state.invoices,
            services: state.services,
            enquiries: state.enquiries,
            announcements: state.announcements,
            portal_requests: state.portalRequests,
            documents: state.documents,
            activities: state.activities
        };

        downloadTextFile(
            "swayphics-workspace-backup-" +
            dashboardTodayISO() +
            ".json",
            JSON.stringify(payload, null, 2),
            "application/json;charset=utf-8"
        );
    }

    function exportWorkspaceCsv() {
        const datasets = {
            clients: state.clients,
            leads: state.leads,
            projects: state.projects,
            tasks: state.tasks,
            followups: state.followups,
            communications: state.communications,
            quotes: state.quotes,
            invoices: state.invoices,
            payments: state.payments,
            services: state.services,
            enquiries: state.enquiries,
            portal_requests: state.portalRequests,
            activities: state.activities
        };

        Object.keys(datasets).forEach(function (name, index) {
            const rows = Array.isArray(datasets[name])
                ? datasets[name]
                : [];

            if (!rows.length) {
                return;
            }

            const columns =
                Array.from(
                    rows.reduce(function (set, row) {
                        Object.keys(row || {}).forEach(function (key) {
                            set.add(key);
                        });

                        return set;
                    }, new Set())
                );

            const csv =
                [
                    columns.map(csvCell).join(","),
                    ...rows.map(function (row) {
                        return columns
                            .map(function (column) {
                                return csvCell(row[column]);
                            })
                            .join(",");
                    })
                ].join("\r\n");

            window.setTimeout(function () {
                downloadTextFile(
                    "swayphics-" +
                    name +
                    "-" +
                    dashboardTodayISO() +
                    ".csv",
                    csv,
                    "text/csv;charset=utf-8"
                );
            }, index * 180);
        });
    }


    const CLIENT_DOCUMENT_BUCKET =
        "swayphics-client-files";

    function storageObjectUrl(path) {
        return (
            SUPABASE_URL +
            "/storage/v1/object/" +
            CLIENT_DOCUMENT_BUCKET +
            "/" +
            String(path || "")
                .split("/")
                .map(encodeURIComponent)
                .join("/")
        );
    }

    async function uploadClientDocument(clientId, file, projectId) {
        if (!clientId || !file) {
            throw new Error(
                "Select a client and a file."
            );
        }

        const maxBytes =
            20 * 1024 * 1024;

        if (file.size > maxBytes) {
            throw new Error(
                "Files must be 20 MB or smaller."
            );
        }

        const originalName =
            String(file.name || "document")
                .replace(/[^a-zA-Z0-9._-]+/g, "-")
                .replace(/^-+|-+$/g, "")
                .slice(0, 160) ||
            "document";

        const uniqueName =
            Date.now() +
            "-" +
            randomPortalToken().slice(0, 16) +
            "-" +
            originalName;

        const storagePath =
            String(clientId) +
            "/" +
            uniqueName;

        const uploadResponse =
            await fetch(
                storageObjectUrl(storagePath),
                {
                    method: "POST",
                    headers: headers({
                        "Content-Type":
                            file.type ||
                            "application/octet-stream",
                        "x-upsert": "false"
                    }),
                    body: file
                }
            );

        if (!uploadResponse.ok) {
            const message =
                await uploadResponse.text();

            throw new Error(
                "File upload failed: " +
                (
                    message ||
                    "Storage rejected the file."
                )
            );
        }

        try {
            await api(
                "/rest/v1/client_documents",
                {
                    method: "POST",
                    headers: headers({
                        "Prefer":
                            "return=minimal"
                    }),
                    body:
                        JSON.stringify({
                            client_id: clientId,
                            project_id:
                                projectId || null,
                            file_name:
                                file.name,
                            storage_path:
                                storagePath,
                            mime_type:
                                file.type || null,
                            size_bytes:
                                Number(file.size || 0),
                            uploaded_by:
                                state.currentUser.id
                        })
                }
            );
        } catch (error) {
            await fetch(
                storageObjectUrl(storagePath),
                {
                    method: "DELETE",
                    headers: headers()
                }
            ).catch(function () {
                // Best-effort rollback.
            });

            throw error;
        }

        await logActivity(
            "Uploaded client document",
            "client_documents",
            null
        );
    }

    async function downloadClientDocument(documentId) {
        const documentRecord =
            state.documents.find(function (item) {
                return item.id === documentId;
            });

        if (!documentRecord) return;

        try {
            const response =
                await fetch(
                    storageObjectUrl(
                        documentRecord.storage_path
                    ),
                    {
                        method: "GET",
                        headers: headers()
                    }
                );

            if (!response.ok) {
                throw new Error(
                    "The file could not be downloaded."
                );
            }

            const blob =
                await response.blob();

            const url =
                URL.createObjectURL(blob);

            const anchor =
                document.createElement("a");

            anchor.href = url;
            anchor.download =
                documentRecord.file_name ||
                "document";

            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();

            window.setTimeout(function () {
                URL.revokeObjectURL(url);
            }, 1000);
        } catch (error) {
            swayAlert(
                error.message ||
                "Unable to download the document."
            );
        }
    }

    async function deleteClientDocument(documentId) {
        const documentRecord =
            state.documents.find(function (item) {
                return item.id === documentId;
            });

        if (!documentRecord) return;

        if (
            !(await swayConfirm(
                "Delete this document? The stored file will also be removed."
            ))
        ) {
            return;
        }

        try {
            const storageResponse =
                await fetch(
                    storageObjectUrl(
                        documentRecord.storage_path
                    ),
                    {
                        method: "DELETE",
                        headers: headers()
                    }
                );

            if (!storageResponse.ok) {
                throw new Error(
                    "The stored file could not be removed."
                );
            }

            await api(
                "/rest/v1/client_documents?id=eq." +
                encodeURIComponent(documentId),
                {
                    method: "DELETE",
                    headers: headers({
                        "Prefer":
                            "return=minimal"
                    })
                }
            );

            await logActivity(
                "Deleted client document",
                "client_documents",
                documentId
            );

            await refreshData();
            renderShell();
            renderView();
        } catch (error) {
            swayAlert(
                error.message ||
                "Unable to delete the document."
            );
        }
    }

    async function openDocumentUploadModal(prefillClientId, prefillProjectId) {
        const modal =
            document.createElement("div");

        modal.className =
            "sway-modal";

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
                            client.id === prefillClientId
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
                        project.id === prefillProjectId
                            ? " selected"
                            : ""
                    ) +
                    ">" +
                    esc(project.name) +
                    " — " +
                    esc(clientName(project.client_id)) +
                    "</option>"
                );
            }).join("");

        modal.innerHTML =
            '<div class="sway-modal-backdrop"></div>' +
            '<div class="sway-modal-card" role="dialog" aria-modal="true">' +
                '<div class="sway-modal-header">' +
                    '<div><span class="admin-label">Documents</span><h3>Upload document</h3></div>' +
                    '<button type="button" class="sway-modal-close" data-document-close aria-label="Close">×</button>' +
                "</div>" +
                '<div class="sway-form-grid">' +
                    '<div class="sway-form-field">' +
                        '<label for="sway-document-client">Client</label>' +
                        '<select id="sway-document-client" required>' +
                            clientOptions +
                        "</select>" +
                    "</div>" +
                    '<div class="sway-form-field">' +
                        '<label for="sway-document-project">Project</label>' +
                        '<select id="sway-document-project">' +
                            projectOptions +
                        "</select>" +
                    "</div>" +
                    '<div class="sway-form-field full">' +
                        '<label for="sway-document-file">File</label>' +
                        '<input type="file" id="sway-document-file" required>' +
                        '<small>Private storage · maximum 20 MB.</small>' +
                    "</div>" +
                    '<div class="sway-form-field full">' +
                        '<div class="sway-modal-actions">' +
                            '<button type="button" class="sway-workspace-button" data-document-close>Cancel</button>' +
                            '<button type="button" class="sway-workspace-button primary" id="sway-document-upload">Upload</button>' +
                        "</div>" +
                    "</div>" +
                "</div>" +
            "</div>";

        document.body.appendChild(modal);

        function close() {
            modal.remove();
        }

        modal
            .querySelectorAll("[data-document-close]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    close
                );
            });

        modal
            .querySelector("#sway-document-upload")
            .addEventListener(
                "click",
                async function () {
                    const button =
                        modal.querySelector(
                            "#sway-document-upload"
                        );

                    const clientSelect =
                        modal.querySelector(
                            "#sway-document-client"
                        );

                    const projectSelect =
                        modal.querySelector(
                            "#sway-document-project"
                        );

                    const fileInput =
                        modal.querySelector(
                            "#sway-document-file"
                        );

                    const file =
                        fileInput.files &&
                        fileInput.files[0];

                    if (!clientSelect.value || !file) {
                        swayAlert(
                            "Select a client and a file before uploading."
                        );
                        return;
                    }

                    button.disabled = true;
                    button.textContent =
                        "Uploading...";

                    try {
                        await uploadClientDocument(
                            clientSelect.value,
                            file,
                            projectSelect.value || null
                        );

                        await refreshData();
                        close();
                        renderShell();
                        renderView();

                        swayAlert(
                            "Document uploaded."
                        );
                    } catch (error) {
                        swayAlert(
                            error.message ||
                            "Unable to upload the document."
                        );
                    } finally {
                        button.disabled = false;
                        button.textContent =
                            "Upload";
                    }
                }
            );
    }

    function renderDocuments() {
        const rows =
            state.documents.map(function (item) {
                return (
                    "<tr>" +
                        "<td><strong>" +
                            esc(item.file_name) +
                        "</strong></td>" +
                        "<td>" +
                            esc(clientName(item.client_id)) +
                        "</td>" +
                        "<td>" +
                            (
                                item.project_id
                                    ? esc(projectName(item.project_id))
                                    : "—"
                            ) +
                        "</td>" +
                        "<td>" +
                            esc(
                                item.mime_type ||
                                "File"
                            ) +
                        "</td>" +
                        "<td>" +
                            esc(
                                Math.max(
                                    1,
                                    Math.round(
                                        Number(item.size_bytes || 0) /
                                        1024
                                    )
                                ) +
                                " KB"
                            ) +
                        "</td>" +
                        "<td>" +
                            esc(dateTime(item.created_at)) +
                        "</td>" +
                        "<td>" +
                            '<div class="sway-row-actions">' +
                                '<button type="button" class="sway-row-action" data-download-document="' +
                                    esc(item.id) +
                                '">Download</button>' +
                                '<button type="button" class="sway-row-action danger" data-delete-document="' +
                                    esc(item.id) +
                                '">Delete</button>' +
                            "</div>" +
                        "</td>" +
                    "</tr>"
                );
            }).join("");

        return (
            heading(
                '<button type="button" class="sway-workspace-button primary" data-upload-document>+ Upload document</button>'
            ) +
            panel(
                "Private documents",
                "Client and project files stored in private Supabase Storage. Files are only accessible to authenticated Swayphics admins.",
                rows
                    ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>File</th><th>Client</th><th>Project</th><th>Type</th><th>Size</th><th>Uploaded</th><th></th></tr></thead><tbody>' +
                      rows +
                      "</tbody></table></div>"
                    : empty("No documents uploaded yet. Use Client 360 or Upload document to add files.")
            )
        );
    }

    function renderPortalRequests() {
        const rows =
            state.portalRequests.map(function (item) {
                return (
                    "<tr>" +
                        "<td><strong>" +
                            esc(clientName(item.client_id)) +
                        "</strong></td>" +
                        "<td>" +
                            esc(item.subject) +
                        "</td>" +
                        "<td>" +
                            '<div class="sway-portal-request-message">' +
                                esc(item.message) +
                            "</div>" +
                        "</td>" +
                        "<td>" +
                            esc(dateTime(item.created_at)) +
                        "</td>" +
                        "<td>" +
                            chip(item.status) +
                        "</td>" +
                        "<td>" +
                            '<div class="sway-row-actions">' +
                                (
                                    item.status !== "in progress"
                                        ? '<button class="sway-row-action" data-portal-request-status="in progress" data-id="' +
                                          esc(item.id) +
                                          '">Start</button>'
                                        : ""
                                ) +
                                (
                                    item.status !== "completed"
                                        ? '<button class="sway-row-action" data-portal-request-status="completed" data-id="' +
                                          esc(item.id) +
                                          '">Complete</button>'
                                        : ""
                                ) +
                            "</div>" +
                        "</td>" +
                    "</tr>"
                );
            }).join("");

        return (
            heading(
                '<button type="button" class="sway-workspace-button" data-refresh-workspace>Refresh data</button>'
            ) +
            panel(
                "Client portal requests",
                "Requests submitted by clients from their secure portal.",
                rows
                    ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Client</th><th>Subject</th><th>Request</th><th>Received</th><th>Status</th><th></th></tr></thead><tbody>' +
                      rows +
                      "</tbody></table></div>"
                    : empty("No portal requests yet.")
            )
        );
    }

    function renderDataExport() {
        return (
            heading(
                '<button type="button" class="sway-workspace-button primary" data-export-json>Export JSON backup</button>' +
                '<button type="button" class="sway-workspace-button" data-export-csv>Export CSV files</button>'
            ) +
            panel(
                "Workspace backup",
                "Download a local copy of Swayphics operational records.",
                '<div class="sway-export-grid">' +
                    '<div class="sway-export-card">' +
                        '<strong>JSON workspace backup</strong>' +
                        '<p>One structured file containing clients, leads, projects, tasks, communications, billing records, enquiries, portal requests and activity.</p>' +
                        '<button type="button" class="sway-workspace-button primary" data-export-json>Download JSON</button>' +
                    "</div>" +
                    '<div class="sway-export-card">' +
                        '<strong>CSV data export</strong>' +
                        '<p>Downloads separate CSV files for the main operational datasets so they can be opened in Excel or Google Sheets.</p>' +
                        '<button type="button" class="sway-workspace-button" data-export-csv>Download CSV files</button>' +
                    "</div>" +
                "</div>" +
                '<div class="sway-inline-note" style="margin-top:16px;">' +
                    "<strong>Backup note:</strong> these exports are generated in your browser. Private invoice bank settings are intentionally excluded from the export. Automated off-site backups still require a server-side storage destination." +
                "</div>"
            )
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
                                        formatDisplayText(value) +
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
                                        formatDisplayText(value) +
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
                        type: "section",
                        label: "Lead assessment & opportunity",
                        help: "Use public business information only. Record observable facts, findings, the opportunity for Swayphics, and the services that directly address the problem."
                    },
                    {
                        key: "business_assessment",
                        label: "Business assessment",
                        type: "textarea",
                        full: true,
                        value: item.business_assessment,
                        help: "Your overall assessment of the business from publicly available information."
                    },
                    {
                        key: "research_findings",
                        label: "Research findings",
                        type: "textarea",
                        full: true,
                        value: item.research_findings,
                        help: "Capture specific gaps, missed opportunities, customer-facing issues or strengths you observed."
                    },
                    {
                        key: "swayphics_solution",
                        label: "How Swayphics can help",
                        type: "textarea",
                        full: true,
                        value: item.swayphics_solution,
                        help: "Turn the findings into a concrete Swayphics solution and the business outcome it should create."
                    },
                    {
                        key: "recommended_services",
                        label: "Recommended Swayphics services",
                        type: "textarea",
                        full: true,
                        value: item.recommended_services,
                        help: "List the Swayphics services that directly solve the identified problems."
                    },
                    {
                        key: "research_sources",
                        label: "Public information / sources",
                        type: "textarea",
                        full: true,
                        value: item.research_sources,
                        help: "Record public URLs or source names used, such as the business website, social profiles or public listings."
                    },
                    {
                        key: "notes",
                        label: "General internal notes",
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
                        key: "estimated_cost",
                        label: "Estimated internal cost (ZAR)",
                        type: "number",
                        value: item.estimated_cost || 0,
                        help: "Use your estimated internal delivery cost for profitability reporting."
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
                        label: "Amount received (ZAR)",
                        type: "number",
                        required: true,
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
                        key: "invoice_id",
                        label: "Invoice number",
                        type: "select",
                        required: true,
                        disabled: Boolean(item.id),
                        help: item.id
                            ? "Invoice linkage is locked after a payment is created."
                            : "The selected invoice determines the client and project automatically.",
                        options:
                            '<option value="">Select invoice...</option>' +
                            state.invoices
                                .filter(function (invoice) {
                                    const outstanding =
                                        Number(
                                            invoice.amount_outstanding != null
                                                ? invoice.amount_outstanding
                                                : invoice.total || 0
                                        );

                                    return (
                                        invoice.status !== "cancelled" &&
                                        (
                                            Boolean(item.id) &&
                                            invoice.id === item.invoice_id
                                            ||
                                            outstanding > 0
                                        )
                                    );
                                })
                                .map(function (invoice) {
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
                                        " — Outstanding " +
                                        esc(
                                            money(
                                                invoice.amount_outstanding != null
                                                    ? invoice.amount_outstanding
                                                    : invoice.total || 0
                                            )
                                        ) +
                                        "</option>"
                                    );
                                }).join("")
                    },
                    {
                        key: "amount",
                        label: "Amount received (ZAR)",
                        type: "number",
                        required: true,
                        value: item.amount
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
                        key: "paid_at",
                        label: "Payment date",
                        type: "date",
                        value: dateInput(item.paid_at) || dashboardTodayISO()
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


        socialAccounts: {
            table: "social_accounts",
            title: "Social account",
            fields: function (item) {
                return [
                    {
                        key: "platform",
                        label: "Platform",
                        type: "select",
                        required: true,
                        options:
                            ["Instagram", "Facebook", "TikTok"]
                                .map(function (value) {
                                    return (
                                        '<option value="' +
                                        value +
                                        '"' +
                                        (
                                            value === item.platform
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
                        key: "account_name",
                        label: "Account name",
                        type: "text",
                        required: true,
                        value: item.account_name
                    },
                    {
                        key: "handle",
                        label: "Handle / username",
                        type: "text",
                        value: item.handle
                    },
                    {
                        key: "external_account_id",
                        label: "Platform account ID",
                        type: "text",
                        value: item.external_account_id,
                        help: "Used by the official API integration. Do not enter a password or access token here."
                    },
                    {
                        key: "profile_url",
                        label: "Profile URL",
                        type: "url",
                        value: item.profile_url
                    },
                    {
                        key: "status",
                        label: "Connection status",
                        type: "select",
                        options:
                            ["disconnected", "pending", "connected"]
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
                                        formatDisplayText(value) +
                                        "</option>"
                                    );
                                }).join("")
                    }
                ];
            }
        },

        socialPosts: {
            table: "social_posts",
            title: "Social post",
            fields: function (item) {
                return [
                    {
                        key: "title",
                        label: "Internal title",
                        type: "text",
                        value: item.title
                    },
                    {
                        key: "caption",
                        label: "Caption",
                        type: "textarea",
                        required: true,
                        full: true,
                        value: item.caption
                    },
                    {
                        key: "platform",
                        label: "Platform",
                        type: "select",
                        required: true,
                        options:
                            [
                                "Instagram",
                                "Facebook",
                                "TikTok",
                                "Multi-platform"
                            ]
                            .map(function (value) {
                                return (
                                    '<option value="' +
                                    value +
                                    '"' +
                                    (
                                        value === item.platform
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
                                "draft",
                                "scheduled",
                                "published",
                                "failed"
                            ]
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
                                    formatDisplayText(value) +
                                    "</option>"
                                );
                            }).join("")
                    },
                    {
                        key: "media_url",
                        label: "Media URL",
                        type: "url",
                        value: item.media_url,
                        help: "The later publishing integration will handle authenticated media transfer."
                    },
                    {
                        key: "scheduled_for",
                        label: "Scheduled date and time",
                        type: "datetime-local",
                        value: socialDateTimeInput(item.scheduled_for)
                    },
                    {
                        key: "external_post_url",
                        label: "Published post URL",
                        type: "url",
                        value: item.external_post_url
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
                        key: "placement",
                        label: "Public-site placement",
                        type: "select",
                        options:
                            '<option value="top-bar"' +
                            (
                                (item.placement || "top-bar") === "top-bar"
                                    ? " selected"
                                    : ""
                            ) +
                            ">Top notice</option>" +
                            '<option value="hero"' +
                            (
                                item.placement === "hero"
                                    ? " selected"
                                    : ""
                            ) +
                            ">Hero notice</option>" +
                            '<option value="bottom"' +
                            (
                                item.placement === "bottom"
                                    ? " selected"
                                    : ""
                            ) +
                            ">Bottom notice</option>"
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
        },

        communications: {
            table: "communication_logs",
            title: "Communication",
            fields: function (item) {
            const selectedContact =
                item.client_id
                    ? "client:" + item.client_id
                    : item.lead_id
                        ? "lead:" + item.lead_id
                        : "";

            const contactOptions =
                '<option value="">Select contact...</option>' +
                state.clients
                    .map(function (client) {
                        const person =
                            client.contact_name ||
                            client.business_name ||
                            client.email ||
                            "Client";

                        const label =
                            client.contact_name &&
                            client.business_name
                                ? person +
                                  " · " +
                                  client.business_name
                                : person;

                        return (
                            '<option value="client:' +
                            esc(client.id) +
                            '"' +
                            (
                                selectedContact ===
                                "client:" +
                                client.id
                                    ? " selected"
                                    : ""
                            ) +
                            ">" +
                            esc(label) +
                            "</option>"
                        );
                    }).join("") +
                state.leads
                    .map(function (lead) {
                        const person =
                            lead.contact_name ||
                            lead.business_name ||
                            lead.email ||
                            "Lead";

                        const label =
                            lead.contact_name &&
                            lead.business_name
                                ? person +
                                  " · " +
                                  lead.business_name
                                : person;

                        return (
                            '<option value="lead:' +
                            esc(lead.id) +
                            '"' +
                            (
                                selectedContact ===
                                "lead:" +
                                lead.id
                                    ? " selected"
                                    : ""
                            ) +
                            ">" +
                            esc(label) +
                            "</option>"
                        );
                    }).join("");

            return [
                {
                    key: "communication_contact",
                    label: "Contact",
                    type: "select",
                    options: contactOptions
                },
                    {
                        key: "channel",
                        label: "Channel",
                        type: "select",
                        required: true,
                        options:
                            [
                                "Email",
                                "WhatsApp",
                                "Phone",
                                "Meeting",
                                "SMS",
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
                        key: "direction",
                        label: "Direction",
                        type: "select",
                        required: true,
                        options:
                            [
                                ["outbound", "Outbound"],
                                ["inbound", "Inbound"]
                            ].map(function (option) {
                                return (
                                    '<option value="' +
                                    option[0] +
                                    '"' +
                                    (
                                        option[0] === item.direction
                                            ? " selected"
                                            : ""
                                    ) +
                                    ">" +
                                    option[1] +
                                    "</option>"
                                );
                            }).join("")
                    },
                    {
                        key: "subject",
                        label: "Subject / topic",
                        type: "text",
                        value: item.subject
                    },
                    {
                        key: "contacted_at",
                        label: "Date & time",
                        type: "datetime-local",
                        required: true,
                        value:
                            dateTimeInput(item.contacted_at) ||
                            dateTimeInput(new Date())
                    },
                    {
                        key: "message",
                        label: "Communication notes",
                        type: "textarea",
                        required: true,
                        full: true,
                        value: item.message
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

                const disabledAttribute =
                    field.disabled
                        ? " disabled"
                        : "";

                const requiredAttribute =
                    field.required && !field.disabled
                        ? " required"
                        : "";

                if (field.type === "section") {
                    return (
                        '<div class="sway-form-section-heading">' +
                            '<strong>' +
                                esc(field.label) +
                            "</strong>" +
                            (
                                field.help
                                    ? "<small>" +
                                      esc(field.help) +
                                      "</small>"
                                    : ""
                            ) +
                        "</div>"
                    );
                } else if (field.type === "textarea") {
                    control =
                        '<textarea id="sway-field-' +
                        esc(field.key) +
                        '" rows="4"' +
                        disabledAttribute +
                        ">" +
                        esc(value) +
                        "</textarea>";
                } else if (field.type === "select") {
                    control =
                        '<select id="sway-field-' +
                        esc(field.key) +
                        '"' +
                        disabledAttribute +
                        ">" +
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
                        requiredAttribute +
                        disabledAttribute +
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
                    if (field.type === "section") {
                        return;
                    }

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

    async function createOrEdit(type, id, prefill) {
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
                : Object.assign(
                    {},
                    prefill || {}
                );

        const fields =
            config.fields(item);

        showModal(
            (id ? "Edit " : "New ") +
            config.title,
            fields,
            async function (payload) {
                const previousStatus =
                    item &&
                    item.status;

                if (type === "communications") {
                    const contactValue =
                        String(
                            payload.communication_contact ||
                            ""
                        ).trim();

                    delete payload.communication_contact;

                    if (
                        !contactValue ||
                        !(
                            contactValue.indexOf("client:") === 0 ||
                            contactValue.indexOf("lead:") === 0
                        )
                    ) {
                        throw new Error(
                            "Select the exact client or lead this communication belongs to."
                        );
                    }

                    const contactParts =
                        contactValue.split(":");

                    const contactType =
                        contactParts[0];

                    const contactId =
                        contactParts.slice(1).join(":");

                    payload.client_id =
                        contactType === "client"
                            ? contactId
                            : null;

                    payload.lead_id =
                        contactType === "lead"
                            ? contactId
                            : null;

                    payload.created_by =
                        item.created_by ||
                        state.currentUser.id;

                    payload.contacted_at =
                        payload.contacted_at
                            ? new Date(payload.contacted_at).toISOString()
                            : new Date().toISOString();

                    payload.updated_at =
                        new Date().toISOString();
                }

                if (type === "leads") {
                    payload.assessment_updated_at =
                        new Date().toISOString();

                    payload.assessment_updated_by =
                        state.currentUser.id;
                }

                if (
                    type === "payments"
                ) {
                    const invoice =
                        state.invoices.find(function (entry) {
                            return entry.id === payload.invoice_id;
                        });

                    if (!invoice) {
                        throw new Error(
                            "Select a valid invoice number before recording a payment."
                        );
                    }

                    if (invoice.status === "cancelled") {
                        throw new Error(
                            "Cancelled invoices cannot receive payments."
                        );
                    }

                    if (
                        id &&
                        item.invoice_id &&
                        payload.invoice_id !== item.invoice_id
                    ) {
                        throw new Error(
                            "The invoice attached to an existing payment cannot be changed."
                        );
                    }

                    const outstanding =
                        Number(
                            invoice.amount_outstanding != null
                                ? invoice.amount_outstanding
                                : invoice.total || 0
                        );

                    const existingPaymentAmount =
                        id &&
                        item.invoice_id === invoice.id
                            ? Number(item.amount || 0)
                            : 0;

                    const availableBalance =
                        Math.max(
                            0,
                            outstanding +
                            existingPaymentAmount
                        );

                    const amount =
                        Number(
                            payload.amount || 0
                        );

                    if (
                        amount <= 0 ||
                        amount > availableBalance
                    ) {
                        throw new Error(
                            "Payment amount must be greater than R0 and no more than the invoice's available balance of " +
                            money(availableBalance) +
                            "."
                        );
                    }

                    payload.client_id =
                        invoice.client_id;

                    payload.project_id =
                        invoice.project_id || null;

                    payload.status = "paid";

                    if (!payload.paid_at) {
                        payload.paid_at =
                            dashboardTodayISO();
                    }
                }

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

                    const savedRecord =
                        await api(
                            endpoint,
                            {
                                method:
                                    id
                                        ? "PATCH"
                                        : "POST",
                                headers: headers({
                                    "Prefer":
                                        "return=representation"
                                }),
                                body:
                                    JSON.stringify(
                                        payload
                                    )
                            }
                        );

                    const savedProjectId =
                        id ||
                        (
                            Array.isArray(savedRecord)
                                ? savedRecord[0]?.id
                                : savedRecord?.id
                        );

                    if (
                        type === "projects" &&
                        payload.status === "completed"
                    ) {
                        await handleProjectCompletion(
                            savedProjectId,
                            previousStatus === "completed"
                        );
                    }
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

    async function archiveClient(id) {
        const client =
            state.clients.find(function (item) {
                return item.id === id;
            });

        if (!client) return;

        const archived =
            client.status === "archived";

        if (
            !(await swayConfirm(
                archived
                    ? "Restore " +
                      client.business_name +
                      " to active clients?"
                    : "Archive " +
                      client.business_name +
                      "? The client and its history will be retained."
            ))
        ) {
            return;
        }

        await api(
            "/rest/v1/clients?id=eq." +
            encodeURIComponent(id),
            {
                method: "PATCH",
                headers: headers({
                    "Prefer":
                        "return=minimal"
                }),
                body:
                    JSON.stringify({
                        status:
                            archived
                                ? "active"
                                : "archived",
                        updated_at:
                            new Date().toISOString()
                    })
            }
        );

        await logActivity(
            archived
                ? "Restored client"
                : "Archived client",
            "clients",
            id
        );

        await refreshData();
        renderShell();
        renderView();
    }

    function deleteClient(id) {
        const client =
            state.clients.find(function (item) {
                return item.id === id;
            });

        if (!client) return;

        swayAlert(
            "Swayphics clients are retained permanently. Archive the client instead of deleting the record."
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

        const confirmMessage =
            type === "clients"
                ? "Permanently delete this client? This removes the client and linked projects, tasks, follow-ups, payments, communication logs and invoices. Quotes are retained without the client link. This cannot be undone."
                : "Delete this " +
                  config.title.toLowerCase() +
                  "?";

        if (
            !(await swayConfirm(confirmMessage))
        ) {
            return;
        }

        if (type === "clients") {
            const clientInvoices =
                state.invoices.filter(function (invoice) {
                    return invoice.client_id === id;
                });

            for (const invoice of clientInvoices) {
                const deletedInvoices =
                    await api(
                        "/rest/v1/invoices?id=eq." +
                        encodeURIComponent(invoice.id),
                        {
                            method: "DELETE",
                            headers: headers({
                                "Prefer":
                                    "return=representation"
                            })
                        }
                    );

                if (
                    Array.isArray(deletedInvoices) &&
                    deletedInvoices.length === 0
                ) {
                    throw new Error(
                        "The invoice could not be deleted. Your current Supabase permissions may not allow invoice deletion."
                    );
                }
            }
        }

        const deletedRecords =
            await api(
                "/rest/v1/" +
                config.table +
                "?id=eq." +
                encodeURIComponent(id),
                {
                    method: "DELETE",
                    headers: headers({
                        "Prefer":
                            "return=representation"
                    })
                }
            );

        if (
            Array.isArray(deletedRecords) &&
            deletedRecords.length === 0
        ) {
            throw new Error(
                "The record was not deleted. Supabase returned no deleted rows, which usually means the current database permissions or RLS policy is blocking this action."
            );
        }

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
        const followup =
            state.followups.find(function (item) {
                return item.id === id;
            });

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

        if (followup && followup.lead_id) {
            await api(
                "/rest/v1/leads?id=eq." +
                encodeURIComponent(followup.lead_id),
                {
                    method: "PATCH",
                    headers: headers({
                        "Prefer":
                            "return=minimal"
                    }),
                    body:
                        JSON.stringify({
                            status: "contacted",
                            last_contacted_at:
                                new Date().toISOString(),
                            next_follow_up:
                                null
                        })
                }
            );
        }

        await logActivity(
            followup && followup.lead_id
                ? "Completed lead follow-up and returned lead to active pipeline"
                : "Completed follow-up",
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
                "Move " +
                lead.business_name +
                " into Clients? This marks the lead as won."
            ))
        ) {
            return;
        }

        const clientId =
            await api(
                "/rest/v1/rpc/convert_swayphics_lead_to_client",
                {
                    method: "POST",
                    headers: headers({
                        "Prefer":
                            "return=representation"
                    }),
                    body:
                        JSON.stringify({
                            p_lead_id: id
                        })
                }
            );

        await logActivity(
            "Converted lead to client",
            "leads",
            id
        );

        if (clientId) {
            await logActivity(
                "Created client from lead",
                "clients",
                clientId
            );
        }

        await refreshData();
        renderShell();
        renderView();
    }

    async function updateEnquiryStatus(
        id,
        status
    ) {
        if (status === "contacted") {
            const leadId =
                await api(
                    "/rest/v1/rpc/convert_swayphics_enquiry_to_lead",
                    {
                        method: "POST",
                        headers: headers({
                            "Prefer":
                                "return=representation"
                        }),
                        body:
                            JSON.stringify({
                                p_enquiry_id: id
                            })
                    }
                );

            await logActivity(
                "Contacted enquiry and moved it to Leads",
                "website_enquiries",
                id
            );

            if (leadId) {
                await logActivity(
                    "Created lead from website enquiry",
                    "leads",
                    leadId
                );
            }
        } else {
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
        }

        await refreshData();
        renderShell();
        renderView();
    }

    async function processStaleLeads() {
        try {
            return await api(
                "/rest/v1/rpc/process_swayphics_stale_leads",
                {
                    method: "POST",
                    headers: headers({
                        "Prefer":
                            "return=representation"
                    }),
                    body: "{}"
                }
            );
        } catch (error) {
            console.warn(
                "Stale lead automation could not run.",
                error
            );
            return 0;
        }
    }

    async function requestClientReview(projectId) {
        const response =
            await fetch(
                SUPABASE_URL +
                "/functions/v1/request-client-review",
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
                            project_id:
                                projectId
                        })
                }
            );

        const responseText =
            await response.text();

        let result = null;

        try {
            result =
                responseText
                    ? JSON.parse(responseText)
                    : null;
        } catch (error) {
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
                    : "Unable to send the client review email."
            );
        }

        return result;
    }

    async function handleProjectCompletion(
        projectId,
        wasCompleted
    ) {
        if (
            !projectId ||
            wasCompleted
        ) {
            return;
        }

        try {
            const result =
                await requestClientReview(
                    projectId
                );

            if (!result.already_sent) {
                await logActivity(
                    "Sent client review request",
                    "client_projects",
                    projectId
                );
            }
        } catch (error) {
            console.warn(
                "Client review email was not sent:",
                error
            );

            await logActivity(
                "Client review request needs attention: " +
                error.message,
                "client_projects",
                projectId
            );

            swayAlert(
                "The project was completed and added to Portfolio. The client review email could not be sent yet. Check the client's email and Resend configuration, then retry it from the project."
            );
        }

        if (
            typeof window.loadAdminPortfolio === "function"
        ) {
            try {
                await window.loadAdminPortfolio();
            } catch (error) {
                console.warn(
                    "Portfolio refresh after project completion failed.",
                    error
                );
            }
        }
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

    function renderWorkspaceLoading() {
        return (
            '<section class="sway-workspace-loading">' +
                '<div class="sway-workspace-loading-orb"></div>' +
                '<div class="sway-workspace-loading-copy">' +
                    "<strong>Loading your workspace</strong>" +
                    "<span>Syncing your latest Swayphics data…</span>" +
                "</div>" +
                '<div class="sway-workspace-loading-grid">' +
                    "<span></span><span></span><span></span><span></span>" +
                "</div>" +
            "</section>"
        );
    }

    function renderView() {
        const main =
            document.getElementById(
                "sway-workspace-main"
            );

        if (!main) return;

        if (!state.initialDataLoaded) {
            main.innerHTML =
                renderWorkspaceLoading();
            return;
        }

        try {
            if (state.currentView === "overview") {
                main.innerHTML =
                    renderOverview();
            }

            if (state.currentView === "insights") {
                main.innerHTML =
                    renderInsights();
            }

            if (state.currentView === "reminders") {
                main.innerHTML =
                    heading() +
                    renderAutomatedReminders();
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

            if (state.currentView === "communications") {
                main.innerHTML =
                    renderCommunications();
            }

            if (state.currentView === "email") {
                main.innerHTML =
                    renderEmailWorkspace();
            }

            if (state.currentView === "documents") {
                main.innerHTML =
                    renderDocuments();
            }

            if (state.currentView === "social-overview") {
                main.innerHTML =
                    renderSocialOverview();
            }

            if (state.currentView === "social-content") {
                main.innerHTML =
                    renderSocialContent();
            }

            if (state.currentView === "social-analytics") {
                main.innerHTML =
                    renderSocialAnalytics();
            }

            if (state.currentView === "content") {
                main.innerHTML =
                    renderContent();
            }

            if (state.currentView === "activity") {
                main.innerHTML =
                    renderActivity();
            }

            if (state.currentView === "portal-requests") {
                main.innerHTML =
                    renderPortalRequests();
            }

            if (state.currentView === "data-export") {
                main.innerHTML =
                    renderDataExport();
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
                            await syncWorkspaceData({
                                fallbackToPolling: true,
                                render: true
                            });
                        } catch (error) {
                            swayAlert(
                                error.message ||
                                "Unable to refresh workspace data."
                            );
                        } finally {
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

                            if (action === "archive") {
                                const invoice =
                                    state.invoices.find(function (item) {
                                        return item.id === id;
                                    });

                                if (!invoice || invoice.archived) {
                                    return;
                                }

                                if (
                                    !(await swayConfirm(
                                        "Archive invoice " +
                                        invoice.invoice_number +
                                        "? It will leave active billing but remain available in the archive."
                                    ))
                                ) {
                                    return;
                                }

                                await api(
                                    "/rest/v1/invoices?id=eq." +
                                    encodeURIComponent(id),
                                    {
                                        method: "PATCH",
                                        headers: headers({
                                            "Prefer":
                                                "return=minimal"
                                        }),
                                        body:
                                            JSON.stringify({
                                                archived: true,
                                                archived_at:
                                                    new Date().toISOString()
                                            })
                                    }
                                );

                                await logActivity(
                                    "Archived invoice",
                                    "invoices",
                                    id
                                );

                                await refreshData();
                                renderShell();
                                renderView();
                            }

                            if (action === "restore") {
                                await api(
                                    "/rest/v1/invoices?id=eq." +
                                    encodeURIComponent(id),
                                    {
                                        method: "PATCH",
                                        headers: headers({
                                            "Prefer":
                                                "return=minimal"
                                        }),
                                        body:
                                            JSON.stringify({
                                                archived: false,
                                                archived_at: null
                                            })
                                    }
                                );

                                await logActivity(
                                    "Restored invoice",
                                    "invoices",
                                    id
                                );

                                await refreshData();
                                renderShell();
                                renderView();
                            }

                            if (action === "delete") {
                                const invoice =
                                    state.invoices.find(function (item) {
                                        return item.id === id;
                                    });

                                if (!invoice) {
                                    return;
                                }

                                if (
                                    invoice.status !== "draft" &&
                                    !invoice.archived
                                ) {
                                    swayAlert(
                                        "Archive this invoice first. Sent, paid and overdue invoice records should be retained in the archive rather than permanently deleted."
                                    );
                                    return;
                                }

                                const warning =
                                    invoice.archived
                                        ? "Permanently delete this archived invoice? This cannot be undone."
                                        : "Delete this draft invoice? This cannot be undone.";

                                if (!(await swayConfirm(warning))) {
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
                                    invoice.archived
                                        ? "Permanently deleted archived invoice"
                                        : "Deleted invoice draft",
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
            .querySelectorAll("[data-invoice-filter]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        const showArchived =
                            localStorage.getItem(
                                "swayphics_show_archived_invoices"
                            ) === "true";

                        localStorage.setItem(
                            "swayphics_show_archived_invoices",
                            showArchived
                                ? "false"
                                : "true"
                        );

                        renderView();
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
            .querySelectorAll("[data-new-project-client]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        createOrEdit(
                            "projects",
                            null,
                            {
                                client_id:
                                    button.dataset.newProjectClient
                            }
                        );
                    }
                );
            });

        workspace
            .querySelectorAll("[data-new-invoice-client]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        openInvoiceBuilder(
                            null,
                            button.dataset.newInvoiceClient
                        );
                    }
                );
            });

        workspace
            .querySelectorAll("[data-new-payment-invoice]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        createOrEdit(
                            "payments",
                            null,
                            {
                                invoice_id:
                                    button.dataset.newPaymentInvoice
                            }
                        );
                    }
                );
            });

        workspace
            .querySelectorAll("[data-request-review]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    async function () {
                        try {
                            button.disabled = true;
                            button.textContent = "Sending...";

                            await requestClientReview(
                                button.dataset.requestReview
                            );

                            await logActivity(
                                "Sent client review request",
                                "client_projects",
                                button.dataset.requestReview
                            );

                            await refreshData();
                            renderShell();
                            renderView();
                        } catch (error) {
                            swayAlert(
                                error.message ||
                                "Unable to send the client review email."
                            );
                            button.disabled = false;
                        }
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
            .querySelectorAll("[data-client360]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        openClient360(
                            button.dataset.client360
                        );
                    }
                );
            });

        workspace
            .querySelectorAll("[data-archive-client], [data-restore-client]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        archiveClient(
                            button.dataset.archiveClient ||
                            button.dataset.restoreClient
                        );
                    }
                );
            });

        workspace
            .querySelectorAll("[data-close-client360]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        const modal =
                            document.getElementById(
                                "sway-client360-modal"
                            );

                        if (modal) {
                            modal.remove();
                        }
                    }
                );
            });

        workspace
            .querySelectorAll("#sway-client360-modal [data-view-target]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        const view =
                            button.dataset.viewTarget;

                        const modal =
                            document.getElementById(
                                "sway-client360-modal"
                            );

                        if (modal) {
                            modal.remove();
                        }

                        state.currentView = view;
                        renderShell();
                        renderView();
                    }
                );
            });

        workspace
            .querySelectorAll("[data-automation-followup]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        const suggestions =
                            followupAutomationSuggestions();

                        const suggestion =
                            suggestions[
                                Number(
                                    button.dataset.automationFollowup
                                )
                            ];

                        if (!suggestion) return;

                        createOrEdit(
                            "followups",
                            null,
                            {
                                lead_id:
                                    suggestion.leadId,
                                client_id:
                                    suggestion.clientId,
                                assigned_to:
                                    state.currentUser.id,
                                scheduled_for:
                                    suggestion.suggestedDate,
                                channel:
                                    "WhatsApp",
                                status:
                                    "pending",
                                note:
                                    suggestion.note
                            }
                        );
                    }
                );
            });

        workspace
            .querySelectorAll("[data-run-automated-reminders]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    async function () {
                        const originalText = button.textContent;
                        button.disabled = true;
                        button.textContent = "Running...";

                        try {
                            const created =
                                await processAutomatedReminders();

                            if (created) {
                                await refreshData();
                            }

                            renderShell();
                            renderView();
                            setStandaloneManagerVisibility(
                                state.currentView
                            );

                            swayAlert(
                                created
                                    ? created +
                                      (
                                          created === 1
                                              ? " automatic reminder created."
                                              : " automatic reminders created."
                                      )
                                    : "No new automatic reminders were due."
                            );
                        } catch (error) {
                            swayAlert(
                                error.message ||
                                "Unable to run automatic reminders."
                            );
                        } finally {
                            button.disabled = false;
                            button.textContent = originalText;
                        }
                    }
                );
            });

        workspace
            .querySelectorAll("[data-project-timeline]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        openProjectTimeline(
                            button.dataset.projectTimeline
                        );
                    }
                );
            });

        workspace
            .querySelectorAll("[data-create-invoice-from-quote]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        createInvoiceFromQuote(
                            button.dataset.createInvoiceFromQuote
                        );
                    }
                );
            });

        workspace
            .querySelectorAll("[data-client-portal]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        createClientPortalLink(
                            button.dataset.clientPortal
                        );
                    }
                );
            });

        workspace
            .querySelectorAll("[data-add-communication-client]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        createOrEdit(
                            "communications",
                            null,
                            {
                                client_id:
                                    button.dataset.addCommunicationClient,
                                lead_id: null,
                                channel: "WhatsApp",
                                direction: "outbound",
                                contacted_at:
                                    dateTimeInput(new Date())
                            }
                        );
                    }
                );
            });

        workspace
            .querySelectorAll("[data-portal-request-status]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    async function () {
                        try {
                            await api(
                                "/rest/v1/client_portal_requests?id=eq." +
                                encodeURIComponent(button.dataset.id),
                                {
                                    method: "PATCH",
                                    headers: headers({
                                        "Prefer":
                                            "return=minimal"
                                    }),
                                    body:
                                        JSON.stringify({
                                            status:
                                                button.dataset.portalRequestStatus,
                                            updated_at:
                                                new Date().toISOString()
                                        })
                                }
                            );

                            await logActivity(
                                "Updated portal request",
                                "client_portal_requests",
                                button.dataset.id
                            );

                            await refreshData();
                            renderShell();
                            renderView();
                        } catch (error) {
                            swayAlert(
                                error.message ||
                                "Unable to update the portal request."
                            );
                        }
                    }
                );
            });

        workspace
            .querySelectorAll("[data-upload-document]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        openDocumentUploadModal();
                    }
                );
            });

        workspace
            .querySelectorAll("[data-download-document]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        downloadClientDocument(
                            button.dataset.downloadDocument
                        );
                    }
                );
            });

        workspace
            .querySelectorAll("[data-delete-document]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        deleteClientDocument(
                            button.dataset.deleteDocument
                        );
                    }
                );
            });

        workspace
            .querySelectorAll("[data-export-json]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    exportWorkspaceJson
                );
            });

        workspace
            .querySelectorAll("[data-export-csv]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    exportWorkspaceCsv
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
            .querySelectorAll("[data-social-add-account]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        createOrEdit(
                            "socialAccounts",
                            null,
                            {
                                platform:
                                    button.dataset.socialAddAccount,
                                status: "disconnected"
                            }
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
            .querySelectorAll("[data-send-email-type]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        openEmailComposer(
                            button.dataset.sendEmailType,
                            button.dataset.sendEmailId
                        );
                    }
                );
            });

        workspace
            .querySelectorAll("[data-compose-email]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        openEmailComposer();
                    }
                );
            });

        workspace
            .querySelectorAll("[data-delete]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    async function () {
                        if (button.disabled) {
                            return;
                        }

                        button.disabled = true;
                        const originalText =
                            button.textContent;

                        button.textContent =
                            "Deleting...";

                        try {
                            await removeRecord(
                                button.dataset.delete,
                                button.dataset.id
                            );
                        } catch (error) {
                            swayAlert(
                                error.message ||
                                "Unable to delete this record."
                            );
                        } finally {
                            button.disabled = false;
                            button.textContent =
                                originalText;
                        }
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
        state.initialDataLoading = true;

        setupAdminThemeToggle();

        renderShell();
        renderView();

        try {
            await Promise.all([
                loadState(),
                refreshData()
            ]);

            renderShell();
            renderView();
            setupNotificationCenter();
            setStandaloneManagerVisibility(
                state.currentView
            );
            setupGlobalSearch();
            setupRealtime();

            /*
             * Startup-critical data is now rendered before any automation
             * or secondary workspace work runs. This prevents the dashboard
             * from appearing, changing, and re-rendering several times during
             * the initial load.
             */

            processAutomatedReminders()
                .then(function (created) {
                    if (!created) {
                        return;
                    }

                    return refreshData();
                })
                .then(function () {
                    updateNotificationCenter();

                    if (
                        state.currentView === "reminders" ||
                        state.currentView === "followups"
                    ) {
                        renderView();
                        setupNotificationCenter();
                        setStandaloneManagerVisibility(
                            state.currentView
                        );
                    }
                })
                .catch(function (error) {
                    console.warn(
                        "Background reminder automation failed.",
                        error
                    );
                });

            refreshSecondaryData()
                .then(function () {
                    updateNotificationCenter();

                    if (
                        [
                            "communications",
                            "email",
                            "documents",
                            "portal-requests"
                        ].includes(state.currentView)
                    ) {
                        renderView();
                        setupNotificationCenter();
                        setStandaloneManagerVisibility(
                            state.currentView
                        );
                    }
                })
                .catch(function (error) {
                    console.warn(
                        "Secondary workspace data could not be loaded.",
                        error
                    );
                });

            window.setTimeout(
                function () {
                    processStaleLeads()
                        .then(function (changed) {
                            if (!changed) {
                                return;
                            }

                            return refreshData();
                        })
                        .then(function (changed) {
                            if (!changed) {
                                return;
                            }

                            updateNotificationCenter();

                            if (
                                state.currentView === "leads" ||
                                state.currentView === "followups" ||
                                state.currentView === "reminders"
                            ) {
                                renderView();
                                setupNotificationCenter();
                                setStandaloneManagerVisibility(
                                    state.currentView
                                );
                            }
                        })
                        .catch(function (error) {
                            console.warn(
                                "Background stale-lead automation failed.",
                                error
                            );
                        });
                },
                1500
            );
        } catch (error) {
            state.initialDataLoading = false;
            state.initialDataError =
                error.message ||
                "Unable to load workspace data.";

            const main =
                document.getElementById(
                    "sway-workspace-main"
                );

            if (main) {
                main.innerHTML =
                    '<div class="sway-error">' +
                        esc(
                            state.initialDataError
                        ) +
                    "</div>";
            }

            console.error(
                "Swayphics workspace failed to initialise:",
                error
            );
        }
    }

    boot();
})();
