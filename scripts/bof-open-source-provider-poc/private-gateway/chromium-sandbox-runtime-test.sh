#!/usr/bin/env bash
set -Eeuo pipefail

# Ephemeral CI-only diagnostic. It deliberately relaxes seccomp and AppArmor
# only to isolate host user-namespace support; this is NOT a deployable profile.
# It does not alter host sysctls, AppArmor policy, Docker daemon config or production.
image="unclecode/crawl4ai:0.9.6@sha256:4603d7c4d69769673dfa1214fa9abbcac2a874d4d9af07d784782af528b65c68"
name="bof-chromium-sandbox-ci"
port="${BOF_CHROMIUM_SANDBOX_TEST_PORT:-11236}"
token="$(openssl rand -hex 32)"
response_file="$(mktemp)"
log_file="$(mktemp)"
cleanup() {
  docker rm --force "$name" >/dev/null 2>&1 || true
  rm -f "$response_file" "$log_file"
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "FAIL: Docker CLI is unavailable" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "FAIL: Docker daemon is unavailable" >&2
  exit 1
fi

echo "Host user-namespace settings:"
for setting in kernel.unprivileged_userns_clone kernel.apparmor_restrict_unprivileged_userns; do
  file="/proc/sys/${setting//./\/}"
  if [ -r "$file" ]; then
    printf '  %s=%s\n' "$setting" "$(cat "$file")"
  else
    printf '  %s=not-exposed\n' "$setting"
  fi
done

echo "Starting pinned Crawl4AI with sandbox=true, non-root appuser, no capabilities and no-new-privileges; seccomp/AppArmor are unconfined for this disposable diagnostic only."
docker run --detach --name "$name" \
  --publish "127.0.0.1:${port}:11235" \
  --env "CRAWL4AI_API_TOKEN=$token" \
  --env CRAWL4AI_CHROMIUM_SANDBOX=true \
  --user appuser \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --security-opt seccomp=unconfined \
  --security-opt apparmor=unconfined \
  --read-only \
  --tmpfs /tmp \
  --tmpfs /var/lib/redis:uid=999,gid=999,mode=0700 \
  --tmpfs /var/lib/crawl4ai/outputs:uid=999,gid=999,mode=0700 \
  --tmpfs /home/appuser/.crawl4ai:uid=999,gid=999,mode=0700 \
  --tmpfs /home/appuser/.cache/url_seeder:uid=999,gid=999,mode=0700 \
  --tmpfs /home/appuser/.gunicorn:uid=999,gid=999,mode=0700 \
  --shm-size 1g \
  "$image" >/dev/null

ready=false
for attempt in $(seq 1 40); do
  if curl --connect-timeout 2 --max-time 4 --fail --silent \
      "http://127.0.0.1:${port}/health" >/dev/null; then
    ready=true
    break
  fi
  state="$(docker inspect --format '{{.State.Status}}' "$name" 2>/dev/null || true)"
  if [ "$state" = "exited" ] || [ "$state" = "dead" ]; then
    docker logs "$name" >&2 || true
    echo "FAIL: Crawl4AI exited before becoming healthy" >&2
    exit 1
  fi
  sleep 2
done
if [ "$ready" != true ]; then
  docker logs "$name" >&2 || true
  echo "FAIL: Crawl4AI did not become healthy with Chromium sandbox enabled" >&2
  exit 1
fi

echo "Submitting a real public-page crawl while observing Chromium process arguments."
curl --connect-timeout 3 --max-time 90 --fail --silent --show-error \
  -X POST "http://127.0.0.1:${port}/crawl" \
  -H "Authorization: Bearer $token" \
  -H "Content-Type: application/json" \
  --data '{"urls":["https://example.com"],"browser_config":{},"crawler_config":{}}' \
  >"$response_file" &
request_pid=$!
chromium_seen=false
sandbox_flag_clear=false
while :; do
  request_state="$(ps -o stat= -p "$request_pid" 2>/dev/null || true)"
  if [ -z "$request_state" ] || [[ "$request_state" == Z* ]]; then
    break
  fi
  observation="$(docker exec "$name" python -c '
import glob, os
for path in glob.glob("/proc/[0-9]*/cmdline"):
    try:
        raw = open(path, "rb").read().replace(b"\\x00", b" ").decode("utf-8", "replace")
    except (OSError, PermissionError):
        continue
    low = raw.lower()
    if "chrom" in low and ("--type=renderer" in low or "--type=gpu-process" in low or "--no-sandbox" in low):
        print(raw)
        break
' 2>/dev/null || true)"
  if [ -n "$observation" ]; then
    chromium_seen=true
    printf '%s\n' "$observation" >>"$log_file"
    if ! grep -q -- '--no-sandbox' <<<"$observation"; then
      sandbox_flag_clear=true
    fi
  fi
  sleep 0.1
done
wait "$request_pid" || {
  docker logs "$name" >&2 || true
  cat "$response_file" >&2 || true
  echo "FAIL: Crawl4AI request failed with CRAWL4AI_CHROMIUM_SANDBOX=true" >&2
  exit 1
}

python - "$response_file" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)
results = payload.get("results")
if not isinstance(results, list) or not results:
    raise SystemExit("FAIL: Crawl4AI returned no result records")
result = results[0]
if result.get("success") is not True:
    raise SystemExit("FAIL: public example.com crawl was not successful: " + repr(result.get("error_message") or result.get("status")))
if not (result.get("markdown") or result.get("extracted_content")):
    raise SystemExit("FAIL: successful crawl contained no readable content")
print("PASS: sandbox-enabled crawl returned readable content from https://example.com")
PY

if [ "$chromium_seen" != true ]; then
  echo "FAIL: no Chromium renderer/GPU process arguments were observed during the crawl" >&2
  exit 1
fi
if [ "$sandbox_flag_clear" != true ]; then
  echo "FAIL: Chromium process was observed with --no-sandbox or no sandbox-free process could be confirmed" >&2
  cat "$log_file" >&2
  exit 1
fi

echo "PASS: Chromium renderer process was observed without --no-sandbox."
echo "PASS: Chromium sandbox itself launched with user namespaces when outer container seccomp/AppArmor restrictions were relaxed."
echo "LIMIT: this is only a diagnostic. It does not validate a safe container seccomp/AppArmor profile and is not deployable configuration."
