import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const migration = await readFile(
  new URL("../../migrations/20261104110000_innerme_integration_quota.sql", import.meta.url),
  "utf8",
);

test("quota storage is private, RLS-enabled, and not directly granted to API roles", () => {
  assert.match(migration, /create schema if not exists innerme_private/i);
  assert.match(migration, /alter table innerme_private\.innerme_integration_quota_windows enable row level security/i);
  assert.match(migration, /alter table innerme_private\.innerme_integration_quota_leases enable row level security/i);
  assert.match(
    migration,
    /revoke all on table innerme_private\.innerme_integration_quota_windows\s+from public, anon, authenticated, service_role/i,
  );
  assert.match(
    migration,
    /revoke all on table innerme_private\.innerme_integration_quota_leases\s+from public, anon, authenticated, service_role/i,
  );
});

test("only the fixed Municipal Money capability can reserve quota", () => {
  assert.match(
    migration,
    /p_capability is distinct from 'za\.municipal_money\.income_expenditure\.read'/i,
  );
  assert.match(
    migration,
    /capability = 'za\.municipal_money\.income_expenditure\.read'/i,
  );
  assert.match(migration, /public\.is_swayphics_admin\(\)/i);
  assert.match(migration, /auth\.uid\(\) is null/i);
});

test("reservation serialization prevents concurrent last-slot overspend", () => {
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /on conflict \(scope_type, scope_id, capability, window_type, window_start\)/i);
  assert.match(migration, /reserved_count = q\.reserved_count \+ 1/i);
});

test("pilot ceilings and UTC window boundaries are explicit", () => {
  for (const expected of [
    "admin_per_minute', 3",
    "project_per_minute', 15",
    "admin_per_utc_day', 30",
    "project_per_utc_day', 100",
    "project_concurrent', 3",
  ]) {
    assert.ok(migration.includes(expected), `Missing quota ceiling: ${expected}`);
  }
  assert.match(migration, /date_trunc\('minute', v_now at time zone 'UTC'\)/i);
  assert.match(migration, /date_trunc\('day', v_now at time zone 'UTC'\)/i);
});

test("public RPCs are invoker functions granted only to authenticated", () => {
  assert.match(
    migration,
    /create or replace function public\.innerme_reserve_integration_quota[\s\S]*?security invoker/i,
  );
  assert.match(
    migration,
    /create or replace function public\.innerme_release_integration_quota[\s\S]*?security invoker/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.innerme_reserve_integration_quota\(text\) to authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.innerme_release_integration_quota\(uuid, text\) to authenticated/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.innerme_reserve_integration_quota\(text\)\s+from public, anon, authenticated, service_role/i,
  );
});

test("private helpers are privileged only behind explicit admin checks", () => {
  assert.match(
    migration,
    /create or replace function innerme_private\.reserve_integration_quota[\s\S]*?security definer[\s\S]*?public\.is_swayphics_admin\(\)/i,
  );
  assert.match(
    migration,
    /create or replace function innerme_private\.release_integration_quota[\s\S]*?security definer[\s\S]*?public\.is_swayphics_admin\(\)/i,
  );
  assert.match(migration, /set search_path = ''/i);
});

test("release is idempotent and never decrements consumed request counters", () => {
  assert.match(migration, /set released_at = pg_catalog\.clock_timestamp\(\)/i);
  assert.match(migration, /'idempotent', not v_released/i);
  assert.doesNotMatch(migration, /reserved_count\s*=\s*[^,;]*-\s*1/i);
  assert.match(migration, /lease_expires_at <= v_now/i);
});

test("quota SQL is free of accidentally schema-qualified special COALESCE syntax", () => {
  assert.doesNotMatch(migration, /pg_catalog\.coalesce\s*\(/i);
  assert.doesNotMatch(migration, /get diagnostics v_released = row_count/i);
});
