(function () {
  "use strict";
  if (window.__swayPaymentReceiptsLoaded) return;
  window.__swayPaymentReceiptsLoaded = true;

  var SUPABASE_URL = "https://sqifhribgsqfaxgtobsa.supabase.co";
  var SUPABASE_KEY = "sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QhB";
  var ACCESS_KEY = "swayphics_admin_access_token";
  var REFRESH_KEY = "swayphics_admin_refresh_token";
  var root = null, receipts = [], busy = false, cleanupPayments = [], cleanupBusy = false;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  function money(value, currency) {
    return new Intl.NumberFormat("en-ZA",{style:"currency",currency:currency || "ZAR"}).format(Number(value || 0));
  }
  function date(value) {
    if (!value) return "—";
    var d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString("en-ZA",{timeZone:"Africa/Johannesburg"});
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
    var response = await fetch(SUPABASE_URL + "/functions/v1/deliver-payment-receipt", {
      method:"POST",
      headers:{"apikey":SUPABASE_KEY,"Authorization":"Bearer " + access,"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify(payload || {}),cache:"no-store"
    });
    if (response.status === 401 && !retried && await refreshSession()) return request(payload,true);
    var raw = await response.text(), data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch (_) {}
    if (!response.ok || !data || data.ok !== true) throw new Error(data && data.error || "The receipt request could not be completed.");
    return data;
  }
  async function rpc(name, payload, retried) {
    var access = token();
    if (!access) throw new Error("Your administrator session is missing. Sign in again.");
    var response = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + encodeURIComponent(name), {
      method:"POST",
      headers:{"apikey":SUPABASE_KEY,"Authorization":"Bearer " + access,"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify(payload || {}),cache:"no-store"
    });
    if (response.status === 401 && !retried && await refreshSession()) return rpc(name,payload,true);
    var raw = await response.text(), data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch (_) {}
    if (!response.ok) throw new Error(data && (data.message || data.error || data.hint) || "The financial cleanup request could not be completed.");
    return data;
  }
  function status(message, bad) {
    var node = root && root.querySelector("[data-pr-status]");
    if (!node) return;
    node.textContent = message || "";
    node.setAttribute("data-error",bad ? "true" : "false");
  }
  function cleanupStatus(message, bad) {
    var node = root && root.querySelector("[data-pr-cleanup-status]");
    if (!node) return;
    node.textContent = message || "";
    node.setAttribute("data-error",bad ? "true" : "false");
  }
  function render() {
    var list = root.querySelector("[data-pr-list]");
    if (!receipts.length) {
      list.innerHTML = '<div class="pr-empty"><strong>No receipts yet</strong><p>Issued payment receipts will appear here.</p></div>';
      return;
    }
    list.innerHTML = receipts.map(function (row) {
      var client = row.client || {}, delivery = row.delivery || {};
      var state = String(delivery.status || "pending");
      var label = state === "sent" ? "Accepted by Resend" : state === "failed" ? "Delivery failed" : state === "sending" ? "Sending" : "Awaiting delivery";
      var providerState = String(delivery.provider_delivery_status || "unknown");
      var providerLabel = providerState === "delivered" ? "Delivered to recipient mail server" :
        providerState === "delayed" ? "Delivery delayed by recipient mail server" :
        providerState === "bounced" ? "Email bounced" :
        providerState === "complained" ? "Recipient marked email as spam" :
        state === "sent" ? "Awaiting provider delivery confirmation" : "";
      var canSend = state !== "sent" && state !== "sending";
      return '<article class="pr-item">' +
        '<div class="pr-item-head"><div><strong>' + esc(row.receipt_number) + '</strong><small>' + esc(client.business_name || client.contact_name || "Client") + ' · ' + esc(date(row.issued_at)) + '</small></div>' +
        '<b>' + esc(money(row.amount,row.currency)) + '</b></div>' +
        '<div class="pr-meta"><span>Payment method</span><strong>' + esc(row.method || "—") + '</strong></div>' +
        '<div class="pr-meta"><span>Recipient</span><strong>' + esc(delivery.recipient_email || client.email || "No email address") + '</strong></div>' +
        '<div class="pr-status" data-state="' + esc(state) + '">' + esc(label) + (delivery.attempt_count ? ' · ' + esc(delivery.attempt_count) + ' attempt(s)' : '') + '</div>' +
        (providerLabel ? '<div class="pr-provider-status" data-provider-state="' + esc(providerState) + '">' + esc(providerLabel) + (providerState === "delivered" && delivery.provider_delivered_at ? ' · ' + esc(date(delivery.provider_delivered_at)) : '') + '</div>' : '') +
        (delivery.last_error ? '<p class="pr-error">' + esc(delivery.last_error) + '</p>' : '') +
        '<div class="pr-actions">' + (canSend ? '<button type="button" data-pr-send="' + esc(row.payment_id) + '">' + (state === "failed" ? "Retry email" : "Send receipt") + '</button>' : '<span class="pr-sent">Sent ' + esc(date(delivery.sent_at)) + '</span>') + '</div>' +
      '</article>';
    }).join("");
  }
  function renderCleanup() {
    var list = root && root.querySelector("[data-pr-cleanup-list]");
    if (!list) return;
    if (!cleanupPayments.length) {
      list.innerHTML = '<div class="pr-empty"><strong>No eligible Yoco test payments</strong><p>Only fully verified Yoco test-mode payments appear here. Paystack live payments, manual payments and bank transfers are excluded.</p></div>';
      return;
    }
    list.innerHTML = cleanupPayments.map(function (row) {
      return '<article class="pr-item">' +
        '<div class="pr-item-head"><div><strong>' + esc(row.invoice_number || "Invoice") + '</strong><small>' + esc(row.client_name || "Client") + ' · ' + esc(date(row.paid_at)) + '</small></div>' +
        '<b>' + esc(money(row.amount,row.currency)) + '</b></div>' +
        '<div class="pr-meta"><span>Receipt</span><strong>' + esc(row.receipt_number || "—") + '</strong></div>' +
        '<div class="pr-meta"><span>Provider</span><strong>Yoco · TEST MODE</strong></div>' +
        '<div class="pr-actions"><button type="button" data-pr-cleanup-id="' + esc(row.payment_id) + '">Review cleanup</button></div>' +
      '</article>';
    }).join("");
  }
  async function loadCleanup() {
    cleanupStatus("Checking verified Yoco test-mode payment records…",false);
    try {
      var data = await rpc("admin_list_yoco_test_payment_cleanup_candidates",{});
      if (!data || data.ok !== true || !Array.isArray(data.payments)) {
        throw new Error("The eligible test-payment list response is incomplete.");
      }
      cleanupPayments = data.payments;
      renderCleanup();
      cleanupStatus(cleanupPayments.length + " eligible Yoco test payment(s).",false);
    } catch (error) {
      cleanupPayments = [];
      renderCleanup();
      cleanupStatus(error.message || "Unable to load eligible Yoco test payments.",true);
    }
  }
  async function load() {
    status("Loading issued receipts…",false);
    try {
      var data = await request({action:"list"});
      if (!Array.isArray(data.receipts)) throw new Error("Receipt list response is incomplete.");
      receipts = data.receipts;
      render();
      root.querySelector("[data-pr-count]").textContent = String(receipts.filter(function (r) { return !r.delivery || r.delivery.status !== "sent"; }).length);
      status(receipts.length + " issued receipt(s).",false);
    } catch (error) { status(error.message || "Unable to load receipts.",true); }
  }
  async function handleClick(event) {
    if (event.target.closest("[data-pr-close]")) { root.setAttribute("data-open","false"); return; }
    if (event.target.closest("[data-pr-cleanup-close]")) { root.setAttribute("data-cleanup-open","false"); return; }
    if (event.target.closest("[data-pr-open]")) { root.setAttribute("data-cleanup-open","false"); root.setAttribute("data-open","true"); load(); return; }

    var cleanupButton = event.target.closest("[data-pr-cleanup-id]");
    if (cleanupButton && !cleanupBusy) {
      var paymentId = cleanupButton.dataset.prCleanupId;
      var reason = window.prompt("Why are you removing this verified Yoco TEST payment? Enter at least 10 characters.");
      if (reason === null) return;
      if (reason.trim().length < 10) {
        cleanupStatus("A cleanup reason of at least 10 characters is required.",true);
        return;
      }
      var expectedConfirmation = "DELETE TEST PAYMENT " + paymentId;
      var confirmation = window.prompt("Type this exact confirmation to continue:\n" + expectedConfirmation);
      if (confirmation !== expectedConfirmation) {
        cleanupStatus("Confirmation did not match. No payment data was changed.",true);
        return;
      }
      if (!window.confirm("This permanently removes the local test payment and issued receipt. The provider attempt, webhook events and audit snapshots are retained, and the invoice balance is recalculated. Continue?")) return;
      cleanupBusy = true;
      cleanupButton.disabled = true;
      cleanupButton.textContent = "Cleaning up…";
      try {
        var result = await rpc("admin_cleanup_yoco_test_payment",{
          p_payment_id:paymentId,
          p_confirmation:confirmation,
          p_reason:reason.trim()
        });
        if (!result || result.ok !== true) throw new Error(result && result.message || "The test payment cleanup was not completed.");
        await loadCleanup();
        cleanupStatus("Cleanup complete. Audit reference: " + (result.audit_id || "recorded") + ".",false);
      } catch (error) {
        await loadCleanup();
        cleanupStatus(error.message || "The test payment could not be cleaned up.",true);
      } finally {
        cleanupBusy = false;
      }
      return;
    }

    var test = event.target.closest("[data-pr-test]");
    if (test) {
      if (busy || testSubmitted || test.disabled) return;
      var confirmed = window.confirm(
        "Send one TEST email to swayphics@gmail.com?\n\n" +
        "It contains a PDF clearly marked TEST ONLY. No payment or client records will be created or changed."
      );
      if (!confirmed) return;
      busy = true;
      test.disabled = true;
      test.textContent = "Sending test…";
      try {
        status("Sending the controlled production test email to swayphics@gmail.com…",false);
        var testResult = await request({action:"test"});
        testSubmitted = true;
        test.textContent = "Test submitted";
        status(
          "Resend accepted the test email for swayphics@gmail.com. Message ID: " +
          (testResult.provider_message_id || "not supplied") +
          ". Check the inbox and confirm the TEST ONLY PDF is attached.",
          false
        );
      } catch (error) {
        test.disabled = false;
        test.textContent = "Send test email";
        status(error.message || "The production test email could not be sent.",true);
      } finally {
        busy = false;
      }
      return;
    }

    var send = event.target.closest("[data-pr-send]");
    if (!send || busy) return;
    busy = true;
    send.disabled = true;
    try {
      status("Generating PDF and sending receipt…",false);
      var result = await request({action:"send",payment_id:send.dataset.prSend});
      status("Email accepted by the provider for receipt " + result.receipt_number + " (" + result.recipient + ").",false);
      await load();
    } catch (error) {
      status(error.message || "Receipt email could not be sent.",true);
      await load();
    } finally { busy = false; }
  }
  function mount() {
    var style = document.createElement("style");
    style.textContent = `
      #sway-payment-receipts{position:fixed;right:22px;bottom:84px;z-index:9998;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      #sway-payment-receipts .pr-launch{display:none;align-items:center;gap:10px;min-height:44px;padding:0 16px;border:1px solid rgba(255,255,255,.24);border-radius:999px;background:#081533;color:#fff;box-shadow:0 12px 34px rgba(8,21,51,.22);font-size:11px;font-weight:800;cursor:pointer}
      #sway-payment-receipts .pr-count{min-width:22px;height:22px;display:grid;place-items:center;padding:0 6px;border-radius:99px;background:#fff;color:#081533;font-size:11px}
      #sway-payment-receipts .pr-panel{display:none;position:fixed;right:22px;bottom:140px;width:min(620px,calc(100vw - 28px));max-height:min(78vh,760px);overflow:auto;background:#fff;border:1px solid #dfe5ea;border-radius:20px;padding:20px;box-shadow:0 24px 70px #07163835}
      #sway-payment-receipts[data-open=true] .pr-panel:not(.pr-cleanup-panel){display:block}
      #sway-payment-receipts[data-cleanup-open=true] .pr-cleanup-panel{display:block}
      #sway-payment-receipts .pr-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px}
      #sway-payment-receipts h2{font-size:18px;margin:0 0 5px;color:#081533}
      #sway-payment-receipts p{font-size:12px;line-height:1.55;color:#66717B}
      #sway-payment-receipts .pr-head-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}
      #sway-payment-receipts .pr-close{width:32px;height:32px;border:0;border-radius:9px;background:#F1F4F8;font-size:20px;color:#56616B;cursor:pointer}
      #sway-payment-receipts .pr-test{min-height:34px;padding:0 11px;border:1px solid #DCE5F2;border-radius:9px;background:#F4F7FC;color:#002096;font-size:10px;font-weight:800;cursor:pointer}
      #sway-payment-receipts .pr-test:disabled{opacity:.65;cursor:default}
      #sway-payment-receipts .pr-test-note{margin:-7px 0 14px;padding:9px 11px;border-radius:10px;background:#F5F8FF;color:#56627B;font-size:10px;line-height:1.5}
      #sway-payment-receipts .pr-list{display:grid;gap:10px}
      #sway-payment-receipts .pr-item{display:grid;gap:9px;padding:14px;border:1px solid #e5e9ed;border-radius:15px;background:#FAFBFC}
      #sway-payment-receipts .pr-item-head{display:flex;justify-content:space-between;gap:12px}
      #sway-payment-receipts .pr-item-head>div{display:grid;gap:4px;min-width:0}
      #sway-payment-receipts .pr-item-head strong{font-size:13px;color:#081533}
      #sway-payment-receipts .pr-item-head small{font-size:11px;color:#66717B}
      #sway-payment-receipts .pr-item-head>b{font-size:14px;white-space:nowrap;color:#081533}
      #sway-payment-receipts .pr-meta{display:flex;justify-content:space-between;gap:12px;font-size:11px}
      #sway-payment-receipts .pr-meta span{color:#66717B}
      #sway-payment-receipts .pr-meta strong{text-align:right;overflow-wrap:anywhere;color:#081533}
      #sway-payment-receipts .pr-status{font-size:11px;font-weight:800;color:#56616B}
      #sway-payment-receipts .pr-status[data-state=sent]{color:#18764B}
      #sway-payment-receipts .pr-status[data-state=failed]{color:#A02A2A}
      #sway-payment-receipts .pr-error{font-size:11px;color:#A02A2A;overflow-wrap:anywhere}
      #sway-payment-receipts .pr-provider-status{font-size:10px;color:#66717B}
      #sway-payment-receipts .pr-provider-status[data-provider-state=delivered]{color:#18764B}
      #sway-payment-receipts .pr-provider-status[data-provider-state=bounced],#sway-payment-receipts .pr-provider-status[data-provider-state=complained]{color:#A02A2A}
      #sway-payment-receipts .pr-actions{display:flex;gap:8px}
      #sway-payment-receipts .pr-actions button{min-height:34px;padding:0 13px;border:0;border-radius:9px;background:#0152F4;color:#fff;font-size:10px;font-weight:800;cursor:pointer}
      #sway-payment-receipts .pr-actions button:disabled{opacity:.55;cursor:wait}
      #sway-payment-receipts .pr-sent{font-size:10px;color:#18764B;font-weight:700}
      #sway-payment-receipts .pr-empty{padding:28px 8px;text-align:center}
      #sway-payment-receipts .pr-empty strong{font-size:13px;color:#081533}
      #sway-payment-receipts [data-pr-status]{margin-top:12px;font-size:11px;color:#56616B;line-height:1.5}
      #sway-payment-receipts [data-pr-status][data-error=true]{color:#9A2525}
      @media(max-width:600px){#sway-payment-receipts{right:12px;bottom:76px}#sway-payment-receipts .pr-panel{right:12px;bottom:132px;padding:15px;max-height:calc(100vh - 155px)}}
    `;
    document.head.appendChild(style);
    root = document.createElement("div");
    root.id = "sway-payment-receipts";
    root.setAttribute("data-open","false");
    root.setAttribute("data-cleanup-open","false");
    root.innerHTML = '<button type="button" class="pr-launch" data-pr-open>Payment receipts <span class="pr-count" data-pr-count>0</span></button>' +
      '<section class="pr-panel" aria-label="Payment receipt delivery"><div class="pr-head"><div><h2>Payment receipts</h2><p>Issued receipts are emailed after verified payments. Failed deliveries can be retried here.</p></div><div class="pr-head-actions"><button type="button" class="pr-test" data-pr-test>Send test email</button><button type="button" class="pr-close" data-pr-close aria-label="Close">×</button></div></div>' +
      '<p class="pr-test-note">Admin-only test: sends one clearly marked TEST ONLY email and PDF to swayphics@gmail.com. It does not create or change payment records.</p>' +
      '<div class="pr-list" data-pr-list><div class="pr-empty">Open the panel to load receipts.</div></div><p data-pr-status role="status" aria-live="polite"></p></section>' +
      '<section class="pr-panel pr-cleanup-panel" aria-label="Yoco test payment cleanup"><div class="pr-head"><div><h2>Yoco test payment cleanup</h2><p>Remove only fully verified Yoco TEST payments after owner confirmation. Provider and receipt audit history is retained.</p></div><button type="button" class="pr-close" data-pr-cleanup-close aria-label="Close">×</button></div>' +
      '<p class="pr-test-note">Paystack live payments, manually recorded payments and bank transfers are not eligible. If a payment has refunds or reconciliation history, cleanup is blocked.</p>' +
      '<div class="pr-list" data-pr-cleanup-list><div class="pr-empty">Open this view to check for eligible test payments.</div></div><p data-pr-cleanup-status role="status" aria-live="polite"></p></section>';
    document.body.appendChild(root);
    root.addEventListener("click",handleClick);

    function addBillingNavigationItem() {
      var menu = document.querySelector('[data-nav-menu="billing"]');
      if (!menu) return;
      var anchor = menu.querySelector('[data-view="invoice-settings"]');
      if (!anchor) return;
      var receiptsButton = menu.querySelector('[data-view="payment-receipts"]');
      if (!receiptsButton) {
        receiptsButton = anchor.cloneNode(true);
        receiptsButton.dataset.view = "payment-receipts";
        receiptsButton.removeAttribute("aria-current");
        receiptsButton.textContent = "Payment receipts";
        receiptsButton.setAttribute("aria-label", "Payment receipts");
        anchor.insertAdjacentElement("afterend", receiptsButton);
      }
      if (!menu.querySelector('[data-view="yoco-test-payment-cleanup"]')) {
        var cleanupNav = receiptsButton.cloneNode(true);
        cleanupNav.dataset.view = "yoco-test-payment-cleanup";
        cleanupNav.removeAttribute("aria-current");
        cleanupNav.textContent = "Test payment cleanup";
        cleanupNav.setAttribute("aria-label", "Test payment cleanup");
        receiptsButton.insertAdjacentElement("afterend", cleanupNav);
      }
    }
    addBillingNavigationItem();
    var navObserver = new MutationObserver(addBillingNavigationItem);
    navObserver.observe(document.body, {childList:true,subtree:true});
    document.addEventListener("click", function(event) {
      var cleanupNav = event.target.closest('[data-view="yoco-test-payment-cleanup"]');
      if (cleanupNav) {
        event.preventDefault();
        event.stopImmediatePropagation();
        root.setAttribute("data-open","false");
        root.setAttribute("data-cleanup-open","true");
        loadCleanup();
        return;
      }
      var button = event.target.closest('[data-view="payment-receipts"]');
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      root.setAttribute("data-cleanup-open","false");
      root.setAttribute("data-open","true");
      load();
    }, true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",mount);
  else mount();
})();
