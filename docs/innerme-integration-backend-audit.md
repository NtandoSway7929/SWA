# InnerMe External Integration Backend Audit

**Status:** Read-only inspection completed  
**Scope:** Current production Supabase Edge Function inventory, selected InnerMe function source, RLS policies, database routine security modes, and repository function configuration.  
**Safety:** No production schema, function, secret, or application code was changed. This is a source/configuration inspection, not a penetration test or runtime verification.

## 1. Executive finding

InnerMe already has a suitable server-side foundation for a governed, read-only external integration gateway. The recommended placement is a dedicated Edge Function that is called by the existing authenticated `swayphics-ai` route (or by a narrowly scoped internal server-to-server path), rather than allowing model-generated URLs or browser code to call providers directly.

The integration gateway should remain separate from the Gemini/Cloudflare model-provider router. A data API integration is a source of external evidence, not an alternative language-model provider.

## 2. Existing production Edge Functions

The Supabase project currently reports 13 active Edge Functions:

- `swayphics-ai` (version 144; `verify_jwt=false`)
- `innerme-knowledge-embed` (version 6; `verify_jwt=false`)
- `innerme-autonomy` (version 4; `verify_jwt=true`)
- `innerme-monitoring` (version 4; `verify_jwt=true`)
- `innerme-interventions` (version 5; `verify_jwt=true`)
- `submit-enquiry`, `generate-invoice`, `request-client-review`, `send-email`, `sync-email-inbox`, `send-admin-push`, `upload-client-onboarding-assets`

The repository `supabase/config.toml` explicitly configures JWT verification for several functions, including `swayphics-ai=false`, `innerme-autonomy=true`, and `innerme-monitoring=true`. The live function inventory also reports `innerme-knowledge-embed=false`. Do not treat `verify_jwt=false` as proof that a function is public or unauthenticated: the function body must enforce its own controls.

## 3. Authentication and request boundaries

### Main AI route: `swayphics-ai`

The function deliberately has two distinct paths:

1. **Public website chat** (`action=public_chat`) executes before admin authentication. The inspected source:
   - restricts Origin to `https://swayphics.co.za` and `https://www.swayphics.co.za`;
   - requires an `x-innerme-session` value of bounded length;
   - hashes the session identifier and the network identifier before using them for rate limiting;
   - calls `consume_public_innerme_rate_limit`;
   - limits message length and history;
   - documents that this branch does not load workspace data or create the authenticated Supabase client.

2. **Private InnerMe operations** require a Bearer access token, validate it using Supabase Auth `getUser`, and call `is_swayphics_admin`. Invalid sessions return 401; non-admin users return 403.

The public and private routes must remain isolated. External integration capabilities must not be exposed through the public chat branch by default.

### Other inspected functions

- `innerme-autonomy` has gateway JWT verification enabled and also validates the access token and admin status in its function logic before accessing plans, proposals, and execution records.
- `innerme-monitoring` has gateway JWT verification enabled and validates the user through `getUser` plus `is_swayphics_admin`.
- `innerme-interventions` has gateway JWT verification enabled and independently validates a Supabase user and an active `admin_users` row before executing an approved intervention.
- `innerme-knowledge-embed` has gateway JWT verification disabled but requires a Bearer token, validates it against `/auth/v1/user`, and checks that the user is in `admin_users` before processing knowledge rows.

**Design consequence:** A new integration gateway should use JWT verification where compatible and still perform explicit user/admin authorization in the function. Do not rely on gateway JWT verification alone as an authorization decision.

## 4. Existing secrets and provider handling

The inspected `swayphics-ai` source reads server-side environment variables for Supabase credentials, `GEMINI_API_KEY`, and optional provider configuration. Gemini calls are routed through a guarded request helper that:
- restricts model names to an approved set;
- enforces a serialized request-size limit;
- reserves provider quota through `innerme_reserve_provider_quota`;
- applies a bounded provider timeout;
- records provider usage metadata without storing prompts, answers, business records, or secrets.

The source also contains server-side service-key usage for telemetry and quota reservation. The inspected knowledge embedding function separately reads configured publishable/secret key maps and validates the caller before reading or updating knowledge records.

The database `vault.secrets` query returned no rows. This only establishes that no entries were visible in that Vault table at inspection time. It does **not** establish that Edge Function secrets are absent: Edge Function environment secrets are a separate configuration surface. Secret values were not requested or exposed, and the available inspection did not establish the complete set of configured function secrets.

**Design consequence:** Provider credentials for external APIs must be stored only as Edge Function secrets (or a separately reviewed secrets facility), never in public tables, model prompts, browser code, registry rows, or logs. Registry records should hold a secret *reference/name*, not the secret itself.

## 5. Existing database security patterns

The inspected InnerMe tables have RLS enabled and use admin-scoped policies. Examples:
- `innerme_knowledge` and `innerme_knowledge_sources`: authenticated admin policies based on `is_swayphics_admin()`;
- `innerme_action_proposals` and `innerme_action_execution_logs`: authenticated admin policies;
- `innerme_knowledge_acquisition_tasks`: separate admin SELECT, INSERT, and UPDATE policies;
- `innerme_provider_usage`: admin SELECT policy.

The routine catalog includes `is_swayphics_admin` as SECURITY DEFINER, while the inspected InnerMe routines are predominantly SECURITY INVOKER. Any new privileged function requires a specific review of its schema, execute grants, caller authorization, and search_path; do not add SECURITY DEFINER merely to bypass an RLS issue.

## 6. Recommended integration architecture

```text
Authenticated InnerMe user
        |
        v
swayphics-ai (existing user + admin authorization)
        |
        | named capability request only
        v
InnerMe Integration Gateway (new Edge Function)
        |
        +--> approved registry entry
        +--> provider/host/path/method allowlist
        +--> input validation + data classification
        +--> server-side secret lookup
        +--> timeout / response-size / rate / quota controls
        |
        v
External read-only API
        |
        v
Normalized result + source URL + retrieved_at + provider metadata
        |
        v
InnerMe evidence/retrieval layer (untrusted until verified)
```

The model must never supply a raw URL, arbitrary host, arbitrary path, HTTP method, or secret reference. It should request a registered capability by stable key and provide schema-validated parameters. The gateway resolves all network destinations from administrator-approved registry configuration.

## 7. Required controls before a pilot

1. Keep the gateway server-side; no provider credentials or direct browser-to-provider calls.
2. Require authenticated active-admin authorization for the first pilot.
3. Use a fixed provider host and fixed endpoint templates; validate parameters against strict schemas.
4. Enforce HTTPS, host/path allowlists, DNS/IP protections against SSRF, redirect validation or disablement, bounded timeouts, response byte limits, and rate limits.
5. Treat all provider responses as untrusted external evidence. Preserve source attribution, retrieval timestamp, provider identity, and relevant license/terms metadata.
6. Do not auto-promote fetched content into authoritative InnerMe knowledge.
7. Keep external integrations read-only in v1. Any future write operation must enter the existing action proposal, policy, safety-gate, approval, and audit path.
8. Log capability key, provider, status, latency, response size, and error category; never log credentials, full prompts, or unnecessary personal/business data.
9. Fail closed when registry state, authorization, quota, or provider configuration cannot be verified.

## 8. Open implementation questions

These must be resolved before schema or gateway implementation:

- Which exact Edge Function secret names are currently configured, and how are they managed across local, preview, and production environments? Secret values must not be copied into this audit.
- Does the current `swayphics-ai` request dispatcher have a clean internal capability-dispatch seam, or should the caller invoke a new gateway function directly after its existing admin check?
- Which existing audit/event table is appropriate for integration invocation metadata, or should the integration layer have a dedicated append-only event table?
- What provider-specific terms, rate limits, attribution requirements, and commercial-use restrictions apply to the selected pilot API?

## 9. Recommended next step

Prepare a concrete, reviewable implementation proposal for one narrow read-only pilot (preferably one official South African public-data source after its current API documentation and terms are verified). The proposal should include the minimal registry schema, gateway request/response contract, RLS/grants, Edge Function auth model, test matrix, and rollback plan.

**No schema, Edge Function, secret, or production behavior was changed during this audit.**
