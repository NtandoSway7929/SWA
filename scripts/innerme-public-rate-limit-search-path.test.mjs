import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20261016060000_innerme_public_rate_limit_search_path_hardening.sql", import.meta.url),
  "utf8",
);

test("the public rate-limit RPC uses an empty search path", () => {
  assert.match(
    migration,
    /ALTER FUNCTION\s+public\.consume_public_innerme_rate_limit\(text,\s*text\)\s+SET search_path\s*=\s*''/i,
  );
  assert.match(migration, /p\.proconfig @> ARRAY\['search_path=""'\]/);
});

test("the migration preserves invoker security and service-role-only execution", () => {
  assert.match(migration, /NOT p\.prosecdef/);
  assert.match(migration, /has_function_privilege\('anon', p\.oid, 'EXECUTE'\)/);
  assert.match(migration, /has_function_privilege\('authenticated', p\.oid, 'EXECUTE'\)/);
  assert.match(migration, /has_function_privilege\('service_role', p\.oid, 'EXECUTE'\)/);
  assert.match(migration, /RAISE EXCEPTION/);
});

test("the migration changes only function configuration and does not modify rate limits or grants", () => {
  assert.equal((migration.match(/\bALTER FUNCTION\b/gi) ?? []).length, 1);
  assert.doesNotMatch(migration, /^\s*(?:GRANT|REVOKE|DROP\s+FUNCTION|ALTER\s+TABLE|CREATE\s+TRIGGER)\b/im);
  assert.doesNotMatch(migration, /request_count\s*=|blocked_10m|blocked_24h/);
});
