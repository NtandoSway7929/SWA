
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
        const response = await fetch(SUPABASE_URL + path, Object.assign({
            method: "GET",
            headers: headers()
        }, options || {}));

        const text = await response.text();
        let data = null;

        try {
            data = text ? JSON.parse(text) : null;
        } catch (error) {
            data = text;
        }

        if (!response.ok) {
            throw new Error(
                "Supabase returned " + response.status + ": " +
                (data && data.message ? data.message : text || "Request failed.")
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
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return value;
        return d.toLocaleDateString("en-ZA", {
            day: "2-digit",
            month: "short",
            year: "numeric"
        });
    }

    function dateInput(value) {
        return value ? String(value).slice(0, 10) : "";
    }

    function datetimeInput(value) {
        if (!value) return "";
        return new Date(value).toISOString().slice(0, 16);
    }

    function adminName(id) {
        const admin = state.admins.find(function (item) {
            return item.user_id === id;
        });
        return admin ? (admin.full_name || admin.email || id) : "Unassigned";
    }

    function clientName(id) {
        const client = state.clients.find(function (item) {
            return item.id === id;
        });
        return client ? client.business_name : "No client";
    }

    function projectName(id) {
        const project = state.projects.find(function (item) {
            return item.id === id;
        });
        return project ? project.name : "No project";
    }

    function leadName(id) {
        const lead = state.leads.find(function (item) {
            return item.id === id;
        });
        return lead ? lead.business_name : "No lead";
    }

    function chip(value) {
        const text = String(value || "—");
        const lower = text.toLowerCase();
        let cls = "neutral";
        if (["completed", "won", "paid", "approved", "published", "active"].includes(lower)) cls = "success";
        if (["high", "urgent", "overdue", "rejected", "lost"].includes(lower)) cls = "danger";
        if (["in progress", "review", "proposal sent", "pending", "new", "sent"].includes(lower)) cls = "warning";
        return '<span class="sway-chip ' + cls + '">' + esc(text.replace(/_/g, " ")) + "</span>";
    }

    async function loadState() {
        const currentUserResponse = await api("/auth/v1/user", {
            method: "GET"
        });

        state.currentUser = currentUserResponse;

        const admins = await api(
            "/rest/v1/admin_users?select=user_id,full_name,email,role,active,created_at&order=created_at.asc"
        );

        state.admins = Array.isArray(admins) ? admins : [];

        state.currentAdmin = state.admins.find(function (item) {
            return item.user_id === state.currentUser.id && item.active;
        });

        if (!state.currentAdmin) {
            throw new Error("Your account is authenticated, but it is not active in the Swayphics admin team.");
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

    function viewMeta(view) {
        const meta = {
            overview: ["Overview", "The operational picture for Swayphics today."],
            tasks: ["Tasks", "Work assigned to the Swayphics team."],
            leads: ["Leads", "Track prospects from first contact to conversion."],
            followups: ["Follow-ups", "Never lose a promising conversation."],
            clients: ["Clients", "Keep every active client relationship in one place."],
            projects: ["Projects", "Track delivery, ownership and payment status."],
            quotes: ["Quotes", "Track proposals and expected revenue."],
            payments: ["Payments", "Track what is paid, due and outstanding."],
            enquiries: ["Website enquiries", "Turn website submissions into tracked work."],
            content: ["Website content", "Manage internal website announcements and public-facing content records."],
            activity: ["Activity", "A shared operational history for the team."],
            team: ["Team", "Manage Swayphics dashboard access and roles."],
            portfolio: ["Portfolio", "Manage published Swayphics portfolio work."],
            testimonials: ["Testimonials", "Review client feedback already connected to the dashboard."]
        };
        return meta[view] || meta.overview;
    }

    function navButton(item) {
        const view = item[0];
        let count = "";
        if (view === "tasks") count = state.tasks.filter(function (x) { return x.status !== "completed"; }).length;
        if (view === "leads") count = state.leads.filter(function (x) { return !["won", "lost"].includes(x.status); }).length;
        if (view === "followups") count = state.followups.filter(function (x) { return x.status === "pending"; }).length;
        if (view === "enquiries") count = state.enquiries.filter(function (x) { return x.status === "new"; }).length;
        return '<button type="button" class="sway-workspace-nav-button ' +
            (state.currentView === view ? "active" : "") +
            '" data-view="' + esc(view) + '">' +
            '<span>' + esc(item[1]) + "</span>" +
            (count ? '<span class="sway-workspace-count">' + count + "</span>" : "") +
            "</button>";
    }

    function renderShell() {
        workspace.innerHTML =
            '<div class="sway-workspace-shell">' +
                '<aside class="sway-workspace-sidebar" aria-label="Admin workspace navigation">' +
                    nav.map(navButton).join("") +
                "</aside>" +
                '<div class="sway-workspace-main" id="sway-workspace-main"></div>' +
            "</div>";

        workspace.querySelectorAll("[data-view]").forEach(function (button) {
            button.addEventListener("click", function () {
                const view = button.dataset.view;
                state.currentView = view;

                if (view === "portfolio") {
                    const target = document.querySelector(".portfolio-manager");
                    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
                    return;
                }

                if (view === "testimonials") {
                    const target = document.querySelector("#testimonials-admin-section");
                    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
                    return;
                }

                renderShell();
                renderView();
            });
        });
    }

    function heading(extraActions) {
        const meta = viewMeta(state.currentView);
        return '<div class="sway-workspace-heading">' +
            '<div class="sway-workspace-heading-copy">' +
                '<span class="admin-label">' + esc(meta[0]) + "</span>" +
                "<h2>" + esc(meta[0]) + "</h2>" +
                "<p>" + esc(meta[1]) + "</p>" +
            "</div>" +
            '<div class="sway-workspace-heading-actions">' +
                (extraActions || "") +
            "</div>" +
        "</div>";
    }

    function panel(title, subtitle, content, action) {
        return '<section class="sway-panel">' +
            '<div class="sway-panel-title">' +
                '<div><h3>' + esc(title) + '</h3>' +
                (subtitle ? "<p>" + esc(subtitle) + "</p>" : "") +
                "</div>" +
                (action || "") +
            "</div>" +
            content +
        "</section>";
    }

    function empty(message) {
        return '<div class="sway-table-empty">' + esc(message) + "</div>";
    }

    function renderOverview() {
        const today = new Date().toISOString().slice(0, 10);
        const tasksToday = state.tasks.filter(function (item) {
            return item.status !== "completed" && dateInput(item.due_date) === today;
        }).length;
        const followupsToday = state.followups.filter(function (item) {
            return item.status === "pending" && dateInput(item.scheduled_for) === today;
        }).length;
        const outstanding = state.payments
            .filter(function (item) { return item.status !== "paid"; })
            .reduce(function (sum, item) { return sum + Number(item.amount || 0); }, 0);
        const pipeline = state.leads
            .filter(function (item) { return !["won", "lost"].includes(item.status); })
            .reduce(function (sum, item) { return sum + Number(item.estimated_value || 0); }, 0);

        const work = state.tasks
            .filter(function (item) { return item.status !== "completed"; })
            .sort(function (a,b) {
                return String(a.due_date || "9999").localeCompare(String(b.due_date || "9999"));
            })
            .slice(0, 6);

        const activities = state.activities.slice(0, 8);

        return heading(
            '<button type="button" class="sway-workspace-button primary" data-quick="task">+ New task</button>' +
            '<button type="button" class="sway-workspace-button" data-quick="lead">+ New lead</button>'
        ) +
        '<div class="sway-workspace-grid">' +
            '<div class="sway-stat-card"><span class="label">Tasks due today</span><div class="value">' + tasksToday + "</div><div class="hint">Keep production moving.</div></div>" +
            '<div class="sway-stat-card"><span class="label">Follow-ups today</span><div class="value">' + followupsToday + "</div><div class="hint">Protect every active lead.</div></div>" +
            '<div class="sway-stat-card"><span class="label">Open pipeline</span><div class="value">' + esc(money(pipeline)) + "</div><div class="hint">" + state.leads.filter(function (x) { return !["won","lost"].includes(x.status); }).length + " active leads.</div></div>" +
            '<div class="sway-stat-card"><span class="label">Outstanding</span><div class="value">' + esc(money(outstanding)) + "</div><div class="hint">" + state.payments.filter(function (x) { return x.status !== "paid"; }).length + " payment items.</div></div>" +
        "</div>" +
        panel(
            "My work",
            "Tasks assigned to you that are not complete.",
            work.length ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Task</th><th>Client</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>' +
                work.map(function (item) {
                    return "<tr><td><strong>" + esc(item.title) + "</strong></td><td>" + esc(clientName(item.client_id)) + "</td><td>" + esc(date(item.due_date)) + "</td><td>" + chip(item.status) + "</td><td><div class="sway-row-actions"><button class="sway-row-action" data-edit="tasks" data-id="" + esc(item.id) + "">Edit</button></div></td></tr>";
                }).join("") +
                "</tbody></table></div>" : empty("Nothing is currently assigned to you.")
        ) +
        '<div class="sway-workspace-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));">' +
            panel("Recent activity", "What the team has changed recently.", activities.length ? activities.map(function (item) {
                return '<div class="sway-inline-note" style="margin-bottom:8px;">' +
                    "<strong>" + esc(item.action || "Activity") + "</strong><br>" +
                    esc(item.entity_type || "") + " · " + esc(date(item.created_at)) +
                "</div>";
            }).join("") : empty("No activity recorded yet.")) +
            panel("Quick actions", "Jump directly into the next operational step.", '<div class="sway-quick-actions">' +
                '<button class="sway-quick-action" data-quick="client">+ Add client</button>' +
                '<button class="sway-quick-action" data-quick="project">+ Add project</button>' +
                '<button class="sway-quick-action" data-quick="followup">+ Add follow-up</button>' +
                '<button class="sway-quick-action" data-view-target="enquiries">View enquiries</button>' +
            "</div>") +
        "</div>";
    }

    function renderTasks() {
        const rows = state.tasks.map(function (item) {
            return "<tr>" +
                "<td><strong>" + esc(item.title) + "</strong><br><span style="color:var(--text-muted);font-size:.58rem;">" + esc(item.description || "") + "</span></td>" +
                "<td>" + esc(adminName(item.assigned_to)) + "</td>" +
                "<td>" + chip(item.priority) + "</td>" +
                "<td>" + esc(date(item.due_date)) + "</td>" +
                "<td>" + chip(item.status) + "</td>" +
                "<td><div class="sway-row-actions">" +
                    (item.status !== "completed" ? '<button class="sway-row-action" data-complete-task="' + esc(item.id) + '">Complete</button>' : "") +
                    '<button class="sway-row-action" data-edit="tasks" data-id="' + esc(item.id) + '">Edit</button>' +
                    '<button class="sway-row-action danger" data-delete="tasks" data-id="' + esc(item.id) + '">Delete</button>' +
                "</div></td></tr>";
        }).join("");

        return heading('<button class="sway-workspace-button primary" data-add="tasks">+ New task</button>') +
            panel("All tasks", "Assignments, deadlines and delivery status.", state.tasks.length ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Task</th><th>Assigned</th><th>Priority</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>" : empty("No tasks yet."));
    }

    function renderLeads() {
        const rows = state.leads.map(function (item) {
            return "<tr>" +
                "<td><strong>" + esc(item.business_name) + "</strong><br><span style="color:var(--text-muted);font-size:.58rem;">" + esc(item.contact_name || "") + "</span></td>" +
                "<td>" + esc(item.service_interest || "—") + "</td>" +
                "<td>" + chip(item.status) + "</td>" +
                "<td>" + esc(money(item.estimated_value)) + "</td>" +
                "<td>" + esc(date(item.next_follow_up)) + "</td>" +
                "<td><div class="sway-row-actions">" +
                    '<button class="sway-row-action" data-edit="leads" data-id="' + esc(item.id) + '">Edit</button>' +
                    (item.status !== "won" ? '<button class="sway-row-action" data-convert-lead="' + esc(item.id) + '">Convert</button>' : "") +
                    '<button class="sway-row-action danger" data-delete="leads" data-id="' + esc(item.id) + '">Delete</button>' +
                "</div></td></tr>";
        }).join("");

        return heading('<button class="sway-workspace-button primary" data-add="leads">+ New lead</button>') +
            panel("Lead pipeline", "Capture every serious opportunity, regardless of outreach channel.", state.leads.length ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Business</th><th>Service</th><th>Status</th><th>Value</th><th>Follow-up</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>" : empty("No leads yet."));
    }

    function renderFollowups() {
        const rows = state.followups.map(function (item) {
            const subject = item.lead_id ? leadName(item.lead_id) : clientName(item.client_id);
            return "<tr>" +
                "<td><strong>" + esc(subject) + "</strong><br><span style="color:var(--text-muted);font-size:.58rem;">" + esc(item.channel || "—") + "</span></td>" +
                "<td>" + esc(date(item.scheduled_for)) + "</td>" +
                "<td>" + esc(adminName(item.assigned_to)) + "</td>" +
                "<td>" + chip(item.status) + "</td>" +
                "<td><div class="sway-row-actions">" +
                    (item.status === "pending" ? '<button class="sway-row-action" data-complete-followup="' + esc(item.id) + '">Complete</button>' : "") +
                    '<button class="sway-row-action" data-edit="followups" data-id="' + esc(item.id) + '">Edit</button>' +
                    '<button class="sway-row-action danger" data-delete="followups" data-id="' + esc(item.id) + '">Delete</button>' +
                "</div></td></tr>";
        }).join("");

        return heading('<button class="sway-workspace-button primary" data-add="followups">+ New follow-up</button>') +
            panel("Follow-up queue", "A shared reminder system for prospects and clients.", state.followups.length ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Contact</th><th>Scheduled</th><th>Assigned</th><th>Status</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>" : empty("No follow-ups scheduled."));
    }

    function renderClients() {
        const rows = state.clients.map(function (item) {
            const count = state.projects.filter(function (project) { return project.client_id === item.id; }).length;
            return "<tr>" +
                "<td><strong>" + esc(item.business_name) + "</strong><br><span style="color:var(--text-muted);font-size:.58rem;">" + esc(item.contact_name || "") + "</span></td>" +
                "<td>" + esc(item.email || item.phone || "—") + "</td>" +
                "<td>" + esc(adminName(item.assigned_to)) + "</td>" +
                "<td>" + count + "</td>" +
                "<td>" + chip(item.status) + "</td>" +
                "<td><div class="sway-row-actions"><button class="sway-row-action" data-edit="clients" data-id="' + esc(item.id) + '">Edit</button><button class="sway-row-action danger" data-delete="clients" data-id="' + esc(item.id) + '">Delete</button></div></td></tr>";
        }).join("");

        return heading('<button class="sway-workspace-button primary" data-add="clients">+ New client</button>') +
            panel("Clients", "One record for every active Swayphics relationship.", state.clients.length ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Business</th><th>Contact</th><th>Owner</th><th>Projects</th><th>Status</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>" : empty("No clients yet."));
    }

    function renderProjects() {
        const rows = state.projects.map(function (item) {
            return "<tr>" +
                "<td><strong>" + esc(item.name) + "</strong><br><span style="color:var(--text-muted);font-size:.58rem;">" + esc(item.service || "") + "</span></td>" +
                "<td>" + esc(clientName(item.client_id)) + "</td>" +
                "<td>" + chip(item.status) + "</td>" +
                "<td>" + esc(date(item.due_date)) + "</td>" +
                "<td>" + chip(item.payment_status) + "</td>" +
                "<td>" + esc(money(item.value)) + "</td>" +
                "<td><div class="sway-row-actions"><button class="sway-row-action" data-edit="projects" data-id="' + esc(item.id) + '">Edit</button><button class="sway-row-action danger" data-delete="projects" data-id="' + esc(item.id) + '">Delete</button></div></td></tr>";
        }).join("");

        return heading('<button class="sway-workspace-button primary" data-add="projects">+ New project</button>') +
            panel("Projects", "Plan, build, review and close client work.", state.projects.length ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Project</th><th>Client</th><th>Status</th><th>Due</th><th>Payment</th><th>Value</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>" : empty("No projects yet."));
    }

    function renderQuotes() {
        const rows = state.quotes.map(function (item) {
            return "<tr>" +
                "<td><strong>" + esc(item.quote_number || "Unnumbered") + "</strong><br><span style="color:var(--text-muted);font-size:.58rem;">" + esc(item.title || "") + "</span></td>" +
                "<td>" + esc(item.client_id ? clientName(item.client_id) : leadName(item.lead_id)) + "</td>" +
                "<td>" + esc(money(item.amount)) + "</td>" +
                "<td>" + chip(item.status) + "</td>" +
                "<td>" + esc(date(item.valid_until)) + "</td>" +
                "<td><div class="sway-row-actions"><button class="sway-row-action" data-edit="quotes" data-id="' + esc(item.id) + '">Edit</button><button class="sway-row-action danger" data-delete="quotes" data-id="' + esc(item.id) + '">Delete</button></div></td></tr>";
        }).join("");

        return heading('<button class="sway-workspace-button primary" data-add="quotes">+ New quote</button>') +
            panel("Quotes", "Keep every proposal visible and track expected work value.", state.quotes.length ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Quote</th><th>Contact</th><th>Amount</th><th>Status</th><th>Valid until</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>" : empty("No quotes yet."));
    }

    function renderPayments() {
        const rows = state.payments.map(function (item) {
            return "<tr>" +
                "<td><strong>" + esc(clientName(item.client_id)) + "</strong><br><span style="color:var(--text-muted);font-size:.58rem;">" + esc(projectName(item.project_id)) + "</span></td>" +
                "<td>" + esc(money(item.amount)) + "</td>" +
                "<td>" + chip(item.status) + "</td>" +
                "<td>" + esc(date(item.due_date)) + "</td>" +
                "<td>" + esc(item.method || "—") + "</td>" +
                "<td><div class="sway-row-actions"><button class="sway-row-action" data-edit="payments" data-id="' + esc(item.id) + '">Edit</button><button class="sway-row-action danger" data-delete="payments" data-id="' + esc(item.id) + '">Delete</button></div></td></tr>";
        }).join("");

        return heading('<button class="sway-workspace-button primary" data-add="payments">+ New payment</button>') +
            panel("Payments", "A lightweight cash collection tracker for active work.", state.payments.length ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Client / project</th><th>Amount</th><th>Status</th><th>Due</th><th>Method</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>" : empty("No payment records yet."));
    }

    function renderEnquiries() {
        const rows = state.enquiries.map(function (item) {
            return "<tr>" +
                "<td><strong>" + esc(item.business_name || item.name || "Website visitor") + "</strong><br><span style="color:var(--text-muted);font-size:.58rem;">" + esc(item.email || "") + "</span></td>" +
                "<td>" + esc(item.service || "—") + "</td>" +
                "<td>" + chip(item.status) + "</td>" +
                "<td>" + esc(date(item.created_at)) + "</td>" +
                "<td><div class="sway-row-actions">" +
                    '<button class="sway-row-action" data-enquiry-status="' + esc(item.id) + '" data-status-next="contacted">Contacted</button>' +
                    '<button class="sway-row-action" data-enquiry-status="' + esc(item.id) + '" data-status-next="converted">Converted</button>' +
                    '<button class="sway-row-action danger" data-enquiry-status="' + esc(item.id) + '" data-status-next="closed">Close</button>' +
                "</div></td></tr>";
        }).join("");

        return heading() +
            panel("Website enquiries", "Move website submissions into the lead pipeline.", state.enquiries.length ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Enquirer</th><th>Service</th><th>Status</th><th>Received</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>" : empty("No website enquiries are currently stored."));
    }

    function renderContent() {
        const rows = state.announcements.map(function (item) {
            return "<tr><td><strong>" + esc(item.title) + "</strong><br><span style="color:var(--text-muted);font-size:.58rem;">" + esc(item.message || "") + "</span></td><td>" + chip(item.published ? "Published" : "Draft") + "</td><td>" + esc(date(item.created_at)) + "</td><td><div class="sway-row-actions"><button class="sway-row-action" data-edit="announcements" data-id="" + esc(item.id) + "">Edit</button><button class="sway-row-action danger" data-delete="announcements" data-id="" + esc(item.id) + "">Delete</button></div></td></tr>";
        }).join("");

        return heading('<button class="sway-workspace-button primary" data-add="announcements">+ New announcement</button>') +
            panel("Website announcements", "Reusable notices for future public-site placements.", state.announcements.length ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Announcement</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>" : empty("No announcements yet.")) +
            '<div class="sway-inline-note">Portfolio and testimonials remain connected to the existing public-site managers below. This workspace adds the operational layer around them without changing your current public pricing.</div>';
    }

    function renderActivity() {
        const rows = state.activities.map(function (item) {
            return "<tr><td>" + esc(date(item.created_at)) + "</td><td><strong>" + esc(adminName(item.actor_id)) + "</strong></td><td>" + esc(item.action || "—") + "</td><td>" + esc(item.entity_type || "—") + "</td></tr>";
        }).join("");
        return heading() +
            panel("Activity log", "Shared history across the workspace.", rows ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Area</th></tr></thead><tbody>' + rows + "</tbody></table></div>" : empty("No activity recorded."));
    }

    function renderTeam() {
        const rows = state.admins.map(function (item) {
            return "<tr><td><strong>" + esc(item.full_name || "Unnamed") + "</strong><br><span style="color:var(--text-muted);font-size:.58rem;">" + esc(item.email || item.user_id) + "</span></td><td>" + chip(item.role) + "</td><td>" + chip(item.active ? "active" : "inactive") + "</td><td>" + esc(date(item.created_at)) + "</td><td><div class="sway-row-actions">" +
                (state.currentAdmin.role === "owner" && item.user_id !== state.currentAdmin.user_id ? '<button class="sway-row-action" data-toggle-admin="' + esc(item.user_id) + '">' + (item.active ? "Deactivate" : "Activate") + "</button>" : "") +
                "</div></td></tr>";
        }).join("");

        const ownerNote = state.currentAdmin.role === "owner"
            ? '<button class="sway-workspace-button primary" data-add="team">+ Add team member</button>'
            : "";

        return heading(ownerNote) +
            panel("Team access", "Add a user's Supabase Auth UUID here after the account has been created in Supabase.", rows ? '<div class="sway-table-wrap"><table class="sway-table"><thead><tr><th>Member</th><th>Role</th><th>Status</th><th>Added</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>" : empty("No admin users configured."));
    }

    function renderView() {
        const main = document.getElementById("sway-workspace-main");
        if (!main) return;

        try {
            if (state.currentView === "overview") main.innerHTML = renderOverview();
            if (state.currentView === "tasks") main.innerHTML = renderTasks();
            if (state.currentView === "leads") main.innerHTML = renderLeads();
            if (state.currentView === "followups") main.innerHTML = renderFollowups();
            if (state.currentView === "clients") main.innerHTML = renderClients();
            if (state.currentView === "projects") main.innerHTML = renderProjects();
            if (state.currentView === "quotes") main.innerHTML = renderQuotes();
            if (state.currentView === "payments") main.innerHTML = renderPayments();
            if (state.currentView === "enquiries") main.innerHTML = renderEnquiries();
            if (state.currentView === "content") main.innerHTML = renderContent();
            if (state.currentView === "activity") main.innerHTML = renderActivity();
            if (state.currentView === "team") main.innerHTML = renderTeam();

            bindViewActions();
        } catch (error) {
            main.innerHTML = '<div class="sway-error">' + esc(error.message) + "</div>";
        }
    }

    function options(items, valueKey, labelFn, selected) {
        return items.map(function (item) {
            const value = item[valueKey];
            const label = labelFn(item);
            return '<option value="' + esc(value) + '"' + (String(value) === String(selected || "") ? " selected" : "") + ">' + esc(label) + "</option>";
        }).join("");
    }

    const configs = {
        tasks: {
            table: "tasks",
            title: "Task",
            fields: function (item) {
                return [
                    {key:"title",label:"Task title",type:"text",required:true,value:item.title},
                    {key:"description",label:"Description",type:"textarea",full:true,value:item.description},
                    {key:"assigned_to",label:"Assigned to",type:"select",options:options(state.admins,"user_id",function(x){return x.full_name || x.email || x.user_id;},item.assigned_to)},
                    {key:"priority",label:"Priority",type:"select",options:["low","medium","high","urgent"].map(function(x){return '<option value="' + x + '"' + (x === item.priority ? " selected" : "") + ">" + x + "</option>";}).join("")},
                    {key:"status",label:"Status",type:"select",options:["todo","in progress","review","completed"].map(function(x){return '<option value="' + x + '"' + (x === item.status ? " selected" : "") + ">" + x + "</option>";}).join("")},
                    {key:"due_date",label:"Due date",type:"date",value:dateInput(item.due_date)},
                    {key:"client_id",label:"Client",type:"select",options:'<option value="">No client</option>' + options(state.clients,"id",function(x){return x.business_name;},item.client_id)},
                    {key:"project_id",label:"Project",type:"select",options:'<option value="">No project</option>' + options(state.projects,"id",function(x){return x.name;},item.project_id)},
                    {key:"lead_id",label:"Lead",type:"select",options:'<option value="">No lead</option>' + options(state.leads,"id",function(x){return x.business_name;},item.lead_id)}
                ];
            }
        },
        leads: {
            table: "leads",
            title: "Lead",
            fields: function (item) {
                return [
                    {key:"business_name",label:"Business name",type:"text",required:true,value:item.business_name},
                    {key:"contact_name",label:"Contact person",type:"text",value:item.contact_name},
                    {key:"email",label:"Email",type:"email",value:item.email},
                    {key:"phone",label:"Phone / WhatsApp",type:"text",value:item.phone},
                    {key:"service_interest",label:"Service interest",type:"text",value:item.service_interest},
                    {key:"source",label:"Source",type:"select",options:["Email","WhatsApp","Phone","Facebook","Instagram","TikTok","Website","Referral","Other"].map(function(x){return '<option value="' + x + '"' + (x === item.source ? " selected" : "") + ">" + x + "</option>";}).join("")},
                    {key:"status",label:"Status",type:"select",options:["new","contacted","interested","proposal sent","negotiating","won","lost"].map(function(x){return '<option value="' + x + '"' + (x === item.status ? " selected" : "") + ">" + x + "</option>";}).join("")},
                    {key:"estimated_value",label:"Estimated value (ZAR)",type:"number",value:item.estimated_value},
                    {key:"assigned_to",label:"Assigned to",type:"select",options:options(state.admins,"user_id",function(x){return x.full_name || x.email || x.user_id;},item.assigned_to)},
                    {key:"next_follow_up",label:"Next follow-up",type:"date",value:dateInput(item.next_follow_up)},
                    {key:"notes",label:"Notes",type:"textarea",full:true,value:item.notes}
                ];
            }
        },
        followups: {
            table: "follow_ups",
            title: "Follow-up",
            fields: function(item){
                return [
                    {key:"lead_id",label:"Lead",type:"select",options:'<option value="">No lead</option>' + options(state.leads,"id",function(x){return x.business_name;},item.lead_id)},
                    {key:"client_id",label:"Client",type:"select",options:'<option value="">No client</option>' + options(state.clients,"id",function(x){return x.business_name;},item.client_id)},
                    {key:"assigned_to",label:"Assigned to",type:"select",options:options(state.admins,"user_id",function(x){return x.full_name || x.email || x.user_id;},item.assigned_to)},
                    {key:"scheduled_for",label:"Scheduled date",type:"date",value:dateInput(item.scheduled_for)},
                    {key:"channel",label:"Channel",type:"select",options:["WhatsApp","Phone","Email","Meeting","Other"].map(function(x){return '<option value="' + x + '"' + (x === item.channel ? " selected" : "") + ">" + x + "</option>";}).join("")},
                    {key:"status",label:"Status",type:"select",options:["pending","completed","skipped"].map(function(x){return '<option value="' + x + '"' + (x === item.status ? " selected" : "") + ">" + x + "</option>";}).join("")},
                    {key:"note",label:"Note",type:"textarea",full:true,value:item.note}
                ];
            }
        },
        clients: {
            table: "clients",
            title: "Client",
            fields: function(item){
                return [
                    {key:"business_name",label:"Business name",type:"text",required:true,value:item.business_name},
                    {key:"contact_name",label:"Contact person",type:"text",value:item.contact_name},
                    {key:"email",label:"Email",type:"email",value:item.email},
                    {key:"phone",label:"Phone / WhatsApp",type:"text",value:item.phone},
                    {key:"status",label:"Status",type:"select",options:["active","archived"].map(function(x){return '<option value="' + x + '"' + (x === item.status ? " selected" : "") + ">" + x + "</option>";}).join("")},
                    {key:"assigned_to",label:"Account owner",type:"select",options:options(state.admins,"user_id",function(x){return x.full_name || x.email || x.user_id;},item.assigned_to)},
                    {key:"notes",label:"Internal notes",type:"textarea",full:true,value:item.notes}
                ];
            }
        },
        projects: {
            table: "client_projects",
            title: "Project",
            fields: function(item){
                return [
                    {key:"name",label:"Project name",type:"text",required:true,value:item.name},
                    {key:"client_id",label:"Client",type:"select",options:options(state.clients,"id",function(x){return x.business_name;},item.client_id)},
                    {key:"service",label:"Service",type:"text",value:item.service},
                    {key:"status",label:"Status",type:"select",options:["planning","in progress","review","completed","paused","cancelled"].map(function(x){return '<option value="' + x + '"' + (x === item.status ? " selected" : "") + ">" + x + "</option>";}).join("")},
                    {key:"value",label:"Project value (ZAR)",type:"number",value:item.value},
                    {key:"due_date",label:"Due date",type:"date",value:dateInput(item.due_date)},
                    {key:"assigned_to",label:"Assigned to",type:"select",options:options(state.admins,"user_id",function(x){return x.full_name || x.email || x.user_id;},item.assigned_to)},
                    {key:"payment_status",label:"Payment status",type:"select",options:["not invoiced","invoice sent","partially paid","paid","overdue"].map(function(x){return '<option value="' + x + '"' + (x === item.payment_status ? " selected" : "") + ">" + x + "</option>";}).join("")},
                    {key:"description",label:"Description",type:"textarea",full:true,value:item.description}
                ];
            }
        },
        quotes: {
            table: "quotes",
            title: "Quote",
            fields: function(item){
                return [
                    {key:"quote_number",label:"Quote number",type:"text",value:item.quote_number},
                    {key:"title",label:"Title",type:"text",required:true,value:item.title},
                    {key:"lead_id",label:"Lead",type:"select",options:'<option value="">No lead</option>' + options(state.leads,"id",function(x){return x.business_name;},item.lead_id)},
                    {key:"client_id",label:"Client",type:"select",options:'<option value="">No client</option>' + options(state.clients,"id",function(x){return x.business_name;},item.client_id)},
                    {key:"amount",label:"Amount (ZAR)",type:"number",required:true,value:item.amount},
                    {key:"status",label:"Status",type:"select",options:["draft","sent","accepted","rejected","expired"].map(function(x){return '<option value="' + x + '"' + (x === item.status ? " selected" : "") + ">" + x + "</option>";}).join("")},
                    {key:"valid_until",label:"Valid until",type:"date",value:dateInput(item.valid_until)},
                    {key:"notes",label:"Notes",type:"textarea",full:true,value:item.notes}
                ];
            }
        },
        payments: {
            table: "payments",
            title: "Payment",
            fields: function(item){
                return [
                    {key:"client_id",label:"Client",type:"select",options:options(state.clients,"id",function(x){return x.business_name;},item.client_id)},
                    {key:"project_id",label:"Project",type:"select",options:'<option value="">No project</option>' + options(state.projects,"id",function(x){return x.name;},item.project_id)},
                    {key:"amount",label:"Amount (ZAR)",type:"number",required:true,value:item.amount},
                    {key:"status",label:"Status",type:"select",options:["due","partially paid","paid","overdue"].map(function(x){return '<option value="' + x + '"' + (x === item.status ? " selected" : "") + ">" + x + "</option>";}).join("")},
                    {key:"method",label:"Method",type:"select",options:["EFT","Cash","Card","PayFast","Other"].map(function(x){return '<option value="' + x + '"' + (x === item.method ? " selected" : "") + ">" + x + "</option>";}).join("")},
                    {key:"reference",label:"Reference",type:"text",value:item.reference},
                    {key:"due_date",label:"Due date",type:"date",value:dateInput(item.due_date)},
                    {key:"paid_at",label:"Paid at",type:"date",value:dateInput(item.paid_at)},
                    {key:"notes",label:"Notes",type:"textarea",full:true,value:item.notes}
                ];
            }
        },
        announcements: {
            table: "site_announcements",
            title: "Announcement",
            fields: function(item){
                return [
                    {key:"title",label:"Title",type:"text",required:true,value:item.title},
                    {key:"message",label:"Message",type:"textarea",full:true,value:item.message},
                    {key:"published",label:"Published",type:"select",options:'<option value="true"' + (item.published ? " selected" : "") + '>Yes</option><option value="false"' + (!item.published ? " selected" : "") + '>Draft</option>'}
                ];
            }
        },
        team: {
            table: "admin_users",
            title: "Team member",
            fields: function(item){
                return [
                    {key:"user_id",label:"Supabase Auth user UUID",type:"text",required:true,value:item.user_id,help:"Create the user first in Supabase Authentication, then paste the user's UUID here."},
                    {key:"full_name",label:"Full name",type:"text",required:true,value:item.full_name},
                    {key:"email",label:"Email",type:"email",value:item.email},
                    {key:"role",label:"Role",type:"select",options:'<option value="team_member"' + (item.role === "team_member" ? " selected" : "") + '>Team member</option><option value="owner"' + (item.role === "owner" ? " selected" : "") + '>Owner</option>'},
                    {key:"active",label:"Active",type:"select",options:'<option value="true"' + (item.active !== false ? " selected" : "") + '>Active</option><option value="false"' + (item.active === false ? " selected" : "") + '>Inactive</option>'}
                ];
            }
        }
    };

    function showModal(title, fields, initial, onSubmit) {
        const modal = document.createElement("div");
        modal.className = "sway-modal";
        modal.innerHTML =
            '<div class="sway-modal-backdrop"></div>' +
            '<div class="sway-modal-card" role="dialog" aria-modal="true">' +
                '<div class="sway-modal-header"><div><span class="admin-label">Swayphics workspace</span><h3>' + esc(title) + '</h3></div><button class="sway-modal-close" type="button" aria-label="Close">×</button></div>' +
                '<form class="sway-form-grid" id="sway-dynamic-form"></form>' +
            "</div>";

        document.body.appendChild(modal);

        const form = modal.querySelector("#sway-dynamic-form");
        form.innerHTML = fields.map(function(field){
            let control = "";
            const value = field.value == null ? "" : field.value;
            if (field.type === "textarea") {
                control = '<textarea id="sway-field-' + esc(field.key) + '" rows="4">' + esc(value) + "</textarea>";
            } else if (field.type === "select") {
                control = '<select id="sway-field-' + esc(field.key) + '">' + field.options + "</select>";
            } else {
                control = '<input id="sway-field-' + esc(field.key) + '" type="' + esc(field.type || "text") + '" value="' + esc(value) + '"' + (field.required ? " required" : "") + ">";
            }

            return '<div class="sway-form-field ' + (field.full ? "full" : "") + '">' +
                '<label for="sway-field-' + esc(field.key) + '">' + esc(field.label) + "</label>" +
                control +
                (field.help ? "<small>" + esc(field.help) + "</small>" : "") +
            "</div>";
        }).join("") +
        '<div class="sway-form-field full"><div class="sway-modal-actions"><button type="button" class="sway-workspace-button" data-close>Cancel</button><button type="submit" class="sway-workspace-button primary">Save</button></div></div>';

        function close() {
            modal.remove();
        }

        modal.querySelector("[data-close]").addEventListener("click", close);
        modal.querySelector(".sway-modal-close").addEventListener("click", close);
        modal.querySelector(".sway-modal-backdrop").addEventListener("click", close);

        form.addEventListener("submit", async function(event){
            event.preventDefault();

            const payload = {};
            fields.forEach(function(field){
                const el = form.querySelector("#sway-field-" + CSS.escape(field.key));
                if (!el) return;
                let value = el.value;
                if (field.type === "number") value = value === "" ? null : Number(value);
                if (field.type === "select" && ["published","active"].includes(field.key)) value = value === "true";
                if (["assigned_to","client_id","project_id","lead_id"].includes(field.key) && value === "") value = null;
                payload[field.key] = value;
            });

            const submit = form.querySelector('button[type="submit"]');
            submit.disabled = true;
            submit.textContent = "Saving...";

            try {
                await onSubmit(payload);
                close();
                await refreshData();
                renderShell();
                renderView();
            } catch (error) {
                alert(error.message || "Unable to save record.");
                submit.disabled = false;
                submit.textContent = "Save";
            }
        });
    }

    async function createOrEdit(type, id) {
        if (!configs[type]) return;
        const config = configs[type];
        const list = state[type === "projects" ? "projects" : type];
        const item = id ? list.find(function(x){ return x.id === id || x.user_id === id; }) || {} : {};
        const fields = config.fields(item);

        showModal((id ? "Edit " : "New ") + config.title, fields, item, async function(payload){
            if (type === "team" && state.currentAdmin.role !== "owner") {
                throw new Error("Only the owner can manage team access.");
            }

            if (type === "team" && id) {
                await api("/rest/v1/admin_users?user_id=eq." + encodeURIComponent(id), {
                    method: "PATCH",
                    headers: headers({"Prefer":"return=minimal"}),
                    body: JSON.stringify(payload)
                });
            } else {
                const endpoint = "/rest/v1/" + config.table + (id ? "?id=eq." + encodeURIComponent(id) : "");
                await api(endpoint, {
                    method: id ? "PATCH" : "POST",
                    headers: headers({"Prefer":"return=representation"}),
                    body: JSON.stringify(payload)
                });
            }

            await logActivity((id ? "Updated " : "Created ") + config.title.toLowerCase(), config.table, id || null);
        });
    }

    async function removeRecord(type, id) {
        const config = configs[type];
        if (!config) return;
        if (!confirm("Delete this " + config.title.toLowerCase() + "?")) return;

        await api("/rest/v1/" + config.table + "?id=eq." + encodeURIComponent(id), {
            method: "DELETE",
            headers: headers({"Prefer":"return=minimal"})
        });

        await logActivity("Deleted " + config.title.toLowerCase(), config.table, id);
        await refreshData();
        renderShell();
        renderView();
    }

    async function completeTask(id) {
        await api("/rest/v1/tasks?id=eq." + encodeURIComponent(id), {
            method: "PATCH",
            headers: headers({"Prefer":"return=minimal"}),
            body: JSON.stringify({
                status: "completed",
                completed_at: new Date().toISOString()
            })
        });
        await logActivity("Completed task", "tasks", id);
        await refreshData();
        renderShell();
        renderView();
    }

    async function completeFollowup(id) {
        await api("/rest/v1/follow_ups?id=eq." + encodeURIComponent(id), {
            method: "PATCH",
            headers: headers({"Prefer":"return=minimal"}),
            body: JSON.stringify({
                status: "completed",
                completed_at: new Date().toISOString()
            })
        });
        await logActivity("Completed follow-up", "follow_ups", id);
        await refreshData();
        renderShell();
        renderView();
    }

    async function convertLead(id) {
        const lead = state.leads.find(function(item){ return item.id === id; });
        if (!lead) return;

        if (!confirm("Convert " + lead.business_name + " into a client?")) return;

        const existing = state.clients.find(function(item){
            return item.email && lead.email && item.email.toLowerCase() === lead.email.toLowerCase();
        });

        if (!existing) {
            await api("/rest/v1/clients", {
                method: "POST",
                headers: headers({"Prefer":"return=representation"}),
                body: JSON.stringify({
                    business_name: lead.business_name,
                    contact_name: lead.contact_name,
                    email: lead.email,
                    phone: lead.phone,
                    assigned_to: lead.assigned_to || state.currentAdmin.user_id,
                    status: "active",
                    notes: lead.notes
                })
            });
        }

        await api("/rest/v1/leads?id=eq." + encodeURIComponent(id), {
            method: "PATCH",
            headers: headers({"Prefer":"return=minimal"}),
            body: JSON.stringify({status:"won"})
        });

        await logActivity("Converted lead to client", "leads", id);
        await refreshData();
        renderShell();
        renderView();
    }

    async function updateEnquiryStatus(id, status) {
        await api("/rest/v1/website_enquiries?id=eq." + encodeURIComponent(id), {
            method: "PATCH",
            headers: headers({"Prefer":"return=minimal"}),
            body: JSON.stringify({status:status})
        });
        await logActivity("Updated website enquiry to " + status, "website_enquiries", id);
        await refreshData();
        renderShell();
        renderView();
    }

    async function toggleAdmin(id) {
        if (state.currentAdmin.role !== "owner") return;
        const member = state.admins.find(function(item){return item.user_id === id;});
        if (!member) return;
        await api("/rest/v1/admin_users?user_id=eq." + encodeURIComponent(id), {
            method: "PATCH",
            headers: headers({"Prefer":"return=minimal"}),
            body: JSON.stringify({active:!member.active})
        });
        await logActivity((member.active ? "Deactivated " : "Activated ") + "team member", "admin_users", id);
        await refreshData();
        renderShell();
        renderView();
    }

    async function logActivity(action, entityType, entityId) {
        try {
            await api("/rest/v1/activity_log", {
                method: "POST",
                headers: headers({"Prefer":"return=minimal"}),
                body: JSON.stringify({
                    actor_id: state.currentUser.id,
                    action: action,
                    entity_type: entityType,
                    entity_id: entityId || null
                })
            });
        } catch (error) {
            console.warn("Activity log write failed:", error);
        }
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
        state.currentAdmin = state.admins.find(function(item){return item.user_id === state.currentUser.id && item.active;}) || state.currentAdmin;
    }

    function bindViewActions() {
        workspace.querySelectorAll("[data-add]").forEach(function(button){
            button.addEventListener("click", function(){
                createOrEdit(button.dataset.add, null);
            });
        });

        workspace.querySelectorAll("[data-edit]").forEach(function(button){
            button.addEventListener("click", function(){
                createOrEdit(button.dataset.edit, button.dataset.id);
            });
        });

        workspace.querySelectorAll("[data-delete]").forEach(function(button){
            button.addEventListener("click", function(){
                removeRecord(button.dataset.delete, button.dataset.id);
            });
        });

        workspace.querySelectorAll("[data-complete-task]").forEach(function(button){
            button.addEventListener("click", function(){ completeTask(button.dataset.completeTask); });
        });

        workspace.querySelectorAll("[data-complete-followup]").forEach(function(button){
            button.addEventListener("click", function(){ completeFollowup(button.dataset.completeFollowup); });
        });

        workspace.querySelectorAll("[data-convert-lead]").forEach(function(button){
            button.addEventListener("click", function(){ convertLead(button.dataset.convertLead); });
        });

        workspace.querySelectorAll("[data-enquiry-status]").forEach(function(button){
            button.addEventListener("click", function(){ updateEnquiryStatus(button.dataset.enquiryStatus, button.dataset.statusNext); });
        });

        workspace.querySelectorAll("[data-toggle-admin]").forEach(function(button){
            button.addEventListener("click", function(){ toggleAdmin(button.dataset.toggleAdmin); });
        });

        workspace.querySelectorAll("[data-quick]").forEach(function(button){
            button.addEventListener("click", function(){
                const type = button.dataset.quick;
                if (type === "task") createOrEdit("tasks", null);
                if (type === "lead") createOrEdit("leads", null);
                if (type === "client") createOrEdit("clients", null);
                if (type === "project") createOrEdit("projects", null);
                if (type === "followup") createOrEdit("followups", null);
            });
        });

        workspace.querySelectorAll("[data-view-target]").forEach(function(button){
            button.addEventListener("click", function(){
                state.currentView = button.dataset.viewTarget;
                renderShell();
                renderView();
            });
        });
    }

    async function boot() {
        workspace.innerHTML = '<div class="sway-loading">Loading the Swayphics workspace...</div>';

        try {
            await loadState();
            renderShell();
            renderView();
        } catch (error) {
            workspace.innerHTML =
                '<div class="sway-error">' +
                esc(error.message) +
                '<br><br><strong>Setup required:</strong> run the Swayphics admin dashboard SQL schema once in Supabase, then reload this page.' +
                "</div>";
            console.error("Swayphics workspace failed to load:", error);
        }
    }

    boot();
})();
