(function () {
  "use strict";

  var SUPABASE_URL = "https://sqifhribgsqfaxgtobsa.supabase.co";
  var PUBLISHABLE_KEY = "sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QbH";
  var quoteRows = new Map();
  var responseRows = new Map();
  var refreshInFlight = null;
  var observer = null;
  var renderTimer = null;

  function adminToken() {
    try {
      return localStorage.getItem("swayphics_admin_access_token") || "";
    } catch (_) {
      return "";
    }
  }

  function notify(message) {
    if (typeof window.swayAlert === "function") window.swayAlert(message);
    else window.alert(message);
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
    var body = {};
    try { body = await response.json(); } catch (_) {}
    if (!response.ok) {
      throw new Error(body.message || body.error_description || body.error || "The proposal service could not complete the request.");
    }
    return body;
  }

  async function rpc(name, payload) {
    return request("/rest/v1/rpc/" + name, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload || {})
    });
  }

  async function refreshQuoteState() {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async function () {
      if (window.swayphicsAdminSessionReady) {
        await window.swayphicsAdminSessionReady;
      }
      var [quotes, responses] = await Promise.all([
        request("/rest/v1/quotes?select=id,status,quote_number,proposal_id,proposal_version_id,valid_until&order=created_at.desc"),
        request("/rest/v1/quote_review_responses?select=quote_id,decision,respondent_name,respondent_email,message,submitted_at&order=submitted_at.desc")
      ]);
      quoteRows = new Map((Array.isArray(quotes) ? quotes : []).map(function (row) {
        return [String(row.id), row];
      }));
      responseRows = new Map();
      (Array.isArray(responses) ? responses : []).forEach(function (row) {
        var key = String(row.quote_id);
        if (!responseRows.has(key)) responseRows.set(key, row);
      });
    })();
    try {
      await refreshInFlight;
    } finally {
      refreshInFlight = null;
    }
  }

  function quoteIdFromCard(card) {
    var value = String(card.getAttribute("data-ai-record") || "");
    return value.indexOf("quotes:") === 0 ? value.slice(7) : "";
  }

  function addAction(card, quoteId, row) {
    var editButton = card.querySelector('button[data-edit="quotes"]');
    if (!editButton || card.querySelector("[data-proposal-delivery-action]")) return;

    var action = document.createElement("button");
    action.type = "button";
    action.className = "sway-row-action";
    action.setAttribute("data-proposal-delivery-action", quoteId);

    var response = responseRows.get(quoteId);
    if (response) {
      action.textContent = "View client response";
      action.addEventListener("click", function () { showResponse(response, row); });
    } else if (row.status === "draft" && row.proposal_id && row.proposal_version_id) {
      action.textContent = "Send for review";
      action.addEventListener("click", function () { sendForReview(quoteId, row, action); });
    } else if (row.status === "sent") {
      action.textContent = "Awaiting response";
      action.disabled = true;
      action.classList.add("proposal-delivery-static");
    } else {
      return;
    }
    editButton.insertAdjacentElement("afterend", action);
  }

  function renderActions() {
    document.querySelectorAll('article[data-ai-record^="quotes:"]').forEach(function (card) {
      var quoteId = quoteIdFromCard(card);
      var row = quoteRows.get(quoteId);
      if (!row) return;
      addAction(card, quoteId, row);
    });
  }

  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = window.setTimeout(function () {
      renderTimer = null;
      renderActions();
    }, 180);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function expiryLabel(value) {
    if (!value) return "the expiry date shown on the review page";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "the expiry date shown on the review page";
    return new Intl.DateTimeFormat("en-ZA", { dateStyle: "long" }).format(date);
  }

  async function sendForReview(quoteId, quote, button) {
    if (!window.confirm("Send this approved proposal and its linked quotation to the saved lead or client email address?")) return;
    var originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Preparing...";
    var issued = null;
    try {
      issued = await rpc("admin_issue_swayphics_quote_review", { p_quote_id: quoteId });
      if (!issued || !issued.token || !issued.review_link_id || !issued.recipient_email) {
        throw new Error("The secure review link could not be prepared.");
      }

      var reviewUrl = "https://swayphics.co.za/proposal-review/?token=" + encodeURIComponent(issued.token);
      var recipient = String(issued.recipient_name || "").trim();
      var business = String(issued.business_name || "your business").trim();
      var greeting = recipient ? "Hello " + escapeHtml(recipient) + "," : "Hello,";
      var quoteLabel = escapeHtml(issued.quote_number || "your quotation");
      var proposalTitle = escapeHtml(issued.proposal_title || "your proposal");
      var htmlMessage =
        "<p>" + greeting + "</p>" +
        "<p>We have prepared <strong>" + proposalTitle + "</strong> and the accompanying commercial quotation for " + escapeHtml(business) + ".</p>" +
        "<p>The quotation reference is <strong>" + quoteLabel + "</strong>. The review page includes the project scope, deliverables, once-off investment and any recurring charges.</p>" +
        '<p style="margin:24px 0;"><a href="' + reviewUrl + '" style="display:inline-block;background:#0152F4;color:#FFFFFF;text-decoration:none;padding:13px 20px;border-radius:8px;font-weight:700;">Review proposal</a></p>' +
        "<p>This private review link is available until " + escapeHtml(expiryLabel(issued.expires_at)) + ". You can accept or decline the quotation directly on the review page.</p>" +
        "<p>Kind regards,<br><strong>Swayphics</strong></p>";

      button.textContent = "Sending...";
      var emailResult = await request("/functions/v1/send-email", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          contact_type: issued.contact_type,
          contact_id: issued.contact_id,
          recipient_email: issued.recipient_email,
          subject: "Your Swayphics proposal | " + String(issued.quote_number || ""),
          message: htmlMessage,
          proposal_type: "not-website-related"
        })
      });
      if (!emailResult || emailResult.success !== true) {
        throw new Error(emailResult && emailResult.error ? emailResult.error : "The email service did not confirm delivery.");
      }

      await refreshQuoteState();
      renderActions();
      notify("Proposal " + String(issued.quote_number || "") + " sent to " + issued.recipient_email + ". The quotation is now awaiting the client's response.");
    } catch (error) {
      var recoveryMessage = "";
      if (issued && issued.review_link_id) {
        try {
          await rpc("admin_revoke_swayphics_quote_review", {
            p_review_link_id: issued.review_link_id,
            p_reason: "Proposal email delivery did not complete successfully."
          });
          await refreshQuoteState();
          renderActions();
          recoveryMessage = " The review link was revoked and the quotation was returned to draft.";
        } catch (revokeError) {
          recoveryMessage = " The delivery attempt could not be confirmed and the review link could not be automatically revoked. Check this quote's status before retrying.";
        }
      }
      button.disabled = false;
      button.textContent = originalText;
      notify((error && error.message ? error.message : "The proposal could not be sent.") + recoveryMessage);
    }
  }

  function showResponse(response, quote) {
    var date = response.submitted_at ? new Date(response.submitted_at).toLocaleString("en-ZA") : "Date not recorded";
    var decision = response.decision === "accepted" ? "ACCEPTED" : "DECLINED";
    var message = [
      "Quote: " + String(quote.quote_number || "Quotation"),
      "Decision: " + decision,
      "Name: " + String(response.respondent_name || "Not supplied"),
      "Email: " + String(response.respondent_email || "Not supplied"),
      "Submitted: " + date,
      response.message ? "Message: " + response.message : "Message: None"
    ].join("\n\n");
    notify(message);
  }

  async function start() {
    try {
      if (window.swayphicsAdminSessionReady) {
        await window.swayphicsAdminSessionReady;
      }
      if (!adminToken()) return;
      await refreshQuoteState();
      renderActions();
      observer = new MutationObserver(scheduleRender);
      observer.observe(document.body, { childList: true, subtree: true });
      window.addEventListener("focus", function () {
        refreshQuoteState().then(renderActions).catch(function () {});
      });
    } catch (error) {
      // A temporarily unavailable admin table must not interrupt dashboard use.
      console.warn("Proposal delivery actions are temporarily unavailable:", error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();