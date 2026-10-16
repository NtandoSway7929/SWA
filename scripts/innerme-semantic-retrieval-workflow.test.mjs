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
  const match = workflow.match(
    new RegExp("^      " + name + ":\\n((?:^        .*\\n)+)", "m")
  );
  assert.ok(match, "workflow_dispatch input " + name + " must exist");
  return match[1];
}

test("manual semantic retrieval workflow defaults to retrieval-only mode", () => {
  const chatInput = workflowInput("run_chat_checks");
  assert.match(chatInput, /^        type: boolean$/m);
  assert.match(chatInput, /^        default: false$/m);
  assert.match(
    chatInput,
    /normal-chat grounding checks \(uses up to four isolated provider requests\)/,
    "The input description must disclose the provider-request impact."
  );
});

test("full chat mode requires a separate explicit no-billing confirmation", () => {
  const noBillingInput = workflowInput("confirm_no_billing");
  assert.match(noBillingInput, /^        type: boolean$/m);
  assert.match(noBillingInput, /^        default: false$/m);
  assert.match(
    workflow,
    /if \[\[ "\$\{RUN_CHAT_CHECKS\}" == "true" && "\$\{CONFIRM_NO_BILLING\}" != "true" \]\]; then/,
    "Full mode must stop before the suite when no-billing confirmation is absent."
  );
  assert.match(
    workflow,
    /payload\["run_chat_checks"\]\s*=\s*os\.environ\["RUN_CHAT_CHECKS"\]\.strip\(\)\.lower\(\)\s*==\s*"true"/,
    "The selected workflow mode must be forwarded to the regression endpoint."
  );
});

test("the isolated endpoint limits its Gemini key and quota preflight to full chat mode", () => {
  assert.match(endpoint, /const runChatChecks = baseline\.run_chat_checks !== false;/);
  assert.match(
    endpoint,
    /if \(runChatChecks && !Deno\.env\.get\("GEMINI_API_KEY"\)\)/,
    "Retrieval-only mode must not require a Gemini key."
  );
  assert.match(
    endpoint,
    /if \(runChatChecks\) \{\s*const utcQuotaDate = new Date\(\)\.toISOString\(\)\.slice\(0, 10\);\s*const \{ data: quotaRow, error: quotaReadError \}/,
    "The full-chat quota preflight must remain scoped to chat mode."
  );
});
