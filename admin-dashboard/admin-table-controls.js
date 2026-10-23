(function (window) {
    "use strict";

    window.createSwayphicsAdminTableControls = function (context) {
        const state = context.state;
        const workspace = context.workspace;
        const esc = context.esc;
        const adminName = context.adminName;
        const clientName = context.clientName;
        const leadName = context.leadName;
        const formatDisplayText = context.formatDisplayText;
        const completeTask = context.completeTask;
        const completeFollowup = context.completeFollowup;
        const renderView = context.renderView;
        const swayAlert = context.swayAlert;
        const swayConfirm = context.swayConfirm;

        function sortOptions(view) {
            const options = {
                leads: [
                    ["followup_asc", "Next follow-up (soonest first)"],
                    ["value_desc", "Estimated value (high to low)"],
                    ["business_asc", "Business name (A–Z)"],
                    ["created_desc", "Newest added"]
                ],
                tasks: [
                    ["due_asc", "Due date (soonest first)"],
                    ["priority_desc", "Priority (highest first)"],
                    ["title_asc", "Task title (A–Z)"],
                    ["created_desc", "Newest added"]
                ],
                followups: [
                    ["scheduled_asc", "Scheduled date (soonest first)"],
                    ["contact_asc", "Contact (A–Z)"],
                    ["status_asc", "Status (A–Z)"]
                ]
            };
            return options[view] || [];
        }

        function settings(view) {
            if (!state.tableControls[view]) {
                state.tableControls[view] = {
                    search: "",
                    filter: "all",
                    sort: (sortOptions(view)[0] || ["", ""])[0]
                };
            }
            if (!Array.isArray(state.tableSelection[view])) state.tableSelection[view] = [];
            if (typeof state.tableFeedback[view] !== "string") state.tableFeedback[view] = "";
            return state.tableControls[view];
        }

        function searchText(view, item) {
            let fields = [];
            if (view === "leads") {
                fields = [item.business_name, item.contact_name, item.service_interest, item.status,
                    item.source, item.email, item.phone, item.estimated_value, item.next_follow_up];
            } else if (view === "tasks") {
                fields = [item.title, item.description, item.status, item.priority,
                    adminName(item.assigned_to), clientName(item.client_id), item.due_date];
            } else if (view === "followups") {
                fields = [item.lead_id ? leadName(item.lead_id) : clientName(item.client_id),
                    item.channel, item.status, adminName(item.assigned_to), item.scheduled_for, item.note];
            }
            return fields.filter(function (value) {
                return value !== null && typeof value !== "undefined";
            }).join(" ").toLowerCase();
        }

        function items(view, sourceItems) {
            const controls = settings(view);
            const filterValue = String(controls.filter || "all").toLowerCase();
            const result = (sourceItems || []).filter(function (item) {
                return filterValue === "all" ||
                    String(item.status || "").toLowerCase() === filterValue;
            }).slice();

            function dateValue(value) {
                if (!value) return Number.POSITIVE_INFINITY;
                const parsed = Date.parse(value);
                return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
            }
            function textCompare(a, b) {
                return String(a || "").localeCompare(String(b || ""), undefined, {
                    sensitivity: "base", numeric: true
                });
            }
            function dateCompare(a, b) {
                const left = dateValue(a), right = dateValue(b);
                return left === right ? 0 : left < right ? -1 : 1;
            }
            const priority = { urgent: 4, high: 3, normal: 2, medium: 2, low: 1 };
            result.sort(function (a, b) {
                switch (controls.sort) {
                    case "followup_asc":
                        return dateCompare(a.next_follow_up, b.next_follow_up) ||
                            textCompare(a.business_name, b.business_name);
                    case "value_desc":
                        return (Number(b.estimated_value) || 0) - (Number(a.estimated_value) || 0);
                    case "business_asc":
                        return textCompare(a.business_name, b.business_name);
                    case "due_asc":
                        return dateCompare(a.due_date, b.due_date) || textCompare(a.title, b.title);
                    case "priority_desc":
                        return (priority[String(b.priority || "").toLowerCase()] || 0) -
                            (priority[String(a.priority || "").toLowerCase()] || 0) ||
                            dateCompare(a.due_date, b.due_date);
                    case "title_asc":
                        return textCompare(a.title, b.title);
                    case "scheduled_asc":
                        return dateCompare(a.scheduled_for, b.scheduled_for) ||
                            textCompare(a.lead_id ? leadName(a.lead_id) : clientName(a.client_id),
                                b.lead_id ? leadName(b.lead_id) : clientName(b.client_id));
                    case "contact_asc":
                        return textCompare(a.lead_id ? leadName(a.lead_id) : clientName(a.client_id),
                            b.lead_id ? leadName(b.lead_id) : clientName(b.client_id));
                    case "status_asc":
                        return textCompare(a.status, b.status) || dateCompare(a.scheduled_for, b.scheduled_for);
                    case "created_desc":
                        return (Date.parse(b.created_at || "") || 0) - (Date.parse(a.created_at || "") || 0);
                    default:
                        return 0;
                }
            });
            return result;
        }

        function selectedItems(view) {
            const ids = new Set((state.tableSelection[view] || []).map(String));
            return (state[view] || []).filter(function (item) { return ids.has(String(item.id)); });
        }

        function selectionCell(view, item, label) {
            const checked = (state.tableSelection[view] || []).some(function (id) {
                return String(id) === String(item.id);
            });
            return '<td class="sway-admin-table-select-cell"><input type="checkbox" data-admin-table-select="' +
                esc(view) + '" data-id="' + esc(item.id) + '" aria-label="Select ' + esc(label || "record") + '"' +
                (checked ? " checked" : "") + "></td>";
        }

        function renderControls(view) {
            const controls = settings(view);
            const records = Array.isArray(state[view]) ? state[view] : [];
            const statuses = Array.from(new Set(records.map(function (item) {
                return String(item.status || "").trim().toLowerCase();
            }).filter(Boolean)));
            const currentFilter = String(controls.filter || "all").trim().toLowerCase();
            // Keep a selected status available even when a refresh leaves no rows in that status.
            if (currentFilter !== "all" && !statuses.includes(currentFilter)) {
                statuses.push(currentFilter);
            }
            statuses.sort();
            const filterOptions = ['<option value="all"' +
                (controls.filter === "all" ? " selected" : "") + '>All statuses</option>']
                .concat(statuses.map(function (status) {
                    return '<option value="' + esc(status) + '"' +
                        (controls.filter === status ? " selected" : "") + ">" +
                        esc(formatDisplayText(status)) + "</option>";
                })).join("");
            const sortHtml = sortOptions(view).map(function (option) {
                return '<option value="' + esc(option[0]) + '"' +
                    (controls.sort === option[0] ? " selected" : "") + ">" +
                    esc(option[1]) + "</option>";
            }).join("");
            const bulk = view === "leads"
                ? '<button type="button" class="sway-admin-table-bulk-button" data-admin-table-bulk-action="export">Export selected CSV</button>'
                : '<button type="button" class="sway-admin-table-bulk-button" data-admin-table-bulk-action="complete">Complete selected</button>';
            const placeholder = view === "leads" ? "Business, contact, service or email" :
                view === "tasks" ? "Task, client, assignee or description" : "Contact, channel or assignee";
            return '<div class="sway-admin-table-tools" data-admin-table-tools="' + esc(view) + '">' +
                '<div class="sway-admin-table-control-grid">' +
                    '<label class="sway-admin-table-search-label"><span>Search</span>' +
                        '<input type="search" data-admin-table-search-input="' + esc(view) +
                        '" value="' + esc(controls.search) + '" placeholder="' + placeholder +
                        '" aria-label="Search ' + esc(view) + '">' +
                    '</label>' +
                    '<label class="sway-admin-table-field"><span>Status</span>' +
                        '<select data-admin-table-filter="' + esc(view) + '" aria-label="Filter ' + esc(view) + ' by status">' +
                            filterOptions + '</select></label>' +
                    '<label class="sway-admin-table-field"><span>Sort by</span>' +
                        '<select data-admin-table-sort="' + esc(view) + '" aria-label="Sort ' + esc(view) + '">' +
                            sortHtml + '</select></label>' +
                    '<div class="sway-admin-table-count" data-admin-table-count="' + esc(view) + '" aria-live="polite"></div>' +
                '</div>' +
                '<div class="sway-admin-table-bulk-toolbar" data-admin-table-bulk-toolbar="' + esc(view) + '" hidden>' +
                    '<span class="sway-admin-table-selected-count" data-admin-table-selected-count="' + esc(view) + '">0 selected</span>' +
                    bulk +
                    '<button type="button" class="sway-admin-table-clear-selection" data-admin-table-clear-selection="' + esc(view) + '">Clear selection</button>' +
                '</div>' +
                '<p class="sway-admin-table-feedback" data-admin-table-feedback="' + esc(view) +
                '" role="status" aria-live="polite"' + (state.tableFeedback[view] ? "" : " hidden") + ">" +
                    esc(state.tableFeedback[view] || "") + "</p>" +
            "</div>";
        }

        function syncSelection(view) {
            const selected = selectedItems(view);
            const toolbar = workspace.querySelector('[data-admin-table-bulk-toolbar="' + view + '"]');
            const count = workspace.querySelector('[data-admin-table-selected-count="' + view + '"]');
            if (toolbar) toolbar.hidden = selected.length === 0;
            if (count) count.textContent = selected.length + " selected";
            workspace.querySelectorAll("[data-admin-table-bulk-action], [data-admin-table-clear-selection]")
                .forEach(function (button) { button.disabled = state.tableBulkActionRunning; });
        }

        function applySearch(view) {
            const query = String(settings(view).search || "").trim().toLowerCase();
            const rows = Array.from(workspace.querySelectorAll('[data-admin-table-row="' + view + '"]'));
            const selectedIds = new Set((state.tableSelection[view] || []).map(String));
            let visible = 0;
            rows.forEach(function (row) {
                const rowCheckbox = row.querySelector('[data-admin-table-select="' + view + '"]');
                if (rowCheckbox) {
                    rowCheckbox.checked = selectedIds.has(String(rowCheckbox.getAttribute("data-id") || ""));
                }
                row.hidden = !!query && !String(row.getAttribute("data-admin-table-search") || "").includes(query);
                if (!row.hidden) visible += 1;
            });
            const count = workspace.querySelector('[data-admin-table-count="' + view + '"]');
            if (count) count.textContent = "Showing " + visible + " of " + rows.length + " records";
            const noResults = workspace.querySelector('[data-admin-table-no-results="' + view + '"]');
            if (noResults) noResults.hidden = visible > 0;
            const master = workspace.querySelector('[data-admin-table-select-all="' + view + '"]');
            const checkboxes = rows.filter(function (row) { return !row.hidden; }).map(function (row) {
                return row.querySelector('[data-admin-table-select="' + view + '"]');
            }).filter(Boolean);
            if (master) {
                const checked = checkboxes.filter(function (box) { return box.checked; }).length;
                master.checked = checkboxes.length > 0 && checked === checkboxes.length;
                master.indeterminate = checked > 0 && checked < checkboxes.length;
                master.disabled = checkboxes.length === 0;
            }
            syncSelection(view);
        }

        function exportSelection(view) {
            const selected = selectedItems(view);
            if (!selected.length) return;
            let headings, rows;
            if (view === "leads") {
                headings = ["Business", "Contact", "Email", "Service", "Status", "Source", "Estimated value", "Next follow-up"];
                rows = selected.map(function (item) {
                    return [item.business_name, item.contact_name, item.email, item.service_interest,
                        item.status, item.source, item.estimated_value, item.next_follow_up];
                });
            } else if (view === "tasks") {
                headings = ["Task", "Description", "Assigned to", "Client", "Priority", "Due date", "Status"];
                rows = selected.map(function (item) {
                    return [item.title, item.description, adminName(item.assigned_to), clientName(item.client_id),
                        item.priority, item.due_date, item.status];
                });
            } else {
                headings = ["Contact", "Channel", "Scheduled for", "Assigned to", "Status", "Notes"];
                rows = selected.map(function (item) {
                    return [item.lead_id ? leadName(item.lead_id) : clientName(item.client_id), item.channel,
                        item.scheduled_for, adminName(item.assigned_to), item.status, item.note];
                });
            }
            function cell(value) {
                const raw = String(value === null || typeof value === "undefined" ? "" : value);
                // Quoting alone does not stop spreadsheet formula execution in CSV exports.
                const formulaLike = /^[\s\uFEFF]*[=+\-@]/.test(raw);
                const startsWithControl = /^[\t\r\n]/.test(raw);
                const safe = formulaLike || startsWithControl ? "'" + raw : raw;
                return '"' + safe.replace(/"/g, '""') + '"';
            }
            const csv = [headings].concat(rows).map(function (row) {
                return row.map(cell).join(",");
            }).join("\r\n");
            const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" }));
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = "swayphics-selected-" + view + ".csv";
            anchor.style.display = "none";
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            state.tableFeedback[view] = "Exported " + selected.length + " selected records to CSV.";
            const feedback = workspace.querySelector('[data-admin-table-feedback="' + view + '"]');
            if (feedback) {
                feedback.textContent = state.tableFeedback[view];
                feedback.hidden = false;
            }
        }

        function announceFeedback(view, message) {
            state.tableFeedback[view] = String(message || "");
            const feedback = workspace.querySelector('[data-admin-table-feedback="' + view + '"]');
            if (!feedback) return;
            feedback.textContent = state.tableFeedback[view];
            feedback.hidden = !state.tableFeedback[view];
        }

        async function bulkAction(view, action) {
            if (state.tableBulkActionRunning) return;
            if (action === "export") {
                exportSelection(view);
                return;
            }
            if (action !== "complete") return;
            const selected = selectedItems(view);
            const eligible = selected.filter(function (item) {
                const status = String(item.status || "").toLowerCase();
                return view === "tasks" ? status !== "completed" : status === "pending";
            });
            if (!eligible.length) {
                swayAlert(view === "tasks"
                    ? "Select at least one task that is not already completed."
                    : "Select at least one pending follow-up to complete.");
                return;
            }
            const noun = view === "tasks" ? "task" : "follow-up";
            const note = view === "followups"
                ? " Lead-linked follow-ups will also update the lead's contact status and next follow-up, matching the existing Complete action."
                : "";
            if (!(await swayConfirm("Mark " + eligible.length + " selected " + noun +
                (eligible.length === 1 ? "" : "s") + " as completed?" + note))) return;

            state.tableBulkActionRunning = true;
            syncSelection(view);
            announceFeedback(view, "Completing " + eligible.length + " selected " + noun +
                (eligible.length === 1 ? "" : "s") + "…");
            let completed = 0;
            try {
                for (const item of eligible) {
                    if (view === "tasks") await completeTask(item.id);
                    else await completeFollowup(item.id);
                    completed += 1;
                    state.tableSelection[view] = (state.tableSelection[view] || []).filter(function (id) {
                        return String(id) !== String(item.id);
                    });
                }
                state.tableSelection[view] = (state.tableSelection[view] || []).filter(function (id) {
                    return !eligible.some(function (item) { return String(item.id) === String(id); });
                });
                announceFeedback(view, "Completed " + completed + " selected " + noun +
                    (completed === 1 ? "" : "s") + ".");
            } catch (error) {
                // Keep raw provider/database error details out of the dashboard UI.
                // The selected records remain available for a safe retry after refresh.
                announceFeedback(view, "Completed " + completed + " of " + eligible.length +
                    " selected " + noun + (eligible.length === 1 ? "" : "s") +
                    ". The next update failed. Remaining records stay selected; review the affected records and try again.");
            } finally {
                state.tableBulkActionRunning = false;
                renderView();
            }
        }

        function bind() {
            workspace.querySelectorAll("[data-admin-table-search-input]").forEach(function (input) {
                input.addEventListener("input", function () {
                    const view = input.getAttribute("data-admin-table-search-input");
                    settings(view).search = input.value;
                    applySearch(view);
                });
            });
            workspace.querySelectorAll("[data-admin-table-filter]").forEach(function (select) {
                select.addEventListener("change", function () {
                    const view = select.getAttribute("data-admin-table-filter");
                    settings(view).filter = select.value;
                    renderView();
                    const replacement = workspace.querySelector('[data-admin-table-filter="' + view + '"]');
                    if (replacement) replacement.focus();
                });
            });
            workspace.querySelectorAll("[data-admin-table-sort]").forEach(function (select) {
                select.addEventListener("change", function () {
                    const view = select.getAttribute("data-admin-table-sort");
                    settings(view).sort = select.value;
                    renderView();
                    const replacement = workspace.querySelector('[data-admin-table-sort="' + view + '"]');
                    if (replacement) replacement.focus();
                });
            });
            workspace.querySelectorAll("[data-admin-table-select]").forEach(function (checkbox) {
                checkbox.addEventListener("change", function () {
                    const view = checkbox.getAttribute("data-admin-table-select");
                    const id = String(checkbox.getAttribute("data-id") || "");
                    const ids = new Set((state.tableSelection[view] || []).map(String));
                    if (checkbox.checked) ids.add(id);
                    else ids.delete(id);
                    state.tableSelection[view] = Array.from(ids);
                    applySearch(view);
                });
            });
            workspace.querySelectorAll("[data-admin-table-select-all]").forEach(function (checkbox) {
                checkbox.addEventListener("change", function () {
                    const view = checkbox.getAttribute("data-admin-table-select-all");
                    const ids = new Set((state.tableSelection[view] || []).map(String));
                    Array.from(workspace.querySelectorAll('[data-admin-table-row="' + view + '"]'))
                        .filter(function (row) { return !row.hidden; })
                        .forEach(function (row) {
                            const select = row.querySelector('[data-admin-table-select="' + view + '"]');
                            if (!select) return;
                            const id = String(select.getAttribute("data-id") || "");
                            if (checkbox.checked) ids.add(id);
                            else ids.delete(id);
                            select.checked = checkbox.checked;
                        });
                    state.tableSelection[view] = Array.from(ids);
                    applySearch(view);
                });
            });
            workspace.querySelectorAll("[data-admin-table-clear-selection]").forEach(function (button) {
                button.addEventListener("click", function () {
                    state.tableSelection[button.getAttribute("data-admin-table-clear-selection")] = [];
                    applySearch(button.getAttribute("data-admin-table-clear-selection"));
                });
            });
            workspace.querySelectorAll("[data-admin-table-bulk-action]").forEach(function (button) {
                button.addEventListener("click", function () {
                    const root = button.closest("[data-admin-table-tools]");
                    if (root) bulkAction(root.getAttribute("data-admin-table-tools"),
                        button.getAttribute("data-admin-table-bulk-action"));
                });
            });
            ["leads", "tasks", "followups"].forEach(function (view) {
                if (workspace.querySelector('[data-admin-table-tools="' + view + '"]')) applySearch(view);
            });
        }

        return {
            items: items,
            searchText: searchText,
            selectionCell: selectionCell,
            renderControls: renderControls,
            bind: bind
        };
    };
})(window);
