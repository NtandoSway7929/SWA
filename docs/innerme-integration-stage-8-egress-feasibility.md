# InnerMe Integration — Stage 8 Controlled Egress Feasibility

**Date:** 4 November 2026  
**Branch:** `feature/innerme-municipal-money-gateway`  
**PR:** #147  
**Status:** Research and implementation gate only. No egress code, network policy, proxy, credentials, or deployment changed.

## 1. Decision

Do not add a new paid proxy service yet. First prototype the native Supabase Edge Runtime TCP/TLS route in an isolated CI environment. This is the only route identified so far that could provide connection-time destination pinning without introducing another continuously running service.

The native route has now passed a CI proof-of-concept against the pinned `supabase/edge-runtime:v1.77.9` image. This validates the local container's raw TCP/TLS behavior, not a managed Supabase production runtime or the production gateway. See [Stage 9 runtime probe](innerme-integration-stage-9-egress-runtime-probe.md).

## 2. Candidate A — native Supabase Edge Runtime socket

Deno documents the following primitives:

- `Deno.resolveDns(host, "A")` and `Deno.resolveDns(host, "AAAA")` resolve both address families and require network permission.
- `Deno.connect({ hostname: "<literal-IP>", port: 443 })` opens a raw TCP connection to the specified IP. The API is currently marked **unstable** in Deno's API reference.
- `Deno.startTls(tcpConnection, { hostname: "municipaldata.treasury.gov.za" })` upgrades that already-open connection to TLS and uses the supplied hostname for certificate hostname verification. The Stage 9 mock-server test observed the expected SNI and confirmed that a trusted certificate for a different hostname is rejected after explicitly awaiting `TlsConn.handshake()`.

References:
- [Deno Network API — connect, resolveDns and startTls](https://docs.deno.com/api/deno/network/)
- [Deno STARTTLS example](https://docs.deno.com/examples/starttls/)
- [Deno permissions model](https://docs.deno.com/runtime/reference/permissions/)
- [Supabase Edge Functions overview](https://supabase.com/docs/guides/functions)
- [Supabase Edge Runtime repository](https://github.com/supabase/edge-runtime)

### Intended connection sequence

1. Keep the provider host, port, and path constants in trusted source code. No model or request input may provide a URL, hostname, IP address, or port.
2. Resolve A and AAAA records for the fixed provider hostname using the runtime resolver.
3. Validate the entire returned address set. Reject the lookup if it is empty, malformed, contains an IP outside the globally routable unicast ranges, or contains a special-purpose address. Include IPv4-mapped IPv6, loopback, private, link-local, carrier-grade NAT, multicast, documentation, benchmarking, reserved, unspecified, and IPv6 unique-local ranges in the deny set.
4. Select one validated address and call the raw TCP connector with that literal IP, not the hostname. Do not perform another DNS lookup during connection establishment.
5. Confirm the connected peer address is the selected address where the runtime exposes it.
6. Upgrade the same socket to TLS using the original Treasury hostname, keep certificate-chain and hostname verification enabled, and confirm the TLS SNI value is the original hostname in the test server.
7. Send only the pre-approved HTTP method, Host header and fixed route/query shape. Reject redirects. Apply a strict deadline and response-byte cap, and close the socket on every path.

If any required DNS, socket, TLS, peer-address, or permission control is unavailable, abort the provider request. Never fall back silently to ordinary hostname-based `fetch()` after a pinning failure.

### Known blockers

- Deno's API reference marks `Deno.connect` unstable. It worked in the tested local Supabase Edge Runtime image, but the API stability and hosted managed-runtime permission behavior remain production compatibility risks.
- Supabase's public documentation does not guarantee raw TCP permission or the unstable API in the hosted runtime.
- Stage 9 confirmed TLS SNI and wrong-hostname certificate rejection in the local container; the same behavior still needs confirmation in an explicitly approved managed Supabase test environment.
- The current gateway uses `fetch()`. A raw socket cannot be swapped into that call without an HTTP client/transport that supports a caller-supplied connected socket. Avoid implementing an ad hoc HTTP parser for production. Evaluate a maintained HTTP client/connector that preserves the pinned socket and TLS hostname semantics, or use a small, independently reviewed transport module.
- The Edge Runtime self-hosting project labels itself beta. A local/CI pass would establish only that the tested Edge Runtime version behaves as expected, not that every hosted Supabase deployment has identical flags and network policy.

## 3. Candidate B — Cloudflare Workers TCP sockets

Cloudflare documents TCP `connect()` with hostname and port, TLS `startTls()`, and restrictions on connections to private/loopback destinations. Its documented `startTls()` signature does not expose a server-name or certificate-hostname override. A socket connected to a literal IP therefore has no documented way, in this API, to keep the original Treasury hostname as the TLS identity while pinning the TCP destination.

Cloudflare's `resolveOverride` is also constrained: both the URL hostname and override hostname must be within the same Cloudflare zone. That does not directly solve pinning an unrelated Treasury hostname.

References:
- [Cloudflare Workers TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
- [Cloudflare fetch API — resolveOverride](https://developers.cloudflare.com/workers/runtime-apis/fetch/)

**Decision:** do not select this as the first implementation route unless Cloudflare documents and demonstrates a supported TLS server-name/certificate-hostname override for the chosen transport.

## 4. Candidate C — dedicated outbound proxy

A controlled proxy remains the clearest infrastructure boundary if native Edge Runtime sockets cannot meet the requirements. It should accept only a capability identifier and validated parameters, construct the Treasury destination internally, resolve and validate A/AAAA at connection time, pin the selected IP, preserve TLS hostname verification, reject redirects and enforce byte/time limits.

Supabase's knowledge base recommends an outbound proxy when a third party requires a stable source IP. That is a separate use case from DNS pinning, but it supports the proxy as an established topology. A dedicated VM/proxy introduces recurring infrastructure cost, patching, monitoring and operational responsibility.

Reference:
- [Supabase KB — Edge Functions and static egress IPs](https://supabase.com/kb/troubleshooting/why-supabase-edge-functions-cannot-provide-static-egress-ips-for-whitelisting)

**Decision:** fallback only. Do not provision a VM or paid proxy until the native runtime proof is complete and the expected monthly cost has been reviewed.

## 5. Required proof-of-concept tests

The CI-only proof-of-concept against a pinned Supabase Edge Runtime container and local mock TLS server has passed. Its exact scope and limitations are recorded in [Stage 9](innerme-integration-stage-9-egress-runtime-probe.md). Do not call National Treasury, production Supabase, or the inactive test project from CI.

The next test stage must demonstrate:

- The exact runtime supports DNS resolution and raw TCP connect with the permissions available to a user function.
- Mixed public/private A/AAAA answers are rejected before a socket is opened.
- IPv4 and IPv6 literals are handled correctly; IPv4-mapped IPv6 and special-use addresses are denied.
- The socket's peer address equals the validated IP that was selected.
- TLS SNI and certificate hostname verification both use the fixed Treasury hostname, even though TCP connects to the literal IP.
- A certificate for a different hostname fails verification.
- Redirects are not followed; oversized, slow, truncated, malformed and non-JSON responses fail closed.
- The client cannot influence IP, host, port, method, path or TLS settings.
- The connector fails closed on denied permission, DNS failure, connection failure and TLS failure.

A passing local Edge Runtime container test is a necessary proof, not a sufficient hosted-runtime approval. Before production, confirm the same API/permission behavior in a separately approved isolated Supabase environment.

## 6. Cost and release recommendation

| Route | Additional recurring infrastructure | Current decision |
|---|---:|---|
| Supabase Edge Runtime native pinned socket | None identified beyond the existing Supabase plan; usage still subject to current plan limits | CI prototype passed; hosted compatibility and production transport outstanding |
| Cloudflare Worker with ordinary `fetch()` | Potentially zero within the current free tier | Does not by itself prove destination pinning |
| Dedicated outbound proxy | Yes; VM/service, static IP and operations | Fallback after cost review |

The GitHub Actions prototype should use an ephemeral mock service and must not require restoring the inactive Supabase project. Do not treat GitHub CI minutes as a substitute for hosted Supabase validation.

## 7. Current release blockers

- The current gateway still does not implement connection-time DNS/IP pinning.
- The raw socket/TLS sequence passed in the pinned local Edge Runtime container, but managed Supabase hosted compatibility is still unverified.
- The exact HTTP transport over a caller-supplied pinned socket has not been selected or reviewed.
- Treasury's authoritative publication date remains unavailable in the response; `retrieved_at` must not be substituted.
- Treasury catalogue contract/counts and financial-year bounds still need live verification.
- Numeric quota ceilings remain provisional and unconfirmed for database application.
- No Supabase migration, function, egress proxy, secret, network policy, or UI/chat integration was changed in this stage.

## 8. Next implementation gate

The standalone IPv4/IPv6 destination classifier and its unit tests now exist in [Stage 10](innerme-integration-stage-10-ip-policy.md), and the gateway CI run passed. Next, integrate it into a dependency-reviewed DNS resolver and pinned-socket HTTP transport on the feature branch, retaining the existing gateway unchanged until the transport has a complete test suite. Before any hosted-environment test, review the exact Supabase runtime/API compatibility. If it cannot provide the required guarantees, stop and present the dedicated proxy's measured cost before choosing that route.
