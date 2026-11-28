# BOF provider host egress and SSRF hardening

**Status:** design and audit tooling only. No host firewall rules have been applied, no VM has been selected, and no provider has been deployed.

This runbook defines the network policy required before any production use of the Swayphics Business Opportunity Finder (BOF) open-source provider stack. It is intentionally not an install script: the eventual host's Docker firewall backend, network allocation, upstream resolver and existing firewall policy must be inspected before rules are written.

## 1. Fixed Docker network map

The private-gateway Compose file now assigns stable subnets:

| Network | Subnet | Members | Internet egress |
|---|---|---|---|
| \`tunnel_internal\` | \`10.77.30.0/24\` | Caddy, cloudflared | Internal only |
| \`search_internal\` | \`10.77.10.0/24\` | Caddy, SearXNG, Valkey | Internal only |
| \`crawl_internal\` | \`10.77.20.0/24\` | Caddy, Crawl4AI | Internal only |
| \`search_egress\` | \`10.77.40.0/24\` | SearXNG | Outbound, restricted by host firewall |
| \`crawl_egress\` | \`10.77.50.0/24\` | Crawl4AI | Outbound, restricted by host firewall |
| \`cloudflare_egress\` | \`10.77.60.0/24\` | cloudflared | Outbound, restricted by host firewall |

Caddy has no egress network. Valkey is reachable only on \`search_internal\`. Search, crawl and tunnel egress are separated so host rules can apply different destination and port policies.

Before deployment, inspect all host, VPN, LAN, existing Docker and cloud-provider routes. None of the six ranges may overlap. If any range changes, update Compose and this policy together; the limiter's trusted Caddy address \`10.77.10.254/32\` must also remain synchronised with the gateway's fixed IP. Caddy uses `.254` in each subnet so dynamic container addresses can use the low end of the range without colliding with the gateway.

## 2. Required egress policy

Apply filtering to forwarded traffic from the three egress source subnets, not merely to host-originated \`OUTPUT\` traffic. A default-deny policy is required for traffic sourced from these subnets.

Policy order is important:

1. Drop traffic from an egress subnet when its destination is loopback, private, link-local, metadata, multicast, reserved, documentation-only, IPv4-mapped IPv6 or NAT64-translation space.
2. Permit return traffic for established outbound connections.
3. Permit only the service-specific outbound ports listed below, and only after the non-public destination blocks have been evaluated.
4. Drop all other new outbound traffic from the three egress subnets.
5. Leave unrelated host and Docker traffic unchanged.

Required service allowances:

| Source subnet | Allow | Purpose |
|---|---|---|
| \`10.77.40.0/24\` | TCP 443 | SearXNG queries to its configured external search engines |
| \`10.77.50.0/24\` | TCP 80 and 443 | Public HTTP/HTTPS page retrieval by Crawl4AI |
| \`10.77.60.0/24\` | TCP and UDP 7844 | Cloudflare Tunnel HTTP/2 and QUIC connections |

Cloudflare documents TCP/UDP port 7844 for Tunnel connectivity. Optional outbound TCP 443 should be added to the cloudflared source subnet only when a specific optional feature requires it, not as a blanket allowance. Keep Cloudflare's current destination IP/FQDN list updated if the host firewall supports destination allowlists. See [Cloudflare Tunnel firewall requirements](https://developers.cloudflare.com/tunnel/configuration/).

Docker's embedded DNS resolver normally handles container DNS requests inside the Docker networking path. Do not solve DNS failures by globally allowing arbitrary container DNS traffic. Inspect the resolver path on the actual host. If a container can send DNS directly to an external resolver, allow only the explicitly approved resolver IP and port 53, then verify that the source policy still blocks private destinations after name resolution.

### Minimum non-public destination blocks

The filter must cover IPv4 and IPv6. This list is a baseline, not a substitute for reviewing the live IANA special-purpose registries and the selected host's own address ranges.

| Family | Destination ranges to block |
|---|---|
| IPv4 | \`0.0.0.0/8\`, \`10.0.0.0/8\`, \`100.64.0.0/10\`, \`127.0.0.0/8\`, \`169.254.0.0/16\`, \`172.16.0.0/12\`, \`192.0.0.0/24\`, \`192.0.2.0/24\`, \`192.168.0.0/16\`, \`198.18.0.0/15\`, \`198.51.100.0/24\`, \`203.0.113.0/24\`, \`224.0.0.0/4\`, \`240.0.0.0/4\`, \`255.255.255.255/32\` |
| IPv6 | \`::/128\`, \`::1/128\`, \`::ffff:0:0/96\`, \`64:ff9b::/96\`, \`64:ff9b:1::/48\`, \`100::/64\`, \`2001:db8::/32\`, \`fc00::/7\`, \`fe80::/10\`, \`ff00::/8\` |

The rules must also block the host's actual private and management subnets, Docker bridge subnets, VPN ranges, and any cloud-provider metadata or control-plane destinations. The IPv4 link-local block includes the well-known \`169.254.169.254\` metadata address. The IPv6 unique-local block includes the AWS IPv6 metadata address \`fd00:ec2::254\`.

Do not check only IPv4 dotted-decimal strings. IPv4-mapped IPv6 and NAT64 representations can encode destinations that are private in IPv4 form. Normalise those forms before address classification and block the corresponding packet-level destination ranges. OWASP identifies these representations and the metadata endpoints in its [SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

## 3. Identify the Docker firewall backend first

Run this read-only check on the eventual Linux host:

\`\`\`bash
bash scripts/bof-open-source-provider-poc/private-gateway/audit-host-firewall-backend.sh
\`\`\`

The script reads \`docker info\` and checks the expected management interface. It does not add, delete or flush firewall rules. If Docker does not report a recognised backend, the script exits non-zero and requires manual inspection. Do not guess based on the presence of an \`iptables\` compatibility command.

### If Docker reports iptables

Use a dedicated administrator-owned subchain reached from \`DOCKER-USER\` in the filter/FORWARD path. Add a single jump at the top of \`DOCKER-USER\`; keep the actual policy in the named subchain. Do not flush or replace \`DOCKER-USER\`, because the host may already have other administrator rules.

The subchain must implement the policy order above, matching the fixed source subnets. Docker documents that packets reaching \`DOCKER-USER\` have already passed destination NAT; for this outbound policy, match the container egress source subnet and the resolved destination address. Do not append the policy after Docker's own forwarding accepts. Review [Docker's iptables firewall guidance](https://docs.docker.com/engine/network/firewall-iptables/).

### If Docker reports nftables

Do not create \`DOCKER-USER\` and do not edit Docker-managed nftables tables. Use a separate administrator-owned table, for example \`inet swayphics_bof\`, with a base chain attached to the \`forward\` hook. Inspect the active Docker ruleset first and set the chain priority so the deny rules execute before Docker's forwarding accepts. Keep the host's unrelated forwarding policy intact.

Docker's nftables documentation specifically describes creating a separate table/base chain and ordering it before Docker's rules. See [Docker's nftables firewall guidance](https://docs.docker.com/engine/network/firewall-nftables/).

### UFW is not the enforcement point

Do not assume a UFW deny rule controls forwarded Docker bridge traffic. Docker's NAT and forwarding path can bypass the UFW chains normally used for host input/output filtering. The Docker documentation explicitly calls out this incompatibility. See [Docker packet filtering and firewalls](https://docs.docker.com/engine/network/packet-filtering-firewalls/).

## 4. SSRF validation matrix for staging

A successful host firewall deployment must be verified from the actual Crawl4AI container and its egress network. Use controlled test endpoints and a test-only DNS zone. Do not send probes at the real cloud metadata service or production infrastructure.

| Test | Expected result |
|---|---|
| Public HTTPS page on TCP 443 | Allowed |
| Public HTTP page on TCP 80 | Allowed by crawl subnet only |
| Public destination on an unapproved port | Blocked |
| \`127.0.0.1\`, \`::1\` and host loopback | Blocked |
| RFC1918, ULA, host LAN, VPN and Docker bridge addresses | Blocked |
| IPv4 link-local and metadata addresses | Blocked |
| IPv6 link-local and metadata address | Blocked |
| IPv4-mapped private IPv6 and NAT64-encoded private IPv4 | Blocked |
| Public URL that redirects to any blocked destination | Blocked at the redirected destination |
| Controlled hostname that resolves public first, then to a blocked address | Blocked on the later connection |
| DNS response containing both public and blocked A/AAAA answers | No connection may reach the blocked address |
| SearXNG public search over TCP 443 | Allowed |
| SearXNG or Crawl4AI request to an internal service | Blocked |
| cloudflared to the current Cloudflare Tunnel endpoints on TCP/UDP 7844 | Allowed |
| cloudflared or either provider to arbitrary internal destinations | Blocked |

Application URL validation remains necessary but is not sufficient. OWASP notes that domain allowlisting alone does not stop DNS rebinding: the resolved IP must be checked and the HTTP client must connect to that validated address without a second unchecked DNS lookup. The packet-level egress filter is a separate defence in depth. If Crawl4AI cannot guarantee validation at connection time for redirects and each browser subrequest, add a dedicated egress proxy that enforces destination policy on every connection.

## 5. Acceptance gates

Do not mark host egress security complete until all of the following are evidenced on the chosen staging host:

- Docker firewall backend and active chains are recorded.
- The six subnet ranges do not overlap the host, VPN, LAN or other Docker networks.
- Rules match the source subnet of each egress service and cover both IPv4 and IPv6.
- Non-public and metadata destinations are denied before outbound-port allowances.
- Search, crawler and tunnel egress each have only their required ports.
- Caddy and Valkey have no outbound internet path.
- Rules survive Docker daemon restart and host reboot without changing unrelated host traffic.
- Counters or logs show test traffic hitting both allow and deny rules.
- DNS rebinding, mixed A/AAAA answers and redirect-to-private tests all fail closed.
- The service still passes the legitimate public search/fetch smoke tests after filtering.
- The firewall policy can be rolled back safely through the host provider's console if SSH or networking is disrupted.

## 6. Current status

The POC Compose file now pins all three egress networks to stable source subnets. The new audit script detects the Docker firewall backend and the correct policy attachment point without changing the machine. Automated tests use mocked \`docker\`, \`iptables\` and \`nft\` commands to verify both supported branches and the unknown-backend fail-closed behaviour.

No host firewall rules have been installed. No host, VM, tunnel, production secret or live endpoint has been selected or provisioned. Do not apply firewall commands until the actual host and firewall backend are known and an out-of-band recovery route is available.
