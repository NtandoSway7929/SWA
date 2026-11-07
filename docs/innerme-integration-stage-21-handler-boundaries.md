# InnerMe Integration — Stage 21 Expanded Handler Boundary Tests

**Date:** 4 November 2026  
**Branch:** `feature/innerme-municipal-money-gateway`  
**PR:** #147  
**Status:** Passed in the pinned local Supabase Edge Runtime. No managed Supabase project or live provider was contacted.

## Objective

Extend the Stage 20 handler/Auth-client runtime proof to cover additional request validation and fail-closed quota boundaries, using the actual gateway handler and Supabase JavaScript client.

## Runtime topology

The same isolated local topology from Stage 20 is retained:
- actual gateway `index.ts` loaded in `supabase/edge-runtime:v1.77.9`;
- actual `@supabase/supabase-js@2` client;
- local mock Auth/PostgREST service;
- test-only URL and public API key;
- no credentials or requests sent to hosted Supabase or National Treasury.

The outer test proxy forwards all methods for the gateway route. The real handler is responsible for its own POST/OPTIONS method behavior.

## Verified cases

[GitHub Actions run #41826477663](https://github.com/NtandoSway7929/SWA/actions/runs/41826477663) completed successfully. The assertion output recorded 18 passing contract cases:

| Area | Verified behavior |
|---|---|
| Authentication | Missing bearer → 401; invalid session → 401; authenticated non-admin → 403 |
| Request validation | Invalid parameters, unsupported body fields, unknown capability and invalid JSON rejected before quota reservation |
| Method and CORS | Non-POST method → 405; allowed OPTIONS preflight → 204 without Auth; disallowed Origin → 403 before Auth |
| Request bounds | Oversized request with declared length → 413 before Auth; authenticated streamed 5 KB body without `Content-Length` → 413 from the streaming body reader |
| Quota denial | Denied reservation → 429 with `Retry-After` |
| Quota fail-closed | RPC error, malformed quota decision, invalid retry interval, and malformed reservation ID → 503 |
| Call ordering | Auth user lookup precedes active-admin RPC; admin RPC precedes quota reservation |
| Credential forwarding | Caller bearer token and configured public API key forwarded to Auth/RPC requests |
| Provider isolation | Zero provider calls across the test suite |

The test output recorded 12 Auth user calls, 11 admin RPC calls, five quota reservation calls, and zero provider calls. The counts are request observations from this isolated test, not production telemetry.

## Request-body limit interpretation

The gateway rejects a declared `Content-Length` over 4 KiB before authentication. When no length is declared, the streaming reader enforces the 4 KiB cap after the request has passed authentication and active-admin authorization. The streamed-body test uses a mock authenticated admin to exercise that reader. This is consistent with the handler's current ordering and does not mean unauthenticated streamed payloads are fully buffered.

## Harness corrections made during verification

- The outer test proxy initially intercepted non-POST requests and returned 404; it now forwards the gateway path regardless of method so the handler itself returns 405/204.
- The streamed-body assertion initially omitted an authenticated mock session. Because the handler authenticates before reading the body, it returned 401 without entering the body reader. The test now supplies a mock admin token and verifies the actual 413 streaming limit.
- Both corrections are test harness changes. The gateway authentication implementation was not changed for these failures.

## Limitations

- Mock Auth responses do not cryptographically validate JWT signatures, issuer, audience, expiry or claims.
- The test does not validate actual Supabase Auth, the real `is_swayphics_admin()` function, SQL grants/RLS, PostgREST exposure, or the quota migration against a managed project.
- It does not validate hosted Edge Runtime permissions, live provider access, provider rate allowances, publication-date attribution, or public IPv6 routing.

No Supabase project was restored, started, migrated, or modified. No live Treasury request was made. The quota ceilings remain provisional. PR #147 remains a draft.

## Release status

Stage 21 closes additional local handler boundary and fail-closed test gaps. Managed Supabase validation, authoritative publication-date attribution, live provider verification, quota approval and independent security review remain release gates.
