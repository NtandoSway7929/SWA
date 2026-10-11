# InnerMe v91 Production Release Record

**Date:** 2026-10-11  
**Project:** `Swayphics Web` (`sqifhribgsqfaxgtobsa`)  
**Function version:** `91` ACTIVE  
**Gateway JWT setting:** `verify_jwt=false`, preserved

## Source and deployment

The v91 bundle was deployed from GitHub `main` with these files:

- `supabase/functions/swayphics-ai/index.ts`
- `supabase/functions/swayphics-ai/innerme-evidence-traceability.mjs`

Supabase reports bundle SHA-256 `384a6a5a1fbf9c6efae99e9cfc8ca286a2e1c0b4291f591763ca7b07d292f43a`. After deployment, both production source files were fetched back and compared with GitHub `main`; both contents matched exactly.

## Pre-deployment verification

- Deno type-check: passed.
- Isolated test function v1: ACTIVE.
- Isolated test and production v90 GET health checks: passed.
- An unauthenticated `execute_innerme_action` POST to test and production v90 returned HTTP 401 with `Authentication is required.`.
- Phase 30 isolated database suite: 24/24 synthetic scenarios passed.

## Post-deployment acceptance checks

The GitHub Actions workflow associated with this release documentation change should pass:
1. Deno type-check.
2. Isolated test GET health check.
3. Isolated test unauthenticated-action rejection.
4. Production unauthenticated-action rejection.
5. Production GET health check.

These tests validate type correctness, endpoint availability and the early authentication guard. They do not validate an authenticated end-to-end execution or prove task creation/email delivery works.

## Data safety snapshot

Immediately after the v91 upload, production SQL checks returned:

- Action proposals: 0
- Action policy reviews: 0
- Action execution logs: 0
- Phase 30 finalization/recovery RPCs: 2 present

The isolated Phase 30 result table still contained 24 passing scenarios and no failed/unset results.

## Recovery reference

The known-good pre-promotion v90 entry point and helper were preserved at commit [`9f3dc55f360a1dda054c36d4770f32ed906b09a1`](https://github.com/NtandoSway7929/SWA/commit/9f3dc55f360a1dda054c36d4770f32ed906b09a1). Those source files were verified byte-for-byte against production v90 before promotion. Function recovery is separate from the Phase 30 SQL migrations; an Edge Function-only recovery should not reverse the database migrations.
