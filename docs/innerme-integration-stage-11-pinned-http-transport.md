# InnerMe Integration — Stage 11 Pinned HTTP Transport

**Date:** 4 November 2026  
**Branch:** `feature/innerme-municipal-money-gateway`  
**PR:** #147  
**Status:** Standalone transport prototype with provider-free tests. Not yet used by the existing Municipal Money adapter.

## Objective

Build a small HTTP/1.1 client that sends Municipal Money requests over a prevalidated literal-IP TCP connection while preserving TLS identity for the fixed Treasury hostname. This transport deliberately avoids ordinary hostname-resolving `fetch()`.

Files:
- `supabase/functions/innerme-integration-gateway/pinned-http.mjs`
- `supabase/functions/innerme-integration-gateway/pinned-http.test.mjs`
- Address classification: `egress-policy.mjs`
- Address policy tests: `egress-policy.test.mjs`

## Destination and request restrictions

Only the fixed origin `https://municipaldata.treasury.gov.za`, the `incexp_v2/facts` route, and the approved `demarcation`, `amount_type`, and `item` member routes are accepted. Method is always GET. Facts-cut syntax, page/page-size bounds, JSON format, URL scheme, credentials, fragments, repeated/unknown query parameters, and path are validated before DNS or socket creation.

The model/request cannot provide a hostname, port, raw URL, method, transport option, or arbitrary route.

## Connection sequence

1. Resolve both A and AAAA for the fixed Treasury hostname.
2. Validate the complete result set. Empty, malformed, over-64, mixed-safe/unsafe, or prohibited answer sets fail closed.
3. Select one validated literal IP and connect TCP to that literal IP on port 443.
4. Compare the connected peer address numerically with the selected DNS answer.
5. Upgrade the same socket to TLS using the fixed Treasury hostname, default certificate verification, and HTTP/1.1 ALPN.
6. Explicitly complete the handshake.
7. Send a fixed GET with the fixed Host header, JSON Accept header, identity encoding and connection-close directive.
8. Parse a bounded HTTP response. No redirect is followed.

## HTTP response limits

| Control | Bound |
|---|---:|
| Default request timeout | 8 seconds |
| Maximum configurable timeout | 30 seconds |
| Body | 512 KiB |
| Headers | 16 KiB |
| Header count | 64 |
| Wire framing allowance | 64 KiB above header/body caps |
| Content encoding | Identity only |
| Accepted status | HTTP 200 only |

The parser supports strict HTTP/1.0 or HTTP/1.1 response status lines and bounded content-length, chunked or close-delimited bodies. It rejects malformed/truncated framing, duplicate headers, content-length/transfer-encoding conflicts, unsupported transfer encodings, prohibited trailers, compressed content, oversized bodies/headers, every 3xx status including 304, and all non-200 statuses.

The returned body remains bytes. The provider adapter must check JSON content type, decode UTF-8 strictly, parse JSON and validate provider fields and data semantics.

## Timeout and lifecycle

A request-level timer aborts DNS/connect signals, closes the active connection where possible, and rejects the operation. A finalizer closes the connection on success and failure. Deno documents abort signals for DNS and TCP connection establishment; `Deno.startTls` consumes the original TCP connection and has no separate signal argument. Local tests cover the stalled response-read timeout and cleanup path. A live provider TLS timeout and managed Supabase cancellation behavior remain unverified.

## Verification

The gateway workflow runs:

```sh
node --test supabase/functions/innerme-integration-gateway/*.test.mjs
```

[Latest successful gateway validation — run #41817411747](https://github.com/NtandoSway7929/SWA/actions/runs/41817411747)

- **54 tests passed, 0 failed**
- Deno Edge Function type-check passed
- `git diff --check` passed

Coverage includes IPv4/IPv6 classification, answer-set bounds, mixed public/private refusal, peer mismatch, fixed URL/path/query validation, ALPN rejection, redirect and status rejection, HTTP framing, malformed/truncated responses, duplicate/conflicting headers, compression rejection, body/header limits, partial writes and timeout.

## Integration boundary

The Municipal Money adapter now uses this transport by default for both member-catalogue and facts requests. The adapter retains an explicitly injected Fetch implementation as a provider-free test seam; it is not the production default. See [Stage 13 adapter integration](innerme-integration-stage-13-adapter-integration.md) for the wiring and full-flow test.

No live Treasury request or managed Supabase project test has been performed.

## Remaining release review

Before release:
- complete the independent security review;
- verify provider response/catalogue compatibility;
- test IPv4 and IPv6 socket paths;
- verify resolver no-answer and error behavior for both A and AAAA;
- test timeout/cleanup during stalled DNS, TCP, TLS, headers and body; and
- keep Treasury publication-date attribution blocked until authoritative metadata exists.

The integration remains not production-ready.
