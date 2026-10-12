(function () {
  "use strict";

  const SUPABASE_URL = "https://sqifhribgsqfaxgtobsa.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QhB";
  const ACCESS_TOKEN_KEY = "swayphics_admin_access_token";
  const RPC_URL = SUPABASE_URL + "/rest/v1/rpc/get_innerme_provider_health_summary";
  const REFRESH_AFTER_MS = 60 * 1000;
  let loading = false;
  let lastLoadedAt = 0;

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toLocaleString("en-ZA") : "0";
  }

  function percent(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toFixed(2).replace(/\.00$/, "") + "%" : "0%";
  }

  function dateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? "—"
      : date.toLocaleString("en-ZA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  function active(panel) {
    const section = panel && panel.closest("[data-innerme-section]");
    return Boolean(section && !section.hidden && !section.closest("[hidden]"));
  }

  function setStatus(panel, message, state) {
    const status = panel.querySelector("[data-provider-usage-status]");
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state || "neutral";
  }

  function metric(label, value, detail) {
    return '<article class="sway-provider-usage-metric"><span>' + escapeHtml(label) +
      '</span><strong>' + escapeHtml(value) + '</strong><small>' + escapeHtml(detail || "") +
      '</small></article>';
  }

  function renderProviderSignals(data) {
    const summary = data.summary || {};
    const providers = Array.isArray(data.providers) ? data.providers : [];
    const quota = data.daily_quota || {};
    const attempts = Math.max(0, Number(summary.attempts) || 0);
    const failures = Math.max(0, Number(summary.failures) || 0);
    const fallbackEvents = Math.max(0, Number(summary.fallbacks) || 0);
    const signals = [];

    if (attempts === 0) {
      signals.push({
        state: "info",
        title: "No provider attempts recorded",
        detail: "There is not enough recent telemetry to assess provider reliability yet."
      });
    }

    if (fallbackEvents > 0) {
      signals.push({
        state: fallbackEvents >= 3 ? "warning" : "info",
        title: number(fallbackEvents) + " fallback-related attempt" + (fallbackEvents === 1 ? "" : "s") + " recorded",
        detail: fallbackEvents >= 3
          ? "Fallbacks are recurring. Review recent attempts and the primary provider's timeout or error pattern."
          : "At least one request used a fallback path. Check whether this becomes a recurring pattern."
      });
    }

    if (failures > fallbackEvents) {
      signals.push({
        state: failures - fallbackEvents >= 3 ? "critical" : "warning",
        title: number(failures - fallbackEvents) + " failure" + (failures - fallbackEvents === 1 ? "" : "s") + " not matched by a fallback event",
        detail: "Inspect the recent attempts table for provider errors that may not have recovered automatically."
      });
    }

    providers.forEach(function (provider) {
      const title = provider.provider === "cloudflare" ? "Cloudflare Workers AI" : "Google Gemini";
      const providerAttempts = Math.max(0, Number(provider.attempts) || 0);
      const successRate = Number(provider.success_rate_pct);
      const timeouts = Math.max(0, Number(provider.timeouts) || 0);

      if (providerAttempts >= 5 && Number.isFinite(successRate) && successRate < 80) {
        signals.push({
          state: "critical",
          title: title + " success rate is below 80%",
          detail: number(providerAttempts) + " attempts in the last 24 hours; inspect the recent attempts before changing provider settings."
        });
      } else if (providerAttempts >= 5 && Number.isFinite(successRate) && successRate < 90) {
        signals.push({
          state: "warning",
          title: title + " success rate is below 90%",
          detail: number(providerAttempts) + " attempts in the last 24 hours. Continue monitoring before making changes."
        });
      }

      if (timeouts >= 3) {
        signals.push({
          state: "warning",
          title: "Recurring timeout signals for " + title,
          detail: number(timeouts) + " timeout errors were recorded in the 24-hour window."
        });
      }
    });

    ["cloudflare", "gemini"].forEach(function (key) {
      const provider = quota[key] || {};
      const reserved = Math.max(0, Number(provider.reserved) || 0);
      const limit = Math.max(0, Number(provider.limit) || 0);
      if (!limit) return;
      const ratio = reserved / limit * 100;
      const title = key === "cloudflare" ? "Cloudflare" : "Gemini";
      if (ratio >= 95) {
        signals.push({
          state: "critical",
          title: title + " request reservation is at or above 95% of its daily cap",
          detail: number(reserved) + " of " + number(limit) + " reservations used (UTC). Further requests may be blocked by the application guard."
        });
      } else if (ratio >= 80) {
        signals.push({
          state: "warning",
          title: title + " request reservation is at or above 80% of its daily cap",
          detail: number(reserved) + " of " + number(limit) + " reservations used (UTC). Avoid unnecessary retests."
        });
      }
    });

    if (!signals.length) {
      signals.push({
        state: "good",
        title: "No monitoring thresholds crossed",
        detail: "No repeated-failure, timeout, or high-quota signals were detected in the available telemetry."
      });
    }

    const rank = { critical: 0, warning: 1, info: 2, good: 3 };
    signals.sort(function (a, b) { return rank[a.state] - rank[b.state]; });
    return signals.map(function (signal) {
      const label = signal.state === "critical" ? "Action needed" :
        signal.state === "warning" ? "Watch" :
        signal.state === "good" ? "Clear" : "Info";
      return '<article class="sway-provider-usage-signal ' + escapeHtml(signal.state) + '">' +
        '<span class="sway-provider-usage-signal-label">' + escapeHtml(label) + '</span>' +
        '<div><strong>' + escapeHtml(signal.title) + '</strong><p>' +
        escapeHtml(signal.detail) + '</p></div></article>';
    }).join("");
  }

  function renderSummary(panel, data) {
    const summary = data.summary || {};
    const signalsPanel = panel.querySelector("[data-provider-usage-signals]");
    if (signalsPanel) signalsPanel.innerHTML = renderProviderSignals(data);
    const metrics = panel.querySelector("[data-provider-usage-metrics]");
    metrics.innerHTML = [
      metric("Provider attempts", number(summary.attempts), "Last 24 hours"),
      metric("Attempt success rate", percent(summary.success_rate_pct), number(summary.successes) + " successful attempts"),
      metric("Failed attempts", number(summary.failures), "Provider attempts ending in error"),
      metric("Timeout signals", number(summary.timeouts), "Includes timeout-triggered fallbacks"),
      metric("Average latency", number(summary.avg_latency_ms) + " ms", "Across recorded attempts"),
      metric("P95 latency", number(summary.p95_latency_ms) + " ms", "95th percentile, last 24 hours")
    ].join("");

    const providers = Array.isArray(data.providers) ? data.providers : [];
    const breakdown = panel.querySelector("[data-provider-usage-breakdown]");
    breakdown.innerHTML = providers.length ? providers.map(function (provider) {
      const title = provider.provider === "cloudflare" ? "Cloudflare Workers AI" : "Google Gemini";
      return '<article class="sway-provider-usage-provider"><div class="sway-provider-usage-provider-head"><strong>' +
        escapeHtml(title) + '</strong><span>' + escapeHtml(percent(provider.success_rate_pct)) +
        '</span></div><div class="sway-provider-usage-provider-stats"><span>' +
        escapeHtml(number(provider.attempts)) + ' attempts</span><span>' +
        escapeHtml(number(provider.successes)) + ' success</span><span>' +
        escapeHtml(number(provider.failures)) + ' failed</span><span>' +
        escapeHtml(number(provider.timeouts)) + ' timeout signals</span></div><small>Avg ' +
        escapeHtml(number(provider.avg_latency_ms)) + ' ms · P95 ' +
        escapeHtml(number(provider.p95_latency_ms)) + ' ms</small></article>';
    }).join("") : '<p class="sway-provider-usage-empty">No provider attempts have been recorded in the last 24 hours.</p>';

    const quota = data.daily_quota || {};
    const quotaPanel = panel.querySelector("[data-provider-usage-quota]");
    quotaPanel.innerHTML = ["cloudflare", "gemini"].map(function (providerKey) {
      const provider = quota[providerKey] || { reserved: 0, limit: 0 };
      const used = Math.max(0, Number(provider.reserved) || 0);
      const limit = Math.max(0, Number(provider.limit) || 0);
      const ratio = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
      const title = providerKey === "cloudflare" ? "Cloudflare Workers AI" : "Gemini (approved models combined)";
      return '<article class="sway-provider-usage-quota-item"><div><strong>' + escapeHtml(title) +
        '</strong><span>' + escapeHtml(number(used)) + ' / ' + escapeHtml(number(limit)) +
        '</span></div><div class="sway-provider-usage-progress" role="progressbar" aria-label="' +
        escapeHtml(title + " daily request reservations") + '" aria-valuemin="0" aria-valuemax="' +
        escapeHtml(limit) + '" aria-valuenow="' + escapeHtml(used) +
        '"><span style="width:' + ratio.toFixed(2) + '%"></span></div><small>' +
        escapeHtml(percent(ratio)) + ' of the application-enforced daily cap · UTC reset</small></article>';
    }).join("");

    const rows = Array.isArray(data.recent_attempts) ? data.recent_attempts : [];
    const recent = panel.querySelector("[data-provider-usage-recent]");
    recent.innerHTML = rows.length ? rows.map(function (attempt) {
      const title = attempt.provider === "cloudflare" ? "Cloudflare" : "Gemini";
      const note = attempt.fallback_reason || attempt.error_code || "—";
      const displayOutcome = attempt.outcome === "success" && attempt.fallback_reason
        ? "Fallback success" : attempt.outcome;
      const statusClass = attempt.outcome === "success" ? "success" : "error";
      return '<tr><td>' + escapeHtml(dateTime(attempt.created_at)) +
        '</td><td><strong>' + escapeHtml(title) + '</strong><small>' + escapeHtml(attempt.model) +
        '</small></td><td><span class="sway-provider-usage-outcome ' + statusClass + '">' +
        escapeHtml(displayOutcome) + '</span></td><td>' + escapeHtml(number(attempt.latency_ms)) +
        ' ms</td><td>' + escapeHtml(attempt.http_status == null ? "—" : attempt.http_status) +
        '</td><td>' + escapeHtml(note) + '</td></tr>';
    }).join("") : '<tr><td colspan="6">No provider attempts recorded in the selected window.</td></tr>';

    const time = dateTime(data.generated_at);
    setStatus(panel, "Updated " + time + " · Window: last 24 hours · UTC quota date: " +
      escapeHtml(quota.date_utc || "—"), "success");
  }

  async function load(panel, manual) {
    if (!panel || loading) return;
    if (!manual && !active(panel)) return;
    let accessToken = "";
    try { accessToken = localStorage.getItem(ACCESS_TOKEN_KEY) || ""; } catch (_) {}
    if (!accessToken) {
      setStatus(panel, "Your admin session was not found. Sign in again, then refresh this view.", "error");
      return;
    }

    loading = true;
    const button = panel.querySelector("[data-provider-usage-refresh]");
    if (button) {
      button.disabled = true;
      button.textContent = "Refreshing…";
    }
    setStatus(panel, "Loading provider health and quota counters…", "neutral");

    try {
      const response = await fetch(RPC_URL, {
        method: "POST",
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: "Bearer " + accessToken,
          "Content-Type": "application/json"
        },
        body: "{}",
        cache: "no-store"
      });
      const payload = await response.json().catch(function () { return null; });
      if (!response.ok) {
        const message = payload && (payload.message || payload.error || payload.hint);
        throw new Error(message || ("Provider health request returned HTTP " + response.status));
      }
      if (!payload || typeof payload !== "object") throw new Error("The provider health response was empty.");
      renderSummary(panel, payload);
      lastLoadedAt = Date.now();
    } catch (error) {
      setStatus(panel, error && error.message ? error.message : "Could not load provider health.", "error");
      lastLoadedAt = Date.now();
    } finally {
      loading = false;
      if (button) {
        button.disabled = false;
        button.textContent = "Refresh data";
      }
    }
  }

  function inspect() {
    const panel = document.getElementById("sway-innerme-provider-usage");
    if (!panel) return;
    const button = panel.querySelector("[data-provider-usage-refresh]");
    if (button && button.dataset.bound !== "true") {
      button.dataset.bound = "true";
      button.addEventListener("click", function () { load(panel, true); });
    }
    if (active(panel) && Date.now() - lastLoadedAt >= REFRESH_AFTER_MS) load(panel, false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inspect, { once: true });
  } else {
    inspect();
  }

  if (document.body && typeof MutationObserver !== "undefined") {
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden"]
    });
  }
})();
