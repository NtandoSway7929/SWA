# InnerMe Integration Gateway — Stage 6 Infrastructure Design

**Date:** 4 November 2026  
**Scope:** Shared invocation quotas and controlled outbound networking  
**Target:** Municipal Money pilot / PR #147  
**Status:** Design only. No database schema, credentials, project state, network policy, or deployment changed.

## 1. Decision summary

Stage 6 should not be implemented by adding an in-memory rate counter or by treating a hostname allowlist as complete SSRF protection.

Recommended path:

1. Use the existing Swayphics Postgres database for a dedicated, atomic integration quota mechanism, subject to a separately approved migration.
2. Put outbound HTTP behind a narrow egress gateway that validates DNS answers and pins the connection to a vetted public IP while preserving TLS hostname verification.
3. Keep the current Edge Function disabled and isolated until both controls can be tested in the inactive test project or another explicitly approved environment.

This design deliberately separates external-data integration budgets from InnerMe's Gemini/Cloudflare inference budgets.

## 2. Existing quota infrastructure inspected

The live Swayphics project currently has:
- `public.innerme_provider_quota_daily`, with a provider constraint that permits only `cloudflare` and `gemini`;
- `public.innerme_reserve_provider_quota(text, text, integer)`, which reserves a daily model-provider request;
- the reservation RPC is executable by `service_role`, not by `authenticated`;
- `public.innerme_provider_usage` for model-provider attempt telemetry.

These controls protect AI inference spending. They should not be repurposed for Municipal Money because the provider allowlist, reservation semantics, keying, and permission model are different.

Reference implementation:
- `supabase/migrations/20261012163000_innerme_zero_cost_provider_guard.sql`
- `supabase/migrations/20261016034000_innerme_zero_cost_quota_exhaustion_fix.sql`

## 3. Proposed shared quota

### 3.1 Storage and permission model

Add a dedicated, non-exposed schema for integration quota data, for example `innerme_private`.

Proposed logical records:

**Quota window counters**
- `scope_type`: `admin` or `project`
- `scope_id`: authenticated admin UUID for admin scope; fixed project key for project scope
- `capability`: stable capability key
- `window_type`: `minute` or `utc_day`
- `window_start`: UTC window boundary
- `reserved_count`
- `updated_at`

Unique key: `(scope_type, scope_id, capability, window_type, window_start)`.

**In-flight reservations**
- `request_id`: server-generated UUID
- `admin_user_id`
- `capability`
- `reserved_at`
- `lease_expires_at`

An in-flight lease prevents an authenticated caller from starting unbounded parallel provider calls. Leases expire automatically for recovery from isolate termination; completed requests explicitly release the lease. The request reservation itself remains counted after release, including failed upstream attempts, so callers cannot evade quota by inducing provider errors.

### 3.2 Reservation RPC

Expose one narrowly scoped RPC in the API-exposed schema. It must:
- require non-null `auth.uid()`;
- call `public.is_swayphics_admin()` using the caller's JWT context;
- accept only the known Municipal Money capability;
- calculate UTC windows in the database, not from a caller-supplied clock;
- reserve per-admin and project-wide minute/day budgets in a single transaction;
- enforce a project-wide in-flight ceiling;
- return `allowed`, `reason`, `retry_after_seconds`, and a server-generated reservation ID;
- fail closed if the database quota service is unavailable;
- expose no raw counter-table reads or writes to browser clients.

Use atomic database statements and transaction-level locking so concurrent requests cannot pass the same remaining slot. All related counters and the in-flight lease must succeed or fail as one reservation. Release must be idempotent and scoped to the reservation ID plus the same admin/capability.

The database function should run as `SECURITY INVOKER` where feasible. If a privileged helper is technically unavoidable, place it in the non-exposed schema, explicitly check `auth.uid()` and active-admin status, pin `search_path`, and grant execution only to the exact required role. Do not make a new general-purpose `SECURITY DEFINER` endpoint in `public`.

### 3.3 Edge Function sequence

1. Validate method, origin, bounded body and JWT.
2. Validate the user with Auth and verify active-admin status.
3. Validate the named capability and strict parameters.
4. Call the quota reservation RPC with the caller's JWT.
5. If rejected, return HTTP 429 with a bounded `Retry-After`; do not call the provider.
6. Make provider requests through the controlled egress gateway.
7. Release the in-flight lease in a `finally` path, without decrementing the consumed rate counters.
8. Log capability, result category, latency, response size and quota outcome only. Never log tokens or full provider payloads.

### 3.4 Provisional pilot limits

The following are **proposed internal safety ceilings**, not National Treasury limits. They need owner approval and should be configurable in trusted server-side policy, not passed by the model.

- 3 requests per admin per minute;
- 15 requests per project per minute;
- 30 requests per admin per UTC day;
- 100 requests per project per UTC day;
- maximum 3 concurrent project-wide provider requests.

Metadata lookups count against the same capability reservation. The ten-minute per-isolate metadata cache remains a performance optimisation only; it is not the shared quota.

If actual provider documentation specifies a lower request allowance, the lower allowance takes precedence.

## 4. Outbound network enforcement

### 4.1 Why a hostname allowlist is not the final control

The current adapter has a fixed HTTPS origin and fixed route templates, rejects redirects, and never accepts a model-supplied URL. This materially narrows destination control.

However, ordinary `fetch()` does not give the application a demonstrated guarantee that the DNS answers were checked and pinned to the actual destination socket at connection time. Checking DNS separately and then calling ordinary `fetch()` creates a time-of-check/time-of-use gap.

The current function must therefore not be described as fully SSRF-proof.

### 4.2 Recommended topology

```text
Authenticated InnerMe administrator
              |
              v
Supabase Edge Function
  - validates JWT and active admin
  - validates capability and parameters
  - reserves shared quota
              |
              | authenticated capability request
              v
Controlled egress gateway
  - accepts only the Municipal Money capability
  - constructs the provider URLs internally
  - resolves A and AAAA records itself
  - rejects private, loopback, link-local, multicast,
    reserved, unspecified and IPv4-mapped/IPv6 special ranges
  - pins the chosen vetted address for the connection
  - performs TLS with the original hostname as SNI
  - validates the certificate against that hostname
  - rejects redirects and alternate ports
  - enforces timeout and response byte limits
              |
              v
municipaldata.treasury.gov.za
```

The egress gateway must not accept arbitrary URLs, hosts, ports, methods, or redirects from InnerMe. Its API should accept only the capability identifier and validated parameters. It must reconstruct the provider paths itself.

Validate all A and AAAA answers for a hostname before selecting an address. Revalidate on each new connection. Do not follow a redirect; if provider operation ever requires one, every new target must pass the same allowlist and connection-time destination checks.

Keep TLS hostname verification enabled even when the network connection is pinned to an IP address.

### 4.3 Platform options assessed

**Supabase Edge Function direct `fetch()`:** Retain for provider-free local tests and as the current isolated implementation, but do not call it a complete connection-time IP enforcement mechanism.

**Supabase Network Restrictions:** Not an outbound API firewall. Supabase documents these restrictions as applying to incoming connections to Postgres and its pooler, not HTTPS APIs such as Auth, Storage, and PostgREST. They do not secure the Edge Function's outbound connection to National Treasury.

**Cloudflare Worker as a simple proxy:** Not accepted as a DNS-pinning solution by itself. A Worker that forwards with ordinary `fetch()` still needs a documented connection-time DNS/IP enforcement mechanism. Cloudflare TCP sockets are a separate API; its documentation says to use `fetch` for HTTP on ports 80/443. Do not assume TCP sockets alone solve HTTPS hostname verification and destination pinning.

**Dedicated outbound proxy / controlled gateway:** Preferred production pattern if it provides the required resolver, dialer, TLS and egress policy controls. This introduces an additional deployed service and may have a non-zero recurring cost. No provider or hosting plan is selected in this stage.

## 5. Cost and resource considerations

The lowest incremental-cost quota option is a dedicated atomic Postgres counter and reservation RPC in the existing database. It avoids another SaaS dependency but adds database writes and needs a reviewed migration.

A managed Redis service is a valid alternative for atomic counters; Supabase's official rate-limiting example uses Redis/Upstash. It adds an external account, secret, service limit and potential cost. Do not introduce it until the current free-tier limits and billing implications are confirmed.

A controlled egress proxy adds another service. A free-tier proxy must not be labelled a security control unless its runtime and connection-time IP enforcement are actually verified.

The isolated Supabase project `ofqofhnlzbouclvvrmzd` is currently inactive. Do not restore or activate it until its resulting billing and resource implications have been reviewed.

## 6. Required verification

### Quota tests
- Concurrent requests racing for the last per-admin slot: only the allowed number succeeds.
- Concurrent requests racing for the last project-wide slot: only the allowed number succeeds.
- A non-admin and expired/missing JWT cannot reserve.
- A quota RPC timeout/unavailability blocks provider access.
- Upstream success, error and timeout all consume the request reservation.
- Lease release is idempotent; expired leases do not permanently consume concurrency.
- Minute and UTC-day boundaries behave correctly.

### Egress tests
- Approved DNS response resolves to public IPs and connects using the pinned address.
- Mixed public/private A or AAAA answers are rejected.
- Loopback, RFC1918, link-local, multicast, reserved, unspecified, IPv4-mapped IPv6 and ULA IPv6 destinations are rejected.
- DNS answer changes between requests are revalidated.
- A DNS change between validation and connection cannot change the socket destination.
- TLS validates the original provider hostname.
- Redirects, alternate ports, alternate paths and unexpected methods are rejected.
- Slow response, oversized response, malformed JSON and upstream errors fail safely.

### End-to-end tests
- Valid active admin: quota reserved and read-only provider result returned.
- Non-admin: rejected before quota/provider.
- Invalid parameter: rejected before quota/provider.
- Quota exhausted: HTTP 429 and zero provider calls.
- Quota service unavailable: fail closed and zero provider calls.
- Provider failure: no knowledge write, action proposal, or execution side effect.

## 7. Approval boundary and next actions

This document is a design, not an implementation or approval to alter the database.

Before any implementation:
1. Approve a dedicated integration quota table and authenticated RPC migration.
2. Confirm the provisional pilot ceilings or replace them with approved values.
3. Confirm whether an additional controlled egress service and its cost are acceptable.
4. Approve restoration/activation of the isolated Supabase test project only after its cost is known.

Until those approvals and tests exist, keep PR #147 in draft and do not deploy or connect the capability to InnerMe chat.

## Official references

- Supabase [Rate Limiting Edge Functions](https://supabase.com/docs/guides/functions/examples/rate-limiting)
- Supabase [Recursive / Nested Function Calls](https://supabase.com/docs/guides/functions/recursive-functions)
- Supabase [Network Restrictions](https://supabase.com/docs/guides/platform/network-restrictions)
- Supabase [Edge Functions](https://supabase.com/docs/guides/functions)
- Supabase [Why Edge Functions cannot provide static egress IPs](https://supabase.com/kb/troubleshooting/why-supabase-edge-functions-cannot-provide-static-egress-ips-for-whitelisting)
- Cloudflare [TCP Sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
