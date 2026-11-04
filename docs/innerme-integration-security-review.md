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
- [ ] Run PostgreSQL authorization, RLS, concurrent last-slot, UTC boundary, lease expiry and idempotent-release tests.
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
4. **Quota limits are provisional.** The SQL migration has executed in ephemeral PostgreSQL CI, but it has not been applied to any Supabase project. The ceilings require owner confirmation; simultaneous multi-session last-slot race and hosted JWT/RPC behavior remain to be tested.
5. **Deployment config is not prepared.** Add explicit `verify_jwt = true` only in an approved deployment change. No shared Supabase config or secrets were changed in this PR.
6. **Address policy is manually maintained.** It is a conservative implementation snapshot of IANA special-purpose ranges, not an automatically updated registry feed. Review it before release and on a defined cadence.
7. **IPv6 socket route remains unproven end-to-end.** IPv6 parsing/peer comparison is unit-tested; the full Edge Runtime mock exercises IPv4 only.
8. **No chat/action integration.** The gateway is not called from `swayphics-ai`, InnerMe chat, or an Action Centre workflow. Keep provider content as untrusted evidence if and when the governance path is added.
9. **Deno API stability.** `Deno.connect` is marked unstable. The tested local Edge Runtime image supports the needed calls; hosted managed-runtime availability and long-term compatibility are not guaranteed by this CI evidence.

### Release decision

**Keep PR #147 open as a draft. Do not merge, apply its migration, deploy its function, activate the inactive Supabase test project, or wire the capability into InnerMe chat yet.** The feature-branch implementation and local CI evidence are materially stronger, but the live provider terms, managed Supabase runtime and independent security gates remain open.
