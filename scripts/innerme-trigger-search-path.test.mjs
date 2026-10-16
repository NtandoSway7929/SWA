import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20261016050000_innerme_trigger_search_path_hardening.sql", import.meta.url),
  "utf8",
);

test("the migration pins exactly the two reviewed InnerMe trigger functions to pg_catalog", () => {
  const configuredFunctions = [
    ...migration.matchAll(
      /ALTER FUNCTION\s+(public\.[a-z0-9_]+\(\))\s+SET search_path\s*=\s*pg_catalog/gi,
    ),
  ]
    .map((match) => match[1].toLowerCase())
    .sort();

  assert.deepEqual(configuredFunctions, [
    "public.refresh_innerme_embedding_text()",
    "public.set_innerme_updated_at()",
  ]);
});

test("the migration checks both settings and fails closed if either function is missing or misconfigured", () => {
  assert.match(migration, /p\.oid IN \([\s\S]*?'public\.set_innerme_updated_at\(\)'::regprocedure[\s\S]*?'public\.refresh_innerme_embedding_text\(\)'::regprocedure/);
  assert.match(migration, /p\.proconfig @> ARRAY\['search_path=pg_catalog'\]/);
  assert.match(migration, /v_function_count <> 2 OR v_hardened_count <> 2/);
  assert.match(migration, /RAISE EXCEPTION/);
});

test("the migration does not change grants, function bodies, tables, or trigger wiring", () => {
  assert.doesNotMatch(migration, /^\s*(?:GRANT|REVOKE|DROP\s+FUNCTION|CREATE\s+TRIGGER|ALTER\s+TABLE)\b/im);
  assert.equal((migration.match(/\bALTER FUNCTION\b/gi) ?? []).length, 2);
});
