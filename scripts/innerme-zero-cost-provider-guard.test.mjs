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
