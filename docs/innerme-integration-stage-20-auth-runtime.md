# InnerMe Integration — Stage 20 Local Edge Runtime Auth/Quota Contract Test

**Date:** 4 November 2026  
**Branch:** `feature/innerme-municipal-money-gateway`  
**PR:** #147  
**Status:** Passed in the pinned local Supabase Edge Runtime. No hosted Supabase project or live provider was contacted.

## Objective

Exercise the actual `supabase/functions/innerme-integration-gateway/index.ts` handler, rather than only its isolated helper modules, and verify its interaction with the Supabase JavaScript client under controlled Auth and PostgREST responses.

## Test topology

- Pinned runtime: `supabase/edge-runtime:v1.77.9`.
- The real gateway handler is loaded as an Edge Runtime User Worker.
- The handler imports the actual `@supabase/supabase-js@2` client.
- Test-only `SUPABASE_URL` and public API key are passed into the worker as key/value tuples.
- A separate local Node mock implements only the Auth user endpoint and the three required RPC routes: `is_swayphics_admin`, `innerme_reserve_integration_quota`, and `innerme_release_integration_quota`.
- The mock records the Authorization bearer token and `apikey` header on each request. It does not make external calls.

## Cases and result

The workflow passed all seven assertions:

| Case | Expected result | Observed |
|---|---:|---:|
| Missing bearer token | 401 | Pass |
| Invalid session response | 401 | Pass |
| Authenticated non-admin | 403 | Pass |
| Invalid municipality code | 400 before quota reservation | Pass |
| Quota denial | 429 and `Retry-After: 17` | Pass |
| Quota RPC backend error | 503 fail-closed | Pass |
| Disallowed Origin | 403 before authentication | Pass |

The assertion output also recorded five Auth user calls, four admin RPC calls, two quota reservation calls, caller bearer-token forwarding, public API-key forwarding, and **zero provider calls**.

## CI evidence

[GitHub Actions run #41825641021](https://github.com/NtandoSway7929/SWA/actions/runs/41825641021) completed successfully. The Edge Runtime health check, handler contract assertions, and cleanup steps all passed.

The initial run [#41823872708](https://github.com/NtandoSway7929/SWA/actions/runs/41823872708) failed before the handler was invoked because `envVars` was supplied as a string array rather than the Edge Runtime's required key/value tuple array. The harness was corrected and the follow-up run passed. This was a test-harness configuration defect, not a gateway authentication code defect.

## What this proves

- The actual Edge Function handler can run in the pinned local Edge Runtime.
- Its actual Supabase JS client makes Auth and RPC requests to the configured Supabase URL.
- The caller bearer token and configured public API key are forwarded to Auth and PostgREST RPC requests.
- The handler rejects missing/invalid sessions and non-admin responses before the quota/provider path.
- Parameter validation occurs before quota reservation.
- Quota denial and backend errors fail closed.
- Disallowed origins are rejected before any Auth request.
- No provider request is made during these cases.

## What this does not prove

- The mock does not cryptographically validate JWT signatures, issuer, audience, expiry, or claims. It intentionally returns controlled Auth responses for test tokens.
- It does not validate the real Supabase project's `is_swayphics_admin()` implementation, JWT roles, SQL grants, RLS behavior, PostgREST schema exposure, or the real quota migration against Supabase Auth.
- It does not prove hosted Edge Runtime permission flags, runtime build, TCP/TLS egress, project-specific configuration, or cancellation semantics.
- It does not replace validation in an explicitly approved managed Supabase test project.

No Supabase project was restored, started, migrated or modified. No Treasury endpoint was contacted. The provisional quota ceilings remain unapproved. PR #147 remains a draft.

## Release status

This stage closes the local handler/Auth-client contract test gap only. Managed Supabase validation and the separate provider terms/data verification blockers remain open.
