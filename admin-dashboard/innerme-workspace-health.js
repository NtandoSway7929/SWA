(function () {
  "use strict";

  const SUPABASE_URL = "https://sqifhribgsqfaxgtobsa.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QhB";
  const PANEL_ID = "innerme-workspace-health-panel";
  const EXPECTED_COLLECTIONS = [
    "leads", "followups", "clients", "projects", "tasks", "quotes", "invoices",
    "payments", "enquiries", "portal_requests", "communications", "email_messages",
    "activities"
  ];
  let running = false;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function parseTokenExpiry(token) {
    try {
      const parts = String(token || "").split(".");
      if (parts.length !== 3) return 0;
      const part = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const claims = JSON.parse(atob(part + "=".repeat((4 - part.length % 4) % 4)));
      return Number(claims.exp || 0) * 1000;
    } catch (_) {
      return 0;
    }
  }

  async function getAdminToken() {
    let token = localStorage.getItem("swayphics_admin_access_token");
    if (!token) throw new Error("No admin session was found. Sign in to the dashboard, then retry.");
    const expiry = parseTokenExpiry(token);
    if (expiry && expiry - Date.now() > 90 * 1000) return token;

    const refreshToken = localStorage.getItem("swayphics_admin_refresh_token");
    if (!refreshToken) return token;

    const response = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    const session = await response.json().catch(() => null);
    if (!response.ok || !session || !session.access_token) return token;
    localStorage.setItem("swayphics_admin_access_token", session.access_token);
    if (session.refresh_token) localStorage.setItem("swayphics_admin_refresh_token", session.refresh_token);
    return session.access_token;
  }

  function makePanel() {
    const panel = el("section", "innerme-workspace-health");
    panel.id = PANEL_ID;
    panel.setAttribute("aria-labelledby", "innerme-workspace-health-title");
    panel.innerHTML =
      '<div class="innerme-health-header">' +
        '<div class="innerme-health-copy">' +
          '<span class="innerme-health-eyebrow">InnerMe / Read-only diagnostics</span>' +
          '<h3 class="innerme-health-title" id="innerme-workspace-health-title">Workspace health</h3>' +
          '<p class="innerme-health-description">Checks the authenticated admin’s access to the operational workspace and database aggregate. This test does not send an AI chat prompt or call Gemini/Cloudflare.</p>' +
        '</div>' +
        '<button type="button" class="innerme-health-run" data-innerme-health-run aria-controls="innerme-workspace-health-results">Run health check</button>' +
      '</div>' +
      '<p class="innerme-health-status" data-innerme-health-status role="status" aria-live="polite">Not run yet. Run the check to verify live database access from this signed-in dashboard.</p>' +
      '<div class="innerme-health-results" id="innerme-workspace-health-results" data-innerme-health-results hidden></div>';
    const button = panel.querySelector("[data-innerme-health-run]");
    button.addEventListener("click", runHealthCheck);
    return panel;
  }

  function addMetric(container, label, value) {
    const metric = el("div", "innerme-health-metric");
    metric.appendChild(el("span", "innerme-health-metric-label", label));
    metric.appendChild(el("strong", "innerme-health-metric-value", value));
    container.appendChild(metric);
  }

  function showError(status, message) {
    const statusNode = document.querySelector("#" + PANEL_ID + " [data-innerme-health-status]");
    if (!statusNode) return;
    statusNode.dataset.state = "failed";
    statusNode.textContent = message || ("Health check failed (HTTP " + status + ").");
  }

  function renderHealthResult(httpStatus, data, requestId) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const statusNode = panel.querySelector("[data-innerme-health-status]");
    const results = panel.querySelector("[data-innerme-health-results]");
    if (!statusNode || !results) return;
    results.replaceChildren();
    results.hidden = false;

    const queryCount = Number(data && data.queried_collection_count);
    const failures = Array.isArray(data && data.workspace_query_failures) ? data.workspace_query_failures : [];
    const failureCount = Number.isFinite(Number(data && data.workspace_query_failure_count))
      ? Number(data.workspace_query_failure_count)
      : failures.length;
    const aggregateReady = data && data.aggregate_ready === true;
    const ready = httpStatus === 200 &&
      data && data.ok === true &&
      aggregateReady &&
      Number.isFinite(queryCount) && queryCount === EXPECTED_COLLECTIONS.length &&
      failureCount === 0;

    statusNode.dataset.state = ready ? "passed" : "failed";
    statusNode.textContent = ready
      ? "PASS · HTTP 200 · All 13 operational collection queries and the database aggregate succeeded."
      : "NOT HEALTHY · HTTP " + httpStatus + " · Review the diagnostic details below.";

    const metrics = el("div", "innerme-health-metrics");
    addMetric(metrics, "HTTP status", String(httpStatus));
    addMetric(metrics, "Workspace state", ready ? "Healthy" : "Needs review");
    addMetric(metrics, "Collections queried", Number.isFinite(queryCount) ? queryCount + " / 13" : "Not reported");
    addMetric(metrics, "Query failures", String(failureCount));
    results.appendChild(metrics);

    const details = el("section", "innerme-health-details");
    details.appendChild(el("h4", "", "Operational collections"));
    const list = el("ul", "innerme-health-collections");
    const queried = Array.isArray(data && data.queried_collections) ? data.queried_collections : [];
    const names = queried.length ? queried : EXPECTED_COLLECTIONS;
    names.forEach(name => {
      const item = el("li", "", name);
      if (failures.includes(name)) item.classList.add("is-failed");
      list.appendChild(item);
    });
    details.appendChild(list);

    if (failures.length) {
      const failureList = el("ul", "innerme-health-failures");
      failures.forEach(name => failureList.appendChild(el("li", "", String(name))));
      details.appendChild(failureList);
    } else {
      details.appendChild(el("p", "innerme-health-meta", "No workspace query failures were reported."));
    }
    results.appendChild(details);

    const meta = [];
    if (data && data.retrieval_profile) meta.push("Profile: " + data.retrieval_profile);
    if (data && Number.isFinite(Number(data.server_elapsed_ms))) meta.push("Server time: " + Number(data.server_elapsed_ms) + " ms");
    if (requestId) meta.push("Request: " + requestId);
    if (data && data.read_only === true) meta.push("Read-only");
    results.appendChild(el("p", "innerme-health-meta", meta.join(" · ") || "No additional diagnostic metadata was returned."));
  }

  async function runHealthCheck(event) {
    if (running) return;
    const panel = document.getElementById(PANEL_ID);
    const button = event && event.currentTarget ? event.currentTarget : panel && panel.querySelector("[data-innerme-health-run]");
    const statusNode = panel && panel.querySelector("[data-innerme-health-status]");
    if (!panel || !button || !statusNode) return;

    running = true;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = "Checking…";
    statusNode.dataset.state = "running";
    statusNode.textContent = "Checking authenticated database queries. No AI-provider request will be sent.";
    try {
      let token = await getAdminToken();
      const request = () => fetch(SUPABASE_URL + "/functions/v1/swayphics-ai", {
        method: "POST",
        cache: "no-store",
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          action: "innerme_workspace_read_health",
          message: "Read-only workspace health diagnostic initiated from the Swayphics admin dashboard."
        })
      });

      let response = await request();
      if (response.status === 401) {
        const refreshToken = localStorage.getItem("swayphics_admin_refresh_token");
        if (refreshToken) {
          const refreshResponse = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
            method: "POST",
            headers: {
              apikey: SUPABASE_PUBLISHABLE_KEY,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ refresh_token: refreshToken })
          });
          const session = await refreshResponse.json().catch(() => null);
          if (refreshResponse.ok && session && session.access_token) {
            token = session.access_token;
            localStorage.setItem("swayphics_admin_access_token", session.access_token);
            if (session.refresh_token) localStorage.setItem("swayphics_admin_refresh_token", session.refresh_token);
            response = await request();
          }
        }
      }

      const data = await response.json().catch(() => null);
      const requestId = response.headers.get("x-innerme-request-id") || (data && data.request_id) || "";
      if (!data || typeof data !== "object") {
        showError(response.status, "The health endpoint returned a non-JSON response (HTTP " + response.status + ").");
        return;
      }
      renderHealthResult(response.status, data, requestId);
    } catch (error) {
      showError(0, error instanceof Error ? error.message : "The health check failed before a response was received.");
    } finally {
      running = false;
      const currentPanel = document.getElementById(PANEL_ID);
      const currentButton = currentPanel && currentPanel.querySelector("[data-innerme-health-run]");
      if (currentButton) {
        currentButton.disabled = false;
        currentButton.removeAttribute("aria-busy");
        currentButton.textContent = "Run health check again";
      }
    }
  }

  function mountPanel() {
    const mount = document.querySelector("#sway-admin-workspace #sway-ai-intelligence-mount");
    if (!mount || document.getElementById(PANEL_ID)) return;
    mount.parentNode.insertBefore(makePanel(), mount);
  }

  function boot() {
    const root = document.getElementById("sway-admin-workspace");
    if (!root) return;
    mountPanel();
    const observer = new MutationObserver(() => mountPanel());
    observer.observe(root, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
