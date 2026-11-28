#!/usr/bin/env bash
# Isolated IPv4/IPv6 forwarding and SSRF lab for a disposable Linux Docker host.
# Creates temporary network namespaces and veth pairs only. No host firewall
# tables, routes, sysctls, Docker networks, or production services are changed.
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "ERROR: run as root (for example: sudo $0)" >&2
  exit 2
fi
for bin in ip nft python3; do
  command -v "$bin" >/dev/null 2>&1 || { echo "ERROR: missing required command: $bin" >&2; exit 2; }
done

suffix="bof$$"
ns_client="${suffix}c"
ns_router="${suffix}r"
ns_target="${suffix}t"
server_pid=""
cleanup() {
  set +e
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null
    wait "$server_pid" 2>/dev/null
  fi
  ip netns del "$ns_client" 2>/dev/null
  ip netns del "$ns_router" 2>/dev/null
  ip netns del "$ns_target" 2>/dev/null
}
trap cleanup EXIT INT TERM

for ns in "$ns_client" "$ns_router" "$ns_target"; do
  if ip netns list | awk '{print $1}' | grep -Fxq "$ns"; then
    echo "ERROR: namespace collision: $ns" >&2
    exit 2
  fi
done

ip netns add "$ns_client"
ip netns add "$ns_router"
ip netns add "$ns_target"

ip link add c-r type veth peer name r-c
ip link set c-r netns "$ns_client"
ip link set r-c netns "$ns_router"
ip link add r-t type veth peer name t-r
ip link set r-t netns "$ns_router"
ip link set t-r netns "$ns_target"

ip -n "$ns_client" link set lo up
ip -n "$ns_router" link set lo up
ip -n "$ns_target" link set lo up
ip -n "$ns_client" addr add 10.200.1.2/24 dev c-r
ip -n "$ns_router" addr add 10.200.1.1/24 dev r-c
ip -n "$ns_router" addr add 10.200.2.1/24 dev r-t
ip -n "$ns_target" addr add 10.200.2.2/24 dev t-r
ip -n "$ns_target" addr add 1.1.1.1/32 dev lo
ip -n "$ns_client" -6 addr add fd00:200:1::2/64 dev c-r
ip -n "$ns_router" -6 addr add fd00:200:1::1/64 dev r-c
ip -n "$ns_router" -6 addr add fd00:200:2::1/64 dev r-t
ip -n "$ns_target" -6 addr add fd00:200:2::2/64 dev t-r
ip -n "$ns_target" -6 addr add 2001:4860:4860::8888/128 dev lo
ip -n "$ns_target" -6 addr add fd00:ec2::254/128 dev lo
ip -n "$ns_client" link set c-r up
ip -n "$ns_router" link set r-c up
ip -n "$ns_router" link set r-t up
ip -n "$ns_target" link set t-r up
ip -n "$ns_client" route add default via 10.200.1.1
ip -n "$ns_router" route add 1.1.1.1/32 via 10.200.2.2
ip -n "$ns_target" route add 10.200.1.0/24 via 10.200.2.1
ip -n "$ns_client" -6 route add default via fd00:200:1::1
ip -n "$ns_router" -6 route add 2001:4860:4860::8888/128 via fd00:200:2::2
ip -n "$ns_router" -6 route add fd00:ec2::254/128 via fd00:200:2::2
ip -n "$ns_target" -6 route add fd00:200:1::/64 via fd00:200:2::1
ip netns exec "$ns_router" sysctl -q -w net.ipv4.ip_forward=1
ip netns exec "$ns_router" sysctl -q -w net.ipv6.conf.all.forwarding=1

# Simulated "public" destination is a documentation-only test address assigned
# inside the target namespace. It is not contacted over the public internet.
ip netns exec "$ns_router" nft -f - <<'NFT'
table inet bof_ssrf_lab {
  chain forward {
    type filter hook forward priority filter; policy drop;
    ct state established,related accept
    iifname "r-c" oifname "r-t" ip daddr 1.1.1.1 tcp dport 8080 accept
    iifname "r-c" oifname "r-t" ip6 daddr 2001:4860:4860::8888 tcp dport 8081 accept
  }
}
NFT

ip netns exec "$ns_target" python3 - <<'PY' &
from http.server import BaseHTTPRequestHandler, HTTPServer
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "http://10.200.2.2:8080/private")
            self.end_headers()
            return
        body = (b"public-test-target" if self.path == "/" else b"private-target")
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *_):
        pass
HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
class IPv6HTTPServer(HTTPServer):
    address_family = 10  # socket.AF_INET6
class IPv6Handler(Handler):
    def do_GET(self):
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "http://[fd00:200:2::2]:8081/private")
            self.end_headers()
            return
        body = b"public-test-target-v6" if self.path == "/" else b"private-target-v6"
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
IPv6HTTPServer(("::", 8081), IPv6Handler).serve_forever()
PY
server_pid=$!

sleep 0.3

echo "1/3: permitted simulated public destination"
ip netns exec "$ns_client" python3 - <<'PY'
from urllib.request import urlopen
with urlopen("http://1.1.1.1:8080/", timeout=2) as response:
    body = response.read()
assert body == b"public-test-target", body
print("PASS: permitted destination reachable")
PY

echo "2/3: direct private destination must be blocked"
if ip netns exec "$ns_client" python3 - <<'PY'
from urllib.request import urlopen
try:
    urlopen("http://10.200.2.2:8080/private", timeout=2)
except Exception:
    raise SystemExit(0)
raise SystemExit(1)
PY
then
  echo "PASS: direct private destination blocked"
else
  echo "FAIL: direct private destination was reachable" >&2
  exit 1
fi

echo "3/3: HTTP redirect to private destination must be blocked"
if ip netns exec "$ns_client" python3 - <<'PY'
from urllib.request import urlopen
try:
    urlopen("http://1.1.1.1:8080/redirect", timeout=2)
except Exception:
    raise SystemExit(0)
raise SystemExit(1)
PY
then
  echo "PASS: redirect follow-up to private destination blocked"
else
  echo "FAIL: redirect reached private destination" >&2
  exit 1
fi

echo "4/6: permitted simulated public IPv6 destination"
ip netns exec "$ns_client" python3 - <<'PY'
from urllib.request import urlopen
with urlopen("http://[2001:4860:4860::8888]:8081/", timeout=2) as response:
    body = response.read()
assert body == b"public-test-target-v6", body
print("PASS: permitted IPv6 destination reachable")
PY

echo "5/6: direct IPv6 ULA and metadata destinations must be blocked"
for destination in "[fd00:200:2::2]" "[fd00:ec2::254]"; do
  if ip netns exec "$ns_client" python3 - "$destination" <<'PY'
import sys
from urllib.request import urlopen
try:
    urlopen(f"http://{sys.argv[1]}:8081/private", timeout=2)
except Exception:
    raise SystemExit(0)
raise SystemExit(1)
PY
  then
    echo "PASS: blocked IPv6 destination $destination"
  else
    echo "FAIL: IPv6 destination was reachable: $destination" >&2
    exit 1
  fi
done

echo "6/6: IPv6 HTTP redirect to ULA must be blocked"
if ip netns exec "$ns_client" python3 - <<'PY'
from urllib.request import urlopen
try:
    urlopen("http://[2001:4860:4860::8888]:8081/redirect", timeout=2)
except Exception:
    raise SystemExit(0)
raise SystemExit(1)
PY
then
  echo "PASS: IPv6 redirect follow-up to ULA blocked"
else
  echo "FAIL: IPv6 redirect reached ULA destination" >&2
  exit 1
fi

echo "PASS: isolated IPv4/IPv6 namespace SSRF forwarding lab completed"
echo "LIMIT: this tests a temporary nftables router namespace, not the host's Docker DOCKER-USER/forward path, DNS resolver behavior, Chromium subrequests, Cloudflare Tunnel egress, or the production firewall."
