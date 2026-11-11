#!/usr/bin/env bash
set -euo pipefail

: "${LOCAL_DB_URL:?LOCAL_DB_URL must point to the disposable local Supabase database}"
: "${YOCO_TEST_CASE_ID:?YOCO_TEST_CASE_ID must identify an open Yoco test reconciliation case}"
: "${YOCO_ADMIN_A_ID:?YOCO_ADMIN_A_ID must identify an active administrator}"
: "${YOCO_ADMIN_B_ID:?YOCO_ADMIN_B_ID must identify a second active administrator}"

if [[ "$YOCO_ADMIN_A_ID" == "$YOCO_ADMIN_B_ID" ]]; then
  echo "Two distinct administrator identities are required." >&2
  exit 2
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

expected_version="$(psql "$LOCAL_DB_URL" -X -A -t -v ON_ERROR_STOP=1 \
  -v case_id="$YOCO_TEST_CASE_ID" -c \
  "select updated_at from public.payment_reconciliation where id = :'case_id'::uuid and provider = 'yoco' and environment = 'test' and status = 'open'")"
if [[ -z "$expected_version" ]]; then
  echo "The supplied case must exist, be Yoco test-environment scoped, and be open." >&2
  exit 2
fi

run_decision() {
  local admin_id="$1"
  local reason="$2"
  local output="$3"
  psql "$LOCAL_DB_URL" -X -v ON_ERROR_STOP=1 \
    -v case_id="$YOCO_TEST_CASE_ID" \
    -v admin_id="$admin_id" \
    -v expected_version="$expected_version" \
    -v reason="$reason" >"$output" 2>&1 <<'SQL'
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.admin_set_payment_reconciliation_status_v2(
  :'case_id'::uuid,
  'investigating',
  :'reason',
  null,
  null,
  null,
  :'expected_version'::timestamptz
);
select pg_sleep(2);
commit;
SQL
}

run_decision "$YOCO_ADMIN_A_ID" "Stage 1.60 concurrent decision worker A" "$tmp_dir/worker-a" &
pid_a=$!
sleep 0.25
set +e
run_decision "$YOCO_ADMIN_B_ID" "Stage 1.60 concurrent decision worker B" "$tmp_dir/worker-b"
worker_b_exit=$?
set -e
wait "$pid_a"

if [[ "$worker_b_exit" -eq 0 ]]; then
  echo "FAIL: both administrators applied decisions from the same case version." >&2
  cat "$tmp_dir/worker-a" "$tmp_dir/worker-b" >&2
  exit 1
fi
if ! grep -q "40001" "$tmp_dir/worker-b"; then
  echo "FAIL: second administrator was rejected, but not with the expected stale-version SQLSTATE 40001." >&2
  cat "$tmp_dir/worker-a" "$tmp_dir/worker-b" >&2
  exit 1
fi

final_state="$(psql "$LOCAL_DB_URL" -X -A -t -v ON_ERROR_STOP=1 \
  -v case_id="$YOCO_TEST_CASE_ID" -c \
  "select status || '|' || count(*)::text from public.payment_reconciliation c join public.payment_reconciliation_actions a on a.reconciliation_id = c.id where c.id = :'case_id'::uuid group by c.status")"
if [[ "$final_state" != "investigating|1" ]]; then
  echo "FAIL: expected exactly one committed investigating action; got: $final_state" >&2
  exit 1
fi

echo "PASS: two distinct administrators raced the same case version; one decision committed and the stale decision was rejected with SQLSTATE 40001."
