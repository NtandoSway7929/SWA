# InnerMe Municipal Money Gateway — Security Review

**Review date:** 4 November 2026  
**Branch:** `feature/innerme-municipal-money-gateway`  
**PR:** #147  
**Status:** Static review only. Not deployed. No production schema, secrets, or function configuration changed.

## Decision

**Keep this as an isolated draft. Do not deploy or connect it to InnerMe chat yet.**

The handler has a meaningful authentication and destination boundary, but several important release requirements remain open: shared rate limits, connection-time DNS/IP enforcement, live provider verification, publication-date attribution, and isolated runtime testing.

## 1. Authentication

The handler validates a Bearer token with Supabase Auth `getUser(accessToken)`. It then calls `is_swayphics_admin()` using a Supabase client whose global Authorization header is the same caller token. The existing SQL definition of this RPC is `SECURITY DEFINER`, checks `admin_users.user_id = auth.uid()` and `active = true`, revokes execution from `PUBLIC`, and grants it to `authenticated`.

**Assessment:** Static design is consistent with the existing Swayphics admin gate. Runtime verification remains outstanding. Do not replace the caller-context client with a service-role client.

Before deployment, explicitly add:

```toml
[functions.innerme-integration-gateway]
verify_jwt = true
```

The shared `supabase/config.toml` was intentionally not changed in this PR. Supabase documents JWT verification as enabled by default, but the explicit setting should be present in the deployed configuration.

## 2. Network / SSRF

Implemented controls:
- Compile-time HTTPS origin: `municipaldata.treasury.gov.za`.
- Fixed `incexp_v2` facts and member paths.
- Model inputs cannot supply URL, hostname, port, path, method, dataset, redirect target, or raw filter expression.
- GET only; manual redirects; 3xx rejected.
- JSON-only provider responses with timeout and byte limits.

**Residual blocker:** DNS rebinding / connection-time IP validation is not implemented. A fixed host and redirect rejection reduce model-controlled SSRF but do not prove the hostname resolves to public IPs at the moment the connection is made. A DNS lookup followed by ordinary `fetch()` would still have a time-of-check/time-of-use gap.

Before production, use a controlled outbound proxy/gateway or a documented platform network control that validates the resolved destination at connection time. Do not claim the current function is fully SSRF-proof.

## 3. Rate limiting and abuse controls

The gateway now integrates a shared quota reservation/release mechanism in the feature branch:
- Separate counters and in-flight leases in a non-exposed `innerme_private` schema.
- One fixed capability; active-admin checks are repeated in the private helpers.
- Transaction-scoped advisory locking serializes quota checks and counter updates.
- Per-admin and project-wide minute/day ceilings plus a project-wide concurrency cap.
- HTTP 429 with `Retry-After` on denial; HTTP 503 and no provider call if the quota RPC is unavailable or malformed.
- A 60-second lease is released in `finally`; the request count remains consumed after upstream failure.

The migration is not applied to either Supabase project. Its numeric ceilings are provisional internal defaults and must be confirmed by the owner before database application. The added quota contract test is static; PostgreSQL behavior, grants, RLS, concurrency and runtime failure paths remain unverified.

Supabase's nested Edge Function call budget does not govern inbound calls to this endpoint or outbound calls to third-party APIs.

## 4. Request and response validation

Implemented:
- 4 KiB request body cap enforced during streaming, with cancellation on overflow.
- 8-second timeout per provider request.
- 512 KiB provider response cap.
- Facts page size up to 100; page number up to 1,000.
- Member catalogues accept no more than 1,000 distinct values; incomplete or over-cap responses fail closed.
- Facts payload must declare the `amount` field.
- Amounts must be null or safe integers; missing, fractional, string, object, or unsafe numeric values are rejected.
- Pagination metadata is range-checked.
- Upstream exception details are not returned to the caller.

The 1,000-member ceiling is an application safety bound, not evidence every current provider catalogue fits. Verify live catalogue counts before release.

## 5. Provider terms and publication-date attribution

The response preserves provider, capability, dataset, source URL, retrieval timestamp, query, pagination, and source limitations. Provider content is marked `untrusted_external_data` and is not written to InnerMe knowledge or action state.

**Compliance blocker:** National Treasury's terms require acknowledging both the source and the date of publication. The gateway currently returns `attribution.publication_date: null`. A retrieval timestamp is not a publication date and must not be substituted for one.

Obtain a defensible publication date from authoritative provider metadata or a provider notice and include it in the response before onward use, display, publication, or distribution. Do not infer or fabricate the date. Keep the pilot internal until this is resolved.

The adapter retains original null amount values and applies the API's documented null-to-zero interpretation with a caveat. Consumers must not read a normalised zero as proof that the municipality actually reported zero economic activity.

## 6. Privacy and logging

The provider receives only municipality/year/period/amount-type/item/pagination parameters. No user prompts, customer records, email addresses, access tokens, or user IDs are sent to National Treasury. Logs record capability/provider/outcome/latency/record count or sanitised error category, not raw query or response payload.

CORS permits the two Swayphics website origins. Calls without an Origin header are still required to pass the valid JWT and active-admin check. CORS is not authentication.

## 7. Untrusted provider content

The current gateway has no model dispatch or knowledge-promotion path. Any later InnerMe chat integration must treat all provider data as quoted external evidence, not instructions, and preserve provenance and limitations. Provider content must never alter system policy, permissions, registry status, or action routing.

## 8. Verification status

- Earlier CI run [41787886223](https://github.com/NtandoSway7929/SWA/actions/runs/41787886223) passed before the latest strict monetary-record validation change.
- The branch CI workflow now includes a static quota migration contract test as well as the provider adapter tests; a fresh run is required for the latest branch state.
- Provider-free tests use injected responses; they do not call National Treasury.
- No live provider API call, deployed Edge Function test, Supabase JWT round-trip, admin-RPC runtime test, PostgreSQL migration execution, concurrency test, quota runtime/failure-path test, or DNS/egress security test has been performed.

## 9. Release checklist

- [ ] Live-check `incexp_v2` catalogue paths and response shape.
- [ ] Confirm municipality, amount-type and item catalogue counts fit the 1,000-member cap.
- [ ] Confirm financial-year and period bounds from current metadata.
- [ ] Obtain and attach the authoritative publication date.
- [ ] Confirm the provisional quota ceilings and apply the migration only to an explicitly approved isolated Supabase environment.
- [x] Run ephemeral PostgreSQL 17 authorization, RLS, concurrent last-slot, UTC window, lease expiry and idempotent-release tests. [Run #41820154737](https://github.com/NtandoSway7929/SWA/actions/runs/41820154737)
- [ ] Verify the same authorization/RPC behavior in a managed Supabase test environment using the actual Auth JWT and admin function.
- [ ] Implement connection-time DNS/IP destination enforcement.
- [ ] Add explicit `verify_jwt = true` in deployment configuration.
- [ ] Deploy only to an approved isolated Supabase environment.
- [ ] Test valid admin, non-admin, expired/missing token, origin, upstream failure, body/response bounds, and quota paths.
- [ ] Review logs for tokens, prompts, user IDs, customer data, and raw provider payloads.
- [ ] Complete independent security review and obtain explicit owner approval before production deployment or chat integration.

## Official references

- Supabase: [Securing Edge Functions](https://supabase.com/docs/guides/functions/auth)
- Supabase: [Authorization headers and verify_jwt](https://supabase.com/docs/guides/functions/auth-headers)
- Supabase: [Rate limiting Edge Functions](https://supabase.com/docs/guides/functions/examples/rate-limiting)
- Supabase: [Nested function rate limits](https://supabase.com/docs/guides/functions/recursive-functions)
- National Treasury: [Municipal Money API documentation](https://municipaldata.treasury.gov.za/docs)
- National Treasury: [Municipal Money terms](https://municipalmoney.gov.za/terms)


---

## Stage 14 update — adapter integration and focused security reassessment

**Review date:** 4 November 2026  
**Branch:** `feature/innerme-municipal-money-gateway`  
**PR:** #147  
**Nature of review:** Focused static reassessment of the current branch and CI evidence. This is not an independent third-party penetration test and is not a hosted Supabase runtime approval.

### Updated implementation assessment

The Municipal Money adapter now uses the pinned HTTP transport by default for both member-catalogue preflights and facts retrieval. The old Fetch implementation is available only when explicitly injected as a provider-free test seam.

The production-default request path now:
- resolves both A and AAAA for the fixed Treasury hostname;
- treats Deno NotFound for a single address family as an empty result for that family, while propagating other resolver failures;
- rejects empty, mixed safe/unsafe, malformed, or over-64 combined answer sets;
- connects to a literal validated address and compares the socket peer numerically;
- upgrades the same connection to TLS with the fixed Treasury hostname, default certificate verification, and HTTP/1.1 ALPN;
- emits a fixed GET to the approved facts/member route and never follows redirects;
- bounds HTTP headers/body/framing and rejects non-200 responses, invalid framing and compressed content;
- passes caller cancellation and per-request timeout through to DNS/TCP and closes an active TCP/TLS connection on cancellation; and
- keeps provider output marked as untrusted external data and outside the knowledge/action write path.

### Current CI evidence

- Gateway provider-free and contract validation [run #41819309060](https://github.com/NtandoSway7929/SWA/actions/runs/41819309060): **59/59 tests passed**, Deno type-check and `git diff --check` passed.
- Full Municipal Money adapter runtime test [run #41818534857](https://github.com/NtandoSway7929/SWA/actions/runs/41818534857): **success** in `supabase/edge-runtime:v1.77.9` against a local mock. Three catalogues and one facts request all used the pinned transport, for four A/AAAA lookups, four literal-IP connections, and four TLS connections.
- Quota migration test [run #41812361593](https://github.com/NtandoSway7929/SWA/actions/runs/41812361593): **success** in an ephemeral PostgreSQL 17 service with minimal Supabase auth/admin stubs.

### Residual production blockers

1. **No managed Supabase validation.** Local Edge Runtime CI does not prove the deployed project's Deno permission flags, runtime build, Auth/JWT claims, PostgREST RPC exposure, or actual Edge Function environment. The isolated Supabase test project remains inactive.
2. **No live Treasury verification.** The API routes, member catalogue counts, current response contract, financial-year bounds, provider request allowance, and actual certificate chain have not been verified against the live provider.
3. **Terms compliance remains blocked.** The response still has `attribution.publication_date: null`. A retrieval timestamp must not be substituted. Until a defensible publication date is sourced and attached, do not use the data for onward display, publication or distribution.
4. **Quota limits are provisional.** The SQL migration, simultaneous six-session reservation race, UTC window alignment under a non-UTC session timezone, expired-lease recovery and non-refunded request counters passed in ephemeral PostgreSQL CI [run #41820154737](https://github.com/NtandoSway7929/SWA/actions/runs/41820154737). The tests use auth/admin stubs. Hosted JWT/RPC behavior remains unverified, and the migration has not been applied to any Supabase project. The ceilings still require owner confirmation.
5. **Deployment config is not prepared.** Add explicit `verify_jwt = true` only in an approved deployment change. No shared Supabase config or secrets were changed in this PR.
6. **Address policy is manually maintained.** It is a conservative implementation snapshot of IANA special-purpose ranges, not an automatically updated registry feed. Review it before release and on a defined cadence.
7. **Managed IPv6 deployment remains unverified.** Stage 19 proves the full adapter's IPv6-only pinned TCP/TLS path in the local Edge Runtime using a ULA test address and test-only policy. A managed Supabase project and public IPv6 Treasury route are not yet tested.
8. **No chat/action integration.** The gateway is not called from `swayphics-ai`, InnerMe chat, or an Action Centre workflow. Keep provider content as untrusted evidence if and when the governance path is added.
9. **Deno API stability.** `Deno.connect` is marked unstable. The tested local Edge Runtime image supports the needed calls; hosted managed-runtime availability and long-term compatibility are not guaranteed by this CI evidence.

### Release decision

**Keep PR #147 open as a draft. Do not merge, apply its migration, deploy its function, activate the inactive Supabase test project, or wire the capability into InnerMe chat yet.** The feature-branch implementation and local CI evidence are materially stronger, but the live provider terms, managed Supabase runtime and independent security gates remain open.


---

## Stage 15 update — quota concurrency and recovery

**Date:** 4 November 2026  
**Evidence:** [GitHub Actions run #41820154737](https://github.com/NtandoSway7929/SWA/actions/runs/41820154737)

The ephemeral PostgreSQL 17 job passed the exact quota migration and an extended test using six independent psql sessions. Exactly three concurrent reservations were admitted and three denied. The test also verified all admin/project minute/day window starts against UTC while the session timezone was Pacific/Auckland; forced all three leases to expire; confirmed a subsequent reservation succeeded; released that reservation; and verified the project request counter still contained four consumed reservations.

This materially closes the prior PostgreSQL-only concurrency, UTC-window, and expiry-recovery test gaps. It does not validate the real Supabase Auth JWT/admin function, managed PostgREST exposure, or hosted Edge Function runtime because the CI database uses minimal auth/admin stubs. No Supabase project was accessed or changed.


---

## Stage 16 update — official provider contract and financial-year validation

**Review date:** 4 November 2026  
**Sources:** National Treasury API documentation, Income and Expenditure (v2) page, and Municipal Money terms of use. See [Stage 16 provider contract review](innerme-integration-stage-16-provider-contract-review.md).

The public API documentation describes `incexp_v2` as Section 71-level mSCOA income-and-expenditure data from FY 2019–20 onwards. It defines `financial_year_end.year` as the calendar year at the end of the financial year and documents amount type, period, item and municipality dimensions. The API documentation describes GET requests, HTTP 200/JSON success, pagination, integer ZAR values and null/zero semantics.

The adapter previously allowed years up to 2035. It now caps the upper bound at the current UTC calendar year, retaining 2020 as the lower year-end boundary based on the documented v2 start. This prevents obvious future-year requests but does not prove data exists for every year in the range. The public v2 table page shows earlier year choices in its selector; the exact available years must be checked against the live v2 API before release.

The current official page reports 2026 Q2 data and says it is still undergoing completeness/integrity verification. The API docs explain a model `last_updated` field as a partial date for the latest update. Neither the site banner nor `last_updated` has been established as the exact publication date required by the terms. `attribution.publication_date` remains null; this is still a release blocker.

The public documentation reviewed does not identify a numeric provider request limit or current live catalogue cardinalities. Those require provider confirmation or approved live metadata checks.

Latest gateway validation [run #41820778732](https://github.com/NtandoSway7929/SWA/actions/runs/41820778732) passed **60/60 tests**, type-check and `git diff --check`. The full adapter mock in the pinned local Edge Runtime also passed [run #41820772769](https://github.com/NtandoSway7929/SWA/actions/runs/41820772769). No live provider request or managed Supabase project test was performed.


## Stage 17 update — hosted TCP capability documentation

Supabase's current documentation for Edge Functions states that Edge Functions use Deno and have native TCP connection support. Its serverless-driver guidance specifically states that Edge Functions use Deno's native TCP support. This reduces the platform-level concern that TCP sockets are categorically unavailable in Edge Functions.

The Deno API reference still marks `Deno.connect` as unstable and states that it requires `allow-net`. The pinned local Edge Runtime v1.77.9 test proves the exact transport path works in that container, but does not prove the hosted project's permission policy, deployed runtime build, or specific `Deno.connect`/ `Deno.startTls` support. The hosted-runtime verification gate therefore remains open.

References:
- Supabase Edge Functions overview: https://supabase.com/docs/guides/functions
- Supabase serverless-driver guidance: https://supabase.com/docs/guides/database/connecting-to-postgres/serverless-drivers
- Deno Network API: https://docs.deno.com/api/deno/network/


---

## Stage 18 update — IANA address-policy audit

The current IPv4 and IPv6 deny lists were compared against the IANA IPv4/IPv6 Special-Purpose Address Registries and IPv6 Global Unicast Address Assignments. The source registry pages report updates on 2025-10-09 (special-purpose registries) and 2025-10-10 (IPv6 GUA assignments).

The policy blocks all registered special-purpose prefixes reviewed, either directly, through a containing denied prefix, or because they fall outside the IPv6 `2000::/3` candidate range. It intentionally denies the whole IPv4 `192.0.0.0/24` and IPv6 `2001::/23` parents, including more-specific globally reachable anycast exceptions. The tests explicitly assert those exceptions remain blocked.

**Important qualification:** IANA states that special-purpose prefixes are not guaranteed routability in any local/global context. Its IPv6 GUA registry also says unlisted space inside `2000::/3` is reserved for future allocation. Consequently, the current policy's “allowed” result means “inside a broad GUA candidate range and not in the maintained deny list”; it does not prove current allocation or BGP routability. A registry-driven positive allowlist would be a separate future design.

Final PR-head regression CI [run #41822104085](https://github.com/NtandoSway7929/SWA/actions/runs/41822104085) passed 60/60 tests, Deno type-check and diff check. The full adapter mock also passed [run #41822064879](https://github.com/NtandoSway7929/SWA/actions/runs/41822064879). See [Stage 18 IANA address-policy audit](innerme-integration-stage-18-iana-address-policy-audit.md).

The lists are manually maintained and need a defined review cadence. The complete local Edge Runtime mock exercises IPv4 sockets; IPv6 parsing/policy/peer comparison are unit-tested, but an end-to-end IPv6 socket route has not been proven.


---

## Stage 19 update — full adapter over IPv6

The previous residual concern that the local Edge Runtime had only exercised IPv4 sockets is closed. The dual-stack mock now runs the full Municipal Money adapter once using IPv4 and again with A deliberately empty so the same pinned transport must use IPv6.

[GitHub Actions run #41822450213](https://github.com/NtandoSway7929/SWA/actions/runs/41822450213) passed. In the IPv6-only pass, three member catalogue lookups and one facts request used four A queries (empty), four AAAA queries, four literal-IP connections to `fd00:dead:beef::2`, and four TLS sessions. Peer matching succeeded, and the mock observed the expected Treasury SNI and Host header. The adapter normalized the mock amount and preserved its source value.

This used a Docker ULA and a test-only address-policy override. It proves the local pinned Edge Runtime IPv6 socket path, not a publicly routed IPv6 destination or a managed Supabase deployment. The managed platform permission/runtime gate remains open.
