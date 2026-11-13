(function () {
    "use strict";

    if (window.__swayYocoInvoiceSettingsLoaded) return;
    window.__swayYocoInvoiceSettingsLoaded = true;

    var SUPABASE_URL = "https://sqifhribgsqfaxgtobsa.supabase.co";
    var SUPABASE_KEY = "sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QhB";
    var ACCESS_KEY = "swayphics_admin_access_token";
    var REFRESH_KEY = "swayphics_admin_refresh_token";
    var root = null;
    var invoices = [];
    var selectedInvoice = null;

    function escapeHtml(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
            return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
        });
    }

    function token() {
        try { return localStorage.getItem(ACCESS_KEY) || ""; } catch (_) { return ""; }
    }

    async function refresh() {
        var refreshToken = "";
        try { refreshToken = localStorage.getItem(REFRESH_KEY) || ""; } catch (_) {}
        if (!refreshToken) return false;
        var response = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
            method: "POST",
            headers: {"apikey": SUPABASE_KEY, "Content-Type": "application/json"},
            body: JSON.stringify({refresh_token: refreshToken})
        });
        if (!response.ok) return false;
        var data = await response.json();
        if (!data.access_token || !data.refresh_token) return false;
        localStorage.setItem(ACCESS_KEY, data.access_token);
        localStorage.setItem(REFRESH_KEY, data.refresh_token);
        return true;
    }

    async function api(path, options, retried) {
        var access = token();
        if (!access) throw new Error("Your administrator session is missing. Sign in again.");
        options = options || {};
        var headers = {"apikey": SUPABASE_KEY, "Authorization": "Bearer " + access};
        Object.keys(options.headers || {}).forEach(function (key) { headers[key] = options.headers[key]; });
        var init = {method: options.method || "GET", headers: headers};
        if (options.body !== undefined) {
            headers["Content-Type"] = "application/json";
            init.body = JSON.stringify(options.body);
        }
        var response = await fetch(SUPABASE_URL + path, init);
        if (response.status === 401 && !retried && await refresh()) return api(path, options, true);
        var raw = await response.text();
        var data = null;
        if (raw) { try { data = JSON.parse(raw); } catch (_) { data = {message: raw}; } }
        if (!response.ok) throw new Error(data && (data.message || data.error_description || data.error) || "Request failed (" + response.status + ").");
        return data;
    }

    async function verifyAdmin() {
        var user = await api("/auth/v1/user");
        if (!user || !user.id) throw new Error("Unable to verify your administrator session.");
        var rows = await api("/rest/v1/admin_users?select=user_id,active&user_id=eq." +
            encodeURIComponent(user.id) + "&limit=1");
        if (!Array.isArray(rows) || !rows[0] || rows[0].active === false) {
            throw new Error("Active Swayphics administrator access is required.");
        }
    }

    function status(message, bad) {
        var node = root && root.querySelector("[data-yoco-settings-status]");
        if (!node) return;
        node.textContent = message || "";
        node.setAttribute("data-error", bad ? "true" : "false");
    }

    function selected() {
        var id = root.querySelector("[data-yoco-invoice]").value;
        return invoices.find(function (item) { return item.id === id; }) || null;
    }

    function renderForm() {
        var invoice = selected();
        selectedInvoice = invoice;
        var area = root.querySelector("[data-yoco-settings-form]");
        if (!invoice) {
            area.innerHTML = '<p class="syi-empty">No eligible invoices are available. Only issued invoices with an outstanding balance can be configured.</p>';
            return;
        }
        var outstanding = Number(invoice.amount_outstanding != null ? invoice.amount_outstanding : invoice.total) || 0;
        area.innerHTML =
            '<div class="syi-invoice-summary"><span>Invoice ' + escapeHtml(invoice.invoice_number || invoice.id) +
            '</span><strong>R' + outstanding.toFixed(2) + ' outstanding</strong><small>Status: ' +
            escapeHtml(invoice.status || "unknown") + '</small></div>' +
            '<label class="syi-toggle"><input type="checkbox" data-online ' +
            (invoice.online_payment_enabled ? "checked" : "") + '><span><strong>Enable online payments</strong><small>Allow this client to pay this invoice through the hosted Yoco checkout.</small></span></label>' +
            '<label class="syi-toggle"><input type="checkbox" data-partial ' +
            (invoice.partial_payment_enabled ? "checked" : "") + '><span><strong>Allow partial payments</strong><small>Allow the client to pay less than the full outstanding balance.</small></span></label>' +
            '<label class="syi-field"><span>Minimum deposit (R)</span><input type="number" min="0.01" max="' +
            outstanding.toFixed(2) + '" step="0.01" data-deposit value="' +
            (invoice.deposit_amount == null ? "" : Number(invoice.deposit_amount).toFixed(2)) +
            '" placeholder="No minimum deposit"></label>' +
            '<p class="syi-hint">A deposit is a minimum first payment, not an additional charge. The amount cannot exceed the current outstanding balance. Online payments remain disabled by default.</p>' +
            '<button type="button" class="syi-save" data-save>Save invoice settings</button>';
        var online = area.querySelector("[data-online]");
        var partial = area.querySelector("[data-partial]");
        var deposit = area.querySelector("[data-deposit]");
        function sync() {
            partial.disabled = !online.checked;
            deposit.disabled = !online.checked || !partial.checked;
            if (!online.checked || !partial.checked) deposit.value = "";
        }
        online.addEventListener("change", sync);
        partial.addEventListener("change", sync);
        sync();
        area.querySelector("[data-save]").addEventListener("click", save);
    }

    async function loadInvoices() {
        await verifyAdmin();
        invoices = await api("/rest/v1/invoices?select=id,invoice_number,total,amount_outstanding,status,online_payment_enabled,partial_payment_enabled,deposit_amount&order=created_at.desc&limit=200");
        invoices = (Array.isArray(invoices) ? invoices : []).filter(function (item) {
            return !["draft", "cancelled", "paid"].includes(String(item.status || "").toLowerCase()) &&
                Number(item.amount_outstanding != null ? item.amount_outstanding : item.total) > 0;
        });
        var select = root.querySelector("[data-yoco-invoice]");
        select.innerHTML = invoices.map(function (item) {
            var balance = Number(item.amount_outstanding != null ? item.amount_outstanding : item.total) || 0;
            return '<option value="' + escapeHtml(item.id) + '">' +
                escapeHtml(item.invoice_number || item.id) + " · R" + balance.toFixed(2) + " outstanding</option>";
        }).join("");
        if (!invoices.length) select.innerHTML = '<option value="">No eligible invoices</option>';
        renderForm();
    }

    async function save() {
        var invoice = selectedInvoice;
        if (!invoice) return;
        var online = root.querySelector("[data-online]").checked;
        var partial = root.querySelector("[data-partial]").checked;
        var rawDeposit = root.querySelector("[data-deposit]").value.trim();
        var deposit = rawDeposit === "" ? null : Number(rawDeposit);
        var outstanding = Number(invoice.amount_outstanding != null ? invoice.amount_outstanding : invoice.total) || 0;
        if (partial && !online) return status("Enable online payments before allowing partial payments.", true);
        if (deposit !== null && (!Number.isFinite(deposit) || deposit <= 0 || deposit > outstanding)) {
            return status("Enter a minimum deposit greater than zero and no greater than the outstanding balance.", true);
        }
        if (!partial && deposit !== null) return status("A minimum deposit requires partial payments to be enabled.", true);
        var button = root.querySelector("[data-save]");
        button.disabled = true;
        button.textContent = "Saving…";
        status("Saving settings…", false);
        try {
            await api("/rest/v1/rpc/admin_set_invoice_yoco_settings", {
                method: "POST",
                body: {
                    p_invoice_id: invoice.id,
                    p_online_payment_enabled: online,
                    p_partial_payment_enabled: partial,
                    p_deposit_amount: deposit
                }
            });
            invoice.online_payment_enabled = online;
            invoice.partial_payment_enabled = partial;
            invoice.deposit_amount = online && partial ? deposit : null;
            status("Invoice payment settings saved.", false);
            renderForm();
            status("Invoice payment settings saved.", false);
        } catch (error) {
            status(error.message || "Unable to save invoice settings.", true);
        } finally {
            var current = root.querySelector("[data-save]");
            if (current) { current.disabled = false; current.textContent = "Save invoice settings"; }
        }
    }

    function mount() {
        if (document.getElementById("sway-yoco-invoice-settings")) return;
        var style = document.createElement("style");
        style.textContent = `
            #sway-yoco-invoice-settings{position:fixed;right:22px;bottom:22px;z-index:9998;font-family:Montserrat,Arial,sans-serif;color:#081533}
            #sway-yoco-invoice-settings .syi-launch{display:none;border:0;border-radius:14px;padding:13px 17px;background:linear-gradient(120deg,#002096,#0152F4);color:#fff;font-weight:700;box-shadow:0 12px 32px #00209635;cursor:pointer}
            #sway-yoco-invoice-settings .syi-panel{display:none;position:fixed;right:22px;bottom:78px;width:min(440px,calc(100vw - 28px));max-height:min(78vh,720px);overflow:auto;background:#fff;border:1px solid #dce5f5;border-radius:20px;padding:22px;box-shadow:0 24px 70px #07163835}
            #sway-yoco-invoice-settings[data-open=true] .syi-panel{display:block}
            #sway-yoco-invoice-settings .syi-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:15px}
            #sway-yoco-invoice-settings h2{font-size:18px;margin:0 0 6px}
            #sway-yoco-invoice-settings p{font-size:12px;line-height:1.55;color:#58657c}
            #sway-yoco-invoice-settings select,#sway-yoco-invoice-settings input[type=number]{width:100%;border:1px solid #d7dfed;border-radius:10px;padding:11px;font:inherit;font-size:13px;background:#fff}
            #sway-yoco-invoice-settings .syi-picker,#sway-yoco-invoice-settings .syi-field{display:grid;gap:7px;margin:14px 0;font-size:12px;font-weight:700}
            #sway-yoco-invoice-settings .syi-invoice-summary{display:grid;gap:5px;background:#f3f7ff;border-radius:12px;padding:13px;margin:14px 0}
            #sway-yoco-invoice-settings .syi-invoice-summary span{font-size:12px;color:#58657c}
            #sway-yoco-invoice-settings .syi-invoice-summary strong{font-size:18px}
            #sway-yoco-invoice-settings .syi-invoice-summary small{font-size:11px;color:#58657c}
            #sway-yoco-invoice-settings .syi-toggle{display:flex;gap:10px;align-items:flex-start;padding:12px 0;border-bottom:1px solid #edf1f7}
            #sway-yoco-invoice-settings .syi-toggle input{margin-top:3px}
            #sway-yoco-invoice-settings .syi-toggle span{display:grid;gap:4px}
            #sway-yoco-invoice-settings .syi-toggle strong{font-size:12px}
            #sway-yoco-invoice-settings .syi-toggle small,#sway-yoco-invoice-settings .syi-hint{font-size:11px;line-height:1.5;color:#65718a}
            #sway-yoco-invoice-settings .syi-save{width:100%;margin-top:14px;border:0;border-radius:11px;padding:13px;background:#0152F4;color:white;font-weight:700;cursor:pointer}
            #sway-yoco-invoice-settings .syi-save:disabled{opacity:.6;cursor:wait}
            #sway-yoco-invoice-settings [data-yoco-settings-status]{margin-top:10px;color:#12633a;font-size:12px}
            #sway-yoco-invoice-settings [data-yoco-settings-status][data-error=true]{color:#a12626}
            #sway-yoco-invoice-settings .syi-close{border:0;background:transparent;font-size:22px;cursor:pointer;color:#56627a}
            #sway-yoco-invoice-settings .syi-empty{padding:18px 0}
            @media(max-width:600px){#sway-yoco-invoice-settings{right:12px;bottom:12px}#sway-yoco-invoice-settings .syi-panel{right:12px;bottom:68px}}
        `;
        document.head.appendChild(style);
        root = document.createElement("div");
        root.id = "sway-yoco-invoice-settings";
        root.innerHTML = '<button class="syi-launch" type="button" data-open>Invoice payment settings</button>' +
            '<section class="syi-panel" aria-label="Invoice payment settings"><div class="syi-head"><div><h2>Invoice payment settings</h2>' +
            '<p>Control Yoco test-checkout availability for each issued invoice. Live payments are not enabled by this control.</p></div>' +
            '<button type="button" class="syi-close" data-close aria-label="Close">×</button></div>' +
            '<label class="syi-picker">Select invoice<select data-yoco-invoice></select></label>' +
            '<div data-yoco-settings-form><p>Loading invoices…</p></div><p data-yoco-settings-status role="status" aria-live="polite"></p></section>';
        document.body.appendChild(root);
        async function openSettings() {
            root.setAttribute("data-open", "true");
            status("Loading eligible invoices…", false);
            try { await loadInvoices(); status("", false); }
            catch (error) { status(error.message || "Unable to load invoices.", true); }
        }
        root.querySelector("[data-open]").addEventListener("click", function () {
            if (root.getAttribute("data-open") === "true") {
                root.setAttribute("data-open", "false");
                return;
            }
            openSettings();
        });
        root.querySelector("[data-close]").addEventListener("click", function () { root.setAttribute("data-open", "false"); });
        root.querySelector("[data-yoco-invoice]").addEventListener("change", renderForm);
        document.addEventListener("click", function (event) {
            var button = event.target.closest('[data-view="invoice-settings"]');
            if (!button) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            openSettings();
        }, true);
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, {once: true});
    else mount();
})();
