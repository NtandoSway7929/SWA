# InnerMe Integration — Stage 13 Municipal Money Adapter Integration

**Date:** 4 November 2026  
**Branch:** feature/innerme-municipal-money-gateway  
**PR:** #147  
**Status:** Adapter now uses the pinned transport by default on the feature branch. Full adapter flow passed in the pinned local Supabase Edge Runtime container. No live provider or Supabase project was contacted.

## 1. What changed

supabase/functions/innerme-integration-gateway/municipal-money.mjs now imports requestPinnedMunicipalMoney and routes both:
- the municipality, amount-type and item catalogue lookups; and
- the incexp_v2/facts request

through a shared adapter fetch wrapper whose production default is the pinned transport.

The adapter continues to validate provider status, JSON content type, response size, catalogue completeness, requested member membership, amount fields, pagination, and provenance after the transport returns bytes/headers/status.

### Test seams

The existing fetchImpl option is still available as an explicit provider-free test seam. It is selected only when injected by tests. The default path does not call Fetch for outbound provider traffic.

The full-runtime test injects the real pinned transport with a local runtime and test-only address policy, so it exercises the same transport implementation while directing DNS to the local mock. These injection options are internal JavaScript options and are not derived from request/model input.

## 2. End-to-end test topology

- CI-only Docker network.
- Pinned supabase/edge-runtime:v1.77.9.
- Local mock TLS server on port 443.
- Short-lived test CA and certificate with SAN municipaldata.treasury.gov.za.
- Actual adapter module, pinned HTTP module and IPv4/IPv6 policy staged into a read-only worker bundle.
- Test DNS resolver checks that all queries are for the fixed Treasury hostname, then maps them to the mock service alias.
- The mock has an A record only. A missing AAAA record returns Deno's NotFound error, which the resolver adapter normalizes to an empty array for that address family. The combined A+AAAA result is still passed through the address policy and must contain at least one allowed address.
- Test-only address policy allows exactly the resolved private Docker mock IP. Production does not use this override and rejects private/special-purpose addresses.

Nothing in the worker accepts a caller-provided URL, hostname, IP, method or port.

## 3. Verified full adapter flow

[PASS] [GitHub Actions run #41818534857](https://github.com/NtandoSway7929/SWA/actions/runs/41818534857).

Observed result:

    {
      "status": "ok",
      "memberCataloguesValidated": 3,
      "factsRequests": 1,
      "dnsAQueries": 4,
      "dnsAAAAQueries": 4,
      "literalIpConnections": 4,
      "tlsConnections": 4,
      "connectedToMockIp": "172.18.0.2",
      "tlsSniObservedByServer": "municipaldata.treasury.gov.za",
      "httpHostObservedByServer": "municipaldata.treasury.gov.za",
      "factsPathRestricted": true,
      "identityEncodingRequested": true,
      "normalizedAmount": 1250,
      "providerSourceAmountPreserved": true,
      "testOnlyPrivateDestination": true
    }

That is four requests through the same pinned transport: three member catalogue preflights followed by one facts query. All four opened literal-IP TCP connections, passed peer matching and completed TLS to the fixed hostname. The mock facts result was normalized by the real adapter, and its original amount remained preserved.

The transport runtime also passed the expected Deno NotFound handling for a missing mock AAAA record. It converts only that specific no-record error to an empty family result. Other resolver errors still propagate and fail closed.

The Edge Function now forwards its request-abort signal to the adapter. The adapter combines that with each provider request's timeout, and the transport aborts DNS/TCP work and closes an active socket when either signal fires.

The provider-free gateway suite passed [run #41818526598](https://github.com/NtandoSway7929/SWA/actions/runs/41818526598): **56/56 tests passed**, Deno Edge Function type-check passed, and git diff --check passed. Subsequent cancellation hardening passed [run #41819309060](https://github.com/NtandoSway7929/SWA/actions/runs/41819309060): **59/59 tests passed**, type-check and git diff checks passed. The added tests cover an already-aborted caller signal and closing an active pinned socket during cancellation.

## 4. What this does not establish

- No request was sent to municipaldata.treasury.gov.za; all provider responses came from the local mock.
- The Docker private IP was allowed by a test-only policy override. Production uses the real address policy and must reject that IP.
- It does not establish the real provider's current catalogue completeness, financial-year availability, facts response framing, certificate chain, rate limit or publication date.
- It is not a managed Supabase project test. It does not establish deployed Edge Function permissions, current hosted runtime version, the actual Supabase JWT context, or PostgREST/RPC behavior.
- It does not replace a separate security review of DNS rebinding, cancellation during stalled DNS/TLS, IPv6 socket routing, parser edge cases and the adapter's error handling.
- The Municipal Money result still sets attribution.publication_date to null. The retrieval timestamp is not a publication date, so the Treasury terms blocker remains.

## 5. Current release boundary

- The adapter's production-default code path on the feature branch now uses pinned TCP/TLS/HTTP rather than hostname-resolving Fetch.
- The gateway still remains an isolated proposal branch and PR #147 remains draft.
- The quota migration is a feature-branch file only; it has not been applied to any Supabase project.
- No Supabase function was deployed, no config/secret/network restriction changed, and the inactive test project was not restored.
- The capability is not yet connected to swayphics-ai or the InnerMe UI/action system.


## 7. Provider-documented contract and year bounds

A subsequent public-documentation review is recorded in [Stage 16](innerme-integration-stage-16-provider-contract-review.md).

The official API docs describe incexp_v2 as Section 71-level mSCOA income-and-expenditure data from FY 2019–20 onwards and define financial_year_end.year as the calendar year at the end of the financial year. The adapter's lower bound remains 2020; its earlier arbitrary upper bound of 2035 has been removed. The upper bound now follows the current UTC calendar year to reject obvious future-year requests.

This does not prove the API contains data for every year in that range. Current v2 year availability and the public site's year selector need query-level verification. Latest official page banner describes 2026 Q2 data still undergoing completeness/integrity verification; it is not the publication date required by the terms.

The current tests passed [run #41820778732](https://github.com/NtandoSway7929/SWA/actions/runs/41820778732): 60/60 provider-free tests, Edge Function type-check and diff check. The full adapter mock passed [run #41820772769](https://github.com/NtandoSway7929/SWA/actions/runs/41820772769). No live API request was made.

## 8. Dual-stack runtime proof

Stage 19 adds a second complete adapter pass on a dual-stack Docker network with the A response deliberately empty, forcing four literal IPv6 TCP connections and TLS sessions across three catalogue preflights plus facts retrieval. The mock observed the fixed Treasury SNI/Host and the adapter normalized/preserved the facts amount. See [Stage 19 dual-stack runtime verification](innerme-integration-stage-19-dual-stack-runtime.md) and [CI run #41822450213](https://github.com/NtandoSway7929/SWA/actions/runs/41822450213). This is local CI with a ULA test IP and a test-only allow policy, not live public IPv6 or managed Supabase.

## 9. Next gates

1. Independent security review of the adapter, transport, resolver normalization, quota reservation/release ordering, and all error paths.
2. Runtime tests for empty combined DNS answers, mixed public/private and over-64 answers, invalid peer address, redirect, non-200, malformed/oversized response, and timeout/cancellation.
3. Verify real Treasury catalogue routes, financial-year bounds, response schema, attribution and publication date before any provider-facing use.
4. Separately approve and cost-review the inactive Supabase test project before any managed runtime/database test.
5. Only after these gates, connect the capability to InnerMe chat through the existing governance/action boundary and undertake a separate owner acceptance audit.

The integration remains not production-ready.
