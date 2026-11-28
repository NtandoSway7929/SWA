(function () {
  "use strict";

  var SUPABASE_URL = "https://sqifhribgsqfaxgtobsa.supabase.co";
  var PUBLISHABLE_KEY = "sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QbH";
  var quoteRows = new Map();
  var agreementRows = new Map();
  var projectRows = new Map();
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
        request("/rest/v1/quotes?select=id,title,amount,status,quote_number,lead_id,client_id,invoice_id,proposal_id&order=created_at.desc"),
        request("/rest/v1/swayphics_project_agreements?select=id,agreement_number,quote_id,proposal_id,proposal_version_id,lead_id,client_id,agreement_title,proposal_snapshot,commercial_snapshot,terms_url,terms_document_sha,terms_acceptance_statement,accepted_by_name,accepted_by_email,accepted_at&order=accepted_at.desc"),
        request("/rest/v1/client_projects?select=id,client_id,name,status,due_date,value,payment_status,source_quote_id,source_agreement_id&source_quote_id=not.is.null&order=created_at.desc")
      ]);
      quoteRows = new Map((Array.isArray(results[0]) ? results[0] : []).map(function (quote) {
        return [String(quote.id), quote];
      }));
      agreementRows = new Map();
      (Array.isArray(results[1]) ? results[1] : []).forEach(function (agreement) {
        var key = String(agreement.quote_id);
        if (!agreementRows.has(key)) agreementRows.set(key, agreement);
      });
      projectRows = new Map();
      (Array.isArray(results[2]) ? results[2] : []).forEach(function (project) {
        var key = String(project.source_quote_id);
        if (key && !projectRows.has(key)) projectRows.set(key, project);
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

  function projectServiceSummary(items) {
    var names = [];
    (Array.isArray(items) ? items : []).forEach(function (item) {
      var name = String(item.service_name_snapshot || "").trim();
      if (name && names.indexOf(name) === -1) names.push(name);
    });
    return names.join(", ").slice(0, 300);
  }

  function projectScopeSummary(items) {
    return (Array.isArray(items) ? items : []).map(function (item) {
      var name = String(item.service_name_snapshot || "Service").trim();
      var description = String(item.description || "").trim();
      var quantity = Number(item.quantity || 1);
      var interval = String(item.billing_interval || "none");
      var line = name + (quantity > 1 ? " × " + quantity : "");
      if (description) line += "\n" + description;
      if (interval === "monthly") line += "\nBilling: monthly";
      if (interval === "yearly") line += "\nBilling: yearly";
      return line;
    }).filter(Boolean).join("\n\n").slice(0, 12000);
  }

  async function openProjectKickoff(quote, agreement, actionButton) {
    var originalText = actionButton.textContent;
    actionButton.disabled = true;
    actionButton.textContent = "Loading scope...";
    try {
      var items = await request(
        "/rest/v1/quote_items?select=service_name_snapshot,description,quantity,billing_interval,position&quote_id=eq." +
        encodeURIComponent(String(quote.id)) + "&order=position.asc"
      );
      if (!Array.isArray(items) || !items.length) {
        throw new Error("The accepted quote has no saved service line items. Review the quotation before starting the project.");
      }

      var overlay = document.createElement("div");
      overlay.className = "sway-modal sway-project-kickoff-modal";
      overlay.innerHTML =
        '<div class="sway-modal-backdrop" data-kickoff-close></div>' +
        '<section class="sway-modal-card sway-project-kickoff-card" role="dialog" aria-modal="true" aria-labelledby="sway-project-kickoff-title">' +
          '<header class="sway-modal-header"><div><span class="admin-label">SWAYPHICS · PROJECT KICKOFF</span><h3 id="sway-project-kickoff-title">Create project</h3><p class="sway-project-kickoff-subtitle"></p></div><button type="button" class="sway-modal-close" data-kickoff-close aria-label="Close project kickoff">×</button></header>' +
          '<form class="sway-project-kickoff-form" novalidate>' +
            '<label>Project name<input name="project_name" type="text" minlength="2" maxlength="160" required></label>' +
            '<label>Accepted services<input name="service" type="text" maxlength="300"></label>' +
            '<label>Project scope and delivery notes<textarea name="description" rows="5" maxlength="12000"></textarea></label>' +
            '<label>Target date <span>(optional, project defaults apply when blank)</span><input name="due_date" type="date"></label>' +
            '<div class="sway-project-kickoff-summary"><strong>Accepted scope</strong><p data-kickoff-scope></p></div>' +
            '<p class="sway-project-kickoff-note">This is an administrator-confirmed action. The project starts in Planning, uses the existing project task template and is linked to the accepted agreement. Any existing or subsequently created invoice for this quotation is linked to the project. Client onboarding and file uploads remain available through the existing client portal.</p>' +
            '<div class="sway-project-kickoff-actions"><button type="button" class="sway-workspace-button secondary" data-kickoff-close>Cancel</button><button type="submit" class="sway-workspace-button primary" data-kickoff-submit>Create project</button></div>' +
          '</form>' +
        '</section>';

      var subtitle = overlay.querySelector(".sway-project-kickoff-subtitle");
      subtitle.textContent = [
        quote.quote_number || "Accepted quotation",
        agreement.agreement_number || "Accepted agreement"
      ].join(" · ");
      var form = overlay.querySelector("form");
      form.elements.project_name.value = String(quote.title || quote.quote_number || "New client project").slice(0, 160);
      form.elements.service.value = projectServiceSummary(items);
      form.elements.description.value = projectScopeSummary(items);
      overlay.querySelector("[data-kickoff-scope]").textContent =
        items.length + " accepted service line" + (items.length === 1 ? "" : "s") +
        " will be carried into the project record. The accepted commercial agreement remains unchanged.";

      overlay.querySelectorAll("[data-kickoff-close]").forEach(function (button) {
        button.addEventListener("click", function () { overlay.remove(); });
      });

      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        var name = String(form.elements.project_name.value || "").trim();
        var service = String(form.elements.service.value || "").trim();
        var description = String(form.elements.description.value || "").trim();
        var dueDate = String(form.elements.due_date.value || "").trim();
        if (name.length < 2 || name.length > 160) {
          form.elements.project_name.setCustomValidity("Enter a project name between 2 and 160 characters.");
          form.elements.project_name.reportValidity();
          form.elements.project_name.setCustomValidity("");
          return;
        }
        if (service.length > 300 || description.length > 12000) return;

        var submit = form.querySelector("[data-kickoff-submit]");
        submit.disabled = true;
        submit.textContent = "Creating project...";
        try {
          var result = await rpc("admin_create_project_from_accepted_quote", {
            p_quote_id: quote.id,
            p_project_name: name,
            p_service: service || null,
            p_description: description || null,
            p_due_date: dueDate || null,
            p_assigned_to: null
          });
          if (!result || result.success !== true || !result.project_id) {
            throw new Error("The accepted quote could not be converted into a project.");
          }
          overlay.remove();
          await refreshSalesHandoffState();
          renderActions();
          notify(
            (result.already_created ? "Existing project returned: " : "Project created: ") +
            String(result.project_name || name) +
            ". " + String(result.task_count || 0) + " project task(s) are attached. " +
            (result.invoice_linked ? "The accepted quote invoice is linked to the project. " : "") +
            "The project is available in the Projects workspace and client portal."
          );
        } catch (error) {
          submit.disabled = false;
          submit.textContent = "Create project";
          notify(error && error.message ? error.message : "Unable to create the project.");
        }
      });

      document.body.append(overlay);
      form.elements.project_name.focus();
    } catch (error) {
      notify(error && error.message ? error.message : "Unable to load the accepted quote scope.");
    } finally {
      actionButton.disabled = false;
      actionButton.textContent = originalText;
    }
  }

  function renderCard(card, quote) {
    var quoteId = String(quote.id);
    var accepted = String(quote.status || "") === "accepted";
    var hasClient = Boolean(quote.client_id);
    var agreement = agreementRows.get(quoteId);
    var project = projectRows.get(quoteId);
    var invoiceButton = card.querySelector('[data-create-invoice-from-quote="' + quoteId + '"]');
    if (invoiceButton) invoiceButton.hidden = accepted && (!hasClient || !agreement);

    var existing = card.querySelector("[data-accepted-quote-handoff]");
    var state = !accepted ? "not-accepted" :
      hasClient ? (agreement ? "client-agreement" : "client-no-agreement") :
      quote.lead_id ? (agreement ? "lead-awaiting-client" : "lead-missing-agreement") : "no-client-link";
    state += project ? "-project-" + String(project.id) + "-" + String(project.status || "") : "-no-project";

    if (existing && existing.getAttribute("data-handoff-state") === state) return;
    if (existing) existing.remove();
    if (!accepted) return;

    var actionHost = card.querySelector(".sway-record-card-actions");
    if (!actionHost) return;

    var actions = document.createElement("div");
    actions.className = "accepted-quote-handoff-actions";
    actions.setAttribute("data-accepted-quote-handoff", quoteId);
    actions.setAttribute("data-handoff-state", state);

    if (!hasClient && quote.lead_id && agreement) {
      actions.append(createAction(
        "Convert to client",
        "sway-row-action accepted-quote-convert",
        function () { convertAcceptedQuote(quote, actions.querySelector("button")); }
      ));
      var note = document.createElement("small");
      note.textContent = "Client conversion is required before an invoice can be created.";
      actions.append(note);
    } else if (!hasClient && quote.lead_id) {
      actions.append(createAction("Client acceptance required", "sway-row-action accepted-quote-static", null, true));
      var missingAgreementNote = document.createElement("small");
      missingAgreementNote.textContent = "A recorded proposal and Terms & Conditions acceptance is required before client conversion.";
      actions.append(missingAgreementNote);
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
      missingAgreement.textContent = hasClient
        ? "Invoice creation is disabled until a recorded proposal and Terms & Conditions acceptance is available."
        : "No agreement snapshot is recorded for this quotation.";
      actions.append(missingAgreement);
    }

    if (accepted && hasClient && agreement) {
      if (project) {
        actions.append(createAction(
          "Project created",
          "sway-row-action accepted-quote-static",
          null,
          true
        ));
        var projectNote = document.createElement("small");
        projectNote.textContent = String(project.name || "Project") +
          " · " + String(project.status || "planning") +
          (project.due_date ? " · Due " + String(project.due_date) : "") +
          ". Manage delivery and client onboarding in the Projects workspace and client portal.";
        actions.append(projectNote);
      } else {
        actions.append(createAction(
          "Create project",
          "sway-row-action accepted-quote-project-create",
          function (event) {
            openProjectKickoff(quote, agreement, event.currentTarget);
          }
        ));
        var kickoffNote = document.createElement("small");
        kickoffNote.textContent = "Start delivery from the accepted scope. The agreement and pricing snapshot will remain unchanged.";
        actions.append(kickoffNote);
      }
    }

    actionHost.insertAdjacentElement("afterend", actions);
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