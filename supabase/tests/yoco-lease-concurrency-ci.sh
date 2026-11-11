#!/usr/bin/env bash
set -euo pipefail

: "${LOCAL_DB_URL:?LOCAL_DB_URL must point to the disposable local Supabase database}"

REPETITIONS="${YOCO_CONCURRENCY_REPETITIONS:-20}"
if ! [[ "$REPETITIONS" =~ ^[0-9]+$ ]] || (( REPETITIONS < 1 || REPETITIONS > 100 )); then
  echo "YOCO_CONCURRENCY_REPETITIONS must be between 1 and 100." >&2
  exit 2
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

for iteration in $(seq 1 "$REPETITIONS"); do
  provider_event_id="ci_yoco_lease_$(cat /proc/sys/kernel/random/uuid | tr -d '-')"
  event_id="$(psql "$LOCAL_DB_URL" -X -A -t -v ON_ERROR_STOP=1 -c \
    "select (innerme_private.record_verified_yoco_webhook('$provider_event_id', 'payment.succeeded', repeat('a', 64))->>'event_id')")"
  test -n "$event_id"

  psql "$LOCAL_DB_URL" -X -A -t -v ON_ERROR_STOP=1 -c \
    "select coalesce(public.yoco_claim_webhook_event('$event_id'::uuid, 120)->>'claimed', 'false')" \
    >"$tmp_dir/worker-a" &
  pid_a=$!

  psql "$LOCAL_DB_URL" -X -A -t -v ON_ERROR_STOP=1 -c \
    "select coalesce(public.yoco_claim_webhook_event('$event_id'::uuid, 120)->>'claimed', 'false')" \
    >"$tmp_dir/worker-b" &
  pid_b=$!

  wait "$pid_a"
  wait "$pid_b"

  claimed="$(cat "$tmp_dir/worker-a" "$tmp_dir/worker-b" | grep -cx 'true' || true)"
  denied="$(cat "$tmp_dir/worker-a" "$tmp_dir/worker-b" | grep -cx 'false' || true)"
  if [[ "$claimed" != "1" || "$denied" != "1" ]]; then
    echo "FAIL iteration $iteration: expected one lease claim and one denial; got claimed=$claimed denied=$denied" >&2
    cat "$tmp_dir/worker-a" "$tmp_dir/worker-b" >&2
    exit 1
  fi
  printf 'PASS lease claim race %s/%s\n' "$iteration" "$REPETITIONS"
done

echo "PASS: $REPETITIONS concurrent webhook lease-claim races; exactly one worker won each race."
