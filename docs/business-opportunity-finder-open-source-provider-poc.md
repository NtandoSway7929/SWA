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
- Crawl4AI image tag `0.9.6` pinned to multi-architecture manifest digest `sha256:4603d7c4d69769673dfa1214fa9abbcac2a874d4d9af07d784782af528b65c68`, the upstream security release dated 20 November 2026.

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

The same ephemeral run then executes `scripts/business-assessment-open-source-provider.search-benchmark.cjs`, with two separate datasets. The national-brand baseline covers Dis-Chem, Sorbet, Clicks, Planet Fitness and NetFlorist. The Pretoria locally operated/independent pilot covers The Cure Spa, Charis Nail & Beauty Studio, Jacqueline's Chapter One Hair and Beauty Salon, Huba Fleurs and Kalm Skin + Body Studio. The second group was selected using public evidence of local operation, family ownership, owner operation or independent-salon positioning, and each has a separately verified current domain. The national-brand cases use one primary query each; each Pretoria case uses a primary query plus two alternate public-information query formulations. The report separates the primary-query rank from the best rank across all query attempts, records the top-five domains and titles for each attempt, and calculates per-dataset top-five and top-ten hit rates. Candidate alias domains are recorded separately and are not automatically accepted as official or same-owner domains. The Pretoria group is a small, curated pilot, not a representative sample of all independent South African businesses or the BOF's full lead market. A non-empty generic SearXNG result set is not treated as evidence of search accuracy.

### Public source trail for the Pretoria pilot

The expected domains and independent/local-operation indicators were checked against public business pages before being added to the benchmark:

| Business | Expected domain | Public source |
|---|---|---|
| The Cure Spa | `thecurespa.co.za` | https://www.thecurespa.co.za/the-cure — identifies its Pretoria location, 2015 establishment and women-run operation |
| Charis Nail & Beauty Studio | `charisbeauty.co.za` | https://www.charisbeauty.co.za/ — identifies itself as woman-owned, family-run and located in Pretoria East |
| Jacqueline's Chapter One Hair and Beauty Salon | `chapteronehairandbeauty.co.za` | https://www.chapteronehairandbeauty.co.za/ — describes itself as a full-service independent salon and identifies its Montana Park location |
| Huba Fleurs | `hubafleurs.online` | https://hubafleurs.online/ — identifies a Pretoria floral studio and pickup address; the public business listing also links to this domain |
| Kalm Skin + Body Studio | `kalm-studio.co.za` | https://www.kalm-studio.co.za/pages/about-us — describes the business as locally owned and operated and created by a husband-and-wife team |

These checks establish that the benchmark cases and expected domains have a public basis. They do not independently verify corporate registration status, employee count or revenue. The set is therefore labelled locally operated/independent pilot rather than a statistically defined microbusiness sample.

### Search benchmark results

The pinned Docker/API smoke test and mocked adapter contract both passed in [GitHub Actions run 13](https://github.com/NtandoSway7929/SWA/actions/runs/45920990251). The first ten-case search baseline found all five national-brand domains in the top five. For the Pretoria pilot, primary queries found three of five expected domains in the top five and four of five in the top ten.

The expanded 20-search run passed in [GitHub Actions run 14](https://github.com/NtandoSway7929/SWA/actions/runs/45921272694). The five national brands remained five of five in the top five and top ten. The Pretoria primary-query scores were three of five in the top five and four of five in the top ten; the best result across each case's primary and alternate queries was four of five in the top five and five of five in the top ten.

A repeat of the same 20-search matrix passed in [GitHub Actions run 15](https://github.com/NtandoSway7929/SWA/actions/runs/45921542659). Its national-brand results were unchanged at five of five in the top five and top ten. The Pretoria primary-query scores were also unchanged at three of five in the top five and four of five in the top ten, while the best-across-query score increased to five of five in both the top five and top ten. The change was driven by a different result position for Charis under the address-based alternate query. This is evidence of query and run-to-run ranking variability; do not interpret one search rank as a stable discovery score.

The material recovery was Huba Fleurs: the primary query did not surface `hubafleurs.online` in the top ten, while the alternate query `Huba Fleurs Pretoria flower delivery bouquets` surfaced it at rank one in both runs. This shows that discovery can be query-sensitive and supports testing a bounded fallback-query strategy. It does not prove that every fallback query will improve real lead discovery.

Charis remains an identity-review case. Its current site is `charisbeauty.co.za`; the public site identifies the studio at 66 Graham Road, Lombardy Business Park, and lists its current business email. The alternate `charisnails.co.za` page uses the “Charis Nail & Body Studio” name and shares location/contact indicators. In run 14, the current domain appeared at rank 10 across the three tested queries, while the alternate domain ranked first. In run 15, the primary query still placed the current domain tenth, but the address-based alternate query placed it first and the alternate domain tenth. Keep the two domains separate in evidence; use the name, address and phone as corroborating signals for manual review rather than automatically merging the domains or silently substituting one for the other. See https://www.charisbeauty.co.za/ and https://charisnails.co.za/.

These results are limited to five national brands and five curated Pretoria businesses, a single run per query set and the configured SearXNG engine mix at the time of testing. They are a search-discovery pilot, not a representative market accuracy estimate, a BOF lead-market coverage result or proof of identity-matching accuracy.

### Public website retrieval benchmark

The first live five-site Crawl4AI retrieval benchmark completed in [GitHub Actions run 18](https://github.com/NtandoSway7929/SWA/actions/runs/45921770711). All five requested URLs returned response content and stayed on their expected domains. Four returned HTTP 200 and contained the expected business-name cue in both the title and extracted text. Huba Fleurs returned HTTP 302, title `Account Suspended`, only 106 characters of text and no Huba Fleurs identity cue.

The initial adapter version treated a provider response as successful whenever Crawl4AI set `success: true` and returned non-empty text. That condition was too permissive: a hosting suspension page was counted as a successful extraction even though it was not useful business evidence. Direct inspection of https://hubafleurs.online/ on 27 November 2026 also redirected to `/cgi-sys/suspendedpage.cgi` and returned “Account Suspended” and “This Account has been suspended.”

The isolated adapter contract has therefore been tightened: a Crawl4AI item is successful only when it has readable text and its reported HTTP status is either absent or in the 2xx range. A non-2xx status is returned as `http_status_<status>`; it is not silently accepted as an extracted website. The mocked test now includes the observed 302 suspension-style response. The page-retrieval benchmark also reports a separate basic usable-page diagnostic requiring a successful fetch, expected domain, a business-name cue in the title or text and at least 150 extracted characters.

The corrected adapter and v2 retrieval benchmark were verified in [GitHub Actions run 24](https://github.com/NtandoSway7929/SWA/actions/runs/45922391596): four of five pages were successful 2xx retrievals and passed the basic usable-page diagnostic. Huba Fleurs was correctly classified as unsuccessful with `http_status_302`, status 302, title `Account Suspended` and no business-name cue. This confirms that the adapter no longer counts the hosting suspension page as successful content.

The v3 identity benchmark invokes the existing Swayphics `matchBusinessIdentity()` function on each successfully retrieved business page. It passes the test case's public business name and location, the fetched title, up to 12,000 characters of page text, `sourceType: website` and the final public URL. A failed page fetch is marked `not_evaluated_fetch_failed`, not ambiguous or rejected. This measures the current matcher without changing its code or persisting any evidence. Its confirmed/ambiguous/rejected counts are test outputs, not independent proof of legal ownership. The five-site set remains a small diagnostic pilot, not a representative sample of South African business websites.

The first live production-matcher benchmark passed in [GitHub Actions run 25](https://github.com/NtandoSway7929/SWA/actions/runs/45923088374). On the five homepage URLs, the matcher returned three confirmed, one ambiguous, zero rejected and one not evaluated after fetch failure. The Cure Spa, Charis Nail & Beauty Studio and Jacqueline's Chapter One were confirmed. Kalm Skin + Body Studio remained ambiguous because the homepage did not expose the tested Elarduspark locality. Huba Fleurs was not evaluated because its 302 suspension response failed the corrected page-fetch check.

The bounded follow-up experiment passed in [GitHub Actions run 26](https://github.com/NtandoSway7929/SWA/actions/runs/45923420720). It separately fetched Kalm's official `/pages/our-stores` page, which returned HTTP 200 and 9,889 characters. The unchanged matcher confirmed the business name, Elarduspark locality, page title and same-domain URL. This resolved one of one ambiguous homepage cases at the follow-up stage. The homepage record itself remained ambiguous; the secondary page is a separate evidence item. The official page lists Kalm The Park / Elarduspark and its Pretoria address: https://www.kalm-studio.co.za/pages/our-stores.

This supports a bounded follow-up strategy: when a homepage identity result is ambiguous because location is absent, consider one relevant same-domain location/contact/about page, keep the result separate, and rerun the existing matcher. It does not justify unrestricted crawling or changing the matcher thresholds.

A focused follow-up was added for Kalm's official `/pages/our-stores` page. The homepage had been ambiguous because it did not expose the tested Elarduspark locality in the extracted content. The official stores page names Kalm The Park / Elarduspark and gives its Pretoria address ([official Kalm stores page](https://www.kalm-studio.co.za/pages/our-stores)). The benchmark now fetches this single same-domain page separately and reruns the same identity matcher with the same business and location inputs. The secondary result is kept separate from the homepage result: it does not rewrite or upgrade the homepage evidence row. This is a bounded test of targeted internal-page discovery, not permission to crawl arbitrary site links.




The SearXNG test config disables the request limiter only to keep the ephemeral test deterministic. It is not a production configuration. The SearXNG limiter requires a Valkey database and correct trusted-proxy IP handling. A production design must either provision Valkey privately and enable the limiter with correct trusted-proxy configuration, or enforce equivalent per-client rate limiting at a private authenticated gateway and document why the built-in limiter is not used. In either case, restrict network access and review all external search engines.

## Security and deployment-readiness review — 27 November 2026

**Status: not approved for production deployment.** The passing CI suite verifies the adapter contract, isolated service communication and a subset of container posture. It is not a penetration test, a full host hardening review or a production readiness attestation.

### Controls now applied to the isolated Crawl4AI container

The POC Compose service now mirrors the relevant upstream hardened Compose posture, and CI inspects the running Crawl4AI container plus verifies both service ports are bound to host loopback:

- Crawl4AI v0.9.6 is pinned to its multi-architecture image manifest digest.
- The container runs as the non-root `appuser`.
- All Linux capabilities are dropped and privilege escalation is disabled.
- The root filesystem is read-only; the documented working/output directories use restricted tmpfs mounts.
- Shared memory is bounded, and memory/PID limits are declared.
- CI inspects the running Docker container to verify read-only root, user, capability drop, no-new-privileges and resource limits.

These checks intentionally stop short of claiming that Chromium itself is sandboxed. Upstream Crawl4AI still documents `--no-sandbox` as the default. Before production, test the `CRAWL4AI_CHROMIUM_SANDBOX=true` path with a supported unprivileged user namespace or a reviewed seccomp profile, following the upstream security verification runbook. Record the host/kernel and browser-start results. If this cannot be demonstrated, treat it as an explicit residual risk requiring a documented decision and compensating isolation controls.

## Hosting architecture decision — recommended candidate, not yet approved

**Recommendation for a first controlled deployment:** one South African self-managed cloud VM running the existing Docker services, with Cloudflare Tunnel and Cloudflare Access providing the only path from Supabase Edge Functions to a private reverse-proxy gateway. This avoids depending on a private network that Supabase Edge Functions cannot join directly, while keeping the VM's service ports off the public interface.

This is an architecture candidate for costing and a later staging test. It is **not** approval to purchase hosting, expose a hostname, create service credentials, deploy, or modify the production Edge Function.

### Proposed request path

```text
Swayphics assessment / admin action
        |
        v
Supabase Edge Function
  - validates the request and public URL
  - calls a single HTTPS gateway hostname
  - sends Cloudflare Access service-token headers
  - sends the Crawl4AI bearer token only on /crawl
        |
        v
Cloudflare Access
  - deny by default
  - Service Auth policy for the BOF token only
  - strict service-token authentication
  - unauthenticated requests return 401/403, not an interactive login redirect
        |
        v
Cloudflare Tunnel (outbound connection from the VM)
        |
        v
Private reverse-proxy gateway
  /search -> SearXNG
  /crawl  -> Crawl4AI
        |
        +-- private Docker network -- SearXNG
        +-- private Docker network -- Crawl4AI
        +-- private Docker network -- Valkey (for SearXNG's limiter)
```

The Access application should be created before publishing the tunnel hostname. Cloudflare documents that a published hostname without an Access application is available to anyone on the Internet. Access applications are deny-by-default; only a matching policy is granted access. Enable the service-token-specific 401 response and strict service-token authentication, and enable Tunnel's **Protect with Access** origin validation. The public hostname remains internet-addressable at Cloudflare's edge, but requests must pass the service-auth policy; the origin's SearXNG and Crawl4AI ports remain unexposed. See [Cloudflare's self-hosted application guide](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) and [service-token guide](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/).

Use one dedicated token for the Swayphics BOF Edge Function, tagged for the production environment, with a finite expiry and a documented rotation owner. The Client ID and Client Secret are sent in `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers. Store both as Supabase Edge Function secrets, never in the browser or request body. Cloudflare supports secret rotation with a grace period; the old secret can then be revoked. The existing Crawl4AI `Authorization: Bearer` header remains separate and is forwarded only to the `/crawl` upstream. Strict service-token authentication ensures invalid machine credentials receive 401/403 and only Service Auth policies can grant access. See [Cloudflare service-token request and rotation documentation](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/).

**Isolated adapter integration implemented:** the POC adapter sends `CF-Access-Client-Id` and `CF-Access-Client-Secret` on both the SearXNG `/search` request and the Crawl4AI `/crawl` request. The Crawl4AI bearer token remains a separate `Authorization` header on `/crawl` only. Access credentials are never included in the JSON crawl body. The adapter rejects non-loopback service endpoints unless both Access credentials are configured; one-sided configuration is rejected. HTTP loopback endpoints remain available for local Docker tests without Cloudflare credentials. The live integration and benchmark scripts accept the two server-side environment variables. This completes adapter plumbing only: no Cloudflare service token, hostname, tunnel, VM or production secret has been created, and no production Edge Function has been changed.

### Immutable gateway image pins — checked 28 November 2026

The private-gateway Compose file now uses fixed multi-platform image index digests:

| Component | Image reference | Publisher evidence |
|---|---|---|
| Caddy | `caddy:2.11.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0` | [Docker Official Image tag details](https://hub.docker.com/layers/library/caddy/2.11.9-alpine/) |
| Valkey | `valkey/valkey:9.2.1-alpine@sha256:3ad5a213cb1bc2fd4a113c89b6248a88655a6bf1dda69519d04e03cd3e3d2742` | [Valkey Docker Hub image details](https://hub.docker.com/layers/valkey/valkey/9.2.1-alpine/) |
| cloudflared | `cloudflare/cloudflared:2026.11.2@sha256:55c7e3e8d89d5e8d20b75a82f3602cbf98e06db406e73e282073cfdc5a9a3af6` | [Cloudflare Docker Hub image details](https://hub.docker.com/layers/cloudflare/cloudflared/2026.11.2/) |

The Valkey 9.2.1 upstream release is dated 25 November 2026. Cloudflare's 2026.11.2 release is dated 23 November 2026. The Docker Hub sources identify the digests above as multi-platform index digests; the deployment can select the matching architecture without floating tags. These pins improve reproducibility but do not replace vulnerability monitoring or future security updates.

The Compose deployment no longer needs Caddy, Valkey or cloudflared image variables in its private `.env` file. Before upgrading any pin, review the upstream release notes, confirm the new registry index digest, run the POC CI validation and retain an easy rollback to the previous digest.

### Isolated private-gateway deployment template — created, not deployed

A separate Compose definition now exists at `scripts/bof-open-source-provider-poc/private-gateway/compose.yml`. It is deliberately separate from the loopback-only CI Compose file.

The candidate network layout separates service traffic and outbound access:

- `tunnel_internal`: Caddy gateway and `cloudflared` connector only; internal Docker network.
- `search_internal`: Caddy, SearXNG and Valkey only; internal Docker network.
- `crawl_internal`: Caddy and Crawl4AI only; internal Docker network.
- `search_egress` (`10.77.40.0/24`), `crawl_egress` (`10.77.50.0/24`) and `cloudflare_egress` (`10.77.60.0/24`): separate outbound-capable networks with fixed source subnets for future host-firewall rules. SearXNG needs external search-engine access; Crawl4AI needs public website access; cloudflared needs outbound connectivity to Cloudflare. These egress networks are not shared with each other.
- No service publishes a host port. The Caddy gateway has no outbound egress network and is reachable by cloudflared only across `tunnel_internal`.

The Caddyfile accepts only `GET /search` and `POST /crawl`, and requires the Cloudflare-provided `CF-Connecting-IP` header. It sets `X-Forwarded-For` and `X-Real-IP` from that value for the SearXNG limiter. It strips `CF-Access-Client-Id`, `CF-Access-Client-Secret` and `Cf-Access-Jwt-Assertion` before forwarding to either upstream. Cloudflare sends the signed assertion header to the origin boundary; it is not needed by SearXNG or Crawl4AI and must not be propagated downstream. The Crawl4AI `Authorization: Bearer` header is preserved for the crawler API.

SearXNG's deployment settings enable JSON and its limiter. Valkey is reachable only on the internal search network and is configured as an ephemeral, memory-bounded limiter store. The limiter trusts only the fixed Caddy address `10.77.10.254/32`; the Caddy address and `limiter.toml` must be kept in sync. Caddy's `.254` address is reserved at the high end of each subnet to avoid collisions with Docker's low-end dynamic allocations.

The Cloudflare Tunnel connector uses a remotely managed tunnel token mounted from a separate protected file via `--token-file`. The token is distinct from the Cloudflare Access service token. The example environment file contains no actual credentials. Caddy, Valkey and cloudflared are now pinned directly in Compose to the publisher-visible full multi-platform index digests listed above. No image variables or floating image tags are required. The connector is behind the opt-in Compose profile `tunnel`, so the internal gateway can be started and tested without a live Tunnel token or a public hostname.

### Private-gateway internal runtime smoke test

The isolated GitHub Actions workflow now also starts the private-gateway Compose stack without the `tunnel` profile. It reuses the same pinned SearXNG and Crawl4AI images as the provider integration job, starts Valkey and Caddy, and checks:

- Valkey responds to its local health probe.
- Provider, cache and gateway containers have no published host ports.
- Each container is attached only to its intended internal/egress networks; Caddy has no outbound egress network.
- The Cloudflare Tunnel connector is not started.
- A disposable probe container attached only to `tunnel_internal` can reach the gateway, but cannot bypass it to connect directly to either provider.
- Caddy returns 404 for unknown paths, disallowed methods and search requests without the expected Cloudflare client-IP header.
- The allowed `GET /search` route returns SearXNG JSON for a generic query, and `POST /crawl` retrieves only the reserved `https://example.com/` test page using an ephemeral CI bearer token.

This validates internal container networking and the actual Caddy-to-provider HTTP path in a temporary GitHub Actions Docker environment. It does **not** verify a Cloudflare Access policy, a live Tunnel, origin authentication, production rate-limit effectiveness, or the host firewall. The test supplies a synthetic `CF-Connecting-IP` value and temporary Access headers; it does not prove that Cloudflare supplies or protects those headers in a real deployment. It sends only a generic search query and the reserved test URL. Any public search engines enabled in SearXNG may receive the generic query.

Before using this template, check that all six fixed Docker subnets (`10.77.10.0/24`, `10.77.20.0/24`, `10.77.30.0/24`, `10.77.40.0/24`, `10.77.50.0/24`, `10.77.60.0/24`) do not overlap with host, VPN or existing Docker networks. Change the Compose IPAM entries, Caddy address and limiter trusted-proxy entry together if a different subnet plan is required. The three egress subnets are fixed so a host firewall can classify traffic by source network.

**Important residual network control:** dedicated Docker egress networks isolate the three outbound services from one another, and their source subnets are now fixed for host-firewall matching. They still do not by themselves prevent access to private, link-local or cloud metadata addresses. No host egress filter has been installed. Use the backend-specific design in [the host egress/SSRF hardening runbook](./bof-open-source-provider-host-egress-hardening.md), then run live IPv4, IPv6, DNS-rebinding and redirect tests on the selected staging host. Do not rely on UFW alone without checking Docker's packet-filtering behavior.

This is a configuration template only. No hostname has been routed, Cloudflare Access application or Tunnel created, token generated, VM purchased, provider deployed or production code changed. The actual remotely managed tunnel hostname should be routed to `http://gateway:8080` only after the Access application is configured first, with a deny-by-default Service Auth policy limited to the BOF service token and Tunnel's **Protect with Access** origin validation enabled. Cloudflare Tunnel uses outbound connections from the connector, so no inbound server port is required. See [Cloudflare Tunnel run parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/) and [Docker Compose network isolation](https://docs.docker.com/compose/how-tos/networking/).

### Hosting candidate and indicative cost

The most credible locally hosted option identified so far is [xneelo Cloud](https://xneelo.co.za/cloud/). Its published pricing currently lists:

| Resource | Published price | Basis |
|---|---:|---|
| 4 vCPU / 8 GB RAM | R402/month | 730-hour compute estimate |
| 50 GB Premium NVMe | R90/month | 50 × R1.80/GB/month |
| **Indicative total** | **R492/month** | Compute + 50 GB volume |

The xneelo page says its monthly estimates include VAT and are based on 730 hours; actual invoices vary with actual hours and resource use. The 50 GB volume estimate assumes the total Premium NVMe allocation, including the required 10 GB boot volume, is 50 GB. Extra snapshots or storage are additional. See [xneelo's current Cloud pricing](https://xneelo.co.za/cloud/).

This is a **starting-size candidate**, not a measured capacity guarantee. Crawl4AI's self-hosting guide asks for at least 4 GB RAM available for the crawler container alone, with more recommended for heavier use. A 4 GB VM would therefore leave no reasonable memory headroom for the OS, SearXNG, Valkey and gateway. Start evaluation at 8 GB, restrict concurrency, and measure real memory/CPU before committing to production. See [Crawl4AI self-hosting prerequisites](https://docs.crawl4ai.com/core/self-hosting/).

xneelo states that its Cloud service currently has one region and one availability zone in Johannesburg. That is locally relevant, but it is also a single-zone availability risk. xneelo Cloud is self-managed: OS patching, container updates, backup policy, firewall, monitoring and incident response remain Swayphics' responsibility. See [xneelo's region and support information](https://xneelo.co.za/cloud/).

Cloudflare Zero Trust currently lists a Free plan for teams under 50 users, and its account limits list up to 50 service tokens and 1,000 Cloudflare Tunnels. This could avoid an additional Access subscription for a small machine-to-machine use case, subject to confirming the account's current entitlement and whether its usage fits the plan. This does not make the VM free. The domain must be an active Cloudflare zone (full or partial setup) for a custom published application hostname. See [Cloudflare plans](https://www.cloudflare.com/plans/), [account limits](https://developers.cloudflare.com/cloudflare-one/account-limits/) and [application prerequisites](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/).

### Why not Railway or Fly private networking as the direct bridge?

Railway private DNS names are scoped to services in the same Railway project and environment. Fly's 6PN private network is scoped to apps within the same Fly organization; external access requires a WireGuard connection or another explicitly configured route. A hosted Supabase Edge Function is not automatically a member of either provider's private network. Those platforms would still need an access-controlled HTTPS ingress or a separate network connector, so their private-network feature alone does not solve this integration. See [Railway private networking](https://docs.railway.com/networking/private-networking) and [Fly private networking](https://fly.io/docs/networking/private-networking/).

### Deployment and staging gates

1. Confirm that the Swayphics-controlled domain can be used as an active Cloudflare zone and that the Cloudflare Access Free plan is actually available to the account.
2. Obtain a final VM quote and confirm resource quotas, storage, backups/snapshots, network policy, support and any provider terms.
3. Build the gateway and private Docker network so that neither SearXNG nor Crawl4AI publishes a public host port. The only inbound public hostname should terminate at Cloudflare Access; the tunnel connector initiates outbound connectivity.
4. The private-gateway template now includes internal Valkey, enables SearXNG's limiter and forwards the Cloudflare client IP through a fixed Caddy address. CI now starts this stack and exercises the internal Caddy routes, checks network membership/no host-published ports and confirms Valkey responds. This still does not prove SearXNG's live rate-limit behaviour or the authenticity of the client-IP header chain; verify both with a real Cloudflare/Tunnel staging deployment.
5. The isolated adapter now sends both Cloudflare Access headers on both service requests and fails closed when remote endpoints are configured without the complete credential pair. Tests cover missing and partial configuration, header forwarding, and exclusion from the crawl body. Staging must still verify that Cloudflare Access rejects missing, wrong and expired tokens with 401/403, and must confirm that no credentials are written to service or gateway logs.
6. Configure the Edge Function with the gateway URL, Access Client ID/Secret and Crawl4AI bearer token as server-side secrets. Confirm the Edge Function's actual invocation region and measure search/crawl latency and request timeouts against the VM in Johannesburg.
7. Complete network egress/SSRF, DNS-rebinding, Chromium sandbox, image/SBOM, secret-rotation, log-retention, backup/restore and outage-recovery tests in staging.
8. Only after those checks, make a separate production integration decision. Keep the existing TinyFish consent gate and production function untouched until then.

Supabase Edge Functions can make outbound HTTP requests to other APIs using `fetch()`; the hosted runtime also imposes wall-clock and idle-time limits. The gateway request path therefore needs a real staging invocation from the deployed Edge Function, not only a local Node.js test. Review [Supabase Edge Function usage](https://supabase.com/docs/guides/functions/quickstart) and [current Edge Function limits](https://supabase.com/docs/guides/functions/limits) before setting the operational timeout budget.

### Remaining production blockers

1. **SearXNG abuse controls:** the private-gateway CI runtime test now confirms Valkey is healthy, the search route works through Caddy and the intended trusted-proxy configuration is present. It does not prove SearXNG is using Valkey for live limiter state, that the configured thresholds behave as intended, or that the forwarded IP is genuinely supplied by Cloudflare. Verify those behaviours against the protected Tunnel in staging.
2. **Ingress and service identity:** the new deployment template has no public host-port mappings and routes through a private Caddy gateway and cloudflared connector. The live Cloudflare Access application, Service Auth policy, service token, Tunnel hostname, `Protect with Access` setting and origin behavior remain unconfigured and untested. SearXNG itself has no application token in this adapter contract; it must remain reachable only from Caddy on the internal search network.
3. **Egress/SSRF:** the three outbound Docker networks now have deterministic source subnets, and a read-only audit script identifies the Docker host's firewall backend. No firewall policy has been installed. Implement backend-specific host egress rules that block non-public IPv4/IPv6 and metadata destinations, allow only the required outbound ports per service, and default-deny other traffic. Test DNS rebinding, mixed A/AAAA answers and redirect chains against a real staging host.
4. **Chromium sandbox:** complete the upstream sandbox verification. The current container controls do not by themselves prove renderer sandboxing.
5. **Secrets and rotation:** store the SearXNG secret, Crawl4AI API token and any gateway credentials in a managed secret store. Define rotation, least-privilege access and emergency revocation. Never put them in browser code, Git history or assessment payloads.
6. **Search-engine disclosure:** self-hosting SearXNG does not prevent its configured external engines from receiving search queries. Review and minimise the enabled engine list; document which providers receive business names/locations, their retention and terms before real prospect data is used.
7. **Logs/cache/retention:** define what each service logs or caches, retention durations, deletion procedure, access to logs, and whether request URLs or fetched page text can contain personal information.
8. **Licensing:** obtain a commercial licence review for SearXNG's AGPL-3.0 obligations and check Crawl4AI's Apache-2.0 licence and the selected images' dependency notices. Do not infer that self-hosting removes licence obligations.
9. **Operational resilience:** choose the host/network topology, CPU/RAM budget, concurrency, queue limits, health monitoring, backups where applicable, alerting and failure behaviour. Confirm the Supabase Edge Function can reach the private services with acceptable timeouts. The local Docker ports in this test are not reachable from Supabase.
10. **Operational acceptance:** scan and record image provenance/SBOM, vulnerability results and digest; test upgrade/rollback; verify rate-limit, authentication, denial of private network targets, TLS, resource exhaustion and service recovery.

The current Crawl4AI image is the reviewed v0.9.6 release, which upstream marks as a security release. Continue tracking upstream advisories and releases; pinning a digest is a reproducibility control, not a guarantee that the image remains vulnerability-free.

No production hostname, hosting provider, private networking, production secret, Valkey instance or deployment has been selected or provisioned. The private-gateway template is now exercised in an ephemeral GitHub Actions Docker environment, but it has not been deployed or validated on a selected hosting VM, behind Cloudflare, or from a deployed Supabase Edge Function. These decisions remain open and must be completed before any production integration.

The GitHub Actions workflow runs the mocked adapter contract, the provider Docker smoke/benchmark tests, and the private-gateway internal runtime smoke test on the isolated POC branch.

**Interpretation:** a successful run proves that the adapter can communicate with the selected service versions and retrieve a known public test page. It does not establish South African search coverage, non-empty search results, business identity accuracy, website coverage, compliance, production security or service-level reliability.

## Configuration expected at a future integration point

The eventual Edge Function would need server-side configuration similar to:

- `SEARXNG_BASE_URL`
- `CRAWL4AI_BASE_URL`
- `CRAWL4AI_API_TOKEN`
- `CLOUDFLARE_ACCESS_CLIENT_ID`
- `CLOUDFLARE_ACCESS_CLIENT_SECRET`

These are names for a future server-side integration only. No production secrets have been configured or created. The two Cloudflare Access values must be supplied together and must never be exposed to the browser, assessment payloads, logs or source control.

Service base URLs must use HTTPS. HTTP is accepted only for loopback-only local tests.

### Cloudflare Access adapter contract

- Both `searchBaseUrl` and `crawlBaseUrl` must use the same protected gateway origin for the proposed single-gateway deployment.
- Any non-loopback service endpoint requires both `CLOUDFLARE_ACCESS_CLIENT_ID` and `CLOUDFLARE_ACCESS_CLIENT_SECRET`; supplying only one is rejected at adapter construction.
- The adapter attaches both Access headers to each gateway request. The Crawl4AI bearer token is sent separately on `/crawl` only.
- HTTP loopback endpoints are accepted without Access credentials only for local Docker tests. This is not a production authentication mode.
- Adapter tests verify forwarding and that the Access credentials are absent from the Crawl4AI JSON body. A staging test must still verify denial of missing, incorrect and expired credentials, plus the gateway/service logging configuration.

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
- Non-2xx Crawl4AI page responses are not counted as successful extractions.
- The existing Swayphics `matchBusinessIdentity()` function confirms a matching name/locality/title/domain case, leaves third-party and missing-locality cases ambiguous, and rejects a page matching neither the business name nor location.

The Docker integration test checks actual SearXNG JSON API compatibility and actual Crawl4AI retrieval of the reserved `example.com` page. The public-page benchmark also invokes the production identity matcher in memory on five independently verified Pretoria business pages; it does not persist evidence or change the Edge Function. The search benchmark measures expected official-domain rank for five large national brands and five locally operated/independent Pretoria businesses. The Pretoria set is tested using one primary and two alternate queries per business; primary-query and best-across-query metrics are kept separate, and candidate alias domains are surfaced for review without being counted as official-domain hits. A zero-result SearXNG response is reported as a discovery-quality warning rather than proof of useful search coverage.

These checks do not prove live discovery quality, identity matching accuracy, provider privacy, production security or deployment readiness.

## Rollout rule

Do not replace TinyFish in the production Edge Function, configure production provider secrets, deploy either service, run a real assessment inspection or change the consent/agreement gates as part of this proof of concept.

A provider switch requires a separate decision after the mocked tests, isolated live tests with non-customer public URLs, operational/security review and evidence-quality comparison have all passed.


### Automatic bounded internal-page selection

The follow-up benchmark no longer hard-codes Kalm's stores-page URL. For a homepage that the existing identity matcher classifies as ambiguous, the isolated POC examines the homepage's extracted links and selects at most one eligible candidate. Candidate selection is restricted to HTTPS URLs on the exact same host and prioritises store/location/branch paths, then contact/directions paths, then about/story paths. Blog, news, article, product, collection, search and category paths are excluded. If no eligible link exists, no follow-up request is made. A fetched follow-up is eligible for identity evaluation only when its final URL remains on the exact requested HTTPS origin; cross-origin redirects and HTTP downgrades are marked as failed for follow-up identity evaluation.

The selected page is fetched separately and passed through the unchanged identity matcher using the supplied business name and location. Its result remains a separate page-level evidence result; it does not alter the homepage match. This is still a benchmark-only POC helper, not production Edge Function behaviour. CI must verify the selector contract and the live Kalm link-selection result before any further design decision.


The automated follow-up benchmark now includes a redirect-origin contract: a successful crawler response is not enough by itself. The final URL must preserve the selected page's exact HTTPS origin. A redirect to another host or an HTTP downgrade is not evaluated as same-host business evidence.


## Latest isolated CI and benchmark results — 28 November 2026

The isolated POC branch passed [GitHub Actions run 92](https://github.com/NtandoSway7929/SWA/actions/runs/46122945183), commit `605373157ca2c0ef01b64bd0c4afb98c41395a1e`.

The run completed both jobs:

- **Mocked provider adapter contract:** passed, including the Swayphics identity-matcher contract, declarative host-egress policy validation, and private-gateway Compose topology validation.
- **Live Docker smoke test:** passed with the pinned SearXNG, Crawl4AI, Caddy and Valkey services. Provider health checks, live adapter integration, search and retrieval benchmarks, private-gateway health, network membership, unpublished host ports, route/method/client-IP denials, and internal `/search` and `/crawl` requests all completed successfully.
- The private-gateway runtime test returned 20 candidates for its generic test query and successfully fetched the reserved `https://example.com/` page with readable text.

### Search results from run 92

The 20-attempt search benchmark reported:

| Dataset | Query scope | Top 5 | Top 10 |
|---|---|---:|---:|
| Five national brands | Primary query | 5/5 (100%) | 5/5 (100%) |
| Five Pretoria independent/local operators | Primary query | 3/5 (60%) | 4/5 (80%) |
| Five Pretoria independent/local operators | Best across primary + two alternates | 5/5 (100%) | 5/5 (100%) |

For the Pretoria cases, alternate queries recovered one domain that the primary query did not place in the top ten and improved rank in two cases. These figures are search-result rank measurements against this small, curated dataset. They are not identity-confirmation rates, a statistically representative market sample or a guarantee of lead coverage.

### Retrieval and identity results from run 92

The five-site Pretoria page-fetch benchmark reported:

- 4/5 successful HTTP retrievals (80%).
- 4/5 pages with both title and content identity cues.
- Identity matcher outcomes: 3 confirmed, 1 ambiguous, 0 rejected, 1 not evaluated because fetch failed.
- Zero final-domain mismatches.
- Kalm's homepage remained ambiguous on the locality cue; the one automatically selected same-origin `/pages/our-stores` follow-up returned HTTP 200 and independently confirmed the business/location match. The follow-up remains a separate evidence result and does not upgrade the homepage record.
- Huba Fleurs remained unavailable: the expected domain returned HTTP 302 with title `Account Suspended`, only 106 text characters and no business identity cue. The adapter correctly returned `http_status_302` and did not evaluate identity. This is a live-site availability limitation, not evidence that the business does not exist.

The result set is intentionally limited to public independently researched sites. It did not include assessment answers, respondent contact details or user-submitted destinations.

### What this CI run does not prove

The hosted workflow sets `CRAWL4AI_CHROMIUM_SANDBOX=false` only for API-level CI checks. It explicitly records that the browser sandbox has not been verified. The secure private-gateway Compose default remains `true`, and static validation rejects a disabled default. A compatible Linux Docker host must still demonstrate actual Chromium sandbox operation before deployment.

The run also does not verify a real Cloudflare Access/Tunnel deployment, authentic Cloudflare client-IP forwarding, live SearXNG rate-limit behaviour under hostile traffic, host-level egress filtering, DNS-rebinding resistance, IPv4/IPv6 metadata blocking on a selected host, Supabase Edge Function connectivity, production retention/deletion, legal compliance or service reliability under representative load.

### Next engineering gate

The next work should address the gap between the passing ephemeral container tests and a deployable security boundary: define and test DNS-rebinding/redirect SSRF protections at the actual host egress layer, then validate Chromium sandboxing on a compatible Linux Docker host. These are host-dependent tests; do not install firewall rules, provision a VM, create a public route, deploy services or alter production code as part of this POC without separate approval.


## DNS rebinding namespace test — 28 November 2026

The isolated POC branch passed [GitHub Actions run 103](https://github.com/NtandoSway7929/SWA/actions/runs/46124455311), commit `f76258793e38847eb1106bdf2e82d83ebf10f1e6`. In addition to the existing dual-stack direct-SSRF namespace lab, the workflow now runs `scripts/bof-open-source-provider-poc/private-gateway/dns-rebinding-namespace-test.sh`.

The controlled IPv4 DNS fixture returns the simulated public address `1.1.1.1` for the first A query to `rebind-lab.test`, then returns the private fixture address `10.201.2.2` on the next A query. The test verifies that:

- The first resolved address is pinned to the actual socket connection and reaches only the simulated public fixture.
- A later DNS resolution returning the private fixture address cannot establish a connection through the isolated router's default-deny nftables policy.
- An HTTP redirect from the simulated public fixture to the private destination is blocked at connection time.
- The target fixture logs the permitted requests but never receives either blocked destination request.

All four test stages passed in run 103. The lab creates temporary Linux network namespaces and nftables rules only inside its temporary router namespace; it does not change host firewall rules, Docker networks, production services or public Internet routing.

**Scope limitation:** this is a controlled IPv4 DNS-rebinding and redirect test against an isolated router policy. It does not prove host Docker-forwarding enforcement, IPv6 DNS-rebinding behavior, real resolver/cache behavior, Crawl4AI or Chromium subrequest handling, Cloudflare Tunnel egress, or production security. The earlier dual-stack namespace test covers direct IPv4/IPv6 private and metadata destinations and redirects, but does not make this DNS-rebinding test dual-stack.

The next gate remains host-dependent and is not being simulated as complete: select an existing no-cost Linux Docker environment if available, perform the read-only host/network/firewall inventory, and only then design controlled staging enforcement. Chromium sandbox operation also remains unverified. No paid host is required or authorised for this POC.


## Chromium sandbox runtime verification — 28 November 2026

A dedicated CI job now launches the pinned Crawl4AI v0.9.6 image with `CRAWL4AI_CHROMIUM_SANDBOX=true`, non-root `appuser`, all Linux capabilities dropped, `no-new-privileges`, a read-only root filesystem, bounded tmpfs mounts and Docker's default seccomp profile. It attempts a real crawl of the reserved public test page `https://example.com/` and observes Chromium process arguments to ensure `--no-sandbox` is absent.

The first attempt on GitHub's Ubuntu 26.04 hosted runner failed with Chromium's explicit `No usable sandbox!` fatal error. The runner reported `kernel.unprivileged_userns_clone=1` but `kernel.apparmor_restrict_unprivileged_userns=1`. This isolates the immediate failure to the host's AppArmor restriction on unprivileged user namespaces; the test did not demonstrate a working sandbox.

The CI job was then updated to set `kernel.apparmor_restrict_unprivileged_userns=0` only on the disposable GitHub-hosted runner before retrying. This is a temporary test-host setting, not a change to the Crawl4AI container, any Swayphics machine, Docker daemon configuration, or production. The next run must still prove that Chromium launches and completes the crawl under Docker's default seccomp profile. If it fails, preserve the failure and evaluate a narrowly scoped seccomp/AppArmor configuration rather than disabling Chromium's sandbox.

**Current status:** sandbox verification remains open until that retry passes. A passing GitHub-hosted test would establish compatibility with that runner's kernel and Docker configuration only. It would not establish that a future host supports the same policy, nor prove production readiness. The selected deployment host must still pass its own runtime test. The hosted test does not change the private-gateway secure default of `CRAWL4AI_CHROMIUM_SANDBOX=true`.


### Chromium sandbox diagnostic refinement

After temporarily setting the disposable runner's AppArmor user-namespace restriction to `0`, the second run still failed with repeated Chromium `No usable sandbox!` errors while using Docker's default seccomp profile. This demonstrates that relaxing the host AppArmor sysctl alone is insufficient; the default container syscall filter is also a likely blocker. It is not yet proven whether seccomp is the only remaining blocker.

A candidate constrained seccomp profile has now been generated from the pinned Moby default profile at commit `245180c51918481c0525424b3ee025d2b435d46c` (source blob SHA `77df9d19e844f4403e41e401aca25ab28861e317`). The profile adds only:

- A `clone` rule whose masked comparison denies `CLONE_NEWNS`, `CLONE_NEWCGROUP`, `CLONE_NEWUTS` and `CLONE_NEWIPC`, while permitting Chromium's user/PID/network namespace flags.
- An `unshare` rule restricted to `CLONE_NEWUSER`.
- A `chroot` allowance for Chromium's sandbox confinement.

The Moby `clone3` rule remains `SCMP_ACT_ERRNO` with `ENOSYS` (38), so Chromium can fall back to `clone`; no blanket `setns`, mount or pivot-root allowance is added. A validator checks these invariants. The test now uses this candidate profile while keeping AppArmor unconfined on the disposable CI runner and retaining non-root execution, dropped capabilities, `no-new-privileges`, read-only rootfs and resource limits.

**This is still a candidate, not an approved deployment profile.** It must pass the actual Crawl4AI v0.9.6 / Chromium 158 runtime test, and the AppArmor policy/host configuration must be validated separately. The candidate profile is not yet wired into the private-gateway Compose deployment template. Do not copy `apparmor=unconfined` into deployment.

The design is informed by the Playwright Docker guidance that a separate unprivileged browser user should be combined with a seccomp profile that allows the browser's namespace operations, but this POC deliberately narrows the syscall argument flags rather than allowing `clone`, `setns` and `unshare` unconditionally. See [Playwright's Docker guidance](https://playwright.dev/docs/docker), [Docker seccomp documentation](https://docs.docker.com/engine/security/seccomp/) and [Chromium's Linux sandbox design](https://chromium.googlesource.com/chromium/src/+/main/docs/security/).


### Candidate seccomp runtime result — 28 November 2026

The isolated POC workflow passed [GitHub Actions run 117](https://github.com/NtandoSway7929/SWA/actions/runs/46126677958), commit `904ca1ab5a4c6677cf6b38bf4d53844a6fac53f0`. All three jobs passed: mocked adapter/policy contracts, Chromium sandbox host capability diagnostic, and the live provider/private-gateway Docker smoke test.

The Chromium diagnostic specifically verified:

- The candidate profile passed its static invariants: default-deny, filtered `clone` and `unshare`, `clone3` returning ENOSYS, no blanket `setns` or mount-family allowance, and the scoped `chroot` rule.
- The pinned Crawl4AI v0.9.6 image started with `CRAWL4AI_CHROMIUM_SANDBOX=true`, non-root `appuser`, all capabilities dropped, `no-new-privileges`, read-only rootfs and resource limits.
- A real crawl of `https://example.com/` returned readable content.
- A Chromium renderer process was observed without `--no-sandbox`.

**Important limitation:** the diagnostic set `kernel.apparmor_restrict_unprivileged_userns=0` on the disposable GitHub runner and used `apparmor=unconfined` for the test container. It did use the candidate filtered seccomp profile. Therefore the run proves the Chromium sandbox can launch with this seccomp candidate in that ephemeral environment; it does not validate an AppArmor profile, a production host, or the complete private-gateway security boundary. The initial passing test still used AppArmor unconfined. A follow-up test with Docker's default AppArmor profile is recorded below. The candidate profile has since been wired into the isolated private-gateway Compose template, but this remains a POC configuration and is not deployed.


### Default AppArmor retest and private-gateway Compose integration — 28 November 2026

The next isolated CI run passed [GitHub Actions run 119](https://github.com/NtandoSway7929/SWA/actions/runs/46126995477), commit `43c4e2744996ac98ee8af8dc27b1fdb2a3215319`. The Chromium runtime test used the candidate filtered seccomp profile **and Docker's default AppArmor profile**; it no longer used `apparmor=unconfined`. The disposable runner still set `kernel.apparmor_restrict_unprivileged_userns=0`, and the real `https://example.com/` crawl succeeded with a Chromium renderer observed without `--no-sandbox`.

This narrows the requirement: the tested combination is the candidate seccomp profile + Docker default AppArmor profile + host unprivileged-user-namespace support with the Ubuntu AppArmor userns restriction disabled. It does not prove that the restriction can remain enabled using a dedicated AppArmor profile. That remains an alternative host-hardening investigation.

The candidate profile is now referenced by the isolated private-gateway Crawl4AI service as `seccomp=./chromium-seccomp.json`. The static validator checks that reference and the profile invariants. The existing private-gateway Docker smoke test also starts the Compose stack, so it validates that Docker Compose can load the configured profile. It does not run a sandbox-enabled crawl through that gateway stack; the dedicated runtime job does that separately.

**No production changes:** this Compose file, profile and validator exist only on `poc/bof-open-source-inspection-providers`. No production services, host sysctls, secrets, or deployed infrastructure were changed. A future Linux host must pass a read-only network/firewall inventory and the same runtime sandbox test before deployment. Do not apply the host sysctl change without evaluating its effect on that host's user-namespace security posture.


## Chromium sandbox runtime diagnostic — 28 November 2026

The isolated POC branch passed [GitHub Actions run 119](https://github.com/NtandoSway7929/SWA/actions/runs/46126995477), commit `43c4e2744996ac98ee8af8dc27b1fdb2a3215319`. The workflow now includes a separate `Chromium sandbox host capability diagnostic` job before the API integration job.

The diagnostic uses the pinned Crawl4AI 0.9.6 image and the candidate filtered seccomp profile at `scripts/bof-open-source-provider-poc/private-gateway/chromium-seccomp.json`. On the disposable GitHub-hosted Ubuntu 26.04 runner, it temporarily set `kernel.apparmor_restrict_unprivileged_userns=0` (only on that ephemeral runner), confirmed `kernel.unprivileged_userns_clone=1`, started Crawl4AI as non-root `appuser` with `cap_drop: ALL`, `no-new-privileges`, read-only root filesystem, bounded tmpfs mounts, and the candidate seccomp profile, while leaving Docker's default AppArmor profile enabled.

The test then made a real crawl request to the reserved public test page `https://example.com`. It returned readable content. During the request, the test observed a Chromium renderer/GPU process command line without `--no-sandbox`. The runtime test reported that Chromium launched with user namespaces under the candidate seccomp profile. The seccomp validator also passed its static checks for the default-deny profile, filtered `clone`/`unshare` rules, `clone3` returning ENOSYS, and absence of blanket `setns`/mount allowances.

**What this establishes:** the pinned Crawl4AI image can complete a real browser-backed fetch with `CRAWL4AI_CHROMIUM_SANDBOX=true` on this particular disposable GitHub-hosted Linux runner, using the candidate seccomp profile and after relaxing that runner's AppArmor unprivileged-user-namespace restriction.

**What this does not establish:** it does not prove the same sysctl/AppArmor combination is available or appropriate on a future host; that the profile is portable to all Linux distributions or Docker versions; that all Chromium renderer processes remain sandboxed under every workload; or that the full production container/gateway stack is secure. It is not a production-host acceptance test. The test log also emitted shell warnings while reading process command lines because null bytes were stripped during command substitution; the test passed, but this diagnostic output handling should be cleaned up before treating the script as final-quality tooling.

The next host-independent step is to improve the runtime assertion so it verifies the renderer's kernel-enforced sandbox state (not only the absence of `--no-sandbox` in its arguments), remove the null-byte warnings, and add regression checks. A real deployment still requires a selected no-cost Linux Docker host and a read-only host capability audit; no paid server or production changes are authorised.


### Final sandbox CI verification after Compose integration — 28 November 2026

The latest isolated workflow passed [GitHub Actions run 140](https://github.com/NtandoSway7929/SWA/actions/runs/46129501671), commit `c3520288a760fbd396c62f47167a36648a376a04`. All three jobs passed:

- Mocked provider, host-egress policy, private-gateway topology and Chromium seccomp invariant checks.
- Chromium sandbox runtime diagnostic using the pinned Crawl4AI v0.9.6 image, candidate seccomp profile, Docker's default AppArmor profile, non-root `appuser`, dropped capabilities, `no-new-privileges` and read-only root filesystem.
- Live SearXNG/Crawl4AI and private-gateway Compose smoke tests. The private-gateway stack started successfully with the seccomp profile path configured in Compose.

The sandbox diagnostic set `kernel.apparmor_restrict_unprivileged_userns=0` on the disposable GitHub runner only. The reserved `https://example.com/` crawl returned readable content, and a Chromium renderer process was observed without `--no-sandbox`. This matches Crawl4AI's upstream runtime verification runbook for the sandbox-enabled path. The test does not capture the renderer's user-namespace inode or count its individual seccomp filters, so it is not a kernel-level sandbox introspection audit.

**Deployment gate remains open:** the tested host combination requires unprivileged user namespaces and the host AppArmor user-namespace restriction disabled. We have not created a dedicated AppArmor profile that grants user namespaces more selectively. Do not assume the same sysctl setting is appropriate for a shared or general-purpose host. A selected Linux Docker host must undergo the read-only network/firewall audit, host-specific userns/AppArmor review and sandbox runtime test before deployment. No production service, host firewall, host sysctl, secret, paid server or public endpoint has been changed.



### Latest verified sandbox and gateway CI result — 28 November 2026

The isolated POC workflow passed [GitHub Actions run 140](https://github.com/NtandoSway7929/SWA/actions/runs/46129501671), commit c3520288a760fbd396c62f47167a36648a376a04. All three jobs passed:

- Mocked provider adapter contract, host-egress policy validation, Compose validation and policy tests.
- Chromium sandbox host capability diagnostic.
- Live SearXNG/Crawl4AI integration and private-gateway runtime smoke test.

The sandbox diagnostic used the candidate filtered seccomp profile, Docker's default AppArmor profile, non-root appuser, dropped capabilities, no-new-privileges, read-only rootfs and resource limits. It set kernel.apparmor_restrict_unprivileged_userns=0 only on the disposable CI runner. The pinned Crawl4AI v0.9.6 image completed a real https://example.com/ crawl, and the test observed a Chromium renderer process command line without --no-sandbox.

The live private-gateway test also started the Compose stack, verified Valkey health, confirmed the intended network membership and absence of published host ports, confirmed Caddy has no outbound egress, and successfully fetched reserved example.com through the gateway to Crawl4AI. The cloudflared connector was deliberately not started.

Correction to the earlier diagnostic iteration: several intervening test runs failed because the observation script itself was defective (a missing shell state variable, an incorrect result-count assertion, and process-monitoring approaches that did not capture the short-lived renderer). Those failures did not demonstrate a Chromium sandbox failure. The final run above passed with the simpler renderer command-line observation that had already passed in run 119. It does not inspect the renderer's /proc/<pid>/status fields or prove the user-namespace inode differs from the container init process.

Remaining sandbox evidence gap: the runtime check currently verifies that a Chromium renderer command line was observed without --no-sandbox; the static validator verifies the candidate seccomp policy structure. It does not yet prove, from the renderer's kernel state, Seccomp=2, NoNewPrivs=1 and a distinct user namespace. Do not describe that stronger verification as complete.

No paid server has been purchased or selected. No production branch, production service, production secret, Supabase deployment, Cloudflare Tunnel, or host firewall has been changed. The next work remains in this isolated branch: improve the renderer kernel-state observation using a reliable host-PID mapping, then validate the selected no-cost/existing Linux Docker host if one is available. No hosting purchase is required to continue the POC.


### Renderer kernel-state assertion passed — 28 November 2026

The isolated POC workflow passed [GitHub Actions run 147](https://github.com/NtandoSway7929/SWA/actions/runs/46130282821), commit `278cb4bb6aa2ce396d9477f015bf72d81e63f97e`. The Chromium runtime test now observes the container's processes through Docker's host-visible PID table and inspects the actual renderer's host `/proc/<pid>/status` and user-namespace inode.

The captured renderer record showed:

- `RENDERER=True` and no `--no-sandbox` argument.
- `Seccomp=2` (seccomp filter mode).
- `NoNewPrivs=1`.
- `USERNS_DIFF=True`: the renderer's user-namespace inode differs from the Crawl4AI container init process.

The test now asserts all three kernel-state properties on the same renderer record, in addition to a successful sandbox-enabled crawl. All three workflow jobs passed, including the live private-gateway Compose smoke test. This closes the POC's Chromium runtime sandbox evidence gap for the tested combination: candidate filtered seccomp profile, Docker default AppArmor profile, non-root user, dropped capabilities, no-new-privileges and read-only filesystem.

**Remaining host policy decision:** the GitHub runner still required `kernel.apparmor_restrict_unprivileged_userns=0`. This was changed only on the disposable runner. Before deployment, investigate a narrowly scoped AppArmor `userns,` rule for the Crawl4AI container so the host-wide Ubuntu restriction can potentially remain enabled. Do not apply the global sysctl change to a real/shared host without a separate security decision. No host or production configuration was modified.
