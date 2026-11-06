import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261106170000_admin_push_preferences_service_role_select.sql",
    import.meta.url,
  ),
  "utf8",
);

test("grants the push dispatcher service_role read access to notification preferences", () => {
  assert.match(
    migration,
    /grant\s+select\s+on\s+table\s+public\.admin_notification_preferences\s+to\s+service_role\s*;/i,
  );
});

test("does not grant preference-table access to public browser roles", () => {
  assert.doesNotMatch(
    migration,
    /grant\s+[^;]*\s+on\s+table\s+public\.admin_notification_preferences\s+to\s+(?:anon|authenticated|public)\b/i,
  );
});

test("does not disable row-level security or change existing policies", () => {
  assert.doesNotMatch(
    migration,
    /disable\s+row\s+level\s+security|drop\s+policy|create\s+policy/i,
  );
});
