import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workflowPath = fileURLToPath(
  new URL("../.github/workflows/innerme-semantic-retrieval-smoke.yml", import.meta.url)
);
const workflow = readFileSync(workflowPath, "utf8");
const endpointPath = fileURLToPath(
  new URL("../supabase/functions/innerme-retrieval-smoke-test/index.ts", import.meta.url)
);
const endpoint = readFileSync(endpointPath, "utf8");
const seederPath = fileURLToPath(
  new URL("../scripts/innerme-test-corpus-embedding-smoke.mjs", import.meta.url)
);
const seeder = readFileSync(seederPath, "utf8");

function workflowInput(name) {
  const marker = "      " + name + ":\n";
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, "workflow_dispatch input " + name + " must exist");
  const rest = workflow.slice(start + marker.length);
  const nextInput = rest.match(/\n      [a-z_]+:\n/);
  return nextInput ? rest.slice(0, nextInput.index) : rest;
}

test("manual semantic retrieval workflow defaults to retrieval-only mode", () => {
  const chatInput = workflowInput("run_chat_checks");
  assert.ok(chatInput.includes("        type: boolean"));
  assert.ok(chatInput.includes("        default: false"));
  assert.ok(
    chatInput.includes("normal-chat grounding checks"),
    "The input description must disclose the provider-request impact."
  );
  const caseInput = workflowInput("chat_case_id");
  assert.ok(caseInput.includes("        type: choice"));
  assert.ok(caseInput.includes("        default: normal_chat_invoice_grounding"));
  for (const id of [
    "normal_chat_invoice_grounding",
    "normal_chat_appointment_grounding",
    "normal_chat_dispatch_grounding",
    "normal_chat_irrelevant_invoice_exclusion",
    "          - all",
  ]) {
    assert.ok(caseInput.includes(id), "the chat case selector must allow " + id);
  }
});

test("full chat mode requires a separate explicit no-billing confirmation", () => {
  const noBillingInput = workflowInput("confirm_no_billing");
  assert.ok(noBillingInput.includes("        type: boolean"));
  assert.ok(noBillingInput.includes("        default: false"));
  assert.ok(
    workflow.includes('if [[ "${RUN_CHAT_CHECKS}" == "true" && "${CONFIRM_NO_BILLING}" != "true" ]]; then'),
    "Full mode must stop before the suite when no-billing confirmation is absent."
  );
  assert.ok(
    workflow.includes('payload["run_chat_checks"] = os.environ["RUN_CHAT_CHECKS"].strip().lower() == "true"'),
    "The selected workflow mode must be forwarded to the regression endpoint."
  );
  assert.ok(
    workflow.includes('payload["run_chat_case_id"] = os.environ["RUN_CHAT_CASE_ID"].strip()'),
    "The selected grounding case must be forwarded to the isolated endpoint."
  );
});

test("the workflow rejects a dispatch that selects no test task", () => {
  const regressionInput = workflowInput("run_retrieval_regression");
  const corpusInput = workflowInput("seed_test_only_corpus");
  assert.ok(regressionInput.includes("        default: true"));
  assert.ok(corpusInput.includes("        default: false"));
  assert.ok(
    workflow.includes('if [[ "${RUN_RETRIEVAL_REGRESSION}" != "true" && "${SEED_TEST_ONLY_CORPUS}" != "true" ]]; then'),
    "At least one test mode must be selected; a no-op workflow must fail closed."
  );
});

test("ambiguous test-corpus insertion outcomes still discover and clean owned test rows", () => {
  assert.ok(
    seeder.includes("insertionMayHaveCommitted = true;"),
    "Mark the insert as potentially committed before sending the HTTP request."
  );
  assert.ok(
    seeder.includes("const discoveredRows = await getBySlugs(") &&
      seeder.includes('records.map((r) => r.slug),\n            "id,slug,source_id,verification_notes"'),
    "Cleanup must rediscover the fixed test slugs if the insert response is lost or malformed."
  );
  assert.ok(
    seeder.includes('String(row.verification_notes || "").startsWith("TEST ONLY:")'),
    "Cleanup must be restricted to explicitly marked test-only rows."
  );
});

test("the isolated endpoint limits its Gemini key and quota preflight to full chat mode", () => {
  assert.ok(endpoint.includes("const runChatChecks = baseline.run_chat_checks !== false;"));
  assert.ok(
    endpoint.includes('if (runChatChecks && !Deno.env.get("GEMINI_API_KEY"))'),
    "Retrieval-only mode must not require a Gemini key."
  );
  assert.ok(
    endpoint.includes('if (runChatChecks) {\n    const utcQuotaDate = new Date().toISOString().slice(0, 10);\n    const { data: quotaRow, error: quotaReadError }'),
    "The full-chat quota preflight must remain scoped to chat mode."
  );
});


test("targeted grounding mode defaults to one case and scales quota preflight", () => {
  assert.ok(endpoint.includes('baseline.run_chat_case_id !== undefined'));
  assert.ok(endpoint.includes('baseline.run_chat_case_id !== "all" && !ALLOWED_CHAT_CASE_IDS.includes(baseline.run_chat_case_id)'));
  assert.ok(endpoint.includes('const selectedChatCaseCount = runChatCaseId === "all" ? ALLOWED_CHAT_CASE_IDS.length : 1;'));
  assert.ok(endpoint.includes("const minimumRequiredRequests = selectedChatCaseCount * 2;"));
  assert.ok(endpoint.includes('runChatCaseId !== "all" && test.id !== runChatCaseId'));
  assert.ok(endpoint.includes('run_mode: !runChatChecks ? "retrieval_only" : (runChatCaseId === "all" ? "full" : "targeted_grounding")'));
  assert.ok(endpoint.includes("this case was intentionally not sent to the provider"));
});

test("operator guide describes retrieval-only, targeted grounding, and explicit all-cases mode", () => {
  const docsPath = fileURLToPath(
    new URL("../docs/innerme-semantic-retrieval-e2e-smoke-test.md", import.meta.url)
  );
  const docs = readFileSync(docsPath, "utf8");
  assert.ok(docs.includes("default `run_chat_checks=false`"));
  assert.ok(docs.includes("Targeted grounding mode"));
  assert.ok(docs.includes("`chat_case_id=all`"));
});
