(function () {
  "use strict";
  if (window.__swayBankTransferReviewLoaded) return;
  window.__swayBankTransferReviewLoaded = true;

  var SUPABASE_URL = "https://sqifhribgsqfaxgtobsa.supabase.co";
  var SUPABASE_KEY = "sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QhB";
  var ACCESS_KEY = "swayphics_admin_access_token";
  var REFRESH_KEY = "swayphics_admin_refresh_token";
  var root = null;
  var pending = [];
  var busy = false;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  function accessToken() {
    try { return localStorage.getItem(ACCESS_KEY) || ""; } catch (_) { return ""; }
  }
  async function refreshSession() {
    var refresh = "";
    try { refresh = localStorage.getItem(REFRESH_KEY) || ""; } catch (_) {}
    if (!refresh) return false;
    var response = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: {"apikey":SUPABASE_KEY,"Content-Type":"application/json"},
      body: JSON.stringify({refresh_token:refresh})
    });
    if (!response.ok) return false;
    var data = await response.json();
    if (!data.access_token || !data.refresh_token) return false;
    localStorage.setItem(ACCESS_KEY, data.access_token);
    localStorage.setItem(REFRESH_KEY, data.refresh_token);
    return true;
  }
  async function request(action, payload, retried) {
    var token = accessToken();
    if (!token) throw new Error("Your administrator session is missing. Sign in again.");
    var response = await fetch(SUPABASE_URL + "/functions/v1/bank-transfer", {
      method: "POST",
      headers: {"apikey":SUPABASE_KEY,"Authorization":"Bearer " + token,"Content-Type":"application/json","Accept":"application/json"},
      body: JSON.stringify(Object.assign({action:action},payload || {})),
      cache: "no-store"
    });
    if (response.status === 401 && !retried && await refreshSession()) return request(action,payload,true);
    var raw = await response.text(), data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch (_) {}
    if (!response.ok || !data || data.ok !== true) throw new Error(data && data.error || "The bank transfer request could not be completed.");
    return data;
  }
  function status(message, bad) {
    var node = root && root.querySelector("[data-btr-status]");
    if (!node) return;
    node.textContent = message || "";
    node.setAttribute("data-error", bad ? "true" : "false");
  }
  function money(value) {
    return new Intl.NumberFormat("en-ZA",{style:"currency",currency:"ZAR",minimumFractionDigits:2}).format(Number(value || 0));
  }
  function date(value) {
    if (!value) return "—";
    var d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString("en-ZA",{timeZone:"Africa/Johannesburg"});
  }
  function renderQueue() {
    var list = root.querySelector("[data-btr-list]");
    if (!pending.length) {
      list.innerHTML = '<div class="btr-empty"><strong>No transfers awaiting review</strong><p>New client submissions will appear here.</p></div>';
      return;
    }
    list.innerHTML = pending.map(function (row) {
      var client = row.client || {}, invoice = row.invoice || {};
      return '<article class="btr-item" data-btr-item="' + esc(row.id) + '">' +
        '<div class="btr-item-top"><div><strong>' + esc(client.business_name || client.contact_name || "Client") + '</strong>' +
        '<small>' + esc(invoice.invoice_number || "Invoice unavailable") + ' · ' + esc(date(row.submitted_at)) + '</small></div>' +
        '<b>' + esc(money(row.amount)) + '</b></div>' +
        '<div class="btr-meta"><span>Bank reference</span><strong>' + esc(row.bank_reference) + '</strong></div>' +
        '<div class="btr-meta"><span>Invoice balance</span><strong>' + esc(money(invoice.amount_outstanding)) + '</strong></div>' +
        '<div class="btr-actions"><button type="button" class="btr-secondary" data-btr-proof="' + esc(row.id) + '">View proof</button>' +
        '<button type="button" class="btr-primary" data-btr-approve="' + esc(row.id) + '">Confirm deposit &amp; record</button>' +
        '<button type="button" class="btr-reject" data-btr-reject="' + esc(row.id) + '">Reject</button></div></article>';
    }).join("");
  }
  async function load() {
    status("Loading pending bank transfers…", false);
    try {
      var data = await request("list");
      if (!Array.isArray(data.pending) || data.ok !== true) throw new Error("The review queue response is incomplete.");
      pending = data.pending;
      renderQueue();
      root.querySelector("[data-btr-count]").textContent = String(pending.length);
      status(pending.length ? pending.length + " submission(s) require bank-statement verification." : "Queue is up to date.", false);
    } catch (error) {
      status(error.message || "Unable to load bank transfer submissions.", true);
    }
  }
  async function handleClick(event) {
    var proof = event.target.closest("[data-btr-proof]");
    var approve = event.target.closest("[data-btr-approve]");
    var reject = event.target.closest("[data-btr-reject]");
    if (!proof && !approve && !reject) return;
    if (busy) return;
    var id = proof ? proof.dataset.btrProof : (approve ? approve.dataset.btrApprove : reject.dataset.btrReject);
    var item = pending.find(function (row) { return row.id === id; });
    if (!item) return;
    busy = true;
    try {
      if (proof) {
        var win = window.open("about:blank","_blank");
        status("Preparing a private proof link…", false);
        var result = await request("proof",{submission_id:id});
        if (!win) status("Your browser blocked the proof window. Allow pop-ups for this site and try again.",true);
        else {
          win.opener = null;
          win.location.replace(result.signed_url);
          status("Proof link is valid for five minutes.",false);
        }
      } else if (approve) {
        var invoice = item.invoice || {};
        var client = item.client || {};
        var confirmation = "Only approve after confirming the deposit has cleared in the Swayphics bank account.\n\nClient: " +
          (client.business_name || "Client") + "\nInvoice: " + (invoice.invoice_number || "Unknown") +
          "\nAmount: " + money(item.amount) + "\nBank reference: " + item.bank_reference +
          "\n\nRecord this EFT payment now?";
        if (!window.confirm(confirmation)) return;
        status("Verifying invoice balance and recording payment…",false);
        await request("approve",{submission_id:id});
        status("Payment recorded and receipt issued.",false);
        await load();
      } else {
        var reason = window.prompt("Why is this proof being rejected? The client will see this reason.");
        if (reason === null) return;
        reason = reason.trim();
        if (!reason || reason.length > 1000) {
          status("Enter a rejection reason of 1–1,000 characters.",true);
          return;
        }
        status("Rejecting submission…",false);
        await request("reject",{submission_id:id,reason:reason});
        status("Submission rejected. The invoice balance was not changed.",false);
        await load();
      }
    } catch (error) {
      status(error.message || "The action could not be completed.",true);
    } finally {
      busy = false;
    }
  }
  function mount() {
    if (document.getElementById("sway-bank-transfer-review")) return;
    if (!accessToken()) return;
    var style = document.createElement("style");
    style.textContent = `
      #sway-bank-transfer-review{position:fixed;right:22px;bottom:84px;z-index:9997;font-family:Montserrat,Arial,sans-serif;color:#252B31}
      #sway-bank-transfer-review .btr-launch{display:none;align-items:center;gap:9px;border:0;border-radius:14px;padding:13px 16px;background:#343A40;color:#fff;font-weight:800;box-shadow:0 12px 32px #07163835;cursor:pointer}
      #sway-bank-transfer-review .btr-launch span{display:inline-grid;place-items:center;min-width:22px;height:22px;padding:0 6px;border-radius:99px;background:#fff;color:#343A40;font-size:11px}
      #sway-bank-transfer-review .btr-panel{display:none;position:fixed;right:22px;bottom:140px;width:min(620px,calc(100vw - 28px));max-height:min(78vh,760px);overflow:auto;background:#fff;border:1px solid #dfe5ea;border-radius:20px;padding:20px;box-shadow:0 24px 70px #07163835}
      #sway-bank-transfer-review[data-open=true] .btr-panel{display:block}
      #sway-bank-transfer-review .btr-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px}
      #sway-bank-transfer-review h2{font-size:18px;margin:0 0 5px}
      #sway-bank-transfer-review p{font-size:12px;line-height:1.55;color:#66717B}
      #sway-bank-transfer-review .btr-close{border:0;background:transparent;font-size:22px;color:#56616B;cursor:pointer}
      #sway-bank-transfer-review .btr-list{display:grid;gap:10px}
      #sway-bank-transfer-review .btr-item{display:grid;gap:10px;padding:14px;border:1px solid #e5e9ed;border-radius:15px;background:#FAFBFC}
      #sway-bank-transfer-review .btr-item-top{display:flex;justify-content:space-between;gap:12px}
      #sway-bank-transfer-review .btr-item-top>div{display:grid;gap:4px}
      #sway-bank-transfer-review .btr-item-top strong{font-size:13px}
      #sway-bank-transfer-review .btr-item-top small{font-size:11px;color:#66717B}
      #sway-bank-transfer-review .btr-item-top>b{font-size:14px;white-space:nowrap}
      #sway-bank-transfer-review .btr-meta{display:flex;justify-content:space-between;gap:12px;font-size:11px}
      #sway-bank-transfer-review .btr-meta span{color:#66717B}
      #sway-bank-transfer-review .btr-meta strong{text-align:right;overflow-wrap:anywhere}
      #sway-bank-transfer-review .btr-actions{display:flex;flex-wrap:wrap;gap:7px;padding-top:3px}
      #sway-bank-transfer-review .btr-actions button{min-height:34px;padding:0 11px;border-radius:10px;font-size:10px;font-weight:800;cursor:pointer}
      #sway-bank-transfer-review .btr-primary{background:#0152F4;color:#fff}
      #sway-bank-transfer-review .btr-secondary{background:#EEF3FF;color:#0152F4}
      #sway-bank-transfer-review .btr-reject{background:#F8EEEE;color:#9A2525}
      #sway-bank-transfer-review .btr-empty{padding:28px 8px;text-align:center}
      #sway-bank-transfer-review .btr-empty strong{font-size:13px}
      #sway-bank-transfer-review .btr-empty p{margin-top:5px}
      #sway-bank-transfer-review [data-btr-status]{margin-top:12px;font-size:11px;color:#56616B;line-height:1.5}
      #sway-bank-transfer-review [data-btr-status][data-error=true]{color:#9A2525}
      @media(max-width:600px){#sway-bank-transfer-review{right:12px;bottom:76px}#sway-bank-transfer-review .btr-panel{right:12px;bottom:132px;padding:15px;max-height:calc(100vh - 155px)}#sway-bank-transfer-review .btr-actions{display:grid;grid-template-columns:1fr 1fr}#sway-bank-transfer-review .btr-primary{grid-column:1/-1}}
    `;
    document.head.appendChild(style);
    root = document.createElement("div");
    root.id = "sway-bank-transfer-review";
    root.innerHTML = '<button type="button" class="btr-launch" data-btr-open>Bank transfer review <span data-btr-count>Open</span></button>' +
      '<section class="btr-panel" aria-label="Bank transfer review queue"><div class="btr-head"><div><h2>Bank transfer submissions</h2>' +
      '<p>Verify cleared deposits against the bank account before recording any payment.</p></div><button type="button" class="btr-close" data-btr-close aria-label="Close">×</button></div>' +
      '<div class="btr-list" data-btr-list><div class="btr-empty">Open the queue to load submissions.</div></div><p data-btr-status role="status" aria-live="polite"></p></section>';
    document.body.appendChild(root);
    root.querySelector("[data-btr-open]").addEventListener("click",function(){
      root.setAttribute("data-open","true");
      load();
    });
    root.querySelector("[data-btr-close]").addEventListener("click",function(){root.setAttribute("data-open","false")});
    root.querySelector("[data-btr-list]").addEventListener("click",handleClick);

    function addBillingNavigationItem() {
      var menu = document.querySelector('[data-nav-menu="billing"]');
      if (!menu || menu.querySelector('[data-view="bank-transfer-review"]')) return;
      var invoiceSettings = menu.querySelector('[data-view="invoice-settings"]');
      if (!invoiceSettings) return;
      var button = invoiceSettings.cloneNode(true);
      button.dataset.view = "bank-transfer-review";
      button.removeAttribute("aria-current");
      button.textContent = "Bank transfer review";
      button.setAttribute("aria-label", "Bank transfer review");
      invoiceSettings.insertAdjacentElement("afterend", button);
    }
    addBillingNavigationItem();
    var navObserver = new MutationObserver(addBillingNavigationItem);
    navObserver.observe(document.body, {childList:true,subtree:true});
    document.addEventListener("click",function(event){
      var button = event.target.closest('[data-view="bank-transfer-review"]');
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      root.setAttribute("data-open","true");
      load();
    },true);
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount,{once:true});
  else mount();
})();
