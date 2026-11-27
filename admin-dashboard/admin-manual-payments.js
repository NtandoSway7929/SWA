(function () {
  "use strict";
  if (window.__swayManualPaymentsLoaded) return;
  window.__swayManualPaymentsLoaded = true;

  var SUPABASE_URL = "https://sqifhribgsqfaxgtobsa.supabase.co";
  var SUPABASE_KEY = "sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QhB";
  var ACCESS_KEY = "swayphics_admin_access_token";
  var REFRESH_KEY = "swayphics_admin_refresh_token";
  var root = null, invoices = [], busy = false, pendingKey = null;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  function money(value, currency) {
    return new Intl.NumberFormat("en-ZA",{style:"currency",currency:currency || "ZAR"}).format(Number(value || 0));
  }
  function today() {
    var parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Johannesburg",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    var values = {};
    parts.forEach(function (part) {
      if (part.type !== "literal") values[part.type] = part.value;
    });
    return values.year + "-" + values.month + "-" + values.day;
  }
  function token() {
    try { return localStorage.getItem(ACCESS_KEY) || ""; } catch (_) { return ""; }
  }
  async function refreshSession() {
    var refresh = "";
    try { refresh = localStorage.getItem(REFRESH_KEY) || ""; } catch (_) {}
    if (!refresh) return false;
    var response = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
      method:"POST",headers:{"apikey":SUPABASE_KEY,"Content-Type":"application/json"},
      body:JSON.stringify({refresh_token:refresh})
    });
    if (!response.ok) return false;
    var data = await response.json();
    if (!data.access_token || !data.refresh_token) return false;
    localStorage.setItem(ACCESS_KEY,data.access_token);
    localStorage.setItem(REFRESH_KEY,data.refresh_token);
    return true;
  }
  async function request(payload, retried) {
    var access = token();
    if (!access) throw new Error("Your administrator session is missing. Sign in again.");
    var response = await fetch(SUPABASE_URL + "/functions/v1/admin-manual-payment", {
      method:"POST",
      headers:{"apikey":SUPABASE_KEY,"Authorization":"Bearer " + access,"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify(payload || {}),cache:"no-store"
    });
    if (response.status === 401 && !retried && await refreshSession()) return request(payload,true);
    var raw = await response.text(), data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch (_) {}
    if (!response.ok || !data || data.ok !== true) throw new Error(data && data.error || "The request could not be completed.");
    return data;
  }
  function status(message, bad) {
    var node = root && root.querySelector("[data-mp-status]");
    if (!node) return;
    node.textContent = message || "";
    node.setAttribute("data-error",bad ? "true" : "false");
  }
  function selectedInvoice() {
    var id = root.querySelector("[name=invoice_id]").value;
    return invoices.find(function (row) { return row.id === id; }) || null;
  }
  function updateInvoiceSummary() {
    var row = selectedInvoice(), summary = root.querySelector("[data-mp-invoice-summary]");
    if (!row) { summary.textContent = "Choose an outstanding invoice."; return; }
    summary.textContent = (row.client && (row.client.business_name || row.client.contact_name) || "Client") +
      " · " + row.invoice_number + " · Outstanding " + money(row.amount_outstanding,row.currency);
    var amount = root.querySelector("[name=amount]");
    amount.max = String(row.amount_outstanding);
    amount.placeholder = "Maximum " + Number(row.amount_outstanding).toFixed(2);
  }
  async function load() {
    status("Loading outstanding invoices…",false);
    try {
      var data = await request({action:"list"});
      invoices = Array.isArray(data.invoices) ? data.invoices : [];
      var select = root.querySelector("[name=invoice_id]");
      select.innerHTML = '<option value="">Select an invoice</option>' + invoices.map(function (row) {
        var client = row.client || {};
        return '<option value="' + esc(row.id) + '">' + esc(row.invoice_number) + ' · ' +
          esc(client.business_name || client.contact_name || "Client") + ' · ' +
          esc(money(row.amount_outstanding,row.currency)) + ' outstanding</option>';
      }).join("");
      updateInvoiceSummary();
      status(invoices.length ? invoices.length + " invoice(s) available." : "No outstanding invoices are available for manual payment.",false);
    } catch (error) { status(error.message || "Outstanding invoices could not be loaded.",true); }
  }
  async function handleClick(event) {
    if (event.target.closest("[data-mp-close]")) { root.setAttribute("data-open","false"); return; }
    if (event.target.closest("[data-mp-open]")) { root.setAttribute("data-open","true"); load(); return; }
    if (!event.target.closest("[data-mp-submit]") || busy) return;
    var form = root.querySelector("form");
    var row = selectedInvoice();
    if (!row) { status("Choose an invoice first.",true); return; }
    if (!form.reportValidity()) return;
    var amount = Number(form.elements.amount.value);
    if (!Number.isFinite(amount) || amount <= 0 || amount > Number(row.amount_outstanding)) {
      status("The amount must be greater than zero and no more than the outstanding balance.",true);
      return;
    }
    if (!form.elements.confirmed.checked) {
      status("Confirm that you have independently verified the funds were received.",true);
      return;
    }
    if (!pendingKey) pendingKey = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : null;
    if (!pendingKey) { status("This browser cannot create a secure request key. Update your browser and try again.",true); return; }
    var payload = {
      action:"record", invoice_id:row.id, amount:form.elements.amount.value,
      method:form.elements.method.value, reference:form.elements.reference.value.trim(),
      notes:form.elements.notes.value.trim(), payment_date:form.elements.payment_date.value,
      idempotency_key:pendingKey
    };
    busy = true;
    var button = root.querySelector("[data-mp-submit]");
    button.disabled = true;
    status("Recording verified payment and issuing receipt…",false);
    try {
      var result = await request(payload);
      pendingKey = null;
      var email = result.email_status === "sent" ? "Email accepted by the provider." :
        result.email_status === "failed" ? "Receipt created; email delivery needs configuration or a retry." :
        "Receipt created; email delivery is queued.";
      status((result.duplicate ? "This payment was already recorded. " : "Payment recorded. ") +
        "Receipt " + result.receipt_number + ". " + email,false);
      form.reset();
      form.elements.payment_date.value = today();
      await load();
    } catch (error) {
      status(error.message || "Payment could not be recorded. You can retry safely.",true);
    } finally { busy = false; button.disabled = false; }
  }
  function mount() {
    var style = document.createElement("style");
    style.textContent = `
      #sway-manual-payments{position:fixed;left:22px;bottom:84px;z-index:9997;font-family:Montserrat,system-ui,-apple-system,"Segoe UI",sans-serif}
      #sway-manual-payments .mp-launch{display:none;min-height:44px;padding:0 17px;border:1px solid rgba(255,255,255,.2);border-radius:999px;background:#081533;color:#fff;box-shadow:0 12px 34px rgba(8,21,51,.2);font-size:11px;font-weight:800;cursor:pointer}
      #sway-manual-payments .mp-panel{display:none;position:fixed;left:22px;bottom:140px;width:min(520px,calc(100vw - 28px));max-height:min(80vh,760px);overflow:auto;background:#fff;border:1px solid #dfe5ea;border-radius:20px;padding:20px;box-shadow:0 24px 70px #07163835}
      #sway-manual-payments[data-open=true] .mp-panel{display:block}
      #sway-manual-payments .mp-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}
      #sway-manual-payments h2{font-size:18px;margin:0 0 5px;color:#081533}
      #sway-manual-payments p{font-size:11px;line-height:1.55;color:#66717b}
      #sway-manual-payments .mp-close{border:0;background:transparent;font-size:22px;color:#56616b;cursor:pointer}
      #sway-manual-payments form{display:grid;gap:12px}
      #sway-manual-payments label{display:grid;gap:6px;color:#344054;font-size:10px;font-weight:800}
      #sway-manual-payments input,#sway-manual-payments select,#sway-manual-payments textarea{width:100%;min-height:40px;box-sizing:border-box;padding:10px 11px;border:1px solid #d7dee8;border-radius:9px;background:#fff;color:#081533;font:12px Montserrat,system-ui,sans-serif}
      #sway-manual-payments textarea{min-height:66px;resize:vertical}
      #sway-manual-payments .mp-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      #sway-manual-payments .mp-summary{padding:11px 12px;border-radius:10px;background:#f4f7fc;color:#344054;font-size:11px;line-height:1.5}
      #sway-manual-payments .mp-confirm{display:flex;grid-template-columns:18px 1fr;align-items:start;gap:9px;font-weight:600;line-height:1.5}
      #sway-manual-payments .mp-confirm input{width:16px;min-height:16px;margin:1px 0 0}
      #sway-manual-payments [data-mp-submit]{min-height:42px;border:0;border-radius:10px;background:#0152F4;color:#fff;font-size:11px;font-weight:800;cursor:pointer}
      #sway-manual-payments [data-mp-submit]:disabled{opacity:.55;cursor:wait}
      #sway-manual-payments [data-mp-status]{margin-top:12px;font-size:11px;line-height:1.55;color:#56616b}
      #sway-manual-payments [data-mp-status][data-error=true]{color:#9a2525}
      @media(max-width:600px){#sway-manual-payments{left:12px;bottom:76px}#sway-manual-payments .mp-panel{left:12px;bottom:132px;padding:15px;max-height:calc(100vh - 155px)}#sway-manual-payments .mp-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
    root = document.createElement("div");
    root.id = "sway-manual-payments";
    root.setAttribute("data-open","false");
    root.innerHTML = '<button type="button" class="mp-launch" data-mp-open>Record payment</button>' +
      '<section class="mp-panel" aria-label="Record verified offline payment">' +
      '<div class="mp-head"><div><h2>Record a payment</h2><p>For funds received outside the online checkout. Only record a payment after confirming it has cleared.</p></div><button type="button" class="mp-close" data-mp-close aria-label="Close">×</button></div>' +
      '<form novalidate><label>Invoice<select name="invoice_id" required><option value="">Loading invoices…</option></select></label>' +
      '<div class="mp-summary" data-mp-invoice-summary>Choose an outstanding invoice.</div>' +
      '<div class="mp-grid"><label>Amount received<input name="amount" type="number" inputmode="decimal" min="0.01" step="0.01" required placeholder="0.00"></label>' +
      '<label>Payment method<select name="method" required><option value="EFT">EFT</option><option value="Cash">Cash</option><option value="Other">Other</option></select></label></div>' +
      '<div class="mp-grid"><label>Payment date<input name="payment_date" type="date" required></label>' +
      '<label>Bank / payment reference<input name="reference" type="text" maxlength="120" placeholder="Required for EFT"></label></div>' +
      '<label>Internal notes<textarea name="notes" maxlength="1000" placeholder="Optional details for your records"></textarea></label>' +
      '<label class="mp-confirm"><input name="confirmed" type="checkbox" required><span>I have independently verified that the funds were received and cleared.</span></label>' +
      '<button type="button" data-mp-submit>Record verified payment</button></form><p data-mp-status role="status" aria-live="polite"></p></section>';
    root.querySelector("[name=payment_date]").value = today();
    root.querySelector("[name=reference]").required = true;
    root.addEventListener("click",handleClick);
    root.querySelector("[name=invoice_id]").addEventListener("change",updateInvoiceSummary);
    root.querySelector("[name=method]").addEventListener("change",function () {
      root.querySelector("[name=reference]").required = this.value === "EFT";
    });
    document.body.appendChild(root);

    function addBillingNavigationItem() {
      var menu = document.querySelector('[data-nav-menu="billing"]');
      if (!menu) return;
      var anchor = menu.querySelector('[data-view="invoice-settings"]');
      if (!anchor) return;
      if (!menu.querySelector('[data-view="manual-payment-record"]')) {
        var button = anchor.cloneNode(true);
        button.dataset.view = "manual-payment-record";
        button.removeAttribute("aria-current");
        button.textContent = "Record payment";
        button.setAttribute("aria-label", "Record payment");
        anchor.insertAdjacentElement("afterend", button);
        anchor = button;
      }
    }
    addBillingNavigationItem();
    var navObserver = new MutationObserver(addBillingNavigationItem);
    navObserver.observe(document.body, {childList:true,subtree:true});
    document.addEventListener("click", function(event) {
      var button = event.target.closest('[data-view="manual-payment-record"]');
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      root.setAttribute("data-open","true");
      load();
    }, true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",mount);
  else mount();
})();
