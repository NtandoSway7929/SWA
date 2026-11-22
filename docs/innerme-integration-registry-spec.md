# InnerMe External Integration Registry — Specification

**Status:** Proposed specification  
**Version:** 1.0  
**Scope:** Internal Swayphics InnerMe  
**Implementation status:** Documentation only. No database migration, Edge Function, credential, provider connection, or production behaviour is changed by this specification.

## 1. Purpose

Create a governed way for InnerMe to discover and use external data services without coupling individual specialist agents to provider-specific APIs.

The registry describes approved integrations. A server-side Integration Gateway is the only component permitted to make outbound provider requests. Agents request named capabilities through an internal tool contract; they do not receive provider credentials or arbitrary network access.

The initial release is **read-only**. It retrieves public or explicitly authorised data, returns provenance and freshness metadata, and makes the result available to the requesting agent. It does not mutate Swayphics workspace records, send messages, create tasks, or execute external write operations.

## 2. Existing architecture and constraints

The repository's InnerMe roadmap documents these existing boundaries:

- Knowledge sources and acquired information are governed; retrieved external information must not be silently promoted into live knowledge.
- Specialist-agent coordination does not grant permissions.
- Decision candidates, execution plans and action proposals are distinct lifecycle stages.
- Existing controlled actions require explicit approval and safety checks before execution.
- Trust scores do not independently grant permissions.
- Runtime behaviour must not be described as verified solely because a source file or migration exists.

The registry and gateway must preserve those boundaries. They are additive infrastructure, not a replacement for InnerMe's knowledge governance, action proposal lifecycle, Phase 30 safety gate, or provider routing.

## 3. Goals

1. Maintain a central inventory of external services and capabilities.
2. Separate provider identity from the capability an agent requests.
3. Enforce server-side allowlisting, authentication, permissions, quotas and timeouts.
4. Return source attribution, retrieval time, freshness and bounded result metadata.
5. Keep provider secrets outside prompts, browser code, logs and agent-visible payloads.
6. Support cost and reliability monitoring, provider suspension and safe failure.
7. Begin with low-risk read-only integrations and require a separate review for any write capability.

## 4. Non-goals for version 1

- No autonomous purchases, bookings, messages, emails, payments or other external mutations.
- No arbitrary URL fetching or general-purpose browser access for agents.
- No API credentials stored in the registry as plaintext.
- No automatic promotion of API responses into authoritative InnerMe knowledge.
- No replacement of Cloudflare Workers AI / Gemini model routing.
- No new frontend framework and no redesign of the existing InnerMe UI.
- No production schema changes or deployments as part of this specification.

## 5. Logical architecture

1. **Specialist agent:** identifies a task that needs external data and requests a named capability.
2. **Capability policy check:** verifies that the agent, user/session and requested capability are permitted.
3. **Integration Gateway:** resolves the capability to an active provider configuration, validates bounded inputs, and makes the provider request.
4. **Provider adapter:** handles provider-specific authentication, parameters, response parsing and error normalisation.
5. **Result normaliser:** enforces response size and schema limits, marks provider content as untrusted data, and attaches provenance.
6. **Audit and usage layer:** records the capability, provider, requester, latency, outcome and usage units without recording secrets or unnecessary personal data.
7. **Agent:** receives a bounded result and must distinguish source facts, interpretation and uncertainty.

Agents must never call external providers directly from the browser or receive provider credentials.

## 6. Registry record

The logical registry record should support the following fields. Final SQL types, constraints, indexes and RLS policies must be designed against the live schema before any migration is proposed.

| Field | Meaning |
|---|---|
| id | Stable internal identifier |
| slug | Unique machine-readable integration identifier |
| display_name | Human-readable provider name |
| provider | Service operator |
| capability_keys | Explicit capabilities exposed by this integration |
| description | Intended use and limitations |
| base_url | Approved HTTPS origin; not agent-controlled |
| allowed_paths | Explicit path templates or adapter-owned routes |
| allowed_methods | GET only for v1 |
| auth_mode | none, secret reference, or OAuth reference |
| secret_reference | Pointer to server-side secret storage; never the secret itself |
| input_schema | Strict schema for accepted parameters |
| output_schema | Strict schema for normalised results |
| data_classification | public, internal, confidential, or restricted |
| permission_scope | Agents/roles permitted to invoke the capability |
| rate_limit_policy | Provider and caller quotas |
| timeout_ms | Hard request timeout |
| max_response_bytes | Maximum accepted response size |
| cache_policy | TTL and cache-key policy |
| attribution_template | Required source attribution |
| terms_url | Provider terms and commercial-use conditions |
| privacy_url | Provider privacy terms, where applicable |
| cost_model | Free, metered, subscription or unknown |
| status | discovered, under_review, approved, active, suspended, retired |
| reviewed_at / reviewed_by | Governance review metadata |
| created_at / updated_at | Audit timestamps |

The registry must not be writable by model-generated content. Only an authorised administrator or controlled deployment process may approve, activate, suspend or retire an integration.

## 7. Capability contract

Agents request a capability, not an arbitrary provider endpoint.

Conceptual request:

```json
{
  "capability": "economics.south_africa.indicators",
  "parameters": {
    "indicator": "approved-indicator-code",
    "start_period": "2020",
    "end_period": "2026"
  }
}
```

Conceptual response:

```json
{
  "status": "success",
  "capability": "economics.south_africa.indicators",
  "provider": "approved-provider-id",
  "retrieved_at": "ISO-8601 timestamp",
  "source": {
    "name": "Provider name",
    "url": "Provider documentation or data source URL"
  },
  "freshness": {
    "provider_period": "provider-reported period",
    "cache_hit": false
  },
  "data": {},
  "limitations": []
}
```

These are illustrative contracts, not implemented endpoints. The gateway must validate input and output against the registered schemas. The response must not claim a value is current when the provider's underlying data period is older.

## 8. Gateway security requirements

### Network controls

- HTTPS only.
- Provider origins and paths must be allowlisted in trusted server-side configuration.
- Do not accept full URLs, hostnames, ports or redirect destinations from agent input.
- Block loopback, private, link-local, multicast and reserved IP ranges, including IPv4 and IPv6.
- Resolve and validate destination addresses at connection time; defend against DNS rebinding.
- Disable redirects by default. If a provider requires redirects, validate every redirect target against the same allowlist.
- Reject unsupported schemes, ports, methods and content types.
- Do not expose a generic fetch-URL capability to agents.

### Resource limits

- Hard per-request timeout.
- Maximum response bytes and bounded JSON depth/array lengths.
- Per-provider, per-capability and per-caller rate limits.
- Bounded retries only for explicitly retryable failures; never retry non-idempotent operations.
- Circuit breaker or temporary suspension when provider failure thresholds are reached.
- Cache only where provider terms and data freshness permit.

### Secrets and privacy

- Store secrets in server-side secret storage or a protected secret manager reference.
- Never put secrets in prompts, browser bundles, database rows readable by ordinary authenticated users, error messages or logs.
- Redact authorisation headers, tokens, query secrets and personal data from telemetry.
- Request only parameters necessary for the capability.
- Do not send customer or business-confidential data to public APIs unless an explicit privacy review approves the data flow.

### Untrusted external content

- Treat provider responses, descriptions, documents and free text as untrusted data, not instructions.
- External content cannot change system policy, agent permissions, registry status or tool routing.
- Preserve source URL, provider and retrieval timestamp.
- Validate structured values and escape content before rendering in the UI.
- Separate source facts from agent interpretation and flag missing, stale or conflicting data.

## 9. Permission model

Version 1 supports read-only capabilities only.

- Each capability has an explicit permission scope.
- Agent identity is not sufficient on its own; the authenticated user/session and applicable policy must also permit the request.
- A provider being active does not mean every agent can use every capability.
- A trust score is evidence for governance, not an access-control grant.
- Suspended integrations fail closed.
- A capability not present in the approved registry is unavailable.

Any future write-capable integration must undergo a separate design and security review. It must be represented as a controlled action proposal, pass the existing policy and safety gates, receive explicit human approval, and create an auditable execution record. It must not be smuggled through the read-only gateway.

## 10. Lifecycle

1. **Discovered:** candidate identified; no runtime access.
2. **Under review:** documentation, ownership, terms, privacy, cost, authentication, quotas and security are assessed.
3. **Approved:** an administrator has accepted the risk and defined the capability contract.
4. **Active:** deployed server-side adapter and policy are available.
5. **Suspended:** temporarily unavailable due to security, provider, quota, cost or reliability concern.
6. **Retired:** permanently unavailable; historical audit records remain.

Activation requires a reviewed provider terms URL, documented commercial-use position, approved input/output schemas, security review, tests and an owner. Unknown terms or pricing must remain explicitly unknown, not assumed free.

## 11. Initial candidate backlog

These are candidates for assessment, not approved or connected integrations.

| Candidate | Potential capability | Initial decision |
|---|---|---|
| South African Reserve Bank API | South African macroeconomic and financial indicators | Assess first; confirm API access, terms, coverage and rate limits |
| National Treasury Municipal Money / data services | Municipal financial and performance data | Assess second; confirm API availability, licence and data formats |
| World Bank Indicators API | International development and economic indicators | Assess third; confirm attribution and request limits |
| Frankfurter | Currency reference rates and historical rates | Assess fourth; confirm source coverage, update cadence and commercial terms |
| OpenAlex | Academic publication and research metadata | Assess fifth; confirm API key, usage budget, attribution and data licence |

No candidate should be marked active based solely on appearing in a public API directory. Verify the provider's own current documentation and terms at implementation time. Prefer official provider documentation over third-party catalogues.

## 12. Initial pilot recommendation

The first pilot should be one read-only South African Reserve Bank capability, subject to a fresh review of its official API documentation.

Pilot constraints:

- One narrowly defined indicator query, not an unrestricted data proxy.
- Fixed provider origin and approved path.
- Strict input schema and bounded date range.
- No customer PII or confidential workspace data sent to the provider.
- Normalised response with source, retrieval timestamp, provider period and limitations.
- No automatic insertion into authoritative InnerMe knowledge.
- No external writes or workspace mutations.

If the official provider interface, terms or reliability cannot be verified, do not build against assumptions; select the next reviewed candidate instead.

## 13. Observability and audit

For each invocation, record only the minimum necessary operational metadata:

- capability and integration identifiers;
- requester/agent identity and authorised scope;
- request correlation ID;
- timestamp, duration and outcome;
- cache hit/miss;
- response size and usage units, where known;
- normalised error category;
- provider and source reference.

Do not store raw credentials, full authorisation headers, unrestricted provider payloads or hidden model reasoning. If payload retention is necessary for a specific capability, define a separate data-retention and privacy rule first.

## 14. Failure behaviour

The gateway must fail closed when:

- an integration is inactive or unapproved;
- permission checks fail;
- parameters do not match the schema;
- a host, path, method or redirect is not allowlisted;
- the provider times out, exceeds size limits or returns invalid data;
- the provider quota is exhausted;
- required attribution or freshness metadata is unavailable.

Return a structured error category and safe user-facing explanation. Do not fabricate data, silently substitute a different provider, or present cached data as fresh. A fallback is permitted only when explicitly configured and disclosed in the result.

## 15. Acceptance criteria for implementation

The specification is ready to move into implementation planning when all of the following are satisfied:

- [ ] Registry ownership and administrator permissions are defined.
- [ ] Registry storage location and RLS policy are reviewed against existing Supabase conventions.
- [ ] The gateway runs only server-side.
- [ ] Agents cannot provide arbitrary URLs or choose arbitrary HTTP methods.
- [ ] SSRF, redirect, DNS rebinding, timeout and response-size protections are tested.
- [ ] Secrets are stored outside the registry and are never exposed to agents.
- [ ] Input and output schemas are validated.
- [ ] Read-only permissions are enforced server-side.
- [ ] Usage limits, caching and suspension behaviour are tested.
- [ ] Source provenance, provider period and retrieval time are returned.
- [ ] External content is treated as untrusted data.
- [ ] Logs are redacted and access-controlled.
- [ ] Provider terms, pricing, licence and privacy position are documented.
- [ ] Tests demonstrate that an unapproved integration cannot be invoked.
- [ ] No existing knowledge-governance or action-approval boundary is bypassed.

## 16. Proposed delivery sequence

1. Review existing Edge Function conventions, secret handling, admin authorization, RLS and telemetry in the current repository.
2. Finalise the registry schema and permission model without applying it to production.
3. Implement the gateway and one provider adapter on an isolated test environment.
4. Add tests for security boundaries, provider failures, quotas and provenance.
5. Run a read-only pilot and verify its output.
6. Present the migration and deployment plan for explicit review before any production change.

**Change boundary:** This document alone authorises no production database migration, Edge Function deployment, credential creation, external API connection, or autonomous action.
