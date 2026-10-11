# swayphics-ai Edge Function

**Production status (2026-10-11):** Supabase reports `swayphics-ai` version **91** as ACTIVE. The checked-in `index.ts` and `innerme-evidence-traceability.mjs` were fetched back from production after deployment and both matched the source on GitHub `main` exactly.

## Source provenance

- Function: `swayphics-ai`
- Production project ref: `sqifhribgsqfaxgtobsa`
- Current production version: `91`
- Current bundle SHA-256 reported by Supabase: `384a6a5a1fbf9c6efae99e9cfc8ca286a2e1c0b4291f591763ca7b07d292f43a`
- Previous production version: `90`
- Previous bundle SHA-256: `852e470ccec1e2b1eb47eac05f268f40124b5b269c6ff097c8a4664965bcc2cd`
- Known-good v90 source commit: [`9f3dc55f360a1dda054c36d4770f32ed906b09a1`](https://github.com/NtandoSway7929/SWA/commit/9f3dc55f360a1dda054c36d4770f32ed906b09a1)

## Validation record

**Post-deployment verification:** GitHub Actions run 11 passed after production v91 was activated. The checks covered Deno type-check, isolated test GET health, isolated test unauthenticated-action rejection, production unauthenticated-action rejection, and production GET health.

- Deno type-check: passed before v91 deployment.
- Isolated test project function v1: ACTIVE.
- Test and production GET health checks: passed before v91 deployment.
- Unauthenticated controlled-action requests against test and production v90 were rejected with HTTP 401 and `Authentication is required.`.
- Phase 30 database suite: 24/24 synthetic scenarios passed.
- Post-v91 GitHub Actions run 11 passed Deno type-check, both health checks, and both authentication-boundary checks against the current deployments.

## Runtime and gateway notes

The production gateway remains configured with `verify_jwt=false`; the function performs its own bearer-token validation and Swayphics-admin authorization checks. Preserve this setting unless the authentication design is intentionally changed and tested.

A health GET and a rejected unauthenticated POST do not prove a valid authenticated request can complete the full action workflow. No real task or email was used in these tests. Keep credentials in Supabase Edge Function secrets, not in source files or commits.

## Recovery reference

The known-good v90 source files are preserved in the linked GitHub commit above. A function rollback is separate from the Phase 30 database migrations; do not reverse database migrations as part of an Edge Function-only recovery.
