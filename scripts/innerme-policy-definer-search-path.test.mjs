import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20261016070000_innerme_policy_definer_search_path_hardening.sql", import.meta.url),
  "utf8",
);

test("only the two reviewed Phase 30 private policy functions are pinned to an empty search path", () => {
  const configuredFunctions = [
    ...migration.matchAll(
      /ALTER FUNCTION\s+([a-z_]+\.[a-z0-9_]+\([^)]*\))\s+SET search_path\s*=\s*''/gi,
    ),
  ].map((match) => match[1].replace(/\s+/g, "").toLowerCase()).sort();

  assert.deepEqual(configuredFunctions, [
    "innerme_private.evaluate_innerme_action_policy(uuid,text)",
    "innerme_private.innerme_action_policy_fingerprint(uuid)",
  ]);
});

test("the migration verifies definer status and keeps anon execution revoked while authenticated execution remains", () => {
  assert.match(migration, /p\.prosecdef/);
  assert.match(migration, /has_function_privilege\('anon', p\.oid, 'EXECUTE'\)/);
  assert.match(migration, /has_function_privilege\('authenticated', p\.oid, 'EXECUTE'\)/);
  assert.match(migration, /RAISE EXCEPTION/);
  assert.match(migration, /p\.proconfig @> ARRAY\['search_path=""'\]/);
});

test("the migration alters only function configuration, never action rows or approvals", () => {
  assert.equal((migration.match(/\bALTER FUNCTION\b/gi) ?? []).length, 2);
  assert.doesNotMatch(migration, /^\s*(?:GRANT|REVOKE|DROP\s+FUNCTION|ALTER\s+TABLE|INSERT\s+INTO|UPDATE\s+public\.innerme_|CREATE\s+TRIGGER)\b/im);
  assert.doesNotMatch(migration, /innerme_action_proposals\s+SET|innerme_action_policy_reviews\s+SET/);
});
