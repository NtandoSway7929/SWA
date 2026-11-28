#!/usr/bin/env bash
# Controlled DNS-rebinding / connection-time egress test.
# All destinations are fixtures inside temporary Linux network namespaces.
# No public Internet, host firewall rules, Docker networks, or production services
# are touched. A temporary /etc/netns resolver config is removed by the EXIT trap.
set -Eeuo pipefail

if [[ \${EUID} -ne 0 ]]; then
  echo "ERROR: run as root (for example: sudo $0)" >&2
  exit 2
fi
for bin in ip nft python3; do
  command -v "$bin" >/dev/null 2>&1 || { echo "ERROR: missing required command: $bin" >&2; exit 2; }
done

suffix="bofdns$$"
ns_client="\${suffix}c"
ns_router="\${suffix}r"
ns_target="\${suffix}t"
resolver_dir="/etc/netns/\${ns_client}"
resolver_pid=""
target_pid=""
dns_log="$(mktemp)"
target_log="$(mktemp)"

cleanup() {
  set +e
  [[ -n "$resolver_pid" ]] && kill "$resolver_pid" 2>/dev/null
  [[ -n "$target_pid" ]] && kill "$target_pid" 2>/dev/null
  [[ -n "$resolver_pid" ]] && wait "$resolver_pid" 2>/dev/null
  [[ -n "$target_pid" ]] && wait "$target_pid" 2>/dev/null
  ip netns del "$ns_client" 2>/dev/null
  ip netns del "$ns_router" 2>/dev/null
  ip netns del "$ns_target" 2>/dev/null
  rm -rf "$resolver_dir"
  rm -f "$dns_log" "$target_log"
}
trap cleanup EXIT INT TERM

for ns in "$ns_client" "$ns_router" "$ns_target"; do
  if ip netns list | awk '{print $1}' | grep -Fxq "$ns"; then
    echo "ERROR: namespace collision: $ns" >&2
    exit 2
  fi
done
if [[ -e "$resolver_dir" ]]; then
  echo "ERROR: resolver config path already exists: $resolver_dir" >&2
  exit 2
fi

mkdir -p "$resolver_dir"
printf 'nameserver 127.0.0.1\noptions timeout:1 attempts:1 ndots:1\n' > "$resolver_dir/resolv.conf"

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
ip -n "$ns_client" addr add 10.201.1.2/24 dev c-r
ip -n "$ns_router" addr add 10.201.1.1/24 dev r-c
ip -n "$ns_router" addr add 10.201.2.1/24 dev r-t
ip -n "$ns_target" addr add 10.201.2.2/24 dev t-r
ip -n "$ns_target" addr add 1.1.1.1/32 dev lo
ip -n "$ns_client" link set c-r up
ip -n "$ns_router" link set r-c up
ip -n "$ns_router" link set r-t up
ip -n "$ns_target" link set t-r up
ip -n "$ns_client" route add default via 10.201.1.1
ip -n "$ns_router" route add 1.1.1.1/32 via 10.201.2.2
ip -n "$ns_target" route add 10.201.1.0/24 via 10.201.2.1
ip netns exec "$ns_router" sysctl -q -w net.ipv4.ip_forward=1

ip netns exec "$ns_router" nft -f - <<'NFT'
table inet bof_dns_rebinding_lab {
  chain forward {
    type filter hook forward priority filter; policy drop;
    ct state established,related accept
    iifname "r-c" oifname "r-t" ip daddr 1.1.1.1 tcp dport 8080 accept
  }
}
NFT

ip netns exec "$ns_target" python3 - "$target_log" <<'PY' &
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
log_path = sys.argv[1]
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        with open(log_path, "a", encoding="utf-8") as log:
            log.write(self.path + "\n")
        body = b"isolated-public-fixture"
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *_):
        pass
HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
PY
target_pid=$!

ip netns exec "$ns_client" python3 - "$dns_log" <<'PY' &
import socket
import struct
import sys
log_path = sys.argv[1]
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind(("127.0.0.1", 53))
a_queries = 0
while True:
    packet, peer = sock.recvfrom(2048)
    offset = 12
    while packet[offset] != 0:
        offset += packet[offset] + 1
    question_end = offset + 5
    qtype = struct.unpack("!H", packet[offset + 1:offset + 3])[0]
    question = packet[12:question_end]
    answer = b""
    if qtype == 1:
        a_queries += 1
        address = "1.1.1.1" if a_queries == 1 else "10.201.2.2"
        with open(log_path, "a", encoding="utf-8") as log:
            log.write(f"A query {a_queries}: {address}\n")
        answer = b"\xc0\x0c" + struct.pack("!HHIH", 1, 1, 0, 4) + socket.inet_aton(address)
    header = packet[:2] + struct.pack("!HHHHH", 0x8180, 1, 1 if answer else 0, 0, 0)
    sock.sendto(header + question + answer, peer)
PY
resolver_pid=$!

sleep 0.3

echo "1/3: first DNS resolution is the simulated public address"
ip netns exec "$ns_client" python3 - <<'PY'
import socket
resolved = socket.getaddrinfo("rebind-lab.test", 8080, family=socket.AF_INET, type=socket.SOCK_STREAM)
addresses = sorted({item[4][0] for item in resolved})
assert addresses == ["1.1.1.1"], addresses
with socket.create_connection((addresses[0], 8080), timeout=2) as connection:
    connection.sendall(b"GET /pinned HTTP/1.0\r\nHost: rebind-lab.test\r\n\r\n")
    response = connection.recv(4096)
assert b"isolated-public-fixture" in response, response
print("PASS: validated address can be pinned to the actual connection")
PY

echo "2/3: second DNS resolution changes to a private address"
if ip netns exec "$ns_client" python3 - <<'PY'
import socket
try:
    socket.create_connection(("rebind-lab.test", 8080), timeout=2)
except OSError:
    print("PASS: connection-time egress policy blocked the rebinding destination")
    raise SystemExit(0)
raise SystemExit("FAIL: rebinding destination was reachable")
PY
then
  :
else
  echo "FAIL: unpinned connection test did not fail closed" >&2
  exit 1
fi

echo "3/3: verify DNS rotation and that private destination never reached fixture"
grep -Fxq "A query 1: 1.1.1.1" "$dns_log"
grep -Fxq "A query 2: 10.201.2.2" "$dns_log"
grep -Fxq "/pinned" "$target_log"
if grep -Fxq "/rebinding" "$target_log"; then
  echo "FAIL: private rebinding request reached the target fixture" >&2
  exit 1
fi
echo "PASS: resolver changed answers; pinned connection succeeded; unpinned private connection was blocked"
echo "LIMIT: this proves only the isolated router policy for this controlled rebinding path. It does not prove host firewall, Docker forwarding, Crawl4AI/Chromium, redirects, browser subrequests, or production security."
