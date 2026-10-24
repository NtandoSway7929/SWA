import assert from "node:assert/strict";

const SUPABASE_URL = "https://ofqofhnlzbouclvvrmzd.supabase.co";
const PROJECT_REF = "ofqofhnlzbouclvvrmzd";
const PUBLISHABLE_KEY = "sb_publishable_p4UqpaLvEx_93XJSWvzo6Q_loju0xzW";
const SYNTHETIC_MESSAGE =
  "Analyze this fictional performance snapshot and give me a concise executive summary with a main takeaway and each metric preserved separately. Reach: 1,500 impressions. Conversion rate: 3.5%. Customer satisfaction: 92%. These are illustrative test figures, not real business data. Do not invent additional metrics. Because the measures use different units, do not combine them into one chart.";

function requiredEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error("Missing required isolated-test setting: " + name);
  return value;
}

async function postJson(url, headers, payload, timeoutMs = 20000) {
  return await fetch(url, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function parseStructuredAnswer(answer) {
  try {
    const parsed = JSON.parse(answer);
    const ui = parsed && typeof parsed === "object" ? parsed.innerme_ui : null;
    if (!ui || ui.version !== 1 || typeof ui.kind !== "string") {
      return { valid: false, reason: "missing_innerme_ui_v1_envelope", parsed };
    }
    return { valid: true, parsed, ui };
  } catch {
    return { valid: false, reason: "answer_not_strict_json" };
  }
}

function validateMetrics(ui) {
  const errors = [];
  if (ui.kind === "chart" || ui.chart) {
    errors.push("Mixed-unit snapshot was rendered as a chart.");
  }
  const metrics = Array.isArray(ui.metrics) ? ui.metrics : [];
  const fields = [
    { key: "reach", labelMatch: /reach|impressions/i, valueMatch: /1\s*,?\s*500|1500/i },
    { key: "conversion_rate", labelMatch: /conversion/i, valueMatch: /3\.5/ },
    { key: "customer_satisfaction", labelMatch: /satisfaction/i, valueMatch: /92/ },
  ];
  const matched = {};
  for (const field of fields) {
    const metric = metrics.find((item) =>
      item &&
      typeof item.label === "string" &&
      typeof item.value === "string" &&
      field.labelMatch.test(item.label) &&
      field.valueMatch.test(item.value)
    );
    matched[field.key] = metric
      ? { label: metric.label, value: metric.value }
      : null;
    if (!metric) errors.push("Missing separate metric: " + field.key);
  }
  if (metrics.length < 3) errors.push("Expected at least three separate metrics.");
  return { passed: errors.length === 0, errors, matched, metric_count: metrics.length };
}

async function main() {
  assert.equal(new URL(SUPABASE_URL).hostname, PROJECT_REF + ".supabase.co");
  if (String(process.env.CONFIRM_NO_BILLING || "").toLowerCase() !== "true") {
    throw new Error("Safety stop before sign-in: confirm_no_billing must be true.");
  }

  const email = requiredEnvironment("INNERME_TEST_ADMIN_EMAIL");
  const password = requiredEnvironment("INNERME_TEST_ADMIN_PASSWORD");

  const signIn = await postJson(
    SUPABASE_URL + "/auth/v1/token?grant_type=password",
    { apikey: PUBLISHABLE_KEY },
    { email, password },
    15000,
  );
  if (!signIn.ok) {
    throw new Error("Isolated test-admin sign-in failed (HTTP " + signIn.status + "); no chat request was sent.");
  }
  const auth = await signIn.json();
  const accessToken = typeof auth?.access_token === "string" ? auth.access_token : "";
  if (!accessToken) throw new Error("Isolated sign-in returned no access token; no chat request was sent.");

  const headers = {
    apikey: PUBLISHABLE_KEY,
    Authorization: "Bearer " + accessToken,
  };

  // Provider-free preflight: verifies auth, test-admin status, and key readiness.
  const healthResponse = await postJson(
    SUPABASE_URL + "/functions/v1/swayphics-ai",
    headers,
    {
      action: "innerme_workspace_read_health",
      message: "Read-only preflight for the isolated structured-answer evaluation.",
    },
  );
  if (!healthResponse.ok) {
    throw new Error("Provider-free preflight failed (HTTP " + healthResponse.status + "); no chat request was sent.");
  }
  const health = await healthResponse.json();
  const configured = health?.provider_configuration?.gemini_key_configured;
  if (health?.ok !== true || health?.read_only !== true || configured !== true) {
    throw new Error("Isolated preflight did not verify a healthy read-only route and configured Gemini key; no chat request was sent.");
  }

  // Confirm telemetry read access before the single chat POST.
  const telemetryPreflight = await fetch(
    SUPABASE_URL + "/rest/v1/innerme_provider_usage?select=request_id&limit=0",
    {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!telemetryPreflight.ok) {
    throw new Error("Telemetry preflight failed (HTTP " + telemetryPreflight.status + "); no chat request was sent.");
  }

  // Exactly one chat POST. No retry occurs in this script.
  const startedAt = performance.now();
  let response;
  try {
    response = await postJson(
      SUPABASE_URL + "/functions/v1/swayphics-ai",
      { ...headers, Accept: "application/json" },
      { action: "assistant_chat", message: SYNTHETIC_MESSAGE },
      45000,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.name : "unknown_error";
    throw new Error("The one isolated chat request failed at transport level (" + reason + "). No retry was attempted.");
  }
  const elapsedMs = Math.round(performance.now() - startedAt);
  const requestId = response.headers.get("x-innerme-request-id") || "";
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok || !body || typeof body.answer !== "string" || !body.answer.trim()) {
    process.stdout.write(JSON.stringify({
      evaluation: "innerme_structured_answer_live_evaluation_v1",
      status: body?.quota_guarded ? "blocked_before_provider" : "request_failed",
      project: "isolated_test_only",
      project_ref: PROJECT_REF,
      chat_requests_sent: 1,
      provider_requests_confirmed: 0,
      http_status: response.status,
      quota_guarded: body?.quota_guarded === true,
      guard_reason: typeof body?.guard_reason === "string" ? body.guard_reason : null,
      request_id: requestId || null,
      elapsed_ms: elapsedMs,
      retries: 0,
      answer: typeof body?.error === "string" ? body.error.slice(0, 500) : null,
    }, null, 2) + "\n");
    process.exitCode = 1;
    return;
  }

  if (body.read_only !== true) {
    throw new Error("The chat response did not affirm its read-only contract. No retry was attempted.");
  }

  const structured = parseStructuredAnswer(body.answer);
  const validation = structured.valid
    ? validateMetrics(structured.ui)
    : { passed: false, errors: [structured.reason], matched: {}, metric_count: 0 };

  // Correlate provider attempts with the response's server-generated request ID.
  // If telemetry is absent, mark provider-request count as unverified rather than guessing.
  let attempts = null;
  let telemetryError = null;
  if (requestId) {
    const query = new URL(SUPABASE_URL + "/rest/v1/innerme_provider_usage");
    query.searchParams.set("select", "request_id,attempt_number,task_category,provider,model,outcome,http_status,latency_ms,input_tokens,output_tokens,total_tokens,error_code,fallback_reason");
    query.searchParams.set("request_id", "eq." + requestId);
    query.searchParams.set("order", "attempt_number.asc");
    try {
      const telemetry = await fetch(query, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(15000),
      });
      if (telemetry.ok) {
        const rows = await telemetry.json();
        if (Array.isArray(rows)) attempts = rows;
        else telemetryError = "Telemetry response was not an array.";
      } else {
        telemetryError = "Telemetry query returned HTTP " + telemetry.status + ".";
      }
    } catch (error) {
      telemetryError = error instanceof Error ? error.name : "unknown_error";
    }
  } else {
    telemetryError = "Missing X-InnerMe-Request-ID response header.";
  }

  const providerAttemptCount = Array.isArray(attempts) ? attempts.length : null;
  const exactlyOneAttempt = providerAttemptCount === 1 &&
    attempts[0]?.task_category === "assistant_chat" &&
    attempts[0]?.outcome === "success";
  const passed = validation.passed && exactlyOneAttempt;
  const report = {
    evaluation: "innerme_structured_answer_live_evaluation_v1",
    status: passed ? "passed" : "failed",
    project: "isolated_test_only",
    project_ref: PROJECT_REF,
    chat_requests_sent: 1,
    provider_requests_confirmed: providerAttemptCount,
    exactly_one_successful_provider_attempt: exactlyOneAttempt,
    http_status: response.status,
    elapsed_ms: elapsedMs,
    retries: 0,
    model: typeof body.model === "string" ? body.model : null,
    read_only: body.read_only === true,
    retrieval_error: Boolean(body.knowledge_retrieval?.retrieval_error),
    retrieval_match_count: Array.isArray(body.knowledge_retrieval?.matches)
      ? body.knowledge_retrieval.matches.length : null,
    request_id: requestId || null,
    structured: {
      selected: structured.valid,
      kind: structured.valid ? structured.ui.kind : null,
      metric_validation_passed: validation.passed,
      metrics: validation.matched,
      metric_count: validation.metric_count,
      errors: validation.errors,
    },
    provider_attempts: Array.isArray(attempts) ? attempts.map((row) => ({
      attempt: row.attempt_number,
      provider: row.provider,
      model: row.model,
      outcome: row.outcome,
      http_status: row.http_status,
      latency_ms: row.latency_ms,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      error_code: row.error_code,
      fallback_reason: row.fallback_reason,
    })) : null,
    telemetry_error: telemetryError,
    answer: body.answer.slice(0, 4000),
  };

  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write("INNERME_STRUCTURED_LIVE_EVALUATION=STOPPED " +
    (error instanceof Error ? error.message : "Unexpected failure") + "\n");
  process.exitCode = 1;
});
