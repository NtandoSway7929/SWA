(function () {
  "use strict";

  if (window.swayphicsStandardLeadConsentLoaded) return;
  window.swayphicsStandardLeadConsentLoaded = true;

  const SUPABASE_URL = "https://sqifhribgsqfaxgtobsa.supabase.co";
  const SUPABASE_KEY = "sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QhB";
  const records = new Map();
  let loaded = false;
  let loading = null;
  let observer = null;

  function authHeaders(extra) {
    const accessToken = localStorage.getItem("swayphics_admin_access_token");
    if (!accessToken) throw new Error("Your administrator session has expired. Sign in again.");
    return Object.assign({
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + accessToken,
      Accept: "application/json"
    }, extra || {});
  }

  async function request(path, options) {
    const response = await fetch(SUPABASE_URL + "/rest/v1/" + path, Object.assign({
      method: "GET",
      headers: authHeaders()
    }, options || {}));
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (_) { data = text; }
    }
    if (!response.ok) {
      const detail = data && (data.message || data.details || data.hint);
      throw new Error(detail || (typeof data === "string" ? data : response.statusText));
    }
    return data;
  }

  async function loadRecords(force) {
    if (loading && !force) return loading;
    loading = request(
      "leads?select=id,business_name,contact_name,email,phone,email_consent_required,email_consent_status,email_consent_requested_at,email_consent_granted_at,email_consent_channel&email_consent_required=eq.true&limit=100"
    ).then(function (rows) {
      records.clear();
      (rows || []).forEach(function (row) {
        records.set(String(row.id), row);
      });
      loaded = true;
      annotateCards();
      return records;
    }).catch(function (error) {
      loaded = false;
      throw error;
    }).finally(function () {
      loading = null;
    });
    return loading;
  }

  function injectStyles() {
    if (document.getElementById("swayphics-standard-lead-consent-styles")) return;
    const style = document.createElement("style");
    style.id = "swayphics-standard-lead-consent-styles";
    style.textContent = [
      ".sway-lead-consent-chip{display:inline-flex;align-items:center;align-self:center;max-width:100%;padding:5px 8px;border:1px solid #d9e2f0;border-radius:999px;background:#f6f8fc;color:#44536b;font:700 10px/1.2 Montserrat,Arial,sans-serif;white-space:nowrap}",
      ".sway-lead-consent-chip[data-consent-state=granted]{border-color:#b8ddc5;background:#f0faf3;color:#17633a}",
      ".sway-lead-consent-chip[data-consent-state=declined],.sway-lead-consent-chip[data-consent-state=revoked]{border-color:#e7c4c4;background:#fff6f6;color:#963c3c}",
      ".sway-lead-consent-action{font:700 10px/1.2 Montserrat,Arial,sans-serif!important}",
      ".sway-lead-consent-help{flex-basis:100%;margin:2px 0 0;color:#68758a;font:500 10px/1.45 Montserrat,Arial,sans-serif}"
    ].join("");
    document.head.appendChild(style);
  }

  function statusText(status) {
    return ({
      not_requested: "Email consent not requested",
      requested: "Permission requested · awaiting reply",
      granted: "Email consent recorded",
      declined: "Email marketing declined",
      revoked: "Email consent withdrawn"
    })[status] || "Email consent required";
  }

  function annotateCards() {
    if (!loaded) return;
    injectStyles();
    document.querySelectorAll("[data-lead-email-id]").forEach(function (emailButton) {
      const id = String(emailButton.dataset.leadEmailId || "");
      const lead = records.get(id);
      if (!lead || lead.email_consent_required !== true) return;
      const actions = emailButton.closest(".sway-lead-card-actions");
      if (!actions) return;

      emailButton.textContent = lead.email_consent_status === "not_requested"
        ? "Request consent"
        : lead.email_consent_status === "requested"
          ? "Awaiting consent"
          : lead.email_consent_status === "granted"
            ? "Email · consented"
            : "Email blocked";
      emailButton.title = lead.email_consent_status === "granted"
        ? "Email marketing is enabled because consent has been recorded."
        : "Promotional email is blocked until explicit consent is recorded.";

      let chip = actions.querySelector('[data-lead-consent-chip="' + id + '"]');
      if (!chip) {
        chip = document.createElement("span");
        chip.className = "sway-lead-consent-chip";
        chip.dataset.leadConsentChip = id;
        emailButton.insertAdjacentElement("afterend", chip);
      }
      chip.dataset.consentState = lead.email_consent_status || "not_requested";
      chip.textContent = statusText(lead.email_consent_status);

      let consentAction = actions.querySelector('[data-lead-consent-action="' + id + '"]');
      const neededAction = lead.email_consent_status === "requested"
        ? "record"
        : lead.email_consent_status === "granted"
          ? "revoke"
          : "";
      if (!neededAction && consentAction) {
        consentAction.remove();
        consentAction = null;
      }
      if (neededAction && !consentAction) {
        consentAction = document.createElement("button");
        consentAction.type = "button";
        consentAction.className = "sway-row-action sway-lead-consent-action";
        consentAction.dataset.leadConsentAction = id;
        consentAction.dataset.leadConsentActionType = neededAction;
        consentAction.textContent = neededAction === "record" ? "Record response" : "Withdraw consent";
        actions.appendChild(consentAction);
      } else if (neededAction && consentAction) {
        consentAction.dataset.leadConsentActionType = neededAction;
        consentAction.textContent = neededAction === "record" ? "Record response" : "Withdraw consent";
      }
    });
  }

  function openConsentRequest(lead) {
    if (typeof window.swayphicsOpenCampaignEmailComposer !== "function") {
      throw new Error("Swayphics Mail is unavailable. Refresh the dashboard and try again.");
    }
    const business = String(lead.business_name || "your organisation").trim();
    const message = [
      "Good day,",
      "",
      "My name is Lesego Gumede, Owner of Swayphics, a South African Creative & Design Lab.",
      "",
      "I am contacting " + business + " to ask whether an authorised representative would consent to receive occasional business-to-business marketing emails from Swayphics about website design and development, branding, company profiles, digital content and related business design services.",
      "",
      "This is a one-time request for permission only. We will not send promotional material unless you explicitly agree.",
      "",
      "To consent, please reply with your full name and designation and confirm:",
      "\u201cI consent to receive email marketing from Swayphics about the services listed above.\u201d",
      "",
      "You may decline by replying NO. No response will be treated as no consent. You may withdraw consent at any time by replying to this email or contacting info@swayphics.co.za.",
      "",
      "Swayphics",
      "info@swayphics.co.za",
      "https://swayphics.co.za/"
    ].join("\n");

    window.swayphicsOpenCampaignEmailComposer({
      recipientEmail: lead.email,
      recipientName: lead.contact_name || business,
      businessName: business,
      leadId: lead.id,
      subject: "Permission request | Swayphics and " + business,
      message: message,
      emailConsentAction: "permission_request",
      allowProposalTypes: false,
      onSent: async function (result) {
        if (!result || result.email_consent_recorded !== true) {
          throw new Error(
            result && result.email_consent_record_error
              ? result.email_consent_record_error
              : "The permission-request email was sent, but its consent status could not be verified. Reconcile the record before attempting another request."
          );
        }
        await loadRecords(true);
      }
    });
  }

  function openMarketingComposer(lead) {
    if (typeof window.swayphicsOpenCampaignEmailComposer !== "function") {
      throw new Error("Swayphics Mail is unavailable. Refresh the dashboard and try again.");
    }
    const business = String(lead.business_name || "your organisation").trim();
    window.swayphicsOpenCampaignEmailComposer({
      recipientEmail: lead.email,
      recipientName: lead.contact_name || business,
      businessName: business,
      leadId: lead.id,
      subject: "Swayphics | " + business,
      message: "",
      emailConsentAction: "marketing",
      allowProposalTypes: true,
      onSent: async function () {
        await loadRecords(true);
      }
    });
  }

  async function recordResponse(lead, decision) {
    const responseName = window.prompt("Full name of the person who replied:");
    if (responseName === null || !responseName.trim()) return;
    const responseRole = window.prompt("Their designation or authority to respond for the business:");
    if (responseRole === null || !responseRole.trim()) return;
    const evidence = window.prompt(
      decision === "grant"
        ? "Paste the exact written reply confirming consent to receive email marketing from Swayphics:"
        : "Paste the exact written reply declining email marketing from Swayphics:"
    );
    if (evidence === null || !evidence.trim()) return;

    if (decision === "grant" &&
        (!/\b(yes|consent|agree|approve|opt[ -]?in)\b/i.test(evidence) ||
         !/\b(email|marketing)\b/i.test(evidence))) {
      window.alert("The evidence must explicitly confirm consent to receive email marketing. No change was made.");
      return;
    }

    const result = await request("rpc/record_swayphics_lead_email_consent", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        p_lead_id: lead.id,
        p_decision: decision,
        p_response_name: responseName.trim(),
        p_response_role: responseRole.trim(),
        p_evidence: evidence.trim()
      })
    });
    if (!result || result.success !== true) {
      throw new Error("The consent response was not recorded.");
    }
    await loadRecords(true);
    window.alert(decision === "grant"
      ? "Email consent recorded. Branded marketing emails are now enabled for this lead."
      : "The decline has been recorded. Promotional email remains blocked.");
  }

  async function revokeConsent(lead) {
    const confirmed = window.confirm(
      "Withdraw the recorded email-marketing consent for " + lead.business_name + "? Promotional email will be blocked."
    );
    if (!confirmed) return;
    const evidence = window.prompt("Record how the withdrawal was communicated (paste the exact reply or a factual call note):");
    if (evidence === null || !evidence.trim()) return;
    const responseName = window.prompt("Name of the person who withdrew consent (if known):") || "";
    const responseRole = window.prompt("Their designation (if known):") || "";
    const result = await request("rpc/record_swayphics_lead_email_consent", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        p_lead_id: lead.id,
        p_decision: "revoke",
        p_response_name: responseName.trim(),
        p_response_role: responseRole.trim(),
        p_evidence: evidence.trim()
      })
    });
    if (!result || result.success !== true) throw new Error("The consent withdrawal was not recorded.");
    await loadRecords(true);
    window.alert("Email consent withdrawn. Promotional email is now blocked.");
  }

  async function handleEmailButton(button, event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    const id = String(button.dataset.leadEmailId || "");
    let lead = records.get(id);
    if (!loaded) await loadRecords();
    lead = records.get(id);
    if (!lead || lead.email_consent_required !== true) return;

    const status = lead.email_consent_status;
    if (status === "not_requested") {
      openConsentRequest(lead);
    } else if (status === "requested") {
      window.alert("The one-time permission request has already been sent. Wait for an explicit response and use Record response to capture it. Do not send another request.");
    } else if (status === "granted") {
      openMarketingComposer(lead);
    } else {
      window.alert("Email marketing is blocked because this business declined or withdrew consent.");
    }
  }

  async function handleConsentAction(button, event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    if (!loaded) await loadRecords();
    const id = String(button.dataset.leadConsentAction || "");
    const lead = records.get(id);
    if (!lead) throw new Error("The lead consent record could not be loaded.");
    if (button.dataset.leadConsentActionType === "record") {
      const choice = window.prompt("Enter GRANT if an authorised representative explicitly consented to email marketing, or DECLINE if they refused:");
      if (choice === null) return;
      const decision = choice.trim().toLowerCase();
      if (decision !== "grant" && decision !== "granted" && decision !== "decline" && decision !== "declined") {
        window.alert("Enter GRANT or DECLINE. No change was made.");
        return;
      }
      await recordResponse(lead, decision.startsWith("grant") ? "grant" : "decline");
    } else if (button.dataset.leadConsentActionType === "revoke") {
      await revokeConsent(lead);
    }
  }

  document.addEventListener("click", function (event) {
    const consentButton = event.target && event.target.closest
      ? event.target.closest("[data-lead-consent-action]")
      : null;
    if (consentButton) {
      handleConsentAction(consentButton, event).catch(function (error) {
        window.alert(error.message || "Unable to update email consent.");
      });
      return;
    }

    const emailButton = event.target && event.target.closest
      ? event.target.closest("[data-lead-email-id]")
      : null;
    if (!emailButton) return;
    const id = String(emailButton.dataset.leadEmailId || "");
    if (!loaded) {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      loadRecords().then(function () {
        handleEmailButton(emailButton, event).catch(function (error) {
          window.alert(error.message || "Unable to open Swayphics Mail.");
        });
      }).catch(function (error) {
        window.alert(error.message || "Unable to check the lead's email-consent status.");
      });
      return;
    }
    if (records.has(id)) {
      handleEmailButton(emailButton, event).catch(function (error) {
        window.alert(error.message || "Unable to open Swayphics Mail.");
      });
    }
  }, true);

  function start() {
    loadRecords().catch(function (error) {
      console.warn("Standard Lead email-consent workflow could not load:", error);
    });
    observer = new MutationObserver(function () {
      annotateCards();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
