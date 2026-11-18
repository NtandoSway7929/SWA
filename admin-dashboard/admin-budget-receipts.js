(function () {
    "use strict";

    if (window.__swayBudgetReceiptsBooted) return;
    window.__swayBudgetReceiptsBooted = true;

    var SUPABASE_URL = "https://sqifhribgsqfaxgtobsa.supabase.co";
    var SUPABASE_KEY = "sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QhB";
    var BUCKET = "swayphics-budget-receipts";
    var MAX_BYTES = 10 * 1024 * 1024;
    var ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    var currentSection = null;
    var isLoading = false;

    function escapeHtml(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
            return {
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;"
            }[character];
        });
    }

    function token() {
        return localStorage.getItem("swayphics_admin_access_token") || "";
    }

    function headers(extra) {
        return Object.assign({
            "apikey": SUPABASE_KEY,
            "Authorization": "Bearer " + token()
        }, extra || {});
    }

    async function request(path, options) {
        var response = await fetch(SUPABASE_URL + path, Object.assign({
            method: "GET",
            headers: headers({ "Accept": "application/json" })
        }, options || {}));
        var body = await response.text();
        var parsed = null;
        if (body) {
            try { parsed = JSON.parse(body); } catch (error) { parsed = body; }
        }
        if (!response.ok) {
            var message = parsed && typeof parsed === "object"
                ? parsed.message || parsed.error || parsed.details
                : parsed;
            throw new Error("Supabase returned " + response.status + ": " + String(message || "Request failed"));
        }
        return parsed;
    }

    function formatMoney(value) {
        return new Intl.NumberFormat("en-ZA", {
            style: "currency",
            currency: "ZAR",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(Number(value || 0));
    }

    function formatDate(value) {
        if (!value) return "Date not recorded";
        var dateValue = new Date(String(value).slice(0, 10) + "T12:00:00+02:00");
        if (Number.isNaN(dateValue.getTime())) return String(value);
        return new Intl.DateTimeFormat("en-ZA", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            timeZone: "Africa/Johannesburg"
        }).format(dateValue);
    }

    function fileSize(value) {
        var bytes = Number(value || 0);
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
        return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    }

    function renderStyles() {
        if (document.getElementById("sway-budget-receipts-styles")) return;
        var style = document.createElement("style");
        style.id = "sway-budget-receipts-styles";
        style.textContent = `
            #sway-budget-receipts-panel .sway-budget-receipts-toolbar {
                display: flex; align-items: center; justify-content: space-between;
                gap: 14px; margin-bottom: 16px; flex-wrap: wrap;
            }
            #sway-budget-receipts-panel .sway-budget-receipts-search {
                width: min(340px, 100%); min-height: 42px; padding: 10px 13px;
                border: 1px solid var(--sway-border, rgba(0,32,150,.12));
                border-radius: 11px; background: var(--sway-surface, #fff);
                color: inherit; font: inherit; font-size: 12px;
            }
            #sway-budget-receipts-panel .sway-budget-receipt-list {
                display: grid; gap: 12px;
            }
            #sway-budget-receipts-panel .sway-budget-receipt-entry {
                min-width: 0; padding: 15px; border: 1px solid var(--sway-border, rgba(0,32,150,.10));
                border-radius: 14px; background: var(--sway-surface, rgba(255,255,255,.78));
            }
            #sway-budget-receipts-panel .sway-budget-receipt-entry-head {
                display: flex; justify-content: space-between; align-items: flex-start;
                gap: 12px; flex-wrap: wrap;
            }
            #sway-budget-receipts-panel .sway-budget-receipt-title {
                min-width: 0; color: var(--sway-dark, #10224b); font-size: 12px; font-weight: 800;
                overflow-wrap: anywhere;
            }
            #sway-budget-receipts-panel .sway-budget-receipt-meta {
                margin-top: 5px; color: var(--text-muted, #718096); font-size: 10px; line-height: 1.6;
            }
            #sway-budget-receipts-panel .sway-budget-receipt-amount {
                color: var(--sway-blue, #0152F4); font-size: 12px; font-weight: 800; white-space: nowrap;
            }
            #sway-budget-receipts-panel .sway-budget-receipt-status {
                display: inline-flex; align-items: center; padding: 4px 8px; border-radius: 7px;
                background: rgba(21,128,61,.08); color: #15803D; font-size: 9px; font-weight: 800;
            }
            #sway-budget-receipts-panel .sway-budget-receipt-status.missing {
                background: rgba(180,83,9,.08); color: #A16207;
            }
            #sway-budget-receipts-panel .sway-budget-receipt-files {
                display: grid; gap: 7px; margin-top: 12px;
            }
            #sway-budget-receipts-panel .sway-budget-receipt-file {
                display: flex; align-items: center; justify-content: space-between; gap: 10px;
                padding: 9px 10px; border-radius: 9px; background: rgba(1,82,244,.035);
            }
            #sway-budget-receipts-panel .sway-budget-receipt-file-name {
                min-width: 0; color: inherit; font-size: 10px; font-weight: 700;
                overflow-wrap: anywhere;
            }
            #sway-budget-receipts-panel .sway-budget-receipt-file-meta {
                display: block; margin-top: 3px; color: var(--text-muted, #718096);
                font-size: 9px; font-weight: 500;
            }
            #sway-budget-receipts-panel .sway-budget-receipt-actions {
                display: flex; align-items: center; gap: 7px; flex: 0 0 auto;
            }
            #sway-budget-receipts-panel .sway-budget-receipt-button {
                min-height: 34px; padding: 7px 10px; border: 1px solid rgba(1,82,244,.15);
                border-radius: 8px; background: var(--sway-surface, #fff); color: var(--sway-blue, #0152F4);
                font: inherit; font-size: 10px; font-weight: 800; cursor: pointer;
            }
            #sway-budget-receipts-panel .sway-budget-receipt-button.primary {
                border-color: transparent; background: var(--sway-blue, #0152F4); color: #fff;
            }
            #sway-budget-receipts-panel .sway-budget-receipt-button.danger {
                color: #B42318; border-color: rgba(180,35,24,.18);
            }
            #sway-budget-receipts-panel .sway-budget-receipt-button:disabled {
                opacity: .55; cursor: wait;
            }
            #sway-budget-receipts-panel .sway-budget-receipt-upload {
                display: flex; align-items: center; gap: 9px; flex-wrap: wrap; margin-top: 12px;
            }
            #sway-budget-receipts-panel .sway-budget-receipt-upload input {
                max-width: 100%; color: var(--text-muted, #718096); font: inherit; font-size: 10px;
            }
            #sway-budget-receipts-panel .sway-budget-receipt-status-line {
                min-height: 16px; margin-top: 8px; color: var(--text-muted, #718096);
                font-size: 10px; line-height: 1.5;
            }
            #sway-budget-receipts-panel .sway-budget-receipt-status-line.error { color: #B42318; }
            #sway-budget-receipts-panel .sway-budget-receipt-empty {
                padding: 20px; border: 1px dashed var(--sway-border, rgba(0,32,150,.15));
                border-radius: 12px; color: var(--text-muted, #718096); font-size: 11px; text-align: center;
            }
            body.sway-dark-mode #sway-budget-receipts-panel .sway-budget-receipt-entry {
                background: rgba(15,29,50,.72); border-color: rgba(151,176,214,.16);
            }
            body.sway-dark-mode #sway-budget-receipts-panel .sway-budget-receipt-title { color: #E7EDF7; }
            body.sway-dark-mode #sway-budget-receipts-panel .sway-budget-receipt-file {
                background: rgba(119,193,252,.07);
            }
            body.sway-dark-mode #sway-budget-receipts-panel .sway-budget-receipt-button {
                background: #14243B; color: #9CCBFF; border-color: rgba(119,193,252,.2);
            }
            body.sway-dark-mode #sway-budget-receipts-panel .sway-budget-receipt-button.primary {
                background: #0152F4; color: #fff;
            }
            @media (max-width: 600px) {
                #sway-budget-receipts-panel .sway-budget-receipt-file { align-items: flex-start; flex-direction: column; }
                #sway-budget-receipts-panel .sway-budget-receipt-actions { width: 100%; }
                #sway-budget-receipts-panel .sway-budget-receipt-actions .sway-budget-receipt-button { flex: 1; }
                #sway-budget-receipts-panel .sway-budget-receipts-toolbar { align-items: stretch; flex-direction: column; }
                #sway-budget-receipts-panel .sway-budget-receipts-search { width: 100%; box-sizing: border-box; }
            }
        `;
        document.head.appendChild(style);
    }

    function findLedgerPanel() {
        var main = document.getElementById("sway-workspace-main") ||
            document.querySelector("#sway-admin-workspace .sway-workspace-main");
        if (!main) return null;
        var panels = Array.from(main.querySelectorAll(".sway-panel"));
        return panels.find(function (panel) {
            var title = panel.querySelector(".sway-panel-title h3");
            return title && title.textContent.trim().toLowerCase() === "transaction ledger";
        }) || null;
    }

    function mount() {
        var ledger = findLedgerPanel();
        if (!ledger || !ledger.parentNode) {
            currentSection = null;
            return;
        }
        var existing = document.getElementById("sway-budget-receipts-panel");
        if (existing && existing.isConnected) {
            currentSection = existing;
            return;
        }
        renderStyles();
        var section = document.createElement("section");
        section.className = "sway-panel";
        section.id = "sway-budget-receipts-panel";
        section.innerHTML =
            '<div class="sway-panel-title"><div><h3>Receipt management</h3>' +
            '<p>Keep supporting documents attached to operating expenses. Files are stored privately and are visible only to the Swayphics owner.</p></div></div>' +
            '<div class="sway-budget-receipts-toolbar">' +
                '<div><strong data-receipt-summary>Loading expenses...</strong><p class="sway-budget-receipt-meta">PDF, JPG, PNG and WebP · Maximum 10 MB per file</p></div>' +
                '<input class="sway-budget-receipts-search" type="search" placeholder="Search expenses..." aria-label="Search expenses" data-receipt-search>' +
            '</div>' +
            '<div class="sway-budget-receipt-list" data-receipt-list><div class="sway-budget-receipt-empty">Loading expense records...</div></div>';
        ledger.insertAdjacentElement("afterend", section);
        currentSection = section;
        loadData(section);
    }

    function setStatus(section, message, isError) {
        if (!section || !section.isConnected) return;
        var status = section.querySelector("[data-receipt-global-status]");
        if (!status) return;
        status.textContent = message || "";
        status.classList.toggle("error", Boolean(isError));
    }

    var cachedEntries = [];
    var cachedReceipts = [];

    async function loadData(section) {
        if (isLoading || !section || !section.isConnected) return;
        isLoading = true;
        var list = section.querySelector("[data-receipt-list]");
        if (list) list.innerHTML = '<div class="sway-budget-receipt-empty">Loading expense records...</div>';
        try {
            if (window.swayphicsAdminSessionReady && typeof window.swayphicsAdminSessionReady.then === "function") {
                await window.swayphicsAdminSessionReady;
            }
            if (!token()) throw new Error("Your admin session has expired. Sign in again to manage receipts.");
            var results = await Promise.all([
                request("/rest/v1/budget_entries?select=id,description,category,amount,transaction_date,status,entry_type&entry_type=eq.expense&order=transaction_date.desc,created_at.desc&limit=200"),
                request("/rest/v1/budget_entry_receipts?select=id,budget_entry_id,storage_path,original_filename,mime_type,size_bytes,uploaded_at&order=uploaded_at.desc&limit=1000")
            ]);
            cachedEntries = Array.isArray(results[0]) ? results[0] : [];
            cachedReceipts = Array.isArray(results[1]) ? results[1] : [];
            renderList(section);
        } catch (error) {
            if (list) list.innerHTML = '<div class="sway-budget-receipt-empty">' + escapeHtml(error.message || "Receipt records could not be loaded.") + '</div>';
        } finally {
            isLoading = false;
        }
    }

    function renderList(section) {
        if (!section || !section.isConnected) return;
        var list = section.querySelector("[data-receipt-list]");
        var summary = section.querySelector("[data-receipt-summary]");
        if (!list) return;
        var query = String(section.querySelector("[data-receipt-search]")?.value || "").trim().toLowerCase();
        var receiptsByEntry = new Map();
        cachedReceipts.forEach(function (receipt) {
            var key = String(receipt.budget_entry_id || "");
            if (!receiptsByEntry.has(key)) receiptsByEntry.set(key, []);
            receiptsByEntry.get(key).push(receipt);
        });
        var entries = cachedEntries.filter(function (entry) {
            var searchable = [entry.description, entry.category, entry.transaction_date, entry.amount].join(" ").toLowerCase();
            return !query || searchable.includes(query);
        });
        var attachedCount = cachedEntries.filter(function (entry) {
            return (receiptsByEntry.get(String(entry.id)) || []).length > 0;
        }).length;
        if (summary) {
            summary.textContent = cachedEntries.length + " expenses · " + attachedCount + " with receipts · " +
                Math.max(0, cachedEntries.length - attachedCount) + " missing";
        }
        if (!entries.length) {
            list.innerHTML = '<div class="sway-budget-receipt-empty">' +
                (cachedEntries.length ? "No expenses match your search." : "No operating expenses have been recorded yet.") +
                '</div>';
            return;
        }
        list.innerHTML = entries.map(function (entry) {
            var receipts = receiptsByEntry.get(String(entry.id)) || [];
            var isPosted = entry.status === "posted";
            var filesHtml = receipts.length ? receipts.map(function (receipt) {
                return '<div class="sway-budget-receipt-file">' +
                    '<div class="sway-budget-receipt-file-name">' + escapeHtml(receipt.original_filename) +
                    '<span class="sway-budget-receipt-file-meta">' + escapeHtml(fileSize(receipt.size_bytes)) +
                    ' · Added ' + escapeHtml(formatDate(receipt.uploaded_at)) + '</span></div>' +
                    '<div class="sway-budget-receipt-actions">' +
                    '<button type="button" class="sway-budget-receipt-button" data-receipt-open="' + escapeHtml(receipt.id) + '">View</button>' +
                    '<button type="button" class="sway-budget-receipt-button danger" data-receipt-delete="' + escapeHtml(receipt.id) + '">Remove</button>' +
                    '</div></div>';
            }).join("") : '<p class="sway-budget-receipt-meta">No supporting document attached.</p>';
            return '<article class="sway-budget-receipt-entry" data-receipt-entry="' + escapeHtml(entry.id) + '">' +
                '<div class="sway-budget-receipt-entry-head">' +
                    '<div><div class="sway-budget-receipt-title">' + escapeHtml(entry.description || "Untitled expense") + '</div>' +
                    '<div class="sway-budget-receipt-meta">' + escapeHtml(entry.category || "Uncategorised") +
                    ' · ' + escapeHtml(formatDate(entry.transaction_date)) +
                    ' · ' + (isPosted ? 'Posted' : 'Voided') + '</div></div>' +
                    '<div><div class="sway-budget-receipt-amount">' + escapeHtml(formatMoney(entry.amount)) + '</div>' +
                    '<span class="sway-budget-receipt-status ' + (receipts.length ? "" : "missing") + '">' +
                    (receipts.length ? receipts.length + (receipts.length === 1 ? " receipt" : " receipts") : "Missing receipt") +
                    '</span></div>' +
                '</div>' +
                '<div class="sway-budget-receipt-files">' + filesHtml + '</div>' +
                (isPosted ? '<div class="sway-budget-receipt-upload"><input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" data-receipt-upload="' + escapeHtml(entry.id) + '" aria-label="Attach receipt to ' + escapeHtml(entry.description || "expense") + '"></div>' : '') +
                '<div class="sway-budget-receipt-status-line" data-receipt-entry-status></div>' +
                '</article>';
        }).join("");
    }

    function encodedPath(path) {
        return String(path).split("/").map(encodeURIComponent).join("/");
    }

    async function removeStorageObject(path) {
        return request("/storage/v1/object/" + BUCKET, {
            method: "DELETE",
            headers: headers({ "Content-Type": "application/json" }),
            body: JSON.stringify({ prefixes: [path] })
        });
    }

    async function uploadOne(entryId, file) {
        if (!ALLOWED_TYPES.includes(file.type)) {
            throw new Error(file.name + ": use a PDF, JPG, PNG or WebP file.");
        }
        if (!file.size || file.size > MAX_BYTES) {
            throw new Error(file.name + ": file must be between 1 byte and 10 MB.");
        }
        var safeName = String(file.name || "receipt")
            .normalize("NFKD")
            .replace(/[^a-zA-Z0-9._-]+/g, "_")
            .replace(/^\.+/, "")
            .slice(0, 120) || "receipt";
        var unique = window.crypto && typeof window.crypto.randomUUID === "function"
            ? window.crypto.randomUUID()
            : Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
        var storagePath = entryId + "/" + unique + "-" + safeName;
        var uploaded = false;
        try {
            var response = await fetch(
                SUPABASE_URL + "/storage/v1/object/" + BUCKET + "/" + encodedPath(storagePath),
                {
                    method: "POST",
                    headers: headers({
                        "Content-Type": file.type,
                        "x-upsert": "false"
                    }),
                    body: file
                }
            );
            var responseText = await response.text();
            if (!response.ok) throw new Error("File upload failed (" + response.status + "): " + responseText);
            uploaded = true;
            await request("/rest/v1/budget_entry_receipts", {
                method: "POST",
                headers: headers({
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal"
                }),
                body: JSON.stringify({
                    budget_entry_id: entryId,
                    storage_path: storagePath,
                    original_filename: String(file.name || "Receipt").slice(0, 255),
                    mime_type: file.type,
                    size_bytes: file.size
                })
            });
        } catch (error) {
            if (uploaded) {
                try { await removeStorageObject(storagePath); } catch (cleanupError) {
                    console.error("Receipt upload cleanup failed.", cleanupError);
                }
            }
            throw error;
        }
    }

    async function signedUrl(path) {
        var result = await request("/storage/v1/object/sign/" + BUCKET + "/" + encodedPath(path), {
            method: "POST",
            headers: headers({ "Content-Type": "application/json" }),
            body: JSON.stringify({ expiresIn: 120 })
        });
        var signed = result && (result.signedURL || result.signedUrl);
        if (!signed) throw new Error("Supabase did not return a secure file link.");
        return /^https?:\/\//i.test(signed) ? signed : SUPABASE_URL + signed;
    }

    async function handleClick(event) {
        var openButton = event.target.closest("[data-receipt-open]");
        if (openButton && currentSection && currentSection.contains(openButton)) {
            var receipt = cachedReceipts.find(function (item) {
                return String(item.id) === String(openButton.dataset.receiptOpen);
            });
            if (!receipt) return;
            var popup = window.open("about:blank", "_blank");
            if (popup) popup.document.title = "Opening receipt";
            openButton.disabled = true;
            try {
                var url = await signedUrl(receipt.storage_path);
                if (popup) {
                    popup.opener = null;
                    popup.location = url;
                } else {
                    window.location.href = url;
                }
            } catch (error) {
                if (popup) popup.close();
                window.swayAlert ? window.swayAlert(error.message) : window.alert(error.message);
            } finally {
                openButton.disabled = false;
            }
            return;
        }

        var deleteButton = event.target.closest("[data-receipt-delete]");
        if (deleteButton && currentSection && currentSection.contains(deleteButton)) {
            var target = cachedReceipts.find(function (item) {
                return String(item.id) === String(deleteButton.dataset.receiptDelete);
            });
            if (!target) return;
            var confirmed = window.swayConfirm
                ? await window.swayConfirm("Remove this receipt from the expense record? The stored file will also be deleted.")
                : window.confirm("Remove this receipt and its stored file?");
            if (!confirmed) return;
            deleteButton.disabled = true;
            try {
                await removeStorageObject(target.storage_path);
                await request("/rest/v1/budget_entry_receipts?id=eq." + encodeURIComponent(target.id), {
                    method: "DELETE",
                    headers: headers({ "Prefer": "return=minimal" })
                });
                await loadData(currentSection);
            } catch (error) {
                deleteButton.disabled = false;
                window.swayAlert ? window.swayAlert(error.message) : window.alert(error.message);
            }
        }
    }

    async function handleUpload(event) {
        var input = event.target;
        if (!input.matches("[data-receipt-upload]") || !currentSection || !currentSection.contains(input)) return;
        var files = Array.from(input.files || []);
        var entryId = String(input.dataset.receiptUpload || "");
        if (!files.length || !entryId) return;
        var entryCard = input.closest("[data-receipt-entry]");
        var status = entryCard && entryCard.querySelector("[data-receipt-entry-status]");
        input.disabled = true;
        if (status) {
            status.classList.remove("error");
            status.textContent = "Uploading " + files.length + (files.length === 1 ? " file..." : " files...");
        }
        try {
            for (var index = 0; index < files.length; index += 1) {
                await uploadOne(entryId, files[index]);
            }
            input.value = "";
            await loadData(currentSection);
            if (status && status.isConnected) status.textContent = "Receipt upload complete.";
        } catch (error) {
            if (status) {
                status.classList.add("error");
                status.textContent = error.message || "The receipt could not be uploaded.";
            }
        } finally {
            input.disabled = false;
        }
    }

    document.addEventListener("click", handleClick);
    document.addEventListener("change", handleUpload);
    document.addEventListener("input", function (event) {
        if (!event.target.matches("[data-receipt-search]") || !currentSection || !currentSection.contains(event.target)) return;
        renderList(currentSection);
        var search = currentSection.querySelector("[data-receipt-search]");
        if (search) {
            search.focus();
            search.setSelectionRange(search.value.length, search.value.length);
        }
    });

    function startObserver() {
        var observer = new MutationObserver(function () {
            mount();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        mount();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", startObserver, { once: true });
    } else {
        startObserver();
    }
})();
