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

The existing TinyFish provider is unchanged. There is no automatic failover, no provider selection exposed to the public assessment page, and no live SearXNG or Crawl4AI request in this proof of concept.

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

## Configuration expected at a future integration point

The eventual Edge Function would need server-side configuration similar to:

- `SEARXNG_BASE_URL`
- `CRAWL4AI_BASE_URL`
- `CRAWL4AI_API_TOKEN`

These are names for a future implementation only. No secrets have been configured. They must never be exposed to the browser or committed to source control.

Service base URLs must use HTTPS. HTTP is accepted only for loopback-only local tests.

## Hosting and security checks still required

1. Choose hosting for both services and confirm that the Supabase Edge Function can reach them securely.
2. Keep SearXNG and Crawl4AI inaccessible to unauthorised users. Use TLS and network-level or reverse-proxy access controls.
3. Pin reviewed versions and image digests. Do not deploy floating `latest` tags.
4. Reconcile the Crawl4AI upstream README's release statement with its Docker guide before selecting a production image tag.
5. Review Crawl4AI's security advisories and configure Chromium sandboxing, SSRF protections, timeouts, response caps and authentication.
6. Review the external search engines configured in SearXNG. Self-hosting SearXNG does not make the search query private from those engines.
7. Review the AGPL-3.0 obligations for SearXNG and Apache-2.0 terms for Crawl4AI before commercial deployment.
8. Establish retention and deletion controls for service logs, caches and fetched page content.
9. Test representative South African websites and public profiles, including JavaScript-heavy pages, redirects, blocked content and ambiguous identity matches.

## Acceptance tests

The new mocked test file checks:

- SearXNG result mapping, URL normalisation and domain filtering.
- Crawl4AI Markdown, metadata, links, redirect and response-header mapping.
- Bearer token handling and the bounded eight-URL request shape.
- Absence of hooks in crawl requests.
- HTTPS service URL requirement outside loopback.
- Missing Crawl4AI token handling.
- SearXNG JSON-disabled error mapping.

These are deterministic adapter contract tests. They do not prove live service availability, search quality, crawling success, provider privacy, production security or deployment readiness.

## Rollout rule

Do not replace TinyFish in the production Edge Function, configure provider secrets, deploy either service, run a real assessment inspection or change the consent/agreement gates as part of this proof of concept.

A provider switch requires a separate decision after the mocked tests, isolated live tests with non-customer public URLs, operational/security review and evidence-quality comparison have all passed.
