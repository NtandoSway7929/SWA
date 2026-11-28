(function () {
  "use strict";

  var SUPABASE_URL = "https://sqifhribgsqfaxgtobsa.supabase.co";
  var PUBLISHABLE_KEY = "sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QbH";
  var quoteRows = new Map();
  var agreementRows = new Map();
  var refreshPromise = null;
  var renderTimer = null;
  var observer = null;

  function adminToken() {
    try {
      return localStorage.getItem("swayphics_admin_access_token") || "";
    } catch (_) {
      return "";
    }
  }

  function authHeaders(extra) {
    var token = adminToken();
    if (!token) throw new Error("Your Swayphics admin session has expired. Sign in again.");
    var headers = {
      "apikey": PUBLISHABLE_KEY,
      "Authorization": "Bearer " + token
    };
    Object.keys(extra || {}).forEach(function (key) { headers[key] = extra[key]; });
    return headers;
  }

  async function request(path, options) {
    var response = await fetch(SUPABASE_URL + path, Object.assign({
      method: "GET",
      headers: authHeaders()
    }, options || {}));
    var payload = {};
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok) {
      var error = new Error(payload.message || payload.error_description || payload.error || "The sales handoff request could not be completed.");
      error.httpStatus = response.status;
      throw error;
    }
    return payload;
  }

  async function rpc(name, payload) {
    return request("/rest/v1/rpc/" + name, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload || {})
    });
  }

  function notify(message) {
    if (typeof window.swayAlert === "function") window.swayAlert(message);
    else window.alert(message);
  }

  async function refreshSalesHandoffState() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async function () {
      if (window.swayphicsAdminSessionReady) await window.swayphicsAdminSessionReady;
      var results = await Promise.all([
        request("/rest/v1/quotes?select=id,status,quote_number,lead_id,client_id,invoice_id,proposal_id&order=created_at.desc"),
        request("/rest/v1/swayphics_project_agreements?select=id,agreement_number,quote_id,proposal_id,proposal_version_id,lead_id,client_id,agreement_title,proposal_snapshot,commercial_snapshot,terms_url,terms_document_sha,terms_acceptance_statement,accepted_by_name,accepted_by_email,accepted_at&order=accepted_at.desc")
      ]);
      quoteRows = new Map((Array.isArray(results[0]) ? results[0] : []).map(function (quote) {
        return [String(quote.id), quote];
      }));
      agreementRows = new Map();
      (Array.isArray(results[1]) ? results[1] : []).forEach(function (agreement) {
        var key = String(agreement.quote_id);
        if (!agreementRows.has(key)) agreementRows.set(key, agreement);
      });
    })();
    try {
      await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  }

  function quoteIdFromCard(card) {
    var identity = String(card.getAttribute("data-ai-record") || "");
    return identity.indexOf("quotes:") === 0 ? identity.slice(7) : "";
  }

  function createAction(label, className, handler, disabled) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = className || "sway-row-action";
    button.textContent = label;
    button.disabled = Boolean(disabled);
    if (handler) button.addEventListener("click", handler);
    return button;
  }

  function showAgreement(agreement, quote) {
    var overlay = document.createElement("div");
    overlay.className = "sway-modal sway-project-agreement-modal";
    overlay.innerHTML =
      '<div class="sway-modal-backdrop" data-agreement-close></div>' +
      '<section class="sway-modal-card sway-project-agreement-card" role="dialog" aria-modal="true" aria-labelledby="sway-project-agreement-title">' +
        '<header class="sway-modal-header"><div><span class="admin-label">SWAYPHICS · ACCEPTED AGREEMENT</span><h3 id="sway-project-agreement-title">Accepted project agreement</h3><p class="sway-project-agreement-subtitle"></p></div><button type="button" class="sway-modal-close" data-agreement-close aria-label="Close agreement">×</button></header>' +
        '<div class="sway-project-agreement-content">' +
          '<section><strong>Accepted proposal</strong><div data-agreement-proposal></div></section>' +
          '<section><strong>Commercial snapshot</strong><div data-agreement-commercial></div></section>' +
          '<section><strong>Terms acknowledgement</strong><div data-agreement-terms></div></section>' +
        '</div>' +
        '<footer class="sway-project-agreement-footer"><button type="button" class="sway-workspace-button" data-agreement-close>Close</button></footer>' +
      '</section>';

    var subtitle = overlay.querySelector(".sway-project-agreement-subtitle");
    subtitle.textContent = [
      agreement.agreement_number || "Agreement",
      quote && quote.quote_number ? quote.quote_number : "",
      agreement.accepted_at ? new Date(agreement.accepted_at).toLocaleString("en-ZA") : ""
    ].filter(Boolean).join(" · ");

    function appendSnapshot(host, snapshot) {
      var pre = document.createElement("pre");
      pre.textContent = JSON.stringify(snapshot || {}, null, 2);
      host.append(pre);
    }

    appendSnapshot(overlay.querySelector("[data-agreement-proposal]"), agreement.proposal_snapshot);
    appendSnapshot(overlay.querySelector("[data-agreement-commercial]"), agreement.commercial_snapshot);

    var termsHost = overlay.querySelector("[data-agreement-terms]");
    var acceptedBy = document.createElement("p");
    acceptedBy.textContent = "Accepted by " + String(agreement.accepted_by_name || "Not recorded") +
      (agreement.accepted_by_email ? " (" + agreement.accepted_by_email + ")" : "");
    var statement = document.createElement("p");
    statement.textContent = String(agreement.terms_acceptance_statement || "Terms acknowledgement recorded.");
    var termsLink = document.createElement("a");
    termsLink.href = agreement.terms_url || "https://swayphics.co.za/terms-and-conditions/";
    termsLink.target = "_blank";
    termsLink.rel = "noopener noreferrer";
    termsLink.textContent = "Open the Swayphics Terms & Conditions";
    var hash = document.createElement("small");
    hash.textContent = "Terms document reference: " + String(agreement.terms_document_sha || "Not recorded");
    termsHost.append(acceptedBy, statement, termsLink, hash);

    overlay.querySelectorAll("[data-agreement-close]").forEach(function (button) {
      button.addEventListener("click", function () { overlay.remove(); });
    });
    document.body.append(overlay);
    var closeButton = overlay.querySelector("[data-agreement-close]");
    if (closeButton) closeButton.focus();
  }

  async function convertAcceptedQuote(quote, button) {
    if (!window.confirm("Convert the lead linked to " + String(quote.quote_number || "this accepted quote") + " into a Swayphics client? The accepted quotation and agreement will remain unchanged apart from their client association.")) {
      return;
    }
    var originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Converting...";
    try {
      var result = await rpc("admin_convert_accepted_quote_to_client", {
        p_quote_id: quote.id
      });
      if (!result || result.success !== true || !result.client_id) {
        throw new Error("The accepted quote could not be converted into a client record.");
      }
      notify(
        "Client created: " + String(result.business_name || "Client") +
        ". The accepted quotation and agreement are now linked to the client. The Quotes workspace will refresh to expose the existing invoice action."
      );
      window.setTimeout(function () { window.location.reload(); }, 450);
    } catch (error) {
      button.disabled = false;
      button.textContent = originalText;
      notify(error && error.message ? error.message : "Unable to convert this accepted quote into a client.");
    }
  }

  function renderCard(card, quote) {
    var quoteId = String(quote.id);
    var accepted = String(quote.status || "") === "accepted";
    var hasClient = Boolean(quote.client_id);
    var agreement = agreementRows.get(quoteId);
    var invoiceButton = card.querySelector('[data-create-invoice-from-quote="' + quoteId + '"]');
    if (invoiceButton) invoiceButton.hidden = accepted && !hasClient;

    var existing = card.querySelector("[data-accepted-quote-handoff]");
    var state = !accepted ? "not-accepted" :
      hasClient ? (agreement ? "client-agreement" : "client-no-agreement") :
      quote.lead_id ? "lead-awaiting-client" : "no-client-link";

    if (existing && existing.getAttribute("data-handoff-state") === state) return;
    if (existing) existing.remove();
    if (!accepted) return;

    var editButton = card.querySelector('button[data-edit="quotes"]');
    if (!editButton) return;

    var actions = document.createElement("div");
    actions.className = "accepted-quote-handoff-actions";
    actions.setAttribute("data-accepted-quote-handoff", quoteId);
    actions.setAttribute("data-handoff-state", state);

    if (!hasClient && quote.lead_id) {
      actions.append(createAction(
        "Convert to client",
        "sway-row-action accepted-quote-convert",
        function () { convertAcceptedQuote(quote, actions.querySelector("button")); }
      ));
      var note = document.createElement("small");
      note.textContent = "Client conversion is required before an invoice can be created.";
      actions.append(note);
    } else if (!hasClient) {
      actions.append(createAction("Client conversion required", "sway-row-action accepted-quote-static", null, true));
    }

    if (agreement) {
      actions.append(createAction(
        "View accepted agreement",
        "sway-row-action accepted-quote-agreement",
        function () { showAgreement(agreement, quote); }
      ));
    } else {
      var missingAgreement = document.createElement("small");
      missingAgreement.className = "accepted-quote-agreement-note";
      missingAgreement.textContent = "No agreement snapshot is recorded for this quotation.";
      actions.append(missingAgreement);
    }

    editButton.insertAdjacentElement("afterend", actions);
  }

  function renderActions() {
    document.querySelectorAll('article[data-ai-record^="quotes:"]').forEach(function (card) {
      var id = quoteIdFromCard(card);
      var quote = quoteRows.get(id);
      if (quote) renderCard(card, quote);
    });
  }

  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = window.setTimeout(function () {
      renderTimer = null;
      var missing = Array.prototype.some.call(
        document.querySelectorAll('article[data-ai-record^="quotes:"]'),
        function (card) {
          var id = quoteIdFromCard(card);
          return id && !quoteRows.has(id);
        }
      );
      if (missing) {
        refreshSalesHandoffState().then(renderActions).catch(function () {});
      } else {
        renderActions();
      }
    }, 180);
  }

  async function start() {
    try {
      if (window.swayphicsAdminSessionReady) await window.swayphicsAdminSessionReady;
      if (!adminToken()) return;
      await refreshSalesHandoffState();
      renderActions();
      observer = new MutationObserver(scheduleRender);
      observer.observe(document.body, { childList: true, subtree: true });
      window.addEventListener("focus", function () {
        refreshSalesHandoffState().then(renderActions).catch(function () {});
      });
    } catch (error) {
      console.warn("Accepted quote sales handoff actions are temporarily unavailable:", error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();