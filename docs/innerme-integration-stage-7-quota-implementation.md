# InnerMe Integration Quota — Stage 7 Implementation

**Date:** 4 November 2026  
**Branch:** `feature/innerme-municipal-money-gateway`  
**PR:** #147  
**Status:** Implemented in the feature branch only. Migration not applied to any Supabase project.

## 1. Owner-approved scope

The owner approved creation of a separate integration quota store and authenticated reservation RPC on the feature branch. This does not authorize applying the migration, restoring the inactive test project, deploying the Edge Function, or connecting the capability to InnerMe chat.

The implementation is isolated from the Gemini/Cloudflare inference quota tables and RPC.

## 2. Migration contents

Migration:

`supabase/migrations/20261104110000_innerme_integration_quota.sql`

Creates a non-exposed `innerme_private` schema containing:

- `innerme_integration_quota_windows`: minute and UTC-day counters keyed by admin/project scope, capability and window start.
- `innerme_integration_quota_leases`: short-lived, server-generated in-flight reservation IDs, scoped to an admin and capability.

Both tables have RLS enabled. Direct table privileges are revoked from `PUBLIC`, `anon`, `authenticated` and `service_role`. The private schema grants authenticated users only the schema usage required to invoke its narrowly scoped helper functions; it does not grant table access.

The public API surface is limited to two `SECURITY INVOKER` RPCs:

- `innerme_reserve_integration_quota(p_capability)`
- `innerme_release_integration_quota(p_reservation_id, p_capability)`

Both require `auth.uid()` and an active `public.is_swayphics_admin()` result. Private helpers use `SECURITY DEFINER` only in the non-exposed schema, with an empty search path and repeated identity/admin checks. No service-role key is involved.

## 3. Atomicity and limits

A transaction-scoped advisory lock serializes reservation decisions for the fixed capability. Under that lock, the function checks concurrency and all four counters, then increments the counters and creates the lease in the same transaction. This avoids concurrent callers passing the same last available slot.

The migration currently stages these **provisional internal safety ceilings**. One quota unit currently represents one inbound Gateway invocation, not each outbound HTTP request. A cold invocation can make up to four Treasury GETs (catalogue lookups plus the facts request). These ceilings therefore do not establish compliance with any provider request allowance; verify Treasury's current limits and add outbound-call budgeting before release:

| Scope | Window | Ceiling |
|---|---:|---:|
| One admin | Per minute | 3 |
| Whole Supabase project | Per minute | 15 |
| One admin | Per UTC day | 30 |
| Whole Supabase project | Per UTC day | 100 |
| Whole Supabase project | Concurrent requests | 3 |

These are not National Treasury limits. The owner approved the quota mechanism, but these numeric defaults still require explicit confirmation before the migration is applied to a test or production database. A stricter provider-published limit takes precedence.

Lease duration is 60 seconds. Successful release marks the lease as released but never decrements a request counter. Expired leases are pruned during later reservation attempts so a terminated Edge Function cannot occupy a concurrency slot permanently.

## 4. Gateway integration

The Edge Function now:

1. Authenticates the caller and checks active-admin status using the caller JWT.
2. Validates the capability and pure request parameter shape before consuming a quota slot.
3. Calls `innerme_reserve_integration_quota` using the same caller JWT.
4. Returns HTTP 429 with a bounded `Retry-After` header when the reservation is denied.
5. Fails closed with HTTP 503 if the quota RPC errors or returns an invalid response. No provider request is made in that case.
6. Calls the provider adapter only after a successful reservation.
7. Calls `innerme_release_integration_quota` in a `finally` path. Release failures are logged only as a sanitized error category; the 60-second lease expiry is the recovery path.

Provider metadata lookups and the facts request share one invocation reservation, including cache misses. The request reservation remains consumed for provider errors and timeouts.

## 5. Verification

Added `quota-contract.test.mjs`, a static contract test covering:

- private schema/table/RLS and direct privilege boundaries;
- fixed capability and active-admin checks;
- transaction lock and atomic counter updates;
- UTC windows and provisional ceilings;
- public invoker RPC grants;
- private helper security posture;
- idempotent lease release and non-decrementing request counts.

The CI workflows run the adapter tests and quota contract tests, alongside the Edge Function Deno type-check and whitespace check. A separate PostgreSQL 17 service job executes the exact migration and an SQL integration test in an ephemeral GitHub Actions database. The SQL test creates minimal `auth.uid()` and `public.is_swayphics_admin()` stubs, then exercises the real migration's schema/grant boundaries, non-admin rejection, three-request admin ceiling, project concurrency ceiling, owner-scoped lease release, idempotent release, and non-refunded request counters.

**PostgreSQL execution result (4 November 2026):** [GitHub Actions run #41812361593](https://github.com/NtandoSway7929/SWA/actions/runs/41812361593) completed successfully. The exact migration executed on PostgreSQL 17, and all SQL integration assertions passed for schema/grant boundaries, non-admin rejection, the admin minute ceiling, project in-flight ceiling, owner-scoped lease release, idempotent release, and non-refunded request counters.

**Verification boundary:** PostgreSQL CI jobs use minimal auth stubs. They do not validate managed Supabase Auth JWT claim plumbing, the hosted `is_swayphics_admin()` implementation, PostgREST exposure settings, or hosted Edge Function runtime. A simultaneous six-session race, UTC-window verification under a non-UTC session timezone, and lease-expiry recovery have since passed in [Stage 15](innerme-integration-stage-15-quota-concurrency.md). No migration has been applied to any Supabase project.

## 6. Remaining release blockers

- Confirm the five provisional quota ceilings before any database application.
- Apply and test the migration only in an explicitly approved isolated Supabase environment; the existing test project is inactive and has not been restored.
- PostgreSQL 17 CI has now passed the exact migration, six-session concurrency race, non-UTC session timezone checks and expired-lease recovery; see Stage 15. Managed Supabase JWT/RPC behavior and hosted Edge Function integration remain outstanding.
- Connection-time DNS/IP enforcement is now implemented in the pinned transport and wired into the adapter on this feature branch. The full adapter passed in the pinned local Edge Runtime image against a mock. Managed Supabase runtime permissions and IPv6 socket routing remain unverified; see Stages 12–14.
- Obtain the authoritative National Treasury publication date; `retrieved_at` is not a substitute.
- Verify live provider catalogue contracts/counts and exact available financial years. Public documentation now confirms the v2 dataset scope and field semantics; live catalogue cardinalities remain unverified.
- Add explicit `verify_jwt = true` in the deployment configuration when deployment is separately approved.
- Complete a runtime test with valid admin, non-admin, expired token, quota denial, provider failure and quota-service failure.

## 7. Change boundary

This stage changes only the feature branch. It does not:

- apply the migration to production or the inactive test project;
- activate or restore any Supabase project;
- change `supabase/config.toml`, secrets, network policies or provider credentials;
- deploy an Edge Function or egress service;
- change InnerMe UI, chat routing, knowledge or action state;
- merge PR #147 or PR #146.
