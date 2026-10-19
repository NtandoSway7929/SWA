import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20261016034000_innerme_zero_cost_quota_exhaustion_fix.sql", import.meta.url),
  "utf8",
);
const exhaustedBranch = migration.match(/if v_used is null then([\s\S]*?)\n  end if;/)?.[1] ?? "";

test("quota exhaustion returns the existing count without reserving another request", () => {
  assert.ok(exhaustedBranch.includes("COALESCE(v_used, v_daily_limit)"));
  assert.doesNotMatch(exhaustedBranch, /pg_catalog\.coalesce/i);
  assert.match(exhaustedBranch, /'reason', 'daily_quota_reached'/);
  assert.match(migration, /where q\.request_count < v_daily_limit/);
  assert.match(migration, /v_daily_limit := 40;/);
  assert.match(migration, /p_request_bytes > 24000/);
});

test("the corrected guard preserves the approved-model and fail-closed boundaries", () => {
  assert.match(migration, /'@cf\/meta\/llama-3\.1-8b-instruct-fp8'/);
  assert.match(migration, /'gemini-3\.8-flash', 'gemini-3\.5-flash-lite', 'gemini-3\.1-flash-lite'/);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /revoke all on function public\.innerme_reserve_provider_quota\(text, text, integer\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.innerme_reserve_provider_quota\(text, text, integer\) to service_role/i);
  assert.doesNotMatch(migration, /grant execute[^;]*\b(?:anon|authenticated)\b/i);
});


const regressionHelper = readFileSync(
  new URL("../supabase/functions/innerme-retrieval-smoke-test/index.ts", import.meta.url),
  "utf8",
);

test("full-mode chat quota preflight stops before fixture creation when budget is insufficient", () => {
  const preflightIndex = regressionHelper.indexOf('const utcQuotaDate = new Date().toISOString().slice(0, 10);');
  const runIdIndex = regressionHelper.indexOf('const runId = crypto.randomUUID()');
  const fixtureSeedIndex = regressionHelper.indexOf("// Seed only run-unique synthetic rows");
  assert.ok(preflightIndex >= 0, "the quota preflight must exist");
  assert.ok(runIdIndex > preflightIndex, "quota preflight must run before allocating a test run ID");
  assert.ok(fixtureSeedIndex > preflightIndex, "quota preflight must run before creating synthetic fixtures");
  assert.match(regressionHelper, /from\("innerme_provider_quota_daily"\)/);
  assert.match(regressionHelper, /\.eq\("quota_date", utcQuotaDate\)/);
  assert.match(regressionHelper, /const dailyLimit = 40;/);
  assert.match(regressionHelper, /const selectedChatCaseCount = runChatCaseId === "all" \? ALLOWED_CHAT_CASE_IDS.length : 1;/);
  assert.match(regressionHelper, /const minimumRequiredRequests = selectedChatCaseCount \* 2;/);
  assert.match(regressionHelper, /remainingBudget < minimumRequiredRequests/);
  assert.match(regressionHelper, /stage: "provider_quota_preflight"/);
  assert.match(regressionHelper, /no fixtures or chat requests were made/i);
});


const innermeFunctionSource = readFileSync(
  new URL("../supabase/functions/swayphics-ai/index.ts", import.meta.url),
  "utf8",
);
const supabaseFunctionConfig = readFileSync(
  new URL("../supabase/config.toml", import.meta.url),
  "utf8",
);

test("public InnerMe remains available while private operations require application-level admin auth", () => {
  assert.match(supabaseFunctionConfig, /\[functions\.swayphics-ai\]\s*verify_jwt\s*=\s*false/);

  const publicChatIndex = innermeFunctionSource.indexOf('if (body.action === "public_chat") {');
  const adminAuthIndex = innermeFunctionSource.indexOf('const authHeader = req.headers.get("Authorization") || "";');
  assert.ok(publicChatIndex >= 0, "public chat route must exist");
  assert.ok(adminAuthIndex > publicChatIndex, "public chat must be handled before private-admin authentication");

  const publicRoute = innermeFunctionSource.slice(publicChatIndex, adminAuthIndex);
  assert.match(publicRoute, /https:\/\/swayphics\.co\.za/);
  assert.match(publicRoute, /https:\/\/www\.swayphics\.co\.za/);
  assert.match(publicRoute, /consume_public_innerme_rate_limit/);
  assert.match(publicRoute, /x-innerme-session/);
  assert.match(publicRoute, /publicSession\.length < 16/);

  const adminGate = innermeFunctionSource.slice(adminAuthIndex, adminAuthIndex + 5000);
  assert.match(adminGate, /if \(!accessToken\)/);
  assert.match(adminGate, /authSupabase\.auth\.getUser\(accessToken\)/);
  assert.match(adminGate, /authSupabase\.rpc\("is_swayphics_admin"\)/);
});

test("Gemini copywriting fallback omits deprecated Gemini 3.x sampling controls", () => {
  const start = innermeFunctionSource.indexOf("async function requestGeminiCopywritingFallback(model: string) {");
  assert.ok(start >= 0, "Gemini copywriting fallback must exist");
  const end = innermeFunctionSource.indexOf("\n  async function ", start + 10);
  assert.ok(end > start, "Gemini copywriting fallback end must be discoverable");
  const fallbackSource = innermeFunctionSource.slice(start, end);
  const generationConfig = fallbackSource.match(/generationConfig:\s*\{([\s\S]*?)\}/);
  assert.ok(generationConfig, "Gemini fallback must have a generationConfig");
  assert.doesNotMatch(generationConfig[1], /\b(?:temperature|top_p|top_k)\s*:/i);
});
