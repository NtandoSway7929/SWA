
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
        announcements: []
    };

    const nav = [
        ["overview", "Overview"],
        ["tasks", "Tasks"],
        ["leads", "Leads"],
        ["followups", "Follow-ups"],
        ["clients", "Clients"],
        ["projects", "Projects"],
        ["quotes", "Quotes"],
        ["payments", "Payments"],
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

    function date(value) {
        if (!value) return "—";

        const parsed = new Date(value);

        if (Number.isNaN(parsed.getTime())) {
            return String(value);
        }

        return parsed.toLocaleDateString("en-ZA", {
            day: "2-digit",
            month: "short",
            year: "numeric"
        });
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

    function isOverdue(value) {
        if (!value) return false;

        const today = new Date();
        const due = new Date(value);

        today.setHours(0, 0, 0, 0);
        due.setHours(0, 0, 0, 0);

        return due < today;
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
            api("/rest/v1/site_announcements?select=*&order=created_at.desc")
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
            api("/rest/v1/site_announcements?select=*&order=created_at.desc")
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

    function renderOverview() {
        const today =
            new Date().toISOString().slice(0, 10);

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

            '<div class="sway-workspace-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));">' +

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
                        ["published", "active"].includes(field.key)
                    ) {
                        value =
                            value === "true";
                    }

                    if (
                        [
                            "assigned_to",
                            "client_id",
                            "project_id",
                            "lead_id"
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
                    alert(
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
            alert(
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
                alert(
                    "Only the owner can manage team access."
                );
                return;
            }

            alert(
                "Use Activate, Deactivate or Edit for team members. Team members are not deleted from this workspace."
            );
            return;
        }

        if (
            !confirm(
                "Delete this " +
                config.title.toLowerCase() +
                "?"
            )
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
            !confirm(
                "Convert " +
                lead.business_name +
                " into a client?"
            )
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
            renderShell();
            renderView();
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
