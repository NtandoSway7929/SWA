# InnerMe Integration — Stage 9 Edge Runtime Egress Proof

**Date:** 4 November 2026  
**PR:** #147  
**Branch:** `feature/innerme-municipal-money-gateway`  
**Status:** CI proof-of-concept passed. No provider endpoint or Supabase project was contacted.

## 1. Objective

Prove, in a pinned Supabase Edge Runtime container and using only a local mock TLS server, that an Edge Function user worker can resolve a hostname, connect to a chosen literal IP, upgrade that exact TCP connection to TLS while retaining the provider hostname as the TLS identity, and reject a certificate for a different hostname.

This is a feasibility test only. It is not the production egress transport and it does not alter the existing gateway.

## 2. Test topology

- GitHub Actions runner with Docker.
- Pinned Supabase Edge Runtime image: `supabase/edge-runtime:v1.77.9`.
- A separate Node.js TLS server on an ephemeral private Docker network.
- A short-lived test CA and a server certificate with SAN `municipaldata.treasury.gov.za`.
- The Edge Runtime user worker resolves the Docker service alias, connects using the resolved literal IP, and upgrades the same TCP connection to TLS.
- No DNS lookup, request or data access to National Treasury.
- No request to production Supabase or the inactive test project.

The private Docker address is deliberately used only to isolate the test. Production egress must reject private and other special-purpose addresses; this test does not weaken that requirement.

## 3. Result

<badge>PASS</badge> [GitHub Actions run #41813775835](https://github.com/NtandoSway7929/SWA/actions/runs/41813775835) — completed successfully on 4 November 2026.

Observed response:

```json
{
  "dnsResolution": true,
  "pinnedPeerAddress": "172.18.0.2",
  "tcpConnectedToLiteralIp": true,
  "tlsCertificateHostnameVerified": true,
  "tlsSni": "municipaldata.treasury.gov.za",
  "httpHostHeader": "municipaldata.treasury.gov.za",
  "wrongHostnameRejected": true,
  "testOnlyPrivateDestination": true
}
```

The test explicitly calls `await wrongTls.handshake()` before asserting rejection. This matters because creating a `Deno.TlsConn` does not necessarily mean the handshake has already completed.

### What this proves

1. The tested Supabase Edge Runtime image can execute `Deno.resolveDns` in the user worker.
2. The worker can call `Deno.connect` using the DNS result as a literal IP.
3. The connected peer address matched the selected IP.
4. `Deno.startTls` completed TLS against the original hostname even though TCP connected to the literal IP.
5. The mock server observed the expected TLS SNI and HTTP Host header.
6. A certificate trusted by the test CA but issued for another hostname was rejected when the TLS handshake was forced.

## 4. What it does not prove

- This is not a hosted Supabase project test. The CI container is not a guarantee of the exact permission flags, runtime build or network restrictions of every managed Supabase deployment.
- It does not call the actual Treasury hostname or prove the live certificate chain.
- It resolves only the local mock's A record. Production must resolve and validate the complete A and AAAA answer sets and fail closed on malformed, empty, mixed-public/private or special-purpose results.
- It does not implement or test the IP range deny policy.
- It does not exercise a simultaneous DNS rebinding attack or prove the selected address remains the socket peer for all production network paths.
- It does not validate redirects, response framing, chunked transfer encoding, partial reads, compression, content length, streaming limits, request deadlines, or cancellation against a live provider.
- It does not provide a reusable HTTP client over the pinned socket. The probe sends a small fixed HTTP/1.1 request and parses the mock response solely for the test.
- It does not change the existing gateway, which still uses the current fixed-host `fetch()` adapter.
- It does not solve the Treasury publication-date/attribution blocker.

## 5. API stability and compatibility

Deno's current API reference labels `Deno.connect` **unstable** and requires `allow-net`. The test proves the call is available in the selected local Supabase Edge Runtime image, not that the public Supabase hosted runtime provides a contractual compatibility guarantee.

Deno documents that `Deno.startTls` uses its hostname option for server-certificate verification, and its API exposes `handshake()` to force completion. The local test independently observed the intended SNI and a negative certificate-hostname rejection.

References:
- [Deno Network API — Deno.connect and Deno.startTls](https://docs.deno.com/api/deno/network/)
- [Deno STARTTLS example](https://docs.deno.com/examples/starttls/)
- [Supabase Edge Runtime repository](https://github.com/supabase/edge-runtime)

## 6. Decision

Keep the no-new-infrastructure route as the preferred prototype. The CI result shows that a pinned TCP socket and TLS identity preservation are technically possible in the tested Edge Runtime image. A paid proxy is not justified yet.

Do not treat this as a release approval. The next engineering gate is a separately tested, dependency-reviewed egress transport that:

- resolves both A and AAAA records;
- validates every returned address against a conservative IANA special-purpose deny policy;
- connects only to a validated literal IP;
- checks the connected peer address;
- keeps TLS chain and hostname verification enabled and confirms SNI;
- has a strict fixed-origin HTTP request model, redirect rejection and bounded parser/stream handling;
- enforces request and response deadlines, byte limits and cancellation; and
- fails closed if a required control is unsupported.

Before any hosted test, review whether the exact managed Supabase environment enables the necessary network permission and unstable API. The existing test project is inactive and must not be restored without separate cost review and explicit approval.

## 7. Release status

The egress feasibility question is partially resolved: native raw TCP and TLS with hostname verification passed in the pinned CI runtime.

The integration remains **not production-ready**. No production gateway code was switched to this mechanism, no Supabase migration was applied, no secret/configuration was changed, and no function was deployed. Treasury attribution/publication-date, live catalogue verification, hosted runtime testing, and InnerMe chat/UI integration remain outstanding.
