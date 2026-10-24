(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InnerMeIntelligentUI = api;
  if (root && root.document) {
    const start = function () { api.boot(root.document); };
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  const VERSION = 1;

  function classifyText(value) {
    const text = String(value || "").trim();
    if (!text) return "answer";
    if (/\b(step|ranked plan|action plan|next actions|checklist|milestone)\b/i.test(text) ||
        (/^\s*\d+[.)]\s+/m.test(text) && /\b(action|plan|step|next|goal|outcome)\b/i.test(text))) return "plan";
    if (/\b(profit|revenue|cash balance|subtotal|total paid|average monthly|calculation|calculate)\b/i.test(text)) return "calculation";
    if (/\b(summary|in short|key findings|takeaway|overview)\b/i.test(text)) return "summary";
    if (/\b(not specified|not available|cannot verify|retrieval failed|not enough information)\b/i.test(text)) return "evidence";
    return "answer";
  }

  function parseNumericCell(value) {
    const normalized = String(value || "").trim().replace(/\u00a0/g, " ");
    if (!normalized || /^(?:-|—|n\/a|not available)$/i.test(normalized)) return null;
    const candidate = normalized.replace(/\bR\s*/i, "").replace(/[,\s]/g, "").replace(/%$/, "");
    if (!/^-?\d+(?:\.\d+)?$/.test(candidate)) return null;
    const number = Number(candidate);
    return Number.isFinite(number) ? number : null;
  }

  function extractTableSeries(tableRows) {
    if (!Array.isArray(tableRows) || tableRows.length < 3) return null;
    const rows = tableRows.map(row => (Array.isArray(row) ? row : []).map(cell => String(cell ?? "").trim()));
    const header = rows[0] || [];
    const body = rows.slice(1).filter(row => row.length >= 2);
    if (body.length < 2) return null;
    let selectedColumn = -1;
    let values = [];
    const maxColumns = Math.max(0, ...rows.map(row => row.length));
    for (let column = maxColumns - 1; column >= 1; column--) {
      const parsed = body.map(row => parseNumericCell(row[column]));
      if (parsed.filter(value => value !== null).length >= 2) {
        selectedColumn = column;
        values = parsed;
        break;
      }
    }
    if (selectedColumn < 1) return null;
    const points = body.map((row, index) => ({
      label: (row[0] || ("Row " + (index + 1))).slice(0, 100),
      value: values[index]
    })).filter(point => point.value !== null);
    if (points.length < 2) return null;
    return { title: header[selectedColumn] || "Values", points: points.slice(0, 12) };
  }

  function parseOptInPayload(text) {
    const raw = String(text || "").trim();
    if (!raw || raw.length > 20000) return null;
    const fenced = raw.match(new RegExp("^\\x60\\x60\\x60(?:json|innerme-ui)\\s*([\\s\\S]*?)\\s*\\x60\\x60\\x60$", "i"));
    const candidate = fenced ? fenced[1] : raw;
    if (candidate.length > 20000 || candidate[0] !== "{") return null;
    try {
      const value = JSON.parse(candidate);
      const payload = value && value.innerme_ui;
      if (!payload || payload.version !== VERSION ||
          !["summary", "metrics", "checklist", "chart", "sections"].includes(payload.kind)) return null;
      if (payload.title !== undefined && typeof payload.title !== "string") return null;
      if (payload.summary !== undefined && typeof payload.summary !== "string") return null;
      if (payload.metrics !== undefined && (!Array.isArray(payload.metrics) || payload.metrics.length > 8 ||
          payload.metrics.some(item => !item || typeof item.label !== "string" || typeof item.value !== "string"))) return null;
      if (payload.items !== undefined && (!Array.isArray(payload.items) || payload.items.length > 12 ||
          payload.items.some(item => typeof item !== "string" && (!item || typeof item.label !== "string")))) return null;
      if (payload.sections !== undefined && (!Array.isArray(payload.sections) || payload.sections.length > 8 ||
          payload.sections.some(item => !item || typeof item.title !== "string" || typeof item.body !== "string"))) return null;
      if (payload.kind === "chart" &&
          (!payload.chart || !Array.isArray(payload.chart.points) || payload.chart.points.length > 12 ||
          payload.chart.points.some(point => !point || typeof point.label !== "string" ||
            typeof point.value !== "number" || !Number.isFinite(point.value)))) return null;
      return payload;
    } catch (_) { return null; }
  }

  function classifyMessage(text, content) {
    const table = content && content.querySelector ? content.querySelector("table") : null;
    const hasList = !!(content && content.querySelector && content.querySelectorAll("li").length >= 3);
    const rows = table ? Array.from(table.querySelectorAll("tr")).map(row =>
      Array.from(row.querySelectorAll("th,td")).map(cell => cell.textContent || "")) : [];
    const chart = extractTableSeries(rows);
    const kind = classifyText(text);
    return { kind, chart, checklist: kind === "plan" && hasList };
  }

  function el(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderBars(doc, points, title) {
    const section = el(doc, "section", "innerme-iu-chart");
    section.setAttribute("aria-label", title);
    section.appendChild(el(doc, "h4", "innerme-iu-chart-title", title));
    const max = Math.max(1, ...points.map(point => Math.abs(point.value)));
    points.forEach(point => {
      const row = el(doc, "div", "innerme-iu-bar-row");
      const label = el(doc, "span", "innerme-iu-bar-label", point.label);
      const track = el(doc, "span", "innerme-iu-bar-track");
      const bar = el(doc, "span", "innerme-iu-bar");
      bar.style.width = String(Math.max(2, Math.round(Math.abs(point.value) / max * 100))) + "%";
      if (point.value < 0) bar.classList.add("is-negative");
      track.appendChild(bar);
      const value = el(doc, "strong", "innerme-iu-bar-value",
        new Intl.NumberFormat("en-ZA", { maximumFractionDigits: 2 }).format(point.value));
      row.append(label, track, value);
      section.appendChild(row);
    });
    return section;
  }

  function renderPayload(doc, payload) {
    const panel = el(doc, "section", "innerme-iu-card");
    panel.setAttribute("aria-label", payload.title || "Interactive answer");
    if (payload.title) panel.appendChild(el(doc, "h3", "innerme-iu-title", payload.title));
    if (payload.summary) panel.appendChild(el(doc, "p", "innerme-iu-summary", payload.summary));
    if (payload.metrics && payload.metrics.length) {
      const metrics = el(doc, "div", "innerme-iu-metrics");
      payload.metrics.forEach(metric => {
        const card = el(doc, "div", "innerme-iu-metric");
        card.append(el(doc, "span", "innerme-iu-metric-label", metric.label),
          el(doc, "strong", "innerme-iu-metric-value", metric.value));
        metrics.appendChild(card);
      });
      panel.appendChild(metrics);
    }
    if (payload.items && payload.items.length) {
      const list = el(doc, "ul", "innerme-iu-list");
      payload.items.forEach(item => {
        const label = typeof item === "string" ? item : item.label;
        const detail = typeof item === "string" ? "" : (item.detail || "");
        const li = el(doc, "li", "innerme-iu-list-item");
        li.appendChild(el(doc, "span", "innerme-iu-dot", "•"));
        const body = el(doc, "span", "innerme-iu-list-body", label);
        if (detail) body.appendChild(el(doc, "small", "", detail));
        li.appendChild(body);
        list.appendChild(li);
      });
      panel.appendChild(list);
    }
    if (payload.sections) payload.sections.forEach(section => {
      const block = el(doc, "section", "innerme-iu-section");
      block.append(el(doc, "h4", "", section.title), el(doc, "p", "", section.body));
      panel.appendChild(block);
    });
    if (payload.kind === "chart" && payload.chart) panel.appendChild(renderBars(doc, payload.chart.points, payload.chart.title || "Values"));
    return panel;
  }

  function getToolbar(doc, message) {
    let toolbar = message.querySelector(".innerme-iu-toolbar");
    if (!toolbar) {
      toolbar = el(doc, "div", "innerme-iu-toolbar");
      toolbar.setAttribute("aria-label", "Interactive answer tools");
      toolbar.appendChild(el(doc, "span", "innerme-iu-kind", "Answer"));
      message.appendChild(toolbar);
    }
    return toolbar;
  }

  function enhanceChart(doc, message, series) {
    if (message.querySelector(".innerme-iu-chart-toggle")) return;
    const content = message.querySelector(".sway-ai-message-content");
    if (!content) return;
    const toolbar = getToolbar(doc, message);
    const button = el(doc, "button", "innerme-iu-button innerme-iu-chart-toggle", "Show chart");
    button.type = "button";
    button.setAttribute("aria-expanded", "false");
    const chart = renderBars(doc, series.points, series.title);
    chart.hidden = true;
    button.addEventListener("click", function () {
      chart.hidden = !chart.hidden;
      button.textContent = chart.hidden ? "Show chart" : "Hide chart";
      button.setAttribute("aria-expanded", chart.hidden ? "false" : "true");
    });
    toolbar.appendChild(button);
    message.appendChild(chart);
  }

  function enhanceChecklist(doc, message) {
    if (message.querySelector(".innerme-iu-checklist-toggle")) return;
    const content = message.querySelector(".sway-ai-message-content");
    if (!content) return;
    const items = Array.from(content.querySelectorAll("ol li, ul li"))
      .map(li => (li.textContent || "").trim()).filter(Boolean).slice(0, 12);
    if (items.length < 3) return;
    const toolbar = getToolbar(doc, message);
    const button = el(doc, "button", "innerme-iu-button innerme-iu-checklist-toggle", "Make checklist");
    button.type = "button";
    button.setAttribute("aria-expanded", "false");
    const panel = el(doc, "section", "innerme-iu-checklist");
    panel.hidden = true;
    panel.setAttribute("aria-label", "Personal checklist; progress is not saved");
    panel.appendChild(el(doc, "p", "innerme-iu-checklist-note", "Personal checklist · progress stays in this page and is not saved."));
    const list = el(doc, "ul", "innerme-iu-checklist-items");
    const counter = el(doc, "p", "innerme-iu-checklist-count", "0 of " + items.length + " complete");
    function update() {
      const done = Array.from(list.querySelectorAll('input[type="checkbox"]')).filter(input => input.checked).length;
      counter.textContent = done + " of " + items.length + " complete";
    }
    items.forEach((label, index) => {
      const li = el(doc, "li", "innerme-iu-checklist-item");
      const checkbox = el(doc, "input", "");
      checkbox.type = "checkbox";
      checkbox.id = "innerme-iu-check-" + Date.now().toString(36) + "-" + index + "-" + Math.random().toString(36).slice(2);
      const text = el(doc, "label", "", label);
      text.htmlFor = checkbox.id;
      checkbox.addEventListener("change", update);
      li.append(checkbox, text);
      list.appendChild(li);
    });
    panel.append(list, counter);
    button.addEventListener("click", function () {
      panel.hidden = !panel.hidden;
      button.textContent = panel.hidden ? "Make checklist" : "Hide checklist";
      button.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
    });
    toolbar.appendChild(button);
    message.appendChild(panel);
  }

  function enhanceMessage(doc, message) {
    if (!message || message.dataset.innermeUiStructured === "1") return;
    const content = message.querySelector(".sway-ai-message-content");
    if (!content) return;
    const rawText = (content.textContent || "").trim();
    if (!rawText && !content.querySelector("table,ol,ul,pre,code")) return;
    message.dataset.innermeUiEnhanced = "1";
    const payload = parseOptInPayload(rawText);
    if (payload) {
      const original = el(doc, "details", "innerme-iu-original");
      original.appendChild(el(doc, "summary", "", "View original response"));
      const raw = el(doc, "pre", "");
      raw.textContent = rawText;
      original.appendChild(raw);
      content.replaceChildren(renderPayload(doc, payload), original);
      message.dataset.innermeUiStructured = "1";
      message.dataset.innermeUiEnhanced = "1";
      return;
    }
    const classification = classifyMessage(rawText, content);
    const kindLabels = { plan: "Action plan", calculation: "Calculation", summary: "Summary", evidence: "Evidence-aware answer", answer: "Answer" };
    getToolbar(doc, message).querySelector(".innerme-iu-kind").textContent = kindLabels[classification.kind] || "Answer";
    if (classification.chart) enhanceChart(doc, message, classification.chart);
    if (classification.checklist) enhanceChecklist(doc, message);
    message.dataset.innermeUiEnhanced = "1";
  }

  function boot(doc) {
    const workspace = doc.querySelector("#sway-admin-workspace");
    if (!workspace || workspace.dataset.innermeUiBooted === "1") return;
    workspace.dataset.innermeUiBooted = "1";
    const observer = new MutationObserver(records => records.forEach(record => {
      record.addedNodes.forEach(node => {
        const element = node.nodeType === 1 ? node : node.parentElement;
        if (!element) return;
        const parentMessage = element.closest && element.closest(".sway-ai-assistant");
        if (parentMessage) enhanceMessage(doc, parentMessage);
        if (element.matches && element.matches(".sway-ai-assistant")) enhanceMessage(doc, element);
        if (element.querySelectorAll) element.querySelectorAll(".sway-ai-assistant").forEach(message => enhanceMessage(doc, message));
      });
    }));
    observer.observe(workspace, { childList: true, subtree: true });
    workspace.querySelectorAll(".sway-ai-assistant").forEach(message => enhanceMessage(doc, message));
  }
  return { VERSION, classifyText, parseNumericCell, extractTableSeries, parseOptInPayload, classifyMessage, renderPayload, renderBars, enhanceMessage, boot };
});
