import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20261016080000_innerme_trust_definer_search_path_hardening.sql", import.meta.url),
  "utf8",
);

test("only the four reviewed InnerMe trust/calibration functions are pinned to an empty search path", () => {
  const configuredFunctions = [
    ...migration.matchAll(
      /ALTER FUNCTION\s+([a-z_]+\.[a-z0-9_]+\([^;]*?\))\s+SET search_path\s*=\s*''/gi,
    ),
  ].map((match) => match[1].replace(/\s+/g, "").toLowerCase()).sort();

  assert.deepEqual(configuredFunctions, [
    "innerme_private.record_innerme_agent_trust_evidence(uuid,text,uuid,text,text,integer,text,jsonb)",
    "innerme_private.refresh_innerme_agent_trust_calibration()",
    "innerme_private.review_innerme_agent_trust_evidence(uuid,text)",
    "innerme_private.review_innerme_trust_calibration(uuid,text)",
  ]);
});

test("the migration verifies definer status, pinned settings, and existing execute posture", () => {
  assert.match(migration, /p\.prosecdef/);
  assert.match(migration, /p\.proconfig @> ARRAY\['search_path=""'\]/);
  assert.match(migration, /has_function_privilege\('anon', p\.oid, 'EXECUTE'\)/);
  assert.match(migration, /has_function_privilege\('authenticated', p\.oid, 'EXECUTE'\)/);
  assert.match(migration, /v_function_count <> 4 OR v_hardened_count <> 4 OR v_access_posture_count <> 4/);
  assert.match(migration, /RAISE EXCEPTION/);
});

test("the migration changes only configuration and does not alter trust evidence or calibration records", () => {
  assert.equal((migration.match(/\bALTER FUNCTION\b/gi) ?? []).length, 4);
  assert.doesNotMatch(
    migration,
    /^\s*(?:GRANT|REVOKE|DROP\s+FUNCTION|ALTER\s+TABLE|INSERT\s+INTO|UPDATE\s+public\.|CREATE\s+TRIGGER)\b/im,
  );
  assert.doesNotMatch(migration, /innerme_agent_trust_evidence\s+SET|innerme_trust_calibration_reviews\s+SET/);
});
