#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:?PGHOST must point to the ephemeral PostgreSQL service}"
: "${PGUSER:?PGUSER must be set}"
: "${PGDATABASE:?PGDATABASE must be set}"

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

psql --no-psqlrc --set ON_ERROR_STOP=1 \
  --file supabase/tests/integration_quota_concurrency_setup.sql

users=(
  "00000000-0000-4000-8000-000000000101"
  "00000000-0000-4000-8000-000000000102"
  "00000000-0000-4000-8000-000000000103"
  "00000000-0000-4000-8000-000000000104"
  "00000000-0000-4000-8000-000000000105"
  "00000000-0000-4000-8000-000000000106"
)
pids=()

for user_id in "${users[@]}"; do
  output_file="$tmp_dir/$user_id.json"
  sql="
    BEGIN;
    SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claim.sub = '$user_id';
    SET LOCAL test.is_swayphics_admin = 'true';
    SELECT public.innerme_reserve_integration_quota(
      'za.municipal_money.income_expenditure.read'
    )::text;
    COMMIT;
  "
  psql --no-psqlrc --quiet --tuples-only --no-align \
    --set ON_ERROR_STOP=1 \
    --command "$sql" > "$output_file" &
  pids+=("$!")
done

for pid in "${pids[@]}"; do
  wait "$pid"
done

allowed=0
denied=0
for user_id in "${users[@]}"; do
  result_file="$tmp_dir/$user_id.json"
  jq -e 'type == "object" and has("allowed")' "$result_file" >/dev/null
  decision="$(jq -r '.allowed' "$result_file")"

  if [[ "$decision" == "true" ]]; then
    allowed=$((allowed + 1))
  elif [[ "$decision" == "false" ]]; then
    jq -e '.reason == "concurrent_limit" and (.retry_after_seconds | numbers > 0)' \
      "$result_file" >/dev/null
    denied=$((denied + 1))
  else
    echo "Unexpected reservation decision for $user_id" >&2
    cat "$result_file" >&2
    exit 1
  fi
done

test "$allowed" -eq 3
test "$denied" -eq 3

active_leases="$(psql --no-psqlrc --quiet --tuples-only --no-align \
  --set ON_ERROR_STOP=1 \
  --command "SELECT count(*) FROM innerme_private.innerme_integration_quota_leases
    WHERE capability = 'za.municipal_money.income_expenditure.read'
      AND released_at IS NULL
      AND lease_expires_at > clock_timestamp();")"
test "$active_leases" -eq 3

project_minute_reservations="$(psql --no-psqlrc --quiet --tuples-only --no-align \
  --set ON_ERROR_STOP=1 \
  --command "SELECT coalesce(sum(reserved_count), 0)
    FROM innerme_private.innerme_integration_quota_windows
    WHERE scope_type = 'project'
      AND scope_id = current_database()
      AND capability = 'za.municipal_money.income_expenditure.read'
      AND window_type = 'minute';")"
test "$project_minute_reservations" -eq 3

# Verify minute/day window starts are UTC-aligned even when the caller's
# PostgreSQL session timezone is not UTC.
utc_misaligned_windows="$(psql --no-psqlrc --quiet --tuples-only --no-align \
  --set ON_ERROR_STOP=1 \
  --command "SET TIME ZONE 'Pacific/Auckland';
    SELECT count(*)
    FROM innerme_private.innerme_integration_quota_leases l
    WHERE l.capability = 'za.municipal_money.income_expenditure.read'
      AND l.released_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM innerme_private.innerme_integration_quota_windows q
        WHERE q.scope_type = 'admin'
          AND q.scope_id = l.admin_user_id::text
          AND q.capability = l.capability
          AND q.window_type = 'minute'
          AND q.window_start = date_trunc('minute', l.reserved_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      )
      OR NOT EXISTS (
        SELECT 1 FROM innerme_private.innerme_integration_quota_windows q
        WHERE q.scope_type = 'project'
          AND q.scope_id = current_database()
          AND q.capability = l.capability
          AND q.window_type = 'utc_day'
          AND q.window_start = date_trunc('day', l.reserved_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      );")"
test "$utc_misaligned_windows" -eq 0

# Expire the three outstanding leases. A subsequent reservation must reclaim
# the abandoned concurrency slots, while request counters remain consumed.
psql --no-psqlrc --quiet --set ON_ERROR_STOP=1 \
  --command "UPDATE innerme_private.innerme_integration_quota_leases
    SET lease_expires_at = clock_timestamp() - interval '1 second'
    WHERE capability = 'za.municipal_money.income_expenditure.read'
      AND released_at IS NULL;"

recovery_sql="
  BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000106';
  SET LOCAL test.is_swayphics_admin = 'true';
  SELECT public.innerme_reserve_integration_quota(
    'za.municipal_money.income_expenditure.read'
  )::text;
  COMMIT;
"
recovery_file="$tmp_dir/recovery.json"
psql --no-psqlrc --quiet --tuples-only --no-align \
  --set ON_ERROR_STOP=1 --command "$recovery_sql" > "$recovery_file"
jq -e '.allowed == true and (.reservation_id | type == "string")' "$recovery_file" >/dev/null
recovery_id="$(jq -r '.reservation_id' "$recovery_file")"

active_after_recovery="$(psql --no-psqlrc --quiet --tuples-only --no-align \
  --set ON_ERROR_STOP=1 \
  --command "SELECT count(*) FROM innerme_private.innerme_integration_quota_leases
    WHERE capability = 'za.municipal_money.income_expenditure.read'
      AND released_at IS NULL
      AND lease_expires_at > clock_timestamp();")"
test "$active_after_recovery" -eq 1

release_sql="
  BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000106';
  SET LOCAL test.is_swayphics_admin = 'true';
  SELECT public.innerme_release_integration_quota(
    '$recovery_id'::uuid,
    'za.municipal_money.income_expenditure.read'
  )::text;
  COMMIT;
"
release_file="$tmp_dir/release.json"
psql --no-psqlrc --quiet --tuples-only --no-align \
  --set ON_ERROR_STOP=1 --command "$release_sql" > "$release_file"
jq -e '.released == true and .idempotent == false' "$release_file" >/dev/null

active_after_release="$(psql --no-psqlrc --quiet --tuples-only --no-align \
  --set ON_ERROR_STOP=1 \
  --command "SELECT count(*) FROM innerme_private.innerme_integration_quota_leases
    WHERE capability = 'za.municipal_money.income_expenditure.read'
      AND released_at IS NULL
      AND lease_expires_at > clock_timestamp();")"
test "$active_after_release" -eq 0

project_minute_after_recovery="$(psql --no-psqlrc --quiet --tuples-only --no-align \
  --set ON_ERROR_STOP=1 \
  --command "SELECT coalesce(sum(reserved_count), 0)
    FROM innerme_private.innerme_integration_quota_windows
    WHERE scope_type = 'project'
      AND scope_id = current_database()
      AND capability = 'za.municipal_money.income_expenditure.read'
      AND window_type = 'minute';")"
test "$project_minute_after_recovery" -eq 4

printf 'Quota concurrency/recovery test passed: %s allowed, %s denied; UTC-aligned windows; expired leases reclaimed; %s request reservations retained after lease release.\n' \
  "$allowed" "$denied" "$project_minute_after_recovery"
