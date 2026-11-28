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

### Read-only subnet-overlap preflight

Run the overlap audit on the Linux machine that hosts the local Docker daemon, before creating any of the private-gateway Compose networks:

    python3 scripts/bof-open-source-provider-poc/private-gateway/audit-host-network-overlap.py

The audit compares all six planned IPv4 subnets against every IPv4 and IPv6 host-interface prefix, every non-default IPv4 and IPv6 route in all routing tables, and every subnet in the IPAM configuration of every existing Docker network.

Default routes are excluded because they necessarily cover the entire address space. More-specific and broader non-default routes are both checked for overlap. The script is read-only and does not create networks, change routes, or modify firewall rules.

Exit codes are 0 for a complete inventory with no overlap, 1 when an overlap is found, and 2 when the inventory cannot be completed or parsed. Treat exit code 2 as a failed preflight, not as evidence that the ranges are free.

Run the command on the Linux Docker host itself. The audit verifies that the active Docker context points to a Linux Unix-domain socket and rejects remote TCP/SSH endpoints. It also fails when the `DOCKER_HOST` environment override is set, because that override can redirect Docker CLI calls away from the context being inspected. A custom context selected through `DOCKER_CONTEXT` is acceptable only when its inspected endpoint is a local Unix socket. This checks the transport endpoint, not what may be running behind a locally proxied or forwarded socket; do not use a socket proxy or SSH-forwarded socket for this preflight. The audit cannot discover routes or address reservations held only in an external cloud, office, or VPN control plane and not installed on the host; review those allocations separately. Resolve every reported overlap before deployment. The audit intentionally treats an existing network using one of the six planned ranges as a conflict, so run it before creating this stack.

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

Do not check only IPv4 dotted-decimal strings. IPv4-mapped IPv6 and NAT64 representations can encode destinations that are private in IPv4 form. Normalise those forms before address classification and block the corresponding packet-level destination ranges. The application-level URL check in the POC also rejects IPv4 and IPv6 literals (including IPv4-mapped IPv6), non-public suffixes such as `.local`, `.internal`, `.home.arpa`, `.lan`, `.example` and `.invalid`, and localhost names with a trailing root dot. This reduces obvious unsafe inputs but does not validate DNS answers at connection time and cannot prevent a public hostname from resolving or rebinding to a private address. OWASP identifies these representations and the metadata endpoints in its [SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

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

### Read-only firewall state snapshot

After identifying the Docker firewall backend, capture the current forwarding state:

    bash scripts/bof-open-source-provider-poc/private-gateway/audit-host-firewall-state.sh

The snapshot first runs the backend audit, then reads the IPv4 and IPv6 forwarding sysctls. For iptables it records the IPv4 FORWARD, DOCKER-USER and Docker NAT chains, plus the IPv6 FORWARD and (when present) DOCKER-USER chains. For nftables it prints the complete ruleset with handles and chain priorities so the existing forward hooks and rule ordering can be reviewed.

The script never installs, deletes, flushes or reloads firewall rules and does not change sysctls. It exits with code 2 when the backend or forwarding state cannot be read. An absent IPv6 DOCKER-USER chain is reported as a manual-review item rather than being treated as proof that IPv6 is protected. Keep the captured output private because it can disclose host interface, network and firewall topology.

This is an inventory aid, not a policy validator. It does not prove that current rules are safe, that every container path is filtered, or that a proposed policy will execute before Docker's accept rules. Those properties still require inspection of the actual host and controlled packet-level staging tests.

### Offline firewall snapshot structure analyser

Save the output of the read-only snapshot command to a protected local file, then run:

    python3 scripts/bof-open-source-provider-poc/private-gateway/analyse-firewall-snapshot.py /path/to/firewall-snapshot.txt

Alternatively, pipe the snapshot to standard input. The analyser does not execute host commands or alter the snapshot. For iptables it checks whether the visible IPv4 FORWARD rules jump to DOCKER-USER first, and flags an absent or later jump. It reports whether a BOF/Swayphics-named policy jump is visible in DOCKER-USER, but treats that as a manual-review item because it does not inspect the referenced chain's complete semantics. For nftables it compares the priority of a visible administrator-owned BOF forward base chain with a visible Docker-owned forward base chain; it fails when the BOF priority is not earlier and reports REVIEW when either chain cannot be identified reliably.

The analyser is intentionally conservative. It does not prove that rules match the intended source subnets, that deny rules precede allows inside a custom chain, that IPv6 is equivalently protected, or that all Docker forwarding paths traverse the inspected chains. It cannot infer rule semantics from names alone. A PASS is only a structural ordering signal and still prints DEPLOYMENT GATE: NOT READY. Treat REVIEW and FAIL as blockers until an administrator inspects the full host ruleset and completes controlled packet-level staging tests. CI runs offline parser fixtures for positive, negative and ambiguous cases; those fixtures do not represent a live host.

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

The POC Compose file now pins all three egress networks to stable source subnets. The read-only preflight verifies a local Linux Docker Unix-socket context (rejecting remote endpoints and `DOCKER_HOST` overrides), then audits host interface prefixes, all non-default IPv4/IPv6 routes, and existing Docker IPAM subnets against the six planned ranges. A separate read-only audit identifies the Docker firewall backend and expected policy attachment point. A further read-only snapshot records IPv4/IPv6 forwarding settings and the active iptables chains or nftables ruleset for host-specific policy design. Automated tests use mocked \`docker\`, \`iptables\` and \`nft\` commands to verify both supported branches and the unknown-backend fail-closed behaviour.

No host firewall rules have been installed. No host, VM, tunnel, production secret or live endpoint has been selected or provisioned. Do not apply firewall commands until the actual host and firewall backend are known and an out-of-band recovery route is available.


## 7. Machine-readable policy manifest

The declarative policy is stored at:

    scripts/bof-open-source-provider-poc/private-gateway/host-egress-policy.json

Validate its structure and safety invariants without contacting or changing a host:

    node scripts/bof-open-source-provider-poc/private-gateway/validate-host-egress-policy.cjs
    node scripts/bof-open-source-provider-poc/private-gateway/host-egress-policy.test.cjs

The manifest records the three fixed source subnets, service-specific protocol/port allowances, default-deny behaviour, the narrow established-return path, IPv4/IPv6 destination-deny baselines, DNS restrictions and the required attachment points for iptables and nftables. It is data for review only. The validator emits no firewall commands and has no host access.

The IPv4 and IPv6 lists are explicitly conservative baselines, not an exhaustive export of every IANA special-purpose or non-globally-reachable prefix. The IANA registries can change, and their entries include exceptions and different reachability properties. Review the live registries and add the selected host's LAN, management, VPN, Docker and cloud metadata/control-plane ranges before enforcement. The manifest intentionally leaves `host_specific_ranges` empty until those ranges are observed on an actual host.

The Cloudflare endpoint snapshot was checked on 28 November 2026 against the [current Tunnel with firewall page](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/), which states TCP/UDP port 7844 and lists the standard global region1.v2 and region2.v2 endpoints. Its separate `--region us` and FedRAMP endpoint sets are not included in this baseline. Refresh the FQDN/IP set immediately before deployment and verify that the selected firewall can maintain the required endpoint set. Optional TCP 443 is not included in the default cloudflared allowance; add it only for a separately approved feature and destination list. The snapshot is not a promise that those addresses will remain unchanged.

CI runs the manifest regression tests and schema validation as part of the mocked contract job. Passing those checks proves only that the declarative file meets the encoded invariants. It does not validate a real host's firewall backend, route table, DNS path, destination policy, Docker forwarding behaviour or rollback plan.

No firewall rules have been generated or applied. No host, VM, tunnel, production secret or live endpoint has been provisioned.


The manifest also records the expected six-network topology and exact service membership. CI now converts the Compose file to canonical JSON and checks it against the manifest. This catches drift such as a provider changing subnet, Valkey gaining an egress attachment, Caddy gaining an outbound network, a host port being published, or the Cloudflare Tunnel profile becoming unconditional. The Compose comparison is a static configuration check; the existing live CI job separately confirms runtime network membership and unpublished ports.


## 8. Combined read-only host readiness report

Run this on the Linux machine that hosts the local Docker daemon, before creating the private-gateway networks:

    bash scripts/bof-open-source-provider-poc/private-gateway/audit-host-readiness.sh

The report combines the static policy-manifest validator, Docker firewall-backend audit, host subnet-overlap preflight, and the read-only forwarding/firewall snapshot. It captures underlying command output in memory and suppresses raw host topology and firewall rules by default. Use the option --show-details only from a trusted terminal; that output can reveal interface addresses, routes, Docker endpoints and firewall structure.

Exit codes are:

- 0: the available policy and host inventory checks completed, with no planned-subnet overlap detected. This is not deployment approval.
- 1: at least one planned subnet overlaps an observed host range. Do not create the private-gateway networks.
- 2: one or more required audits could not be completed or trusted. Treat this as blocked.
- 3: invalid command-line usage.

The report deliberately prints DEPLOYMENT GATE: NOT READY even when its inventory checks pass. It cannot discover address reservations held only in external cloud, office or VPN control planes; it does not validate the safety or ordering of existing firewall rules; and it does not install or test an egress policy. Host-specific destination ranges, IPv4/IPv6 and DNS-rebinding staging tests, evidence of actual packet filtering, and a safe rollback route are still mandatory.

CI tests the report with mocked Docker, interface, route, sysctl and firewall commands. CI does not run the host audit against the shared runner and does not retain host inventory output. The test suite covers clean inventory, subnet conflict, incomplete inventory, unsupported backend, remote Docker context, sensitive-output suppression, and the absence of any apply mode.

This script is read-only. It does not create Docker networks, alter routes, change sysctls, install firewall rules, deploy provider containers, or configure a tunnel.

## 9. Offline DNS and redirect policy simulator

The POC includes an offline decision simulator:

    python3 scripts/bof-open-source-provider-poc/private-gateway/ssrf-policy-simulator.py --self-test

It loads the declarative destination-deny baseline and tests policy decisions for public IPv4/IPv6, loopback, RFC1918, carrier-grade NAT, link-local and metadata addresses, IPv4-mapped IPv6, NAT64, mixed public/private DNS answer sets, later DNS rebinding, redirect-to-loopback, unsupported schemes, URL credentials and unapproved ports. Each redirect hop is evaluated independently against its supplied DNS answer set.

This is deliberately a **policy-logic regression harness**, not a live DNS server, HTTP proxy, packet filter or Crawl4AI network test. It does not resolve names, open sockets, intercept browser subrequests, enforce address pinning, or prove that the host firewall drops packets. It also cannot populate the still-empty host-specific destination ranges. Passing it demonstrates only that the encoded decision logic fails closed for the supplied test vectors.

The test is run in the POC CI mocked-contract job. Production and host readiness gates remain unchanged: an actual isolated Linux staging host must still demonstrate packet-level denial for DNS rebinding, mixed A/AAAA answers, redirects, browser subrequests, IPv4 and IPv6 private/metadata destinations, and unapproved ports before deployment can be considered.

## 10. Isolated Linux network-namespace forwarding lab

A separate Linux-only lab exercises actual packet forwarding through a temporary nftables router namespace:

    sudo bash scripts/bof-open-source-provider-poc/private-gateway/network-namespace-ssrf-test.sh

Prerequisites: root privileges, iproute2, nftables, and Python 3. The script creates three uniquely named temporary network namespaces (client, router, target), two veth pairs, and one nftables table inside the router namespace only. It does not edit the host nftables/iptables rules, host routes, host forwarding sysctls, Docker networks, or production services. A cleanup trap removes the namespaces and their veth devices.

The target namespace hosts local HTTP fixtures on ports 8080 (IPv4) and 8081 (IPv6). Simulated public destinations (1.1.1.1/32 and 2001:4860:4860::8888/128) are assigned inside the target namespace; neither is contacted over the public internet. The IPv6 fixture also assigns a ULA target and the AWS IPv6 metadata address (fd00:ec2::254/128). The router permits only the exact simulated public IPv4/IPv6 destination and TCP port pairs, then drops other forwarded traffic. The script checks:
- permitted simulated public IPv4 and IPv6 destinations are reachable;
- direct IPv4 private-network traffic is blocked;
- direct IPv6 ULA and IPv6 metadata-address traffic are blocked;
- IPv4 and IPv6 HTTP redirects to private destinations are blocked on their follow-up connections.

This is a packet-level test of a temporary dual-stack nftables forwarding policy in disposable network namespaces. It is not proof that the selected production host's Docker bridge traffic traverses the same hook or rule order. It does not test the actual DOCKER-USER iptables path, Docker's host nftables integration, live DNS rebinding, Chromium subrequests, Cloudflare Tunnel egress, or host-specific destination ranges. Do not use its result to mark the deployment gate ready. Preserve the host-specific preflight and rollback requirements above.


### Additional offline regression coverage — 28 November 2026

The policy simulator's self-test suite also checks a mixed IPv4/IPv6 answer set containing an IPv6 metadata destination, a three-hop redirect chain whose final hop targets RFC1918 space, and malformed DNS answer data. Every supplied address is classified and the chain stops at the first unsafe hop. These tests strengthen the decision-logic regression set; they do not perform DNS lookups or HTTP connections.

**Important TOCTOU limitation:** the simulator models a hostname resolving to a public address on one evaluation and a blocked address on a later evaluation. It does not simulate a DNS answer changing after validation but before the HTTP client opens its socket. A resolver pre-check alone cannot close that race if Crawl4AI/Chromium performs a second lookup. Production enforcement must either pin each connection to the exact validated address while preserving the original Host header and TLS SNI, and repeat validation for every redirect and browser subrequest, or route all crawler traffic through an egress proxy/firewall that enforces destination policy at connection time. The packet-level host egress filter remains mandatory even if application-level address pinning is implemented.

Do not describe the offline suite as proof of DNS-rebinding resistance. The selected Linux staging host must still pass controlled DNS rebinding and redirect tests at the network boundary before any production use.
