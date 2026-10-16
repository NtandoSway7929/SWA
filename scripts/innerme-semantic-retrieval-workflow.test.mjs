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
    chatInput.includes("normal-chat grounding checks (uses up to four isolated provider requests)"),
    "The input description must disclose the provider-request impact."
  );
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
