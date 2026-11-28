#!/usr/bin/env bash
# Controlled DNS-rebinding / connection-time egress test.
# All destinations are fixtures inside temporary Linux network namespaces.
# No public Internet, host firewall rules, Docker networks, or production services
# are touched. A temporary /etc/netns resolver config is removed by the EXIT trap.
set -Eeuo pipefail

if [[ "$(id -u)" != "0" ]]; then
  echo "ERROR: run as root (for example: sudo $0)" >&2
  exit 2
fi
for bin in ip nft python3; do
  command -v "$bin" >/dev/null 2>&1 || { echo "ERROR: missing required command: $bin" >&2; exit 2; }
done

suffix="bofdns$$"
ns_client="${suffix}c"
ns_router="${suffix}r"
ns_target="${suffix}t"
resolver_dir="/etc/netns/${ns_client}"
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
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "http://10.201.2.2:8080/private")
            self.end_headers()
            return
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

echo "1/4: first DNS resolution is the simulated public address"
ip netns exec "$ns_client" python3 - <<'PY'
import socket
import struct

def resolve_a(host):
    identifier = 0x4B31
    labels = b"".join(bytes([len(label)]) + label.encode("ascii") for label in host.split("."))
    question = labels + b"\x00" + struct.pack("!HH", 1, 1)
    packet = struct.pack("!HHHHHH", identifier, 0x0100, 1, 0, 0, 0) + question
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as dns:
        dns.settimeout(2)
        dns.sendto(packet, ("127.0.0.1", 53))
        response, _ = dns.recvfrom(2048)
    assert struct.unpack("!H", response[:2])[0] == identifier
    answers = struct.unpack("!H", response[6:8])[0]
    assert answers == 1, response
    offset = 12
    while response[offset] != 0:
        offset += response[offset] + 1
    offset += 5
    if response[offset:offset + 2] == b"\xc0\x0c":
        offset += 2
    else:
        raise AssertionError("Unexpected DNS answer name encoding")
    record_type, record_class, ttl, length = struct.unpack("!HHIH", response[offset:offset + 10])
    offset += 10
    assert (record_type, record_class, length) == (1, 1, 4)
    return socket.inet_ntoa(response[offset:offset + 4])

resolved = resolve_a("rebind-lab.test")
assert resolved == "1.1.1.1", resolved
with socket.create_connection((resolved, 8080), timeout=2) as connection:
    connection.sendall(b"GET /pinned HTTP/1.0\r\nHost: rebind-lab.test\r\n\r\n")
    chunks = []
    while True:
        chunk = connection.recv(4096)
        if not chunk:
            break
        chunks.append(chunk)
    response = b"".join(chunks)
assert b"isolated-public-fixture" in response, response
print("PASS: controlled DNS answer was pinned to the actual socket connection")
PY

echo "2/4: second DNS resolution changes to a private address"
if ip netns exec "$ns_client" python3 - <<'PY'
import socket
import struct

identifier = 0x4B32
host = "rebind-lab.test"
labels = b"".join(bytes([len(label)]) + label.encode("ascii") for label in host.split("."))
question = labels + b"\x00" + struct.pack("!HH", 1, 1)
packet = struct.pack("!HHHHHH", identifier, 0x0100, 1, 0, 0, 0) + question
with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as dns:
    dns.settimeout(2)
    dns.sendto(packet, ("127.0.0.1", 53))
    response, _ = dns.recvfrom(2048)
assert struct.unpack("!H", response[:2])[0] == identifier
assert struct.unpack("!H", response[6:8])[0] == 1
resolved = socket.inet_ntoa(response[-4:])
assert resolved == "10.201.2.2", resolved
try:
    with socket.create_connection((resolved, 8080), timeout=2) as connection:
        connection.sendall(b"GET /rebinding HTTP/1.0\r\nHost: rebind-lab.test\r\n\r\n")
except OSError:
    print("PASS: changed DNS answer resolved privately and connection-time egress policy blocked it")
    raise SystemExit(0)
raise SystemExit("FAIL: rebinding destination was reachable")
PY
then
  :
else
  echo "FAIL: unpinned connection test did not fail closed" >&2
  exit 1
fi

echo "3/4: HTTP redirect to a private destination must be blocked at connection time"
if ip netns exec "$ns_client" python3 - <<'PY'
from urllib.request import urlopen
try:
    urlopen("http://1.1.1.1:8080/redirect", timeout=2)
except Exception:
    print("PASS: redirect follow-up to private destination was blocked")
    raise SystemExit(0)
raise SystemExit("FAIL: redirect reached the private destination")
PY
then
  :
else
  echo "FAIL: redirect egress test did not fail closed" >&2
  exit 1
fi

echo "4/4: verify DNS rotation and that blocked destinations never reached fixture"
grep -Fxq "A query 1: 1.1.1.1" "$dns_log"
grep -Fxq "A query 2: 10.201.2.2" "$dns_log"
grep -Fxq "/pinned" "$target_log"
grep -Fxq "/redirect" "$target_log"
if grep -Eq '^/(rebinding|private)
  echo "FAIL: blocked destination request reached the target fixture" >&2
  exit 1
fi
echo "PASS: resolver changed answers; pinned connection succeeded; rebinding and redirect destinations were blocked"
echo "LIMIT: this proves only the isolated router policy for these controlled IPv4 paths. It does not prove host firewall, Docker forwarding, Crawl4AI/Chromium, browser subrequests, or production security."
 "$target_log"; then
  echo "FAIL: blocked destination request reached the target fixture" >&2
  exit 1
fi
echo "PASS: resolver changed answers; pinned connection succeeded; rebinding and redirect destinations were blocked"
echo "LIMIT: this proves only the isolated router policy for these controlled IPv4 paths. It does not prove host firewall, Docker forwarding, Crawl4AI/Chromium, browser subrequests, or production security."
