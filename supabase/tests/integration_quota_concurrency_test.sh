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
  --command "SELECT reserved_count
    FROM innerme_private.innerme_integration_quota_windows
    WHERE scope_type = 'project'
      AND scope_id = current_database()
      AND capability = 'za.municipal_money.income_expenditure.read'
      AND window_type = 'minute'
      AND window_start = date_trunc('minute', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';")"
test "$project_minute_reservations" -eq 3

printf 'Concurrent quota test passed: %s allowed, %s denied, %s active leases, %s project-minute reservations.\n' \
  "$allowed" "$denied" "$active_leases" "$project_minute_reservations"
