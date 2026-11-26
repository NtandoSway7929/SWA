(function () {
  "use strict";

  if (window.swayphicsTenderCampaignLoaded) return;
  window.swayphicsTenderCampaignLoaded = true;

  const SUPABASE_URL = "https://sqifhribgsqfaxgtobsa.supabase.co";
  const SUPABASE_KEY = "sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QhB";
  const CAMPAIGN_KEY = "tender-corporate-groups-2026";
  const ROOT_SELECTOR = "#sway-workspace-main";
  const STAGES = [
    ["research_required", "Research required"],
    ["verified", "Verified"],
    ["consent_requested", "Consent requested"],
    ["consent_granted", "Consent granted"],
    ["outreach_ready", "Ready for outreach"],
    ["engaged", "Engaged"],
    ["preview_shared", "Homepage preview shared"],
    ["proposal_sent", "Proposal sent"],
    ["negotiating", "Negotiating"],
    ["won", "Won"],
    ["lost", "Lost"],
    ["nurture", "Nurture"],
    ["do_not_contact", "Do not contact"]
  ];

  let mountedPanelNode = null;

  const state = {
    mode: "standard",
    campaign: null,
    prospects: [],
    tenderEvidence: [],
    filtered: [],
    selectedId: null,
    loaded: false,
    busy: false,
    error: "",
    search: "",
    stageFilter: "all",
    provinceFilter: "all",
    websiteFilter: "all"
  };

  const escapeHtml = value => String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  const meaningful = value => {
    const text = String(value == null ? "" : value).trim();
    return text && !/^(not found|none found|not disclosed|n\/a|null|—)$/i.test(text) ? text : "";
  };

  const safeUrl = value => {
    const text = String(value || "").trim();
    if (!text) return "";
    try {
      const url = new URL(text);
      return ["https:", "http:"].includes(url.protocol) ? url.href : "";
    } catch (_) {
      return "";
    }
  };

  function authHeaders(extra) {
    const token = localStorage.getItem("swayphics_admin_access_token");
    if (!token) throw new Error("Your administrator session has expired. Sign in again.");
    return Object.assign({
      "apikey": SUPABASE_KEY,
      "Authorization": "Bearer " + token,
      "Accept": "application/json"
    }, extra || {});
  }

  async function api(path, options) {
    const response = await fetch(SUPABASE_URL + "/rest/v1/" + path, Object.assign({
      method: "GET",
      headers: authHeaders()
    }, options || {}));
    const body = await response.text();
    let data = null;
    if (body) {
      try { data = JSON.parse(body); } catch (_) { data = body; }
    }
    if (!response.ok) {
      const message = data && (data.message || data.details || data.hint) ?
        [data.message, data.details, data.hint].filter(Boolean).join(" ") :
        (typeof data === "string" ? data : response.statusText);
      throw new Error(message || ("Request failed (" + response.status + ")."));
    }
    return data;
  }

  function apiUrl(table, params) {
    return table + "?" + new URLSearchParams(params).toString();
  }

  function stageLabel(stage) {
    return (STAGES.find(item => item[0] === stage) || [stage, "Research required"])[1];
  }

  function websiteTone(status) {
    const s = String(status || "").toLowerCase();
    if (s.includes("no website") || s.includes("inaccessible") || s.includes("technical problems")) return "warning";
    if (s.includes("outdated") || s.includes("needs recheck") || s.includes("not fully verified")) return "neutral";
    if (s.includes("functional")) return "muted";
    return "neutral";
  }

  function isHighConfidenceAudit(item) {
    const audit = String(item.audit_status || "").toLowerCase();
    return !!audit && !audit.includes("not independently reviewed") && !audit.includes("not independently verified");
  }

  function renderTabs() {
    let tabs = document.getElementById("sway-tender-campaign-tabs");
    if (!tabs) {
      tabs = document.createElement("div");
      tabs.id = "sway-tender-campaign-tabs";
      tabs.className = "sway-tender-tabs";
      tabs.setAttribute("role", "tablist");
      tabs.setAttribute("aria-label", "Lead workspaces");
      tabs.innerHTML =
        '<button type="button" class="sway-tender-tab is-active" role="tab" aria-selected="true" data-sway-tender-mode="standard">Standard Leads</button>' +
        '<button type="button" class="sway-tender-tab" role="tab" aria-selected="false" data-sway-tender-mode="campaign">Tender &amp; Corporate Groups <span class="sway-tender-tab-count" data-sway-tender-count>59</span></button>';
      tabs.addEventListener("click", event => {
        const button = event.target.closest("[data-sway-tender-mode]");
        if (!button) return;
        setMode(button.dataset.swayTenderMode);
      });
      const root = document.querySelector(ROOT_SELECTOR);
      const heading = root && root.querySelector(".sway-workspace-heading-copy h2");
      let headingContainer = heading;
      while (headingContainer && headingContainer.parentElement !== root) {
        headingContainer = headingContainer.parentElement;
      }
      if (headingContainer && headingContainer.parentElement === root) {
        headingContainer.insertAdjacentElement("afterend", tabs);
      }
    }

    let panel = document.getElementById("sway-tender-campaign-panel");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "sway-tender-campaign-panel";
      panel.className = "sway-tender-panel";
      panel.hidden = true;
      tabs.insertAdjacentElement("afterend", panel);
    }

    updateTabs();
    return { tabs, panel };
  }

  function updateTabs() {
    const tabs = document.getElementById("sway-tender-campaign-tabs");
    if (!tabs) return;
    tabs.querySelectorAll("[data-sway-tender-mode]").forEach(button => {
      const active = button.dataset.swayTenderMode === state.mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    const count = tabs.querySelector("[data-sway-tender-count]");
    if (count && state.prospects.length && count.textContent !== String(state.prospects.length)) count.textContent = String(state.prospects.length);
  }

  function setStandardVisibility() {
    const root = document.querySelector(ROOT_SELECTOR);
    const tabs = document.getElementById("sway-tender-campaign-tabs");
    const panel = document.getElementById("sway-tender-campaign-panel");
    if (!root || !tabs || !panel) return;

    const heading = root.querySelector(".sway-workspace-heading-copy h2");
    let headingContainer = heading;
    while (headingContainer && headingContainer.parentElement !== root) headingContainer = headingContainer.parentElement;
    const keep = new Set([headingContainer, tabs, panel].filter(Boolean));
    Array.from(root.children).forEach(child => {
      if (keep.has(child)) {
        child.classList.remove("sway-tender-standard-hidden");
        return;
      }
      if (state.mode === "campaign") child.classList.add("sway-tender-standard-hidden");
      else child.classList.remove("sway-tender-standard-hidden");
    });
    tabs.hidden = false;
    panel.hidden = state.mode !== "campaign";
  }

  async function setMode(mode) {
    state.mode = mode === "campaign" ? "campaign" : "standard";
    updateTabs();
    setStandardVisibility();
    if (state.mode === "campaign") {
      const panel = document.getElementById("sway-tender-campaign-panel");
      if (panel && !state.loaded) {
        panel.innerHTML = loadingMarkup("Loading campaign prospects…");
        await loadCampaign();
      } else {
        renderCampaign();
      }
    }
  }

  function loadingMarkup(message) {
    return '<div class="sway-tender-loading"><span class="sway-tender-spinner" aria-hidden="true"></span>' +
      escapeHtml(message) + "</div>";
  }

  function setError(message) {
    state.error = String(message || "");
    const panel = document.getElementById("sway-tender-campaign-panel");
    if (panel) renderCampaign();
  }

  async function loadCampaign() {
    if (state.busy) return;
    state.busy = true;
    state.error = "";
    const panel = document.getElementById("sway-tender-campaign-panel");
    if (panel) panel.innerHTML = loadingMarkup("Loading campaign prospects…");
    try {
      const campaigns = await api(apiUrl("lead_campaigns", {
        select: "id,campaign_key,name,description,status",
        campaign_key: "eq." + CAMPAIGN_KEY,
        limit: "1"
      }));
      if (!campaigns || !campaigns.length) throw new Error("The Tender & Corporate Groups campaign has not been configured in the database.");
      state.campaign = campaigns[0];
      state.prospects = await api(apiUrl("lead_campaign_prospects", {
        select: "*",
        campaign_id: "eq." + state.campaign.id,
        order: "business_name.asc"
      })) || [];
      state.tenderEvidence = await api(apiUrl("lead_campaign_tender_evidence", {
        select: "id,prospect_id,tender_record_id,source_prospect_id,company_name,tender_reference,procuring_institution,tender_description,award_value,award_date,procurement_role,company_award_count,evidence_url",
        campaign_id: "eq." + state.campaign.id,
        order: "tender_record_id.asc"
      })) || [];
      state.loaded = true;
      updateTabs();
      renderCampaign();
    } catch (error) {
      state.error = error.message || "Unable to load campaign prospects.";
      renderCampaign();
    } finally {
      state.busy = false;
    }
  }

  function applyFilters() {
    const term = state.search.trim().toLowerCase();
    state.filtered = state.prospects.filter(item => {
      const haystack = [
        item.business_name, item.registered_company_name, item.industry, item.province,
        item.city, item.email, item.phone, item.contact_person, item.website_url, item.tender_reference,
        item.tender_award_history, item.audit_outreach_disposition, item.source_prospect_id, item.original_score
      ].join(" ").toLowerCase();
      if (term && !haystack.includes(term)) return false;
      if (state.stageFilter !== "all" && item.stage !== state.stageFilter) return false;
      if (state.provinceFilter !== "all" && item.province !== state.provinceFilter) return false;
      if (state.websiteFilter === "no_website" && !String(item.website_status || "").toLowerCase().includes("no website")) return false;
      if (state.websiteFilter === "issues" && !/(inaccessible|technical problems|outdated|broken)/i.test(item.website_status + " " + item.website_issues)) return false;
      if (state.websiteFilter === "functional" && !String(item.website_status || "").toLowerCase().includes("functional")) return false;
      return true;
    });
  }

  function renderStats() {
    const total = state.prospects.length;
    const noWebsite = state.prospects.filter(item => /no website/i.test(item.website_status || "")).length;
    const issueCount = state.prospects.filter(item => /(inaccessible|technical problems|outdated|broken)/i.test((item.website_status || "") + " " + (item.website_issues || ""))).length;
    const emails = state.prospects.filter(item => meaningful(item.email)).length;
    const consent = state.prospects.filter(item => item.email_consent_status === "granted" && !item.do_not_contact).length;
    return [
      ["Total prospects", total, "Imported from the audited workbook"],
      ["No website listed", noWebsite, "Research finding; confirm before outreach"],
      ["Potential website issues", issueCount, "Includes issues requiring manual recheck"],
      ["Email addresses listed", emails, "Deliverability not tested"],
      ["Consent granted", consent, "Eligible for permitted marketing follow-up"]
    ];
  }

  function getEmailAddress(item) {
    const candidates = [item.email, item.additional_email]
      .map(value => meaningful(value))
      .filter(Boolean);
    return candidates.find(value => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)) || "";
  }

  function emailActionState(item) {
    const email = getEmailAddress(item);
    const consent = String(item.email_consent_status || "not_requested").toLowerCase();
    if (!email) return { disabled: true, reason: "No valid business email address is recorded." };
    if (item.do_not_contact || item.stage === "do_not_contact" || consent === "revoked") {
      return { disabled: true, reason: "This prospect is marked Do Not Contact." };
    }
    if (consent === "requested") {
      return { disabled: true, reason: "A permission request is already recorded. Await the prospect's response." };
    }
    return {
      disabled: false,
      email,
      permissionRequest: consent !== "granted"
    };
  }

  function buildEmailDraft(item) {
    const action = emailActionState(item);
    if (action.disabled) return "";

    const business = String(item.business_name || "your organisation").trim();
    const subject = action.permissionRequest
      ? "Permission to contact " + business + " | Swayphics"
      : "Swayphics | " + business;
    const body = action.permissionRequest ? [
      "Good day,",
      "",
      "I am reaching out on behalf of Swayphics. We came across " + business + " while researching businesses in your sector and would like to ask whether you would be willing to receive one follow-up email outlining a digital or website opportunity that may be relevant to your organisation.",
      "",
      "This message is only a request for permission. We will not send further marketing emails unless you give clear consent.",
      "",
      "Please reply YES if you consent to receiving that one follow-up email, or NO if you do not.",
      "",
      "Kind Regards,",
      "",
      "Lesego Gumede",
      "Swayphics"
    ].join("\n") : "";

    return "mailto:" + action.email +
      "?subject=" + encodeURIComponent(subject) +
      (body ? "&body=" + encodeURIComponent(body) : "");
  }

  function renderProspectRow(item) {
    const website = meaningful(item.website_status) || "Not assessed";
    const tenderStatus = isHighConfidenceAudit(item) ? "Evidence reviewed" : "Research required";
    const contact = meaningful(item.email) || meaningful(item.additional_email) || meaningful(item.phone) || "No direct contact listed";
    const score = item.original_score == null ? "Score pending" : "Original score " + item.original_score + "/100";
    const priority = meaningful(item.original_priority) || "Unranked";
    const emailAction = emailActionState(item);
    const emailTitle = emailAction.reason || (emailAction.permissionRequest
      ? "Opens a one-time permission-request draft. Send manually, then record the request in Review."
      : "Opens an email draft in your default mail application. Nothing is sent automatically.");
    return '<tr data-sway-tender-row="' + escapeHtml(item.id) + '">' +
      '<td><div class="sway-tender-company"><strong>' + escapeHtml(item.business_name) + '</strong><span>' +
        escapeHtml(item.business_category || item.source_prospect_id) + '</span><span class="sway-tender-score-line">' +
        escapeHtml(score + " · " + priority + " priority") + '</span></div></td>' +
      '<td><div class="sway-tender-location">' + escapeHtml(item.industry || "Industry not listed") +
        '<span>' + escapeHtml([item.city, item.province].filter(Boolean).join(", ") || "Location not listed") + '</span></div></td>' +
      '<td><span class="sway-tender-chip ' + websiteTone(website) + '">' + escapeHtml(website) + '</span>' +
        (item.website_url ? '<a class="sway-tender-url" href="' + escapeHtml(safeUrl(item.website_url)) + '" target="_blank" rel="noopener">Visit website</a>' : "") + '</td>' +
      '<td><div class="sway-tender-evidence">' + escapeHtml(tenderStatus) + '<span>' +
        escapeHtml(item.tender_reference || item.tender_award_history || "No specific reference recorded") + '</span></div></td>' +
      '<td><div class="sway-tender-contact">' + escapeHtml(contact) + '<span>' +
        escapeHtml(item.contact_verification_status || "Unverified") + '</span></div></td>' +
      '<td><span class="sway-tender-stage">' + escapeHtml(stageLabel(item.stage)) + '</span></td>' +
      '<td><div class="sway-tender-row-actions">' +
        '<button type="button" class="sway-tender-open" data-sway-tender-open="' + escapeHtml(item.id) + '">Review</button>' +
        '<button type="button" class="sway-tender-email" data-sway-tender-email="' + escapeHtml(item.id) + '" title="' + escapeHtml(emailTitle) + '"' +
          (emailAction.disabled ? " disabled" : "") + '>Email</button>' +
      '</div></td>' +
    "</tr>";
  }

  function renderCampaign() {
    const panel = document.getElementById("sway-tender-campaign-panel");
    if (!panel) return;
    if (state.error) {
      panel.innerHTML = '<div class="sway-tender-error"><strong>Campaign could not be loaded</strong><p>' +
        escapeHtml(state.error) + '</p><button type="button" data-sway-tender-refresh>Try again</button></div>';
      return;
    }
    if (!state.loaded) {
      panel.innerHTML = loadingMarkup("Preparing campaign workspace…");
      return;
    }

    applyFilters();
    const stats = renderStats();
    const provinces = Array.from(new Set(state.prospects.map(item => item.province).filter(Boolean))).sort();
    const selected = state.prospects.find(item => item.id === state.selectedId);
    const tableRows = state.filtered.map(renderProspectRow).join("");
    panel.innerHTML =
      '<div class="sway-tender-hero">' +
        '<div><span class="sway-tender-eyebrow">OUTBOUND CAMPAIGN · SOUTH AFRICA</span>' +
          '<h2>Tender &amp; Corporate Groups</h2>' +
          '<p>Research, qualify and manage the 59 businesses identified in the tender prospecting project. Email marketing remains locked until permission is recorded.</p>' +
        '</div><div class="sway-tender-hero-actions">' +
          '<button type="button" class="sway-tender-secondary" data-sway-tender-refresh>Refresh</button>' +
          '<button type="button" class="sway-tender-secondary" data-sway-tender-export>Export CSV</button>' +
        '</div>' +
      '</div>' +
      '<div class="sway-tender-stats">' + stats.map(s =>
        '<article class="sway-tender-stat"><strong>' + escapeHtml(s[1]) + '</strong><span>' + escapeHtml(s[0]) + '</span><small>' + escapeHtml(s[2]) + '</small></article>'
      ).join("") + '</div>' +
      '<div class="sway-tender-controls">' +
        '<label class="sway-tender-search"><span>Search prospects</span><input type="search" data-sway-tender-search value="' + escapeHtml(state.search) + '" placeholder="Business, industry, tender reference or email"></label>' +
        '<label><span>Campaign stage</span><select data-sway-tender-stage-filter><option value="all">All stages</option>' +
          STAGES.map(s => '<option value="' + s[0] + '"' + (state.stageFilter === s[0] ? " selected" : "") + '>' + escapeHtml(s[1]) + '</option>').join("") +
        '</select></label>' +
        '<label><span>Province</span><select data-sway-tender-province-filter><option value="all">All provinces</option>' +
          provinces.map(p => '<option value="' + escapeHtml(p) + '"' + (state.provinceFilter === p ? " selected" : "") + '>' + escapeHtml(p) + '</option>').join("") +
        '</select></label>' +
        '<label><span>Website opportunity</span><select data-sway-tender-website-filter>' +
          '<option value="all">All website statuses</option><option value="no_website"' + (state.websiteFilter === "no_website" ? " selected" : "") + '>No website listed</option>' +
          '<option value="issues"' + (state.websiteFilter === "issues" ? " selected" : "") + '>Potential issues</option>' +
          '<option value="functional"' + (state.websiteFilter === "functional" ? " selected" : "") + '>Functional website</option>' +
        '</select></label>' +
      '</div>' +
      '<div class="sway-tender-results-head"><strong>' + state.filtered.length + ' prospects</strong><span>Imported records retain their original audit status. Unreviewed prospects are not treated as qualified.</span></div>' +
      '<div class="sway-tender-table-wrap"><table class="sway-tender-table"><thead><tr><th>Business</th><th>Industry / location</th><th>Website</th><th>Tender evidence</th><th>Contact</th><th>Campaign stage</th><th>Actions</th></tr></thead>' +
      '<tbody>' + (tableRows || '<tr><td colspan="7" class="sway-tender-empty">No prospects match the selected filters.</td></tr>') + '</tbody></table></div>' +
      (selected ? renderDetail(selected) : '<div class="sway-tender-empty-state"><strong>Select a prospect to review its research.</strong><span>Open any row to inspect the contact details, website findings, tender evidence and audit notes.</span></div>') +
      '<p class="sway-tender-footnote">Research data imported from Swayphics_Tender_Prospects_Audited.xlsx. The original scores are historical pre-audit values, not validated current qualification scores. No email has been sent from this workspace.</p>';

    bindPanelEvents(panel);
  }

  function renderDetail(item) {
    const link = (url, label) => {
      const safe = safeUrl(url);
      return safe ? '<a href="' + escapeHtml(safe) + '" target="_blank" rel="noopener">' + escapeHtml(label || safe) + '</a>' : "";
    };
    const sources = String(item.source_urls || "").split(/;\s*/).filter(Boolean).map((url, i) =>
      link(url, "Source " + (i + 1))
    ).filter(Boolean).join("");
    const auditSources = String(item.audit_evidence_urls || "").split(/;\s*/).filter(Boolean).map((url, i) =>
      link(url, "Audit source " + (i + 1))
    ).filter(Boolean).join("");
    const dnc = !!item.do_not_contact;
    return '<section class="sway-tender-detail" aria-label="Prospect details">' +
      '<div class="sway-tender-detail-head"><div><span class="sway-tender-eyebrow">PROSPECT RECORD · ' + escapeHtml(item.source_prospect_id) + '</span>' +
        '<h3>' + escapeHtml(item.business_name) + '</h3><p>' + escapeHtml(item.registered_company_name || item.business_category || "") + '</p></div>' +
        '<button type="button" class="sway-tender-close" data-sway-tender-close>Close</button></div>' +
      '<div class="sway-tender-detail-summary">' +
        '<span class="sway-tender-priority ' + escapeHtml(String(item.original_priority || "unranked").toLowerCase()) + '">' +
          escapeHtml(item.original_priority || "Priority not set") + ' priority</span>' +
        '<strong>' + escapeHtml(item.original_score == null ? "Score not available" : item.original_score + "/100") + '</strong>' +
        '<span>Original workbook qualification score</span>' +
      '</div>' +
      '<div class="sway-tender-detail-grid">' +
        detailBlock("Contact information", [
          ["Contact person", meaningful(item.contact_person) || "Not identified"],
          ["Contact source", meaningful(item.contact_source) || "Not recorded"],
          ["Business email", meaningful(item.email) || "Not found"],
          ["Additional email", meaningful(item.additional_email) || "Not found"],
          ["Telephone", meaningful(item.phone) || "Not found"],
          ["WhatsApp", meaningful(item.whatsapp) || "Not found"],
          ["Location", [item.physical_address, item.city, item.province].filter(Boolean).join(" · ") || "Not found"],
          ["Contact verification", item.contact_verification_status || "Unverified"]
        ]) +
        detailBlock("Digital presence", [
          ["Website", item.website_url || "No website recorded"],
          ["Website status", item.website_status || "Not assessed"],
          ["Identified issues", item.website_issues || "No issue description recorded"],
          ["Affected URLs", item.affected_urls || "None listed"],
          ["Digital opportunity", item.digital_opportunity || "Not assessed"],
          ["Recommended service", item.recommended_services || "Not specified"]
        ]) +
        detailBlock("Tender evidence", [
          ["Participation evidence", item.tender_participation_evidence || "Not recorded"],
          ["Award history", item.tender_award_history || "Not recorded"],
          ["Tender reference", item.tender_reference || "Not recorded"],
          ["Procuring institution", item.procuring_entity || "Not recorded"],
          ["Award value", item.tender_award_value || "Not disclosed"],
          ["Verified awards", item.verified_award_count == null ? "Not recorded" : item.verified_award_count],
          ["Revenue dependence", item.tender_dependence_evidence || "Unconfirmed"]
        ]) +
        detailBlock("Website audit evidence", [
          ["Audit finding", meaningful(item.website_audit_problem) || item.website_issues || "No specific issue recorded"],
          ["Audit evidence", meaningful(item.website_audit_evidence) || "No audit evidence note"],
          ["Recommended improvement", meaningful(item.website_recommended_improvement) || "Not recorded"],
          ["Commercial opportunity", meaningful(item.website_commercial_opportunity) || item.digital_opportunity || "Not assessed"],
          ["Website audit priority", meaningful(item.website_audit_priority) || "Not scored"],
          ["Website audit score", item.website_audit_score == null ? "Not scored" : item.website_audit_score + "/100"]
        ]) +
        detailBlock("Commercial intelligence", [
          ["Original qualification", item.score_breakdown || "No scoring breakdown recorded"],
          ["Commercial assessment", meaningful(item.commercial_intelligence_assessment) || "No commercial assessment recorded"],
          ["Recommended outreach approach", meaningful(item.recommended_outreach_approach) || item.outreach_angle || "Not recorded"],
          ["Audit status", item.audit_status || "Not audited"],
          ["Audit notes", item.audit_notes || "No audit notes"],
          ["Outreach disposition", item.audit_outreach_disposition || "Unreviewed"]
        ]) +
      '</div>' +
      renderTenderEvidence(item) +
      '<div class="sway-tender-source-list"><strong>Research sources</strong><div>' + (sources || '<span>No source links recorded</span>') + '</div>' +
        (auditSources ? '<strong>Audit evidence</strong><div>' + auditSources + '</div>' : '') + '</div>' +
      '<div class="sway-tender-workflow">' +
        '<div><h4>Campaign qualification</h4><label><span>Qualification</span><select data-sway-tender-qualification="' + escapeHtml(item.id) + '">' +
          '<option value="research_required"' + (item.qualification_status === "research_required" ? " selected" : "") + '>Research required</option>' +
          '<option value="qualified"' + (item.qualification_status === "qualified" ? " selected" : "") + '>Qualified</option>' +
          '<option value="disqualified"' + (item.qualification_status === "disqualified" ? " selected" : "") + '>Disqualified</option>' +
        '</select></label><label><span>Campaign stage</span><select data-sway-tender-stage="' + escapeHtml(item.id) + '"' + (dnc ? " disabled" : "") + '>' +
          STAGES.filter(s => s[0] !== "do_not_contact").map(s => '<option value="' + s[0] + '"' + (item.stage === s[0] ? " selected" : "") + '>' + escapeHtml(s[1]) + '</option>').join("") +
        '</select></label><button type="button" class="sway-tender-primary" data-sway-tender-save-workflow="' + escapeHtml(item.id) + '">Save qualification &amp; stage</button></div>' +
        '<div><h4>Email permission</h4><span class="sway-tender-chip ' + (item.email_consent_status === "granted" ? "success" : "neutral") + '">' +
          escapeHtml(item.email_consent_status.replace(/_/g, " ")) + '</span><p>Marketing email remains unavailable until explicit consent is recorded with supporting evidence.</p>' +
          '<button type="button" class="sway-tender-secondary" data-sway-tender-consent-request="' + escapeHtml(item.id) + '"' + (dnc ? " disabled" : "") + '>Record consent request sent</button>' +
          '<button type="button" class="sway-tender-secondary" data-sway-tender-consent-granted="' + escapeHtml(item.id) + '"' + (dnc || item.email_consent_status !== "requested" ? " disabled" : "") + '>Record consent received</button>' +
        '</div>' +
      '</div>' +
      '<div class="sway-tender-detail-actions">' +
        (item.lead_id ? '<span class="sway-tender-linked">Linked to CRM lead</span><span class="sway-tender-lead-id">' + escapeHtml(item.lead_id) + '</span>' :
          '<button type="button" class="sway-tender-primary" data-sway-tender-promote="' + escapeHtml(item.id) + '"' + (item.qualification_status !== "qualified" || dnc ? " disabled title=\"Qualify this prospect before adding it to the main CRM.\"" : "") + '>Add to main CRM leads</button>') +
        '<button type="button" class="sway-tender-danger" data-sway-tender-do-not-contact="' + escapeHtml(item.id) + '"' + (dnc ? " disabled" : "") + '>Mark do not contact</button>' +
      '</div>' +
      (dnc ? '<p class="sway-tender-optout">This prospect is permanently marked Do Not Contact. Marketing outreach is disabled.</p>' : '') +
    '</section>';
  }

  function renderTenderEvidence(item) {
    const records = state.tenderEvidence.filter(record => record.prospect_id === item.id);
    const rows = records.map(record =>
      '<article class="sway-tender-evidence-record">' +
        '<div class="sway-tender-evidence-top"><strong>' + escapeHtml(record.tender_reference || record.tender_record_id) + '</strong>' +
          '<span class="sway-tender-role ' + (String(record.procurement_role || "").toLowerCase().includes("awardee") ? "awardee" :
            (String(record.procurement_role || "").toLowerCase().includes("panel") ? "panel" : "participant")) + '">' +
            escapeHtml(record.procurement_role || "Role not recorded") + '</span></div>' +
        '<p>' + escapeHtml(record.tender_description || "No tender description recorded") + '</p>' +
        '<dl><div><dt>Procuring institution</dt><dd>' + escapeHtml(record.procuring_institution || "Not recorded") + '</dd></div>' +
          '<div><dt>Value / pricing</dt><dd>' + escapeHtml(record.award_value || "Not disclosed") + '</dd></div>' +
          '<div><dt>Date / period</dt><dd>' + escapeHtml(record.award_date || "Not recorded") + '</dd></div></dl>' +
        (safeUrl(record.evidence_url) ? '<a href="' + escapeHtml(safeUrl(record.evidence_url)) + '" target="_blank" rel="noopener">Open evidence source</a>' : '') +
        '<small>' + escapeHtml(record.tender_record_id) + '</small>' +
      '</article>'
    ).join("");
    return '<section class="sway-tender-evidence-section"><div class="sway-tender-evidence-heading"><h4>Individual tender records</h4>' +
      '<span>' + records.length + ' source records</span></div>' +
      (rows || '<p class="sway-tender-no-evidence">No individual tender-register rows are linked to this prospect.</p>') +
      '<p class="sway-tender-evidence-note">Tender roles above are shown as recorded in the source workbook. The audit status and notes remain separate and should be used to qualify claims before outreach.</p></section>';
  }

  function detailBlock(title, pairs) {
    return '<article class="sway-tender-detail-block"><h4>' + escapeHtml(title) + '</h4><dl>' +
      pairs.map(pair => '<div><dt>' + escapeHtml(pair[0]) + '</dt><dd>' + escapeHtml(pair[1]) + '</dd></div>').join("") +
      '</dl></article>';
  }

  function bindPanelEvents(panel) {
    panel.querySelectorAll("[data-sway-tender-open]").forEach(button => button.addEventListener("click", () => {
      state.selectedId = button.dataset.swayTenderOpen;
      renderCampaign();
      const detail = panel.querySelector(".sway-tender-detail");
      if (detail) detail.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
    panel.querySelectorAll("[data-sway-tender-email]").forEach(button => button.addEventListener("click", () => {
      const item = state.prospects.find(prospect => prospect.id === button.dataset.swayTenderEmail);
      if (!item) return;
      const draft = buildEmailDraft(item);
      if (draft) window.location.href = draft;
    }));
    panel.querySelectorAll("[data-sway-tender-close]").forEach(button => button.addEventListener("click", () => {
      state.selectedId = null;
      renderCampaign();
    }));
    const search = panel.querySelector("[data-sway-tender-search]");
    if (search) search.addEventListener("input", () => {
      state.search = search.value;
      const cursor = search.selectionStart;
      renderCampaign();
      const next = panel.querySelector("[data-sway-tender-search]");
      if (next) { next.focus(); next.setSelectionRange(cursor, cursor); }
    });
    [
      ["[data-sway-tender-stage-filter]", "stageFilter"],
      ["[data-sway-tender-province-filter]", "provinceFilter"],
      ["[data-sway-tender-website-filter]", "websiteFilter"]
    ].forEach(([selector, key]) => {
      const control = panel.querySelector(selector);
      if (control) control.addEventListener("change", () => {
        state[key] = control.value;
        renderCampaign();
      });
    });
    panel.querySelectorAll("[data-sway-tender-refresh]").forEach(button => button.addEventListener("click", () => {
      state.loaded = false;
      loadCampaign();
    }));
    const exportButton = panel.querySelector("[data-sway-tender-export]");
    if (exportButton) exportButton.addEventListener("click", exportCsv);
    panel.querySelectorAll("[data-sway-tender-save-workflow]").forEach(button => button.addEventListener("click", () =>
      saveWorkflow(button.dataset.swayTenderSaveWorkflow)
    ));
    panel.querySelectorAll("[data-sway-tender-consent-request]").forEach(button => button.addEventListener("click", () =>
      recordConsentRequest(button.dataset.swayTenderConsentRequest)
    ));
    panel.querySelectorAll("[data-sway-tender-consent-granted]").forEach(button => button.addEventListener("click", () =>
      recordConsentGrant(button.dataset.swayTenderConsentGranted)
    ));
    panel.querySelectorAll("[data-sway-tender-promote]").forEach(button => button.addEventListener("click", () =>
      promoteToCrm(button.dataset.swayTenderPromote)
    ));
    panel.querySelectorAll("[data-sway-tender-do-not-contact]").forEach(button => button.addEventListener("click", () =>
      markDoNotContact(button.dataset.swayTenderDoNotContact)
    ));
    panel.querySelectorAll("[data-sway-tender-qualification]").forEach(control => {
      control.addEventListener("change", () => {
        const item = state.prospects.find(p => p.id === control.dataset.swayTenderQualification);
        if (item) item._pendingQualification = control.value;
      });
    });
    panel.querySelectorAll("[data-sway-tender-stage]").forEach(control => {
      control.addEventListener("change", () => {
        const item = state.prospects.find(p => p.id === control.dataset.swayTenderStage);
        if (item) item._pendingStage = control.value;
      });
    });
  }

  async function updateProspect(id, patch) {
    const result = await api(apiUrl("lead_campaign_prospects", {
      id: "eq." + id,
      select: "*"
    }), {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json", "Prefer": "return=representation" }),
      body: JSON.stringify(Object.assign({}, patch, { updated_at: new Date().toISOString() }))
    });
    if (!result || !result.length) throw new Error("No prospect record was updated.");
    const index = state.prospects.findIndex(item => item.id === id);
    if (index >= 0) state.prospects[index] = result[0];
    state.selectedId = id;
    renderCampaign();
  }

  async function saveWorkflow(id) {
    const item = state.prospects.find(p => p.id === id);
    if (!item) return;
    const qualification = item._pendingQualification || item.qualification_status;
    const stage = item._pendingStage || item.stage;
    if (item.do_not_contact && stage !== "do_not_contact") {
      window.alert("This prospect is on the Do Not Contact list and cannot be reactivated from this workspace.");
      return;
    }
    if (["outreach_ready", "engaged", "preview_shared", "proposal_sent", "negotiating"].includes(stage) &&
        (item.email_consent_status !== "granted" || item.do_not_contact)) {
      window.alert("Record explicit email marketing consent before moving this prospect into an email marketing stage.");
      return;
    }
    try {
      await updateProspect(id, { qualification_status: qualification, stage });
    } catch (error) {
      window.alert(error.message || "Unable to update the prospect.");
    }
  }

  function showEvidenceDialog(title, text, onSave) {
    const existing = document.getElementById("sway-tender-evidence-dialog");
    if (existing) existing.remove();
    const overlay = document.createElement("div");
    overlay.id = "sway-tender-evidence-dialog";
    overlay.className = "sway-tender-dialog-backdrop";
    overlay.innerHTML = '<form class="sway-tender-dialog" role="dialog" aria-modal="true">' +
      '<h3>' + escapeHtml(title) + '</h3><p>' + escapeHtml(text) + '</p>' +
      '<label><span>Evidence / source reference</span><textarea name="evidence" required rows="4" placeholder="Record the source, date, email thread or other proof"></textarea></label>' +
      '<label><span>Channel</span><select name="channel"><option>Email</option><option>Telephone</option><option>Other documented channel</option></select></label>' +
      '<div class="sway-tender-dialog-actions"><button type="button" data-cancel>Cancel</button><button type="submit">Save record</button></div>' +
    '</form>';
    overlay.addEventListener("click", event => { if (event.target === overlay) overlay.remove(); });
    overlay.querySelector("[data-cancel]").addEventListener("click", () => overlay.remove());
    overlay.querySelector("form").addEventListener("submit", async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const evidence = String(form.get("evidence") || "").trim();
      const channel = String(form.get("channel") || "Email");
      if (!evidence) return;
      const submit = overlay.querySelector('[type="submit"]');
      submit.disabled = true;
      try { await onSave(evidence, channel); overlay.remove(); }
      catch (error) { window.alert(error.message || "Unable to save the consent record."); submit.disabled = false; }
    });
    document.body.appendChild(overlay);
    overlay.querySelector("textarea").focus();
  }

  async function recordConsentRequest(id) {
    const item = state.prospects.find(p => p.id === id);
    if (!item || item.do_not_contact) return;
    if (!meaningful(item.email)) {
      window.alert("This prospect has no business email address recorded. Verify the correct contact address first.");
      return;
    }
    showEvidenceDialog("Record consent request", "Only use this after the one-time permission request has actually been sent. This action does not send an email.", async (evidence, channel) => {
      await updateProspect(id, {
        email_consent_status: "requested",
        email_consent_requested_at: new Date().toISOString(),
        email_consent_channel: channel,
        email_consent_evidence: evidence,
        stage: "consent_requested"
      });
    });
  }

  async function recordConsentGrant(id) {
    const item = state.prospects.find(p => p.id === id);
    if (!item || item.do_not_contact || item.email_consent_status !== "requested") return;
    showEvidenceDialog("Record consent received", "Only record a clear, affirmative consent response. Keep the source and evidence so the permission can be demonstrated later.", async (evidence, channel) => {
      await updateProspect(id, {
        email_consent_status: "granted",
        email_consent_granted_at: new Date().toISOString(),
        email_consent_channel: channel,
        email_consent_evidence: evidence,
        stage: "consent_granted"
      });
    });
  }

  async function markDoNotContact(id) {
    const reason = window.prompt("Record the reason for this Do Not Contact restriction:");
    if (!reason || !reason.trim()) return;
    if (!window.confirm("This will permanently block marketing outreach to this prospect from this campaign. Continue?")) return;
    try {
      await updateProspect(id, {
        do_not_contact: true,
        do_not_contact_reason: reason.trim(),
        email_consent_status: "revoked",
        stage: "do_not_contact"
      });
    } catch (error) {
      window.alert(error.message || "Unable to apply the restriction.");
    }
  }

  async function promoteToCrm(id) {
    const item = state.prospects.find(p => p.id === id);
    if (!item || item.qualification_status !== "qualified" || item.do_not_contact) return;
    if (!window.confirm("Add " + item.business_name + " to the main CRM Leads pipeline as a new, uncontacted lead? No email will be sent.")) return;
    try {
      let existing = [];
      if (item.email) {
        existing = await api(apiUrl("leads", {
          select: "id,business_name,email",
          email: "ilike." + item.email,
          limit: "5"
        }));
      }
      if (!existing.length) {
        existing = await api(apiUrl("leads", {
          select: "id,business_name,email",
          business_name: "ilike." + item.business_name,
          limit: "5"
        }));
      }
      const match = (existing || []).find(lead =>
        String(lead.business_name || "").trim().toLowerCase() === String(item.business_name).trim().toLowerCase() ||
        (item.email && String(lead.email || "").trim().toLowerCase() === item.email.trim().toLowerCase())
      );
      let leadId = match && match.id;
      if (!leadId) {
        const note = [
          "Imported from Tender & Corporate Groups campaign.",
          "Prospect reference: " + item.source_prospect_id,
          "No outreach has been sent from this campaign workspace.",
          item.audit_notes || "",
          item.audit_outreach_disposition || ""
        ].filter(Boolean).join("\n\n");
        const created = await api("leads?select=id", {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json", "Prefer": "return=representation" }),
          body: JSON.stringify({
            business_name: item.business_name,
            email: meaningful(item.email) || null,
            phone: meaningful(item.phone) || null,
            service_interest: item.recommended_services || "Website design and development",
            source: "Tender & Corporate Groups",
            status: "new",
            estimated_value: 0,
            notes: note,
            business_assessment: item.website_issues || item.website_status || null,
            research_findings: [item.tender_award_history, item.tender_participation_evidence, item.tender_reference].filter(Boolean).join("\n\n"),
            swayphics_solution: item.digital_opportunity || null,
            recommended_services: item.recommended_services || null,
            research_sources: [item.source_urls, item.audit_evidence_urls].filter(Boolean).join("\n")
          })
        });
        if (!created || !created.length) throw new Error("The CRM did not confirm creation of the lead.");
        leadId = created[0].id;
      }
      await updateProspect(id, { lead_id: leadId });
      window.alert(match ? "Linked to the existing CRM lead without overwriting its details." : "Added to the main CRM as a new, uncontacted lead. No email was sent.");
    } catch (error) {
      window.alert(error.message || "Unable to add this prospect to the main CRM.");
    }
  }

  function exportCsv() {
    const columns = [
      ["source_prospect_id","Prospect ID"], ["business_name","Business Name"],
      ["registered_company_name","Registered Company Name"], ["original_priority","Original Priority"],
      ["original_score","Original Score"], ["score_breakdown","Score Breakdown"], ["contact_person","Contact Person"],
      ["contact_source","Contact Source"], ["industry","Industry"],
      ["province","Province"], ["city","City"], ["website_url","Website"],
      ["website_status","Website Status"], ["website_issues","Website Issues"],
      ["website_audit_problem","Website Audit Problem"], ["website_audit_evidence","Website Audit Evidence"],
      ["website_recommended_improvement","Website Recommended Improvement"], ["website_commercial_opportunity","Website Commercial Opportunity"],
      ["email","Business Email"], ["additional_email","Additional Email"],
      ["phone","Telephone"], ["tender_award_history","Tender Award History"],
      ["tender_reference","Tender Reference"], ["procuring_entity","Procuring Institution"],
      ["tender_award_value","Tender Award Value"], ["verified_award_count","Verified Awards"],
      ["audit_status","Audit Status"], ["audit_outreach_disposition","Audit Disposition"],
      ["commercial_intelligence_assessment","Commercial Intelligence Assessment"],
      ["recommended_outreach_approach","Recommended Outreach Approach"],
      ["qualification_status","Qualification"], ["stage","Campaign Stage"],
      ["email_consent_status","Email Consent"], ["do_not_contact","Do Not Contact"],
      ["source_urls","Research Sources"]
    ];
    const rows = [columns.map(c => c[1]), ...state.filtered.map(item => columns.map(c => item[c[0]]))];
    const csv = rows.map(row => row.map(value => '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"').join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "Swayphics_Tender_Corporate_Groups_Prospects.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function cleanupIfNotLeads() {
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root) return;
    const heading = root.querySelector(".sway-workspace-heading-copy h2");
    if (!heading || heading.textContent.trim().toLowerCase() !== "leads") {
      const tabs = document.getElementById("sway-tender-campaign-tabs");
      const panel = document.getElementById("sway-tender-campaign-panel");
      if (tabs) tabs.hidden = true;
      if (panel) panel.hidden = true;
      Array.from(root.querySelectorAll(".sway-tender-standard-hidden")).forEach(node => node.classList.remove("sway-tender-standard-hidden"));
    }
  }

  let scheduled = false;
  function mount() {
    scheduled = false;
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root) return;
    const heading = root.querySelector(".sway-workspace-heading-copy h2");
    if (!heading || heading.textContent.trim().toLowerCase() !== "leads") {
      cleanupIfNotLeads();
      return;
    }
    const ui = renderTabs();
    if (!ui.tabs.isConnected || !ui.panel.isConnected) return;
    setStandardVisibility();
    if (ui.panel !== mountedPanelNode) {
      mountedPanelNode = ui.panel;
      if (state.mode === "campaign" && state.loaded) renderCampaign();
    }
  }

  function scheduleMount() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(mount);
  }

  function start() {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", start, { once: true });
      return;
    }
    // The workspace renderer can replace the main workspace node during
    // navigation. Observe the stable document body so the campaign tab
    // remounts against the current Leads view after that replacement.
    const observer = new MutationObserver(scheduleMount);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    scheduleMount();
    window.addEventListener("storage", event => {
      if (event.key === "swayphics_admin_access_token" && !event.newValue) {
        state.loaded = false;
        state.prospects = [];
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();