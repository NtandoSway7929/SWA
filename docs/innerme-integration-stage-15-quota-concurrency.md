# Stage 15 — Quota concurrency, UTC windows and lease recovery

**Date:** 4 November 2026  
**Branch:** `feature/innerme-municipal-money-gateway`  
**PR:** #147  
**Status:** Passed in ephemeral PostgreSQL 17 GitHub Actions CI. No Supabase project was accessed or changed.

## Result

[GitHub Actions run #41820154737](https://github.com/NtandoSway7929/SWA/actions/runs/41820154737) passed both the exact migration/RPC SQL tests and the extended concurrency/recovery script.

Six independent psql sessions with distinct test admin identities invoked the reservation RPC simultaneously:

```
Quota concurrency/recovery test passed: 3 allowed, 3 denied; UTC-aligned windows; expired leases reclaimed; 4 request reservations retained after lease release.
```

## Verified assertions

- Exactly three simultaneous reservations were admitted and three denied by the project in-flight cap.
- Exactly three active leases and project-minute reservations remained after the race.
- Admin/project minute and UTC-day window starts matched the UTC timestamp derived from each reservation, even with the PostgreSQL session timezone set to `Pacific/Auckland`.
- After all three active leases were forced to expire, a new admin reservation succeeded, demonstrating abandoned-lease cleanup.
- The recovered lease was released successfully.
- The project invocation counter remained at four after the recovered lease release. Releasing a lease does not refund a consumed request reservation.

## Verification boundary

This test uses PostgreSQL 17 in an ephemeral GitHub Actions service with minimal stubs for `auth.uid()` and `public.is_swayphics_admin()`. It verifies SQL concurrency, UTC-window computation and expiry/release behavior under the stub context. It does not verify managed Supabase Auth JWT plumbing, the actual Swayphics admin RPC, PostgREST exposure, or deployed Edge Function runtime.

The test database was disposable. No migration was applied to production or to the inactive Supabase test project. The quota ceilings remain provisional pending owner confirmation.

## Remaining quota gates

Managed Supabase JWT/RPC validation, deterministic hosted-runtime checks, and confirmation of provider request allowances remain outstanding. The integration is not production-ready.
