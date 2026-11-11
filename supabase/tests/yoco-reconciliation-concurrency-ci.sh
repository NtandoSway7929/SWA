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
initial_action_count="$(psql "$LOCAL_DB_URL" -X -A -t -v ON_ERROR_STOP=1 -v case_id="$YOCO_TEST_CASE_ID" -c "select count(*) from public.payment_reconciliation_actions where reconciliation_id = :'case_id'::uuid")"
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
\set VERBOSITY verbose
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
expected_action_count=$((initial_action_count + 1))
if [[ "$final_state" != "investigating|$expected_action_count" ]]; then
  echo "FAIL: expected exactly one new committed investigating action (total $expected_action_count); got: $final_state" >&2
  exit 1
fi

echo "PASS: two distinct administrators raced the same case version; one decision committed and the stale decision was rejected with SQLSTATE 40001."

# Race an evidence append against a closure decision using the same case version.
expected_version="$(psql "$LOCAL_DB_URL" -X -A -t -v ON_ERROR_STOP=1 \
  -v case_id="$YOCO_TEST_CASE_ID" -c \
  "select updated_at from public.payment_reconciliation where id = :'case_id'::uuid and status = 'investigating'")"
initial_evidence_count="$(psql "$LOCAL_DB_URL" -X -A -t -v ON_ERROR_STOP=1 -v case_id="$YOCO_TEST_CASE_ID" -c "select count(*) from public.payment_reconciliation_evidence where reconciliation_id = :'case_id'::uuid")"
initial_action_count="$(psql "$LOCAL_DB_URL" -X -A -t -v ON_ERROR_STOP=1 -v case_id="$YOCO_TEST_CASE_ID" -c "select count(*) from public.payment_reconciliation_actions where reconciliation_id = :'case_id'::uuid")"

run_evidence() {
  psql "$LOCAL_DB_URL" -X -v ON_ERROR_STOP=1 \
    -v case_id="$YOCO_TEST_CASE_ID" -v admin_id="$YOCO_ADMIN_A_ID" \
    >"$tmp_dir/evidence-worker" 2>&1 <<'SQL'
\set VERBOSITY verbose
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.admin_add_payment_reconciliation_evidence(
  :'case_id'::uuid,
  'internal_review',
  'Stage 1.60 concurrent evidence worker',
  'stage-1.60-race'
);
select pg_sleep(2);
commit;
SQL
}

run_close() {
  psql "$LOCAL_DB_URL" -X -v ON_ERROR_STOP=1 \
    -v case_id="$YOCO_TEST_CASE_ID" -v admin_id="$YOCO_ADMIN_B_ID" \
    -v expected_version="$expected_version" \
    >"$tmp_dir/close-worker" 2>&1 <<'SQL'
\set VERBOSITY verbose
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.admin_set_payment_reconciliation_status_v2(
  :'case_id'::uuid,
  'resolved',
  'Stage 1.60 competing closure decision',
  'no_financial_effect',
  null,
  null,
  :'expected_version'::timestamptz
);
commit;
SQL
}

run_evidence &
pid_evidence=$!
sleep 0.25
set +e
run_close
close_exit=$?
set -e
wait "$pid_evidence"

if [[ "$close_exit" -eq 0 ]] || ! grep -q "40001" "$tmp_dir/close-worker"; then
  echo "FAIL: closure based on the pre-evidence case version was not rejected with SQLSTATE 40001." >&2
  cat "$tmp_dir/evidence-worker" "$tmp_dir/close-worker" >&2
  exit 1
fi

evidence_state="$(psql "$LOCAL_DB_URL" -X -A -t -v ON_ERROR_STOP=1 \
  -v case_id="$YOCO_TEST_CASE_ID" -c \
  "select c.status || '|' || (select count(*) from public.payment_reconciliation_evidence e where e.reconciliation_id = c.id)::text || '|' || (select count(*) from public.payment_reconciliation_actions a where a.reconciliation_id = c.id)::text from public.payment_reconciliation c where c.id = :'case_id'::uuid")"
expected_evidence_count=$((initial_evidence_count + 1))
expected_action_count=$((initial_action_count + 1))
if [[ "$evidence_state" != "investigating|$expected_evidence_count|$expected_action_count" ]]; then
  echo "FAIL: expected the evidence append to commit while the stale closure made no change; got: $evidence_state" >&2
  exit 1
fi

echo "PASS: evidence append won the row lock; stale closure was rejected and the case remained investigating."
