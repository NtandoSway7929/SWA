(function () {
  "use strict";
  if (window.__swayYocoReconciliationLoaded) return;
  window.__swayYocoReconciliationLoaded = true;

  var URL = "https://sqifhribgsqfaxgtobsa.supabase.co";
  var KEY = "sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QhB";
  var ACCESS = "swayphics_admin_access_token";
  var REFRESH = "swayphics_admin_refresh_token";
  var root, data = null, selectedId = "", filter = "all", busy = false, historyBusy = {evidence:false,actions:false,both:false}, historyRequestId = 0, historyPage = {evidence_has_more:false,actions_have_more:false};

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  function money(cents, currency) {
    var n = Number(cents);
    return Number.isFinite(n) ? (currency || "ZAR") + " " + (n / 100).toFixed(2) : "Amount unavailable";
  }
  function getToken() {
    try { return localStorage.getItem(ACCESS) || ""; } catch (_) { return ""; }
  }
  async function refreshToken() {
    var r = "";
    try { r = localStorage.getItem(REFRESH) || ""; } catch (_) {}
    if (!r) return false;
    var response = await fetch(URL + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: {"apikey": KEY, "Content-Type": "application/json"},
      body: JSON.stringify({refresh_token: r})
    });
    if (!response.ok) return false;
    var session = await response.json();
    if (!session.access_token || !session.refresh_token) return false;
    localStorage.setItem(ACCESS, session.access_token);
    localStorage.setItem(REFRESH, session.refresh_token);
    return true;
  }
  async function request(path, options, retried) {
    var access = getToken();
    if (!access) throw new Error("Administrator session missing. Sign in again.");
    options = options || {};
    var headers = {"apikey": KEY, "Authorization": "Bearer " + access};
    Object.keys(options.headers || {}).forEach(function (k) { headers[k] = options.headers[k]; });
    var init = {method: options.method || "GET", headers: headers};
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    var response = await fetch(URL + path, init);
    if (response.status === 401 && !retried && await refreshToken()) return request(path, options, true);
    var raw = await response.text(), parsed = null;
    if (raw) { try { parsed = JSON.parse(raw); } catch (_) { parsed = {message: raw}; } }
    if (!response.ok) throw new Error(parsed && (parsed.message || parsed.error || parsed.error_description) || "Request failed (" + response.status + ").");
    return parsed;
  }
  function status(message, bad) {
    var node = root && root.querySelector("[data-yr-status]");
    if (node) { node.textContent = message || ""; node.setAttribute("data-error", bad ? "true" : "false"); }
  }
  function cases() { return data && Array.isArray(data.open_cases) ? data.open_cases : []; }
  function selected() { return cases().find(function (c) { return c.id === selectedId; }) || null; }
  function evidenceFor(id) { return (data.evidence || []).filter(function (x) { return x.reconciliation_id === id; }); }
  function actionsFor(id) { return (data.case_actions || []).filter(function (x) { return x.reconciliation_id === id; }); }
  function actorLabel(id) {
    if (!id || typeof id !== "string") return "Administrator identity unavailable";
    return "Administrator · " + id.slice(0, 8) + "…" + id.slice(-4);
  }
  function chronological(items) {
    return items.slice().sort(function (a, b) {
      var time = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return time || String(a.id || "").localeCompare(String(b.id || ""));
    });
  }

  function renderQueue() {
    var q = root.querySelector("[data-yr-search]").value.trim().toLowerCase();
    var list = cases().filter(function (c) {
      return (filter === "all" || c.status === filter) &&
        (!q || [c.id,c.discrepancy_type,c.summary,c.status].join(" ").toLowerCase().includes(q));
    });
    root.querySelector("[data-yr-queue]").innerHTML = list.length ? list.map(function (c) {
      return '<button type="button" class="yr-case' + (c.id === selectedId ? ' is-selected' : '') +
        '" data-case="' + esc(c.id) + '"><span class="yr-case-top"><b>' + esc(String(c.discrepancy_type || "reconciliation case").replace(/_/g, " ")) +
        '</b><i>' + esc(c.status) + '</i></span><span>' + esc(c.summary || "No summary provided") +
        '</span><small>' + esc(new Date(c.created_at).toLocaleString()) + '</small></button>';
    }).join("") : '<p class="yr-empty">No matching open reconciliation cases.</p>';
    root.querySelectorAll("[data-case]").forEach(function (b) {
      b.addEventListener("click", function () { selectedId = b.getAttribute("data-case"); historyRequestId++; historyBusy = {evidence:false,actions:false,both:false}; data.evidence = []; data.case_actions = []; historyPage = {evidence_has_more:false,actions_have_more:false}; render(); loadHistory(selectedId, "both"); });
    });
  }
  function renderDetail() {
    var c = selected(), node = root.querySelector("[data-yr-detail]");
    if (!c) {
      node.innerHTML = '<div class="yr-empty-detail"><strong>Select a reconciliation case</strong><p>Choose a case from the queue to inspect its financial anchors, evidence and investigation history.</p></div>';
      return;
    }
    var evidence = evidenceFor(c.id), actions = actionsFor(c.id);
    var attempt = (data.attempts || []).find(function (x) { return x.id === c.payment_attempt_id; });
    var payment = (data.attempts || []).find(function (x) { return x.payment_id === c.payment_id; });
    var history = chronological(actions).map(function (a) {
      return '<article class="yr-history"><div><b>' + esc(a.action.replace(/_/g, " ")) +
        '</b><time>' + esc(new Date(a.created_at).toLocaleString()) + '</time></div><small>' + esc(actorLabel(a.actor_user_id)) + '</small><p>' +
        esc(a.reason || (a.previous_status + " → " + a.new_status)) + '</p>' +
        (a.outcome ? '<small>Outcome: ' + esc(a.outcome.replace(/_/g, " ")) + '</small>' : '') +
        (a.related_payment_id ? '<small>Payment ref: ' + esc(a.related_payment_id) + '</small>' : '') +
        (a.related_refund_id ? '<small>Refund ref: ' + esc(a.related_refund_id) + '</small>' : '') +
        '</article>';
    }).join("");
    node.innerHTML =
      '<div class="yr-detail-head"><div><span class="yr-eyebrow">Yoco · Test environment</span><h3>' +
      esc(String(c.discrepancy_type || "reconciliation case").replace(/_/g, " ")) + '</h3><p>' + esc(c.summary || "No case summary") +
      '</p></div><span class="yr-status">' + esc(c.status) + '</span></div>' +
      '<div class="yr-facts"><div><small>Case ID</small><code>' + esc(c.id) + '</code></div>' +
      '<div><small>Payment attempt</small><code>' + esc(c.payment_attempt_id || "Not linked") + '</code></div>' +
      '<div><small>Payment</small><code>' + esc(c.payment_id || (attempt && attempt.payment_id) || "Not linked") + '</code></div>' +
      '<div><small>Refund</small><code>' + esc(c.refund_id || "Not linked") + '</code></div>' +
      (attempt ? '<div><small>Attempt amount</small><b>' + esc(money(attempt.amount_cents, attempt.currency)) + '</b></div>' : '') +
      '</div>' +
      '<section class="yr-section"><h4>Evidence log</h4>' +
      (evidence.length ? chronological(evidence).map(function (e) {
        return '<article class="yr-evidence"><div><b>' + esc(e.evidence_type.replace(/_/g, " ")) +
          '</b><time>' + esc(new Date(e.created_at).toLocaleString()) + '</time></div><small>' + esc(actorLabel(e.created_by)) + '</small><p>' + esc(e.note) +
          '</p>' + (e.reference ? '<small>Reference: ' + esc(e.reference) + '</small>' : '') + '</article>';
      }).join("") : '<p class="yr-muted">No evidence has been recorded.</p>') + (historyPage.evidence_has_more ? '<button type="button" class="yr-refresh" data-load-evidence>Load older evidence</button>' : '') +
      (c.status === "open" || c.status === "investigating" ?
      '<form data-evidence-form class="yr-form"><label>Evidence category<select name="type" required>' +
      '<option value="provider_dashboard">Provider dashboard</option><option value="bank_statement">Bank statement</option>' +
      '<option value="client_confirmation">Client confirmation</option><option value="provider_support">Provider support</option>' +
      '<option value="internal_review">Internal review</option><option value="other">Other</option></select></label>' +
      '<label>Reference (optional)<input name="reference" maxlength="240" placeholder="Provider reference or document identifier"></label>' +
      '<label>Investigation note<textarea name="note" maxlength="2000" required placeholder="Record what was checked and what the evidence establishes"></textarea></label>' +
      '<button class="yr-primary" type="submit">Add evidence</button></form>' : '') +
      '</section>' +
      '<section class="yr-section"><h4>Investigation history</h4>' +
      (history || '<p class="yr-muted">No workflow actions recorded yet.</p>') + (historyPage.actions_have_more ? '<button type="button" class="yr-refresh" data-load-actions>Load older actions</button>' : '') + '</section>' +
      (c.status === "open" || c.status === "investigating" ?
      '<section class="yr-section"><h4>Case action</h4><form data-action-form class="yr-form">' +
      '<label>Action<select name="status" data-next-status>' +
      (c.status === "open" ? '<option value="investigating">Start investigation</option>' :
       '<option value="resolved">Resolve case</option><option value="dismissed">Dismiss case</option><option value="open">Reopen queue</option>') +
      '</select></label><label>Reason / resolution note<textarea name="reason" maxlength="2000" required placeholder="Explain the decision and supporting basis"></textarea></label>' +
      '<div data-outcome-fields hidden><label>Resolution outcome<select name="outcome">' +
      '<option value="provider_state_confirmed">Provider state confirmed</option><option value="duplicate_or_replay">Duplicate or replay</option>' +
      '<option value="financial_correction_recorded">Financial correction separately recorded</option><option value="no_financial_effect">No financial effect</option>' +
      '<option value="false_positive">False positive</option></select></label>' +
      '<label>Related payment ID (required for financial correction)<input name="payment" placeholder="Existing Yoco payment UUID"></label>' +
      '<label>Related refund ID (required for financial correction)<input name="refund" placeholder="Existing Yoco refund UUID"></label>' +
      '<p class="yr-muted">References must already exist and belong to this case’s invoice. This action does not create or change financial records.</p></div>' +
      '<button class="yr-primary" type="submit">Save case action</button></form></section>' : '');
    var olderEvidence = node.querySelector("[data-load-evidence]");
    if (olderEvidence) olderEvidence.addEventListener("click", function () { loadHistory(c.id, "evidence"); });
    var olderActions = node.querySelector("[data-load-actions]");
    if (olderActions) olderActions.addEventListener("click", function () { loadHistory(c.id, "actions"); });
    var form = node.querySelector("[data-evidence-form]");
    if (form) form.addEventListener("submit", submitEvidence);
    var actionForm = node.querySelector("[data-action-form]");
    if (actionForm) {
      var next = actionForm.querySelector("[data-next-status]");
      var fields = actionForm.querySelector("[data-outcome-fields]");
      next.addEventListener("change", function () { fields.hidden = next.value !== "resolved" && next.value !== "dismissed"; });
      actionForm.addEventListener("submit", submitAction);
    }
  }
  function render() {
    root.querySelectorAll("[data-filter]").forEach(function (b) { b.classList.toggle("is-active", b.dataset.filter === filter); });
    renderQueue(); renderDetail();
    root.querySelector("[data-yr-count]").textContent = String(cases().length);
  }
  async function load() {
    status("Loading Yoco reconciliation cases…", false);
    try {
      var payload = await request("/functions/v1/reconcile-payment", {method:"POST",body:{limit:100}});
      var requiredCollections = ["attempts","open_cases","evidence","case_actions","refunds",
        "attempts_needing_attention","webhook_events_needing_attention","operational_alerts"];
      if (!payload || payload.ok !== true || payload.environment !== "test" ||
          !requiredCollections.every(function (key) { return Array.isArray(payload[key]); })) {
        throw new Error("The test-environment reconciliation response is incomplete or invalid.");
      }
      if (!payload.open_cases.every(function (item) {
        return item && typeof item.id === "string" && typeof item.status === "string";
      })) {
        throw new Error("The reconciliation case list contains an invalid record.");
      }
      data = payload;
      data.evidence = []; data.case_actions = [];
      historyPage = {evidence_has_more:false,actions_have_more:false};
      if (!selectedId || !cases().some(function (c) { return c.id === selectedId; })) selectedId = cases()[0] ? cases()[0].id : "";
      render();
      if (selectedId) await loadHistory(selectedId, "both");
      status("Read-only Yoco test data refreshed.", false);
    } catch (e) { status(e.message || "Unable to load reconciliation data.", true); }
  }
  async function loadHistory(caseId, kind) {
    if (!data || caseId !== selectedId) return;
    if (kind === "both" ? historyBusy.both : historyBusy[kind]) return;
    var requestId = ++historyRequestId;
    if (kind === "both") historyBusy.both = true;
    else historyBusy[kind] = true;
    var evidenceOffset = kind === "actions" ? 0 : evidenceFor(caseId).length;
    var actionOffset = kind === "evidence" ? 0 : actionsFor(caseId).length;
    if (kind === "both") { evidenceOffset = 0; actionOffset = 0; }
    renderDetail();
    status("Loading case history…", false);
    try {
      var payload = await request("/functions/v1/reconcile-payment", {method:"POST",body:{
        limit:100,history_case_id:caseId,evidence_offset:evidenceOffset,action_offset:actionOffset
      }});
      if (requestId !== historyRequestId || caseId !== selectedId) return;
      if (!payload || payload.ok !== true || payload.environment !== "test" ||
          !Array.isArray(payload.evidence) || !Array.isArray(payload.case_actions) ||
          !payload.history_page || payload.history_page.case_id !== caseId) {
        throw new Error("The paginated case history response is incomplete or invalid.");
      }
      if (kind === "both") {
        data.evidence = payload.evidence;
        data.case_actions = payload.case_actions;
      } else {
        if (kind !== "actions") data.evidence = evidenceFor(caseId).concat(payload.evidence);
        if (kind !== "evidence") data.case_actions = actionsFor(caseId).concat(payload.case_actions);
      }
      historyPage = {
        evidence_has_more: payload.history_page.evidence_has_more === true,
        actions_have_more: payload.history_page.actions_have_more === true
      };
      data.evidence = chronological(data.evidence);
      data.case_actions = chronological(data.case_actions);
      status("Case history loaded.", false);
    } catch (e) { status(e.message || "Unable to load case history.", true); }
    finally {
      if (requestId === historyRequestId) {
        if (kind === "both") historyBusy.both = false;
        else historyBusy[kind] = false;
        if (caseId === selectedId) renderDetail();
      }
    }
  }
  async function submitEvidence(event) {
    event.preventDefault(); if (busy) return;
    var form = event.currentTarget, fd = new FormData(form), c = selected();
    var note = String(fd.get("note") || "").trim(), ref = String(fd.get("reference") || "").trim();
    if (!note || note.length > 2000 || ref.length > 240) return status("Check the evidence note and reference lengths.", true);
    busy = true; status("Saving evidence…", false);
    try {
      await request("/rest/v1/rpc/admin_add_payment_reconciliation_evidence", {method:"POST",body:{
        p_reconciliation_id:c.id,p_evidence_type:fd.get("type"),p_note:note,p_reference:ref || null
      }});
      await load(); status("Evidence recorded in the append-only case history.", false);
    } catch (e) { status(e.message || "Evidence could not be saved.", true); }
    finally { busy = false; }
  }
  async function submitAction(event) {
    event.preventDefault(); if (busy) return;
    var form = event.currentTarget, fd = new FormData(form), c = selected();
    var next = String(fd.get("status") || ""), reason = String(fd.get("reason") || "").trim();
    var outcome = (next === "resolved" || next === "dismissed") ? String(fd.get("outcome") || "") : null;
    var payment = String(fd.get("payment") || "").trim(), refund = String(fd.get("refund") || "").trim();
    if (!reason || reason.length > 2000) return status("A reason between 1 and 2000 characters is required.", true);
    var uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (payment && !uuidPattern.test(payment)) return status("The related payment reference must be a valid UUID.", true);
    if (refund && !uuidPattern.test(refund)) return status("The related refund reference must be a valid UUID.", true);
    if (outcome === "financial_correction_recorded" && !payment && !refund) return status("Provide an existing payment or refund reference for this outcome.", true);
    if (outcome !== "financial_correction_recorded" && (payment || refund)) return status("Financial references can only accompany the financial-correction outcome.", true);
    busy = true; status("Saving case action…", false);
    try {
      await request("/rest/v1/rpc/admin_set_payment_reconciliation_status_v2", {method:"POST",body:{
        p_reconciliation_id:c.id,p_new_status:next,p_reason:reason,p_outcome:outcome,
        p_related_payment_id:payment || null,p_related_refund_id:refund || null,
        p_expected_updated_at:c.updated_at
      }});
      selectedId = ""; await load(); status("Case action recorded.", false);
    } catch (e) {
      var message = e.message || "Case action could not be saved.";
      if (message.indexOf("changed after it was loaded") >= 0) message += " The case was not changed by your request; refresh and review the latest history before retrying.";
      status(message, true);
    }
    finally { busy = false; }
  }
  function mount() {
    if (document.getElementById("sway-yoco-reconciliation")) return;
    var style = document.createElement("style");
    style.textContent = `
      #sway-yoco-reconciliation{position:fixed;right:22px;bottom:78px;z-index:9997;font-family:Montserrat,Arial,sans-serif;color:#101d38}
      #sway-yoco-reconciliation .yr-launch{border:0;border-radius:13px;padding:12px 16px;background:#101d38;color:#fff;font-weight:750;box-shadow:0 10px 30px #07163830;cursor:pointer}
      #sway-yoco-reconciliation .yr-panel{display:none;position:fixed;inset:5vh 2vw 5vh auto;width:min(1120px,96vw);max-height:90vh;overflow:hidden;background:#fff;border:1px solid #dce5f2;border-radius:20px;box-shadow:0 24px 80px #07163845}
      #sway-yoco-reconciliation[data-open=true] .yr-panel{display:flex;flex-direction:column}
      #sway-yoco-reconciliation .yr-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 22px;border-bottom:1px solid #e7edf6}
      #sway-yoco-reconciliation .yr-head h2{font:750 18px Raleway,Arial;margin:0 0 4px}
      #sway-yoco-reconciliation .yr-head p{font-size:11px;color:#69758b;margin:0}
      #sway-yoco-reconciliation .yr-head-actions{display:flex;gap:8px;align-items:center}
      #sway-yoco-reconciliation button{font:700 11px Montserrat,Arial;cursor:pointer}
      #sway-yoco-reconciliation .yr-refresh,#sway-yoco-reconciliation .yr-close{border:1px solid #dce4ef;border-radius:9px;background:#fff;padding:9px 11px;color:#23314b}
      #sway-yoco-reconciliation .yr-close{font-size:18px}
      #sway-yoco-reconciliation [data-yr-status]{padding:8px 22px;color:#17633d;background:#f1f8f4;font-size:11px}
      #sway-yoco-reconciliation [data-yr-status][data-error=true]{color:#a52a2a;background:#fff3f2}
      #sway-yoco-reconciliation .yr-body{display:grid;grid-template-columns:minmax(260px,34%) 1fr;min-height:0;flex:1}
      #sway-yoco-reconciliation .yr-queue-pane{min-height:0;overflow:auto;border-right:1px solid #e7edf6;padding:15px}
      #sway-yoco-reconciliation .yr-queue-tools{display:grid;gap:10px;margin-bottom:12px}
      #sway-yoco-reconciliation input,#sway-yoco-reconciliation select,#sway-yoco-reconciliation textarea{width:100%;box-sizing:border-box;border:1px solid #d7dfec;border-radius:9px;padding:10px;background:#fff;color:#14213b;font:12px Montserrat,Arial}
      #sway-yoco-reconciliation .yr-filters{display:flex;gap:6px}
      #sway-yoco-reconciliation .yr-filter{border:1px solid #dce4ef;background:#fff;color:#5b6880;border-radius:8px;padding:7px 9px}
      #sway-yoco-reconciliation .yr-filter.is-active{background:#edf3ff;border-color:#b9cdfa;color:#0031c5}
      #sway-yoco-reconciliation .yr-case{display:grid;gap:7px;width:100%;text-align:left;padding:12px;margin:0 0 8px;border:1px solid #e3e9f2;border-radius:11px;background:#fff;color:#17233b}
      #sway-yoco-reconciliation .yr-case.is-selected{border-color:#3675ec;background:#f5f8ff}
      #sway-yoco-reconciliation .yr-case-top{display:flex;justify-content:space-between;gap:8px;align-items:center}
      #sway-yoco-reconciliation .yr-case-top b{font-size:11px;text-transform:capitalize}
      #sway-yoco-reconciliation .yr-case-top i{font-style:normal;color:#52627c;font-size:10px}
      #sway-yoco-reconciliation .yr-case>span:nth-child(2){font-size:11px;line-height:1.5;color:#526079}
      #sway-yoco-reconciliation .yr-case small{font-size:9px;color:#8792a5}
      #sway-yoco-reconciliation .yr-detail{min-width:0;min-height:0;overflow:auto;padding:22px}
      #sway-yoco-reconciliation .yr-detail-head{display:flex;justify-content:space-between;gap:15px}
      #sway-yoco-reconciliation .yr-eyebrow{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#4774c5;font-weight:800}
      #sway-yoco-reconciliation .yr-detail h3{font:750 21px Raleway,Arial;text-transform:capitalize;margin:6px 0}
      #sway-yoco-reconciliation .yr-detail-head p{font-size:12px;line-height:1.6;color:#596780}
      #sway-yoco-reconciliation .yr-status{height:max-content;border-radius:20px;padding:7px 10px;background:#edf3ff;color:#244eaa;font-size:10px;font-weight:750}
      #sway-yoco-reconciliation .yr-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:16px 0;padding:14px;background:#f6f8fc;border-radius:12px}
      #sway-yoco-reconciliation .yr-facts>div{display:grid;gap:4px;min-width:0}
      #sway-yoco-reconciliation .yr-facts small,#sway-yoco-reconciliation .yr-muted{font-size:10px;color:#738098}
      #sway-yoco-reconciliation code{font-size:10px;overflow-wrap:anywhere;color:#34425d}
      #sway-yoco-reconciliation .yr-section{border-top:1px solid #e8edf4;padding:16px 0}
      #sway-yoco-reconciliation .yr-section h4{font:750 13px Raleway,Arial;margin:0 0 12px}
      #sway-yoco-reconciliation .yr-evidence,#sway-yoco-reconciliation .yr-history{padding:11px 0;border-bottom:1px solid #edf0f5}
      #sway-yoco-reconciliation .yr-evidence>div,#sway-yoco-reconciliation .yr-history>div{display:flex;justify-content:space-between;gap:12px}
      #sway-yoco-reconciliation .yr-evidence b,#sway-yoco-reconciliation .yr-history b{font-size:11px;text-transform:capitalize}
      #sway-yoco-reconciliation time,#sway-yoco-reconciliation .yr-evidence small,#sway-yoco-reconciliation .yr-history small{font-size:9px;color:#77849a}
      #sway-yoco-reconciliation .yr-evidence p,#sway-yoco-reconciliation .yr-history p{font-size:11px;line-height:1.6;color:#4f5d75;white-space:pre-wrap;overflow-wrap:anywhere}
      #sway-yoco-reconciliation .yr-form{display:grid;gap:10px;margin-top:12px}
      #sway-yoco-reconciliation .yr-form label{display:grid;gap:6px;font-size:10px;font-weight:750;color:#46536a}
      #sway-yoco-reconciliation textarea{min-height:76px;resize:vertical}
      #sway-yoco-reconciliation .yr-primary{border:0;border-radius:9px;padding:11px 14px;background:linear-gradient(110deg,#002096,#0152f4);color:#fff}
      #sway-yoco-reconciliation .yr-empty,#sway-yoco-reconciliation .yr-empty-detail{padding:20px;color:#7b879b;font-size:11px;line-height:1.6}
      #sway-yoco-reconciliation .yr-empty-detail strong{color:#25324a;font-size:14px}
      @media(max-width:760px){
        #sway-yoco-reconciliation{right:12px;bottom:70px}
        #sway-yoco-reconciliation .yr-panel{inset:2vh 2vw;width:96vw;max-height:96vh;border-radius:15px}
        #sway-yoco-reconciliation .yr-body{grid-template-columns:1fr;grid-template-rows:minmax(130px,28%) 1fr}
        #sway-yoco-reconciliation .yr-queue-pane{border-right:0;border-bottom:1px solid #e7edf6;padding:10px}
        #sway-yoco-reconciliation .yr-detail{padding:14px}
        #sway-yoco-reconciliation .yr-head{padding:13px}
        #sway-yoco-reconciliation .yr-head h2{font-size:15px}
      }
    `;
    document.head.appendChild(style);
    root = document.createElement("div");
    root.id = "sway-yoco-reconciliation";
    root.innerHTML = '<button type="button" class="yr-launch" data-open-panel>Payment reconciliation</button>' +
      '<section class="yr-panel" role="dialog" aria-modal="true" aria-label="Yoco payment reconciliation">' +
      '<header class="yr-head"><div><h2>Payment reconciliation <span data-yr-count>0</span></h2><p>Administrator workflow · Yoco test environment only</p></div>' +
      '<div class="yr-head-actions"><button type="button" class="yr-refresh" data-refresh>Refresh</button><button type="button" class="yr-close" data-close aria-label="Close">×</button></div></header>' +
      '<div data-yr-status role="status" aria-live="polite"></div><div class="yr-body">' +
      '<aside class="yr-queue-pane"><div class="yr-queue-tools"><input data-yr-search type="search" placeholder="Search cases" aria-label="Search reconciliation cases">' +
      '<div class="yr-filters"><button class="yr-filter is-active" data-filter="all">All</button><button class="yr-filter" data-filter="open">Open</button><button class="yr-filter" data-filter="investigating">Investigating</button></div></div><div data-yr-queue></div></aside>' +
      '<main class="yr-detail" data-yr-detail></main></div></section>';
    document.body.appendChild(root);
    root.querySelector("[data-open-panel]").addEventListener("click", function () {
      root.setAttribute("data-open", "true"); if (!data) load();
    });
    root.querySelector("[data-close]").addEventListener("click", function () { root.setAttribute("data-open", "false"); });
    root.querySelector("[data-refresh]").addEventListener("click", load);
    root.querySelector("[data-yr-search]").addEventListener("input", renderQueue);
    root.querySelectorAll("[data-filter]").forEach(function (b) { b.addEventListener("click", function () { filter = b.dataset.filter; render(); }); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, {once:true});
  else mount();
})();