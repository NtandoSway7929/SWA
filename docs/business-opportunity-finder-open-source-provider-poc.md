# Business Opportunity Finder: open-source provider proof of concept

**Status:** isolated proof of concept only. This document and its adapter are not production integration instructions.

## Objective

Evaluate replacing TinyFish Search + Fetch with independently operated services while preserving Swayphics-owned evidence rules and storage.

The proof of concept uses:

- **SearXNG** for candidate discovery: `GET /search?q=...&format=json`.
- **Crawl4AI Docker API** for page retrieval: `POST /crawl` with a bounded `urls` array and Bearer authentication.
- The existing Swayphics evidence normaliser for public-URL validation, page identity matching, evidence classification, excerpt sanitisation and persistence.

Upstream repositories:

- https://github.com/searxng/searxng
- https://github.com/unclecode/crawl4ai

## Implementation boundary

The new module `supabase/functions/_shared/business-assessment-open-source-provider.mjs` is an adapter only. It is deliberately not imported by `inspect-business-assessment/index.ts`.

The existing TinyFish provider is unchanged. There is no automatic failover, no provider selection exposed to the public assessment page, and no production SearXNG or Crawl4AI request.

The adapter exposes:

- `search(query, options)`: returns a bounded list of normalised `{ url, title, snippet }` candidates.
- `fetch(urls)`: accepts at most eight public URLs and returns source-specific `{ url, final_url, success, error_code, title, description, language, text, links }` records.

The caller remains responsible for existing discovery rules, source grouping, identity matching, evidence classification and database persistence.

## SearXNG contract

The adapter calls the configured instance's `/search` endpoint with:

- `q`: bounded search query
- `format=json`
- `language=en`
- `safesearch=1`
- `pageno=1`

The SearXNG instance must have JSON output enabled in its settings. A 403 response is translated to `search_json_format_not_enabled`.

Result-domain include/exclude filters are applied by the adapter after receiving search results. This prevents out-of-scope URLs from becoming candidates, but it does **not** stop configured external search engines from receiving the original query. SearXNG's configured engine list, privacy policies and query retention must be reviewed before using real business names and locations.

## Crawl4AI contract

The adapter calls the configured service's `/crawl` endpoint, sending only:

```json
{
  "urls": ["https://example.co.za/"],
  "browser_config": {},
  "crawler_config": {}
}
```

It sends `Authorization: Bearer <token>` and does not enable request-provided hooks, JavaScript execution, LLM extraction, browser login sessions or proxy configuration.

The adapter maps Crawl4AI's `results[]` entries into the Swayphics page-evidence input shape. It uses Markdown (including `raw_markdown`) or `extracted_content` as page text, `metadata` for title/description/language, `redirected_url` for the final URL and internal/external link `href`/URL fields for link evidence.

The service's own URL destination validation and redirect handling must remain enabled. Swayphics must continue validating submitted and discovered URLs before forwarding them. Do not use this endpoint as a general-purpose proxy or allow public users to supply arbitrary service URLs.

## Isolated Docker integration smoke test

The POC Docker environment is under `scripts/bof-open-source-provider-poc/`.

It pins:

- SearXNG image tag `2026.11.23-a7163d091` with an amd64 image digest.
- Crawl4AI image tag `0.9.6`, the upstream security release dated 20 November 2026.

Crawl4AI 0.9.6 includes security fixes for multiple Docker-server advisories. Do not substitute an older image. Review later security releases before any deployment.

The Compose file publishes both services only on host loopback. Generate temporary credentials before starting:

```bash
export SEARXNG_SECRET="$(openssl rand -hex 32)"
export CRAWL4AI_API_TOKEN="$(openssl rand -hex 32)"

docker compose --file scripts/bof-open-source-provider-poc/docker-compose.yml up --detach

export SEARXNG_BASE_URL="http://127.0.0.1:8080"
export CRAWL4AI_BASE_URL="http://127.0.0.1:11235"

node scripts/business-assessment-open-source-provider.integration.cjs

docker compose --file scripts/bof-open-source-provider-poc/docker-compose.yml down --volumes --remove-orphans
```

The integration smoke test sends one generic query (`Crawl4AI open source web crawler`) through SearXNG and fetches only `https://example.com/` through Crawl4AI. It does not send assessment answers, prospect identifiers, respondent contact details or customer-submitted URLs. External search engines configured in SearXNG may receive that generic query.

The SearXNG test config disables the request limiter only to keep the ephemeral test deterministic. It is not a production configuration. Production must restore rate limiting, restrict network access, configure abuse controls and review all external search engines.

The GitHub Actions workflow runs both the mocked adapter tests and this Docker smoke test on the isolated POC branch.

**Interpretation:** a successful run proves that the adapter can communicate with the selected service versions and retrieve a known public test page. It does not establish South African search coverage, non-empty search results, business identity accuracy, website coverage, compliance, production security or service-level reliability.

## Configuration expected at a future integration point

The eventual Edge Function would need server-side configuration similar to:

- `SEARXNG_BASE_URL`
- `CRAWL4AI_BASE_URL`
- `CRAWL4AI_API_TOKEN`

These are names for a future implementation only. No production secrets have been configured. They must never be exposed to the browser or committed to source control.

Service base URLs must use HTTPS. HTTP is accepted only for loopback-only local tests.

## Hosting and security checks still required

1. Choose hosting for both services and confirm that the Supabase Edge Function can reach them securely.
2. Keep SearXNG and Crawl4AI inaccessible to unauthorised users. Use TLS and network-level or reverse-proxy access controls.
3. Pin reviewed versions and image digests. Do not deploy floating `latest` tags.
4. Review Crawl4AI's security advisories and configure Chromium sandboxing, SSRF protections, timeouts, response caps and authentication.
5. Review the external search engines configured in SearXNG. Self-hosting SearXNG does not make the search query private from those engines.
6. Review the AGPL-3.0 obligations for SearXNG and Apache-2.0 terms for Crawl4AI before commercial deployment.
7. Establish retention and deletion controls for service logs, caches and fetched page content.
8. Test representative South African websites and public profiles, including JavaScript-heavy pages, redirects, blocked content and ambiguous identity matches.
9. Determine whether the configured search sources return enough relevant candidates for each required BOF source category.

## Acceptance tests

The mocked adapter test checks:

- SearXNG result mapping, URL normalisation and domain filtering.
- Crawl4AI Markdown, metadata, links, redirect and response-header mapping.
- Bearer token handling and the bounded eight-URL request shape.
- Absence of hooks in crawl requests.
- HTTPS service URL requirement outside loopback.
- Missing Crawl4AI token handling.
- SearXNG JSON-disabled error mapping.

The Docker integration test checks actual SearXNG JSON API compatibility and actual Crawl4AI retrieval of the reserved `example.com` page. A zero-result SearXNG response is reported as a discovery-quality warning rather than proof of useful search coverage.

These checks do not prove live discovery quality, identity matching accuracy, provider privacy, production security or deployment readiness.

## Rollout rule

Do not replace TinyFish in the production Edge Function, configure production provider secrets, deploy either service, run a real assessment inspection or change the consent/agreement gates as part of this proof of concept.

A provider switch requires a separate decision after the mocked tests, isolated live tests with non-customer public URLs, operational/security review and evidence-quality comparison have all passed.
