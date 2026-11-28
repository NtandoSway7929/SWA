#!/usr/bin/env bash
set -Eeuo pipefail

# Ephemeral CI-only runtime test. It uses the candidate constrained Chromium seccomp
# profile and Docker's default AppArmor profile; host userns restriction is adjusted by CI.
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

profile_path="$(cd "$(dirname "$0")" && pwd)/chromium-seccomp.json"
test -r "$profile_path"
echo "Starting pinned Crawl4AI with sandbox=true, non-root appuser, no capabilities, no-new-privileges, candidate constrained seccomp profile and Docker's default AppArmor profile."
docker run --detach --name "$name" \
  --publish "127.0.0.1:${port}:11235" \
  --env "CRAWL4AI_API_TOKEN=$token" \
  --env CRAWL4AI_CHROMIUM_SANDBOX=true \
  --user appuser \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --security-opt "seccomp=$profile_path" \
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

echo "Starting an in-container /proc observer before submitting the reserved-domain crawl."
docker exec --user 0 "$name" python -c '
import glob, os, time
deadline = time.monotonic() + 45
seen = set()
with open("/tmp/chromium-sandbox-observer.log", "w", encoding="utf-8") as out:
    while time.monotonic() < deadline:
        for path in glob.glob("/proc/[0-9]*/cmdline"):
            pid = path.split("/")[2]
            try:
                raw = open(path, "rb").read().replace(bytes([0]), b" ").decode("utf-8", "replace")
                low = raw.lower()
                if "chrom" not in low or not any(tag in low for tag in ("--type=renderer", "--type=zygote")):
                    continue
                status = {}
                for line in open(f"/proc/{pid}/status", encoding="utf-8"):
                    if ":" in line:
                        key, value = line.split(":", 1)
                        status[key] = value.strip()
                user_ns = os.stat(f"/proc/{pid}/ns/user").st_ino
                init_ns = os.stat("/proc/1/ns/user").st_ino
                record = (pid, raw, status.get("Seccomp", "?"), status.get("NoNewPrivs", "?"), user_ns != init_ns)
                if record not in seen:
                    seen.add(record)
                    out.write(f"PID={pid} {raw} SECCOMP={record[2]} NNP={record[3]} USERNS_DIFF={record[4]}\\n")
                    out.flush()
            except (OSError, PermissionError, ProcessLookupError):
                pass
        time.sleep(0.05)
' &
observer_pid=$!
curl --connect-timeout 3 --max-time 90 --fail --silent --show-error \
  -X POST "http://127.0.0.1:${port}/crawl" \
  -H "Authorization: Bearer $token" \
  -H "Content-Type: application/json" \
  --data '{"urls":["https://example.com"],"browser_config":{},"crawler_config":{"delay_before_return_html":10}}' \
  >"$response_file" &
request_pid=$!
wait "$request_pid" || {
  docker logs "$name" >&2 || true
  cat "$response_file" >&2 || true
  echo "FAIL: Crawl4AI request failed with CRAWL4AI_CHROMIUM_SANDBOX=true" >&2
  exit 1
}
wait "$observer_pid" || true
observation="$(docker exec --user 0 "$name" cat /tmp/chromium-sandbox-observer.log 2>/dev/null || true)"
printf '%s\n' "$observation" >"$log_file"
chromium_seen=false
sandbox_flag_clear=false
kernel_sandbox_verified=false
if [ -n "$observation" ]; then
  chromium_seen=true
  if ! grep -q -- '--no-sandbox' "$log_file"; then
    sandbox_flag_clear=true
  fi
  if grep -q 'SECCOMP=2' "$log_file" &&
     grep -q 'NNP=1' "$log_file" &&
     grep -q 'USERNS_DIFF=True' "$log_file"; then
    kernel_sandbox_verified=true
  fi
fi

python - "$response_file" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)
results = payload.get("results")
if not isinstance(results, list) or len(results) != 1:
    raise SystemExit("FAIL: expected one reserved-domain crawl result record")
result = results[0]
if result.get("success") is not True:
    raise SystemExit("FAIL: reserved-domain crawl was not successful: " + repr(result.get("url")) + " " + repr(result.get("error_message") or result.get("status")))
if not (result.get("markdown") or result.get("extracted_content")):
    raise SystemExit("FAIL: successful crawl contained no readable content")
print("PASS: sandbox-enabled crawl returned readable content from https://example.com")
PY

if [ "$chromium_seen" != true ]; then
  echo "FAIL: no Chromium renderer/GPU process arguments were observed during the crawl" >&2
  exit 1
fi
if [ "$sandbox_flag_clear" != true ]; then
  echo "FAIL: Chromium renderer process was observed with --no-sandbox or no sandbox-free renderer could be confirmed" >&2
  cat "$log_file" >&2
  exit 1
fi
if [ "$kernel_sandbox_verified" != true ]; then
  echo "FAIL: renderer kernel state did not show Seccomp=2, NoNewPrivs=1 and a distinct user namespace" >&2
  cat "$log_file" >&2
  exit 1
fi

echo "PASS: Chromium renderer process was observed without --no-sandbox."
echo "PASS: renderer kernel state confirms seccomp filter mode, no_new_privs and a distinct user namespace."
echo "PASS: Docker's default AppArmor profile and the candidate filtered seccomp profile allowed Chromium's sandbox with the host userns restriction disabled."
echo "LIMIT: the host sysctl was changed only on the disposable runner; production host configuration and operational impact still require review."
