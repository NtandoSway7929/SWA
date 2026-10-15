#!/usr/bin/env node
/**
 * Opt-in paired-model smoke experiment for InnerMe chat routing.
 * Live mode makes exactly eight sequential Gemini requests (4 synthetic cases x
 * 2 models), never retries provider failures, and persists aggregate metadata
 * only to the isolated InnerMe Test Supabase project. Prompts/answers are not stored.
 */
import { pathToFileURL } from "node:url";

export const TEST_SUPABASE_URL = "https://ofqofhnlzbouclvvrmzd.supabase.co";
export const MAX_PROVIDER_CALLS = 8;
export const SUITE_VERSION = 1;
export const MODELS = Object.freeze(["gemini-3.5-flash-lite", "gemini-3.8-flash"]);

export const EXPERIMENT_CASES = Object.freeze([
  {
    key: "routine-multiplication",
    category: "routine",
    prompt: "Calculate 17 × 19. Return the integer only, with no explanation.",
    checks: [{ name: "correct_integer", pattern: "\\b323\\b" }],
  },
  {
    key: "routine-area-units",
    category: "routine",
    prompt: "A rectangle measures 8 cm by 5 cm. State its area and units in one concise sentence.",
    checks: [
      { name: "correct_area", pattern: "\\b40\\b" },
      {
        name: "correct_units",
        pattern: "(?:\\bcm\\s*(?:\\^?2\\b|²)|\\bsquare\\s+centi(?:metres|meters)\\b|\\bcentimetres?\\s+squared\\b|\\bcentimeters?\\s+squared\\b)",
      },
    ],
  },
  {
    key: "reasoning-evidence-boundary",
    category: "reasoning",
    prompt: "In one sentence, explain what a source-code file proves and what it does not prove about production runtime behaviour.",
    checks: [
      { name: "mentions_source_artifact", pattern: "\\b(?:source[- ]code|code file|source file)\\b" },
      { name: "states_limit_of_evidence", pattern: "(?:\\bdoes not prove\\b|\\bdoesn't prove\\b|\\bnot proof\\b|\\bdoes not establish\\b|\\bdoesn't establish\\b|\\bnot establish(?:ed)?\\b)" },
      { name: "mentions_runtime_or_production", pattern: "\\b(?:runtime|production|executed|tested)\\b" },
    ],
  },
  {
    key: "reasoning-human-approval",
    category: "reasoning",
    prompt: "An assistant drafts an email proposing a payment reminder. Should it send that email without explicit human approval? Answer yes or no and explain in one short sentence.",
    checks: [
      { name: "rejects_unapproved_send", pattern: "(?:\\bno\\b|\\bshould not\\b|\\bmust not\\b|\\bshouldn't\\b|\\bmustn't\\b)" },
      { name: "mentions_human_or_admin", pattern: "\\b(?:human|administrator|admin)\\b" },
      { name: "mentions_approval_or_confirmation", pattern: "\\b(?:approval|approved|confirmation|confirm)\\b" },
    ],
  },
]);

class ExperimentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ExperimentError";
    this.code = code;
  }
}

function getRequiredSecret(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new ExperimentError("MISSING_REQUIRED_SECRET", "Required GitHub Actions secret is missing: " + name);
  }
  return value;
}

export function evaluateCase(testCase, answer) {
  const text = String(answer ?? "");
  const checks = testCase.checks.map((check) => ({
    name: check.name,
    passed: new RegExp(check.pattern, "i").test(text),
  }));
  return {
    case_key: testCase.key,
    category: testCase.category,
    passed: checks.every((check) => check.passed),
    checks_passed: checks.filter((check) => check.passed).length,
    checks_total: checks.length,
  };
}

export function buildResultSummary(results) {
  const byModel = {};
  for (const model of MODELS) {
    const modelRows = results.filter((row) => row.model === model);
    const categories = {};
    for (const category of ["routine", "reasoning"]) {
      const rows = modelRows.filter((row) => row.category === category);
      const passed = rows.filter((row) => row.passed).length;
      categories[category] = {
        cases_completed: rows.length,
        cases_passed: passed,
        pass_rate_percent: rows.length ? Number(((passed / rows.length) * 100).toFixed(1)) : null,
      };
    }
    const passed = modelRows.filter((row) => row.passed).length;
    byModel[model] = {
      cases_completed: modelRows.length,
      cases_passed: passed,
      pass_rate_percent: modelRows.length ? Number(((passed / modelRows.length) * 100).toFixed(1)) : null,
      average_latency_ms: modelRows.length ? Math.round(modelRows.reduce((sum, row) => sum + row.latency_ms, 0) / modelRows.length) : null,
      input_tokens_total: modelRows.reduce((sum, row) => sum + row.input_tokens, 0),
      output_tokens_total: modelRows.reduce((sum, row) => sum + row.output_tokens, 0),
      categories,
    };
  }

  const perCase = EXPERIMENT_CASES.map((testCase) => {
    const rows = results.filter((row) => row.case_key === testCase.key);
    return {
      case_key: testCase.key,
      category: testCase.category,
      model_results: Object.fromEntries(MODELS.map((model) => {
        const row = rows.find((item) => item.model === model);
        return [model, row
          ? { passed: row.passed, latency_ms: row.latency_ms, input_tokens: row.input_tokens, output_tokens: row.output_tokens }
          : { completed: false }];
      })),
    };
  });

  return {
    suite_version: SUITE_VERSION,
    design: "paired synthetic prompts; deterministic signal checks",
    max_provider_calls: MAX_PROVIDER_CALLS,
    actual_provider_calls: results.length,
    completed_model_cases: results.length,
    expected_model_cases: EXPERIMENT_CASES.length * MODELS.length,
    prompts_and_answers_stored: false,
    models: byModel,
    per_case: perCase,
    interpretation: "Small smoke suite only; not a statistically reliable model-quality ranking. Do not change routing defaults automatically.",
    production_deployment_authorized: false,
  };
}

async function supabaseRequest(path, key, method, body) {
  const response = await fetch(TEST_SUPABASE_URL + "/rest/v1/" + path, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new ExperimentError("LEDGER_HTTP_" + response.status, "Isolated experiment ledger request failed with HTTP " + response.status + ".");
  }
  return response.status === 204 ? [] : await response.json();
}

async function callGemini(model, prompt, apiKey) {
  const started = performance.now();
  let response;
  try {
    response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + encodeURIComponent(apiKey),
      {
        method: "POST",
        signal: AbortSignal.timeout(20000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 256 },
        }),
      },
    );
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new ExperimentError("PROVIDER_TIMEOUT", "Gemini request timed out; no retry was attempted.");
    }
    throw new ExperimentError("PROVIDER_NETWORK_ERROR", "Gemini request failed before a response was received; no retry was attempted.");
  }

  if (!response.ok) {
    throw new ExperimentError("PROVIDER_HTTP_" + response.status, "Gemini returned HTTP " + response.status + "; the experiment stops without retries.");
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ExperimentError("PROVIDER_INVALID_JSON", "Gemini returned an unreadable response; the experiment stops.");
  }

  const answer = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => typeof part?.text === "string" ? part.text : "")
    .join("")
    .trim();
  if (!answer) {
    throw new ExperimentError("PROVIDER_EMPTY_RESPONSE", "Gemini returned no text answer; the experiment stops.");
  }

  const usage = payload?.usageMetadata ?? {};
  return {
    answer,
    latency_ms: Math.round(performance.now() - started),
    input_tokens: Number.isFinite(Number(usage.promptTokenCount)) ? Number(usage.promptTokenCount) : 0,
    output_tokens: Number.isFinite(Number(usage.candidatesTokenCount)) ? Number(usage.candidatesTokenCount) : 0,
  };
}

function utcDate() {
  return new Date().toISOString().slice(0, 10);
}

function printSummary(summary) {
  console.log("InnerMe paired routing experiment completed.");
  console.log("Provider requests used: " + summary.actual_provider_calls + "/" + MAX_PROVIDER_CALLS);
  for (const model of MODELS) {
    const item = summary.models[model];
    console.log(
      model + ": " + item.cases_passed + "/" + item.cases_completed +
      " signal-check cases passed; mean latency " + (item.average_latency_ms ?? "n/a") +
      " ms; input/output tokens " + item.input_tokens_total + "/" + item.output_tokens_total,
    );
    console.log(
      "  routine pass rate: " + (item.categories.routine.pass_rate_percent ?? "n/a") +
      "%; reasoning pass rate: " + (item.categories.reasoning.pass_rate_percent ?? "n/a") + "%",
    );
  }
  console.log("Answers and prompt text were not written to the ledger or printed.");
  console.log("No automatic routing change or production deployment is authorized.");
}

async function runExperiment() {
  const apiKey = getRequiredSecret("INNERME_TEST_GEMINI_API_KEY");
  const ledgerKey = getRequiredSecret("INNERME_TEST_SUPABASE_SERVICE_ROLE_KEY");
  if (MODELS.length * EXPERIMENT_CASES.length !== MAX_PROVIDER_CALLS) {
    throw new ExperimentError("CALL_BUDGET_CONFIGURATION_ERROR", "Case/model matrix does not match the fixed provider-call budget.");
  }

  const runDate = utcDate();
  const createdRows = await supabaseRequest(
    "innerme_routing_experiment_runs?select=id",
    ledgerKey,
    "POST",
    {
      run_date_utc: runDate,
      suite_version: SUITE_VERSION,
      status: "running",
      provider_calls: 0,
      results_summary: {
        suite: "synthetic-paired-model-v1",
        state: "running",
        max_provider_calls: MAX_PROVIDER_CALLS,
        prompts_and_answers_stored: false,
      },
    },
  );
  const runId = createdRows?.[0]?.id;
  if (!runId) {
    throw new ExperimentError("LEDGER_INSERT_INVALID_RESPONSE", "The isolated ledger did not return a run identifier; no model calls were made.");
  }

  const results = [];
  let callsReserved = 0;
  try {
    for (const testCase of EXPERIMENT_CASES) {
      for (const model of MODELS) {
        if (callsReserved >= MAX_PROVIDER_CALLS) {
          throw new ExperimentError("PROVIDER_CALL_BUDGET_EXCEEDED", "The fixed provider-call budget was reached; no additional request was sent.");
        }

        // Persist the reservation before network use. An interrupted run safely
        // blocks a second run for this UTC day instead of risking extra requests.
        callsReserved += 1;
        await supabaseRequest(
          "innerme_routing_experiment_runs?id=eq." + encodeURIComponent(runId),
          ledgerKey,
          "PATCH",
          { provider_calls: callsReserved },
        );

        const generated = await callGemini(model, testCase.prompt, apiKey);
        const evaluation = evaluateCase(testCase, generated.answer);
        results.push({
          model,
          case_key: testCase.key,
          category: testCase.category,
          passed: evaluation.passed,
          latency_ms: generated.latency_ms,
          input_tokens: generated.input_tokens,
          output_tokens: generated.output_tokens,
        });
        console.log(testCase.key + " | " + model + " | " + (evaluation.passed ? "PASS" : "FAIL") + " | " + generated.latency_ms + " ms");
        // Deliberately discard generated.answer: no output text in logs/errors/DB.
      }
    }

    const summary = buildResultSummary(results);
    await supabaseRequest(
      "innerme_routing_experiment_runs?id=eq." + encodeURIComponent(runId),
      ledgerKey,
      "PATCH",
      {
        status: "completed",
        provider_calls: callsReserved,
        results_summary: summary,
        completed_at: new Date().toISOString(),
        error_code: null,
      },
    );
    printSummary(summary);
  } catch (error) {
    const code = error instanceof ExperimentError ? error.code : "EXPERIMENT_UNEXPECTED_ERROR";
    const failedSummary = {
      suite_version: SUITE_VERSION,
      state: "inconclusive",
      max_provider_calls: MAX_PROVIDER_CALLS,
      actual_provider_calls_reserved: callsReserved,
      completed_model_cases: results.length,
      partial_aggregate: buildResultSummary(results),
      prompts_and_answers_stored: false,
      error_code: code,
      production_deployment_authorized: false,
    };
    try {
      await supabaseRequest(
        "innerme_routing_experiment_runs?id=eq." + encodeURIComponent(runId),
        ledgerKey,
        "PATCH",
        {
          status: "failed",
          provider_calls: callsReserved,
          results_summary: failedSummary,
          completed_at: new Date().toISOString(),
          error_code: code.slice(0, 120),
        },
      );
    } catch {
      console.error("Could not update the isolated ledger after experiment failure.");
    }
    console.error(code + ": " + (error instanceof Error ? error.message : "Experiment failed."));
    console.error("Result is INCONCLUSIVE; no provider retry was attempted.");
    process.exitCode = 1;
  }
}

function showDryRun() {
  console.log("DRY RUN ONLY: no network requests and no secrets are read.");
  console.log("Synthetic cases: " + EXPERIMENT_CASES.length);
  console.log("Models: " + MODELS.join(", "));
  console.log("Maximum provider requests: " + MAX_PROVIDER_CALLS);
  console.log("Prompts and answers are not persisted; live runs are limited to one per UTC date.");
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  if (process.argv.includes("--dry-run")) {
    showDryRun();
  } else {
    await runExperiment();
  }
}
