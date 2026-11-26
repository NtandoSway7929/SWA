# Business Opportunity Finder — Phase 4 evidence inspection

**Status:** Core implementation is in progress on PR #302's isolated feature branch. The public consent path, private inspection tables migration draft, admin-only TinyFish Search/Fetch Edge Function and source-evidence viewer are implemented. Feature tests and Deno type-check pass. No production schema or function deployment has occurred.  
**Branch baseline:** `feat/business-opportunity-finder-phase1-spec` after reconciliation with `main` on 26 November 2026.  
**Scope:** Read-only inspection of public business information. No public report retrieval, public-page scraping from the browser, or automatic lead conversion is introduced by this phase.

## 1. Purpose and boundary

Phase 4 adds independent evidence to the existing answer-led Business Opportunity Finder. It must not overwrite, relabel, or silently strengthen the five-question assessment findings that are currently generated from respondent answers.

The inspection layer covers three independent source groups:

1. **Business website** — reachability, page identity, key public information, visible contact or booking routes, and links to other official channels.
2. **Google Business Profile** — whether a likely listing can be identified and verified as the same business, plus the public profile fields actually visible.
3. **Public social profiles** — official business pages/profiles on platforms such as Instagram, Facebook, TikTok or LinkedIn, with only publicly accessible profile-level information inspected.

The source groups must have separate statuses and evidence references. A successful website fetch must not imply that a Google Business Profile or social profile was inspected.

### Current implementation facts

- The public assessment currently collects five answer groups: industry, discovery channels, contact methods, friction/challenges and priority.
- The stored `business_profile` currently contains business name and location. The five assessment questions do not themselves prove that a business owns a particular domain, Google listing or social account.
- The current server rules label findings `self_reported` and explicitly state that no independent website, social or Google Business Profile inspection has been performed.
- The deployed submission function returns the immediate report and an opaque assessment ID. That ID alone is not a public report-access credential.
- Phase 4 must therefore create a distinct inspection record. It must not add inspection observations directly to the existing respondent answers or make a public database read possible.

## 2. Trigger and consent

### Recommended first release

Use an explicit **Inspect public presence** action in the authenticated Business Assessments admin viewer. The action should be available only to a Swayphics administrator and should not be part of public assessment submission.

This first release keeps the public report immediate, preserves existing privacy boundaries, and allows an administrator to review candidate identities before findings are described as belonging to the business.

Before implementation, add an optional public notice/consent control and optional URL fields to the assessment experience:

- Website URL
- Google Maps / Business Profile URL
- Public social profile URLs (platform + URL, limited to five)
- Separate consent to inspect the submitted links and discoverable public business listings for the diagnostic

The contact-request checkbox must remain separate. Permission to inspect public sources is not permission to contact the business, and a contact request must never be inferred from inspection consent.

Do not inspect existing submissions that have no recorded inspection consent. Treat missing consent as `not_requested`; do not backfill consent. A later admin workflow may allow an administrator to record a separately obtained approval, but that approval must be auditable and attributable to the administrator.

Respondent-provided URLs are candidate source references, not proof of ownership. The inspection must still check that the page content and identity signals reasonably relate to the assessed business.

## 3. Inspection workflow

1. An administrator opens an assessment and selects **Inspect public presence**.
2. The authenticated endpoint verifies the user's current Swayphics-admin status. The browser never receives the TinyFish key or service-role credentials.
3. The endpoint creates an inspection run with a stable ID, version, requested source groups, consent reference, requester and `queued` status.
4. The run transitions to `running`. Each source group is independently processed and persisted; a failure on one source must not erase a success from another.
5. The worker discovers candidates with TinyFish Search where a URL was not supplied, then fetches only a small, bounded set of selected public URLs.
6. Candidate identity is checked against the business name and location. Ambiguous search results remain candidates for administrator confirmation; they are not treated as verified business pages.
7. The worker stores source metadata and bounded evidence, not a full copy of the public website or social feed.
8. The inspection run is marked `completed`, `partial` or `failed`. The admin viewer shows all source statuses, observations, links, timestamps and failure explanations.
9. A later proposal may include only selected evidence references and evidence-backed observations in its immutable assessment snapshot. It must retain the original `self_reported` assessment findings separately.

The inspection action must be idempotent. Double-clicking, retrying a timed-out request, or refreshing the admin page must not create concurrent duplicate runs for the same inspection request.

### Background execution

The preferred implementation is a dedicated admin-authenticated Supabase Edge Function that records the run before scheduling a bounded `EdgeRuntime.waitUntil(...)` task. Supabase documents this mechanism for work that continues after the HTTP response, but the worker remains subject to the project's wall-clock and resource limits. The documented hosted wall-clock limit is 150 seconds on Free and 400 seconds on paid plans; the actual Swayphics project plan must be confirmed before setting worker budgets.

Persist each state transition before or immediately after the corresponding external call. Catch failures per source group. If a worker is terminated, leave a detectable stale `running` state and allow an administrator to retry it safely. Do not rely on an in-memory promise as the only record that work exists.

A first implementation should use Search + Fetch only. Do not add TinyFish Agent / browser automation to the default workflow; reserve it for a later, explicitly approved fallback for a specific source that cannot be checked with Search + Fetch.

## 4. TinyFish provider integration

The application must call TinyFish's **REST API from a Supabase Edge Function**. The installed TinyFish MCP/assistant connector is not an application runtime integration and must not be embedded in the website.

### Authentication and secret handling

- Create a dedicated TinyFish REST API key for the Swayphics runtime.
- Store it as Supabase Edge Function secret `TINYFISH_API_KEY`.
- Send it only in the `X-API-Key` request header from server-side code.
- Never place it in HTML, browser JavaScript, GitHub source, assessment data, logs, or error responses.
- Use separate development and production keys and rotate the key if it is exposed.
- Fail closed with `provider_not_configured` when the secret is absent. Do not fall back to a public client-side request.
- The current connected Supabase tools do not expose a secrets-list or secret-write action, so availability of this key has not been verified. Configure it through the Supabase project's secret manager before enabling the worker.

TinyFish REST API authentication is API-key based and is separate from TinyFish MCP authentication. See [TinyFish Authentication](https://docs.tinyfish.ai/authentication).

### Search

Use:

`GET https://api.search.tinyfish.ai?query=...&location=ZA&language=en`

with the `X-API-Key` header. Search results provide ranked candidates with position, site name, title, snippet and URL. They are discovery material only; a result snippet alone is not sufficient evidence that the business currently has a particular feature or service.

Use bounded, deterministic queries. Example query patterns:

- `"<business name>" "<location>" official website`
- `"<business name>" "<location>" Google Maps business profile`
- `"<business name>" "<location>" official Instagram OR Facebook OR TikTok`

Search should return a small candidate set. Save the query, search timestamp and candidate references so that the administrator can inspect how a candidate was found. Avoid repeatedly issuing broad or duplicate searches.

TinyFish currently documents 30 Search requests per minute on its Free and Pay As You Go plans (higher limits on higher plans). Search does not consume credits, but account access is still required. Re-check plan limits at implementation time.

### Fetch

Use:

`POST https://api.fetch.tinyfish.ai`

with `X-API-Key`, `Content-Type: application/json` and a bounded request body, for example:

```json
{
  "urls": ["https://example.com"],
  "format": "markdown",
  "links": true,
  "image_links": false,
  "ttl": 0,
  "include_etag_and_last_modified": true,
  "per_url_timeout_ms": 25000
}
```

TinyFish Fetch accepts up to 10 public HTTP/HTTPS URLs per request. It returns successful items in `results[]` and per-URL failures in `errors[]`; a successful HTTP response can therefore still contain a failed source. The response includes original and final URLs, title, description, language, extracted text, and optional ETag/Last-Modified validators.

Use a bounded timeout for this workflow, not the provider's maximum. `ttl: 0` requests a fresh fetch for an explicit admin-triggered inspection. For any later refresh/caching implementation, store and replay ETag or Last-Modified validators for a single-URL conditional request; do not assume TinyFish stores validators on the caller's behalf.

Handle the provider's source-specific errors explicitly, including `page_not_found`, `target_unreachable`, `timeout`, `bot_blocked`, `empty_content`, `invalid_url`, `invalid_redirect_url` and `proxy_error`. A 200 response with an entry in `errors[]` is not a successful fetch of that source.

TinyFish currently documents 150 URLs per minute on its Free and Pay As You Go Fetch plans and states that Fetch does not consume credits. Confirm actual account access and live limits before rollout. See [TinyFish Search API](https://docs.tinyfish.ai/search-api) and [TinyFish Fetch API Reference](https://docs.tinyfish.ai/fetch-api/reference).

### Agent / Browser fallback

Do not invoke TinyFish Agent or Browser automatically in Phase 4 v1. They are separate workflows, require their own time/cost controls, and may use credits. If a source is bot-blocked or requires login, record that limitation. Never bypass authentication, paywalls, CAPTCHA or private-account controls to force an inspection.

## 5. Identity and evidence rules

### Source identity

- A submitted URL is not automatically an official business URL.
- Prefer a URL explicitly supplied by the respondent, but check the fetched page for business-name and other identity signals.
- For discovered candidates, require a strong, explainable match using business name and location or a clearly linked official domain/profile.
- If several similar businesses exist, store candidates as `needs_admin_review`. Do not choose the first search result merely because it ranks first.
- A Google search snippet is not a Google Business Profile observation. The Google source must resolve to an identifiable public Google listing/profile.
- A social profile is not considered official merely because its handle resembles the business name. Require corroborating identity signals or explicit admin confirmation.
- Keep matching basis as human-readable reasons, not a fabricated percentage score.

### Permitted finding classifications

Phase 4 may introduce `observed` evidence, but it must preserve the existing classifications:

- `self_reported`: selected or supplied by the respondent.
- `observed`: directly visible on a successfully fetched, identity-matched public source.
- `inferred`: a cautious implication based on one or more recorded observations.
- `unverified`: a claim or candidate that could not be independently checked.

Every observation must store the source URL, final URL when redirected, capture time, source type, inspection/run ID and the relevant extraction reference. Any written business implication must cite one or more stored observations.

### Source statuses

Use explicit source-level states:

- `not_requested`
- `candidate_found`
- `needs_admin_review`
- `observed`
- `not_found_in_search`
- `unverifiable`
- `blocked`
- `unreachable`
- `timeout`
- `fetch_error`

Use explicit run-level states:

- `queued`
- `running`
- `completed`
- `partial`
- `failed`
- `cancelled`

A source-level `not_found_in_search` is not proof that no website, listing or social profile exists. A bot block, timeout, DNS failure or empty extraction is not proof of absence. The admin UI must display the limitation as a limitation, not as a negative business finding.

## 6. Data model proposal

Add two new tables in a future, separately reviewed migration. Do not add these fields to the existing five-question response JSON or overwrite existing report findings.

### `public.business_assessment_inspections`

One row per run:

| Field | Purpose |
|---|---|
| `id` uuid PK | Inspection run identity |
| `assessment_id` uuid FK | Parent assessment |
| `inspection_version` text | Version of discovery and deterministic observation rules |
| `status` text | Run-level state |
| `requested_sources` jsonb | Requested source groups and selected URL references |
| `requested_by` uuid nullable | Authenticated administrator who initiated the run |
| `consent_version` text | Version of public-inspection notice/consent |
| `provider` text | `tinyfish` |
| `provider_request_id` text nullable | Provider request reference, if returned |
| `failure_code` text nullable | Stable internal failure classification |
| `failure_summary` text nullable | Sanitized user/admin-readable summary |
| `queued_at`, `started_at`, `completed_at` | Lifecycle timestamps |
| `created_at`, `updated_at` | Audit timestamps |

Allow several historical runs per assessment; never overwrite a completed run. Add indexes for `assessment_id, created_at desc` and `status, created_at`. Add an idempotency key with a unique constraint for safe retries.

### `public.business_assessment_evidence`

One row per source/candidate observation:

| Field | Purpose |
|---|---|
| `id` uuid PK | Evidence identity |
| `inspection_id` uuid FK | Parent run |
| `source_type` text | `website`, `google_business_profile`, `social_profile` |
| `source_status` text | Source-level state |
| `platform` text nullable | Social platform or `google_maps` |
| `requested_url` text nullable | User/admin supplied URL |
| `source_url` text nullable | Search or source URL |
| `final_url` text nullable | Resolved URL after redirects |
| `source_title` text nullable | Public page/listing title |
| `observations` jsonb | Allowlisted structured facts visible on the source |
| `evidence_excerpt` text nullable | Short, sanitised supporting excerpt with strict length cap |
| `identity_match_status` text | `confirmed`, `ambiguous`, `rejected`, `not_checked` |
| `identity_match_basis` jsonb | Explainable matching signals |
| `provider_error_code` text nullable | TinyFish per-source error |
| `upstream_status` integer nullable | HTTP status where available |
| `provider_request_id` text nullable | TinyFish request reference |
| `content_sha256` text nullable | Fingerprint of bounded extracted content, not a substitute for source URL |
| `observed_at` timestamptz nullable | When the public information was captured |
| `created_at` timestamptz | Persistence timestamp |

The exact enum/check constraints and retention period must be agreed during migration review. Use foreign keys and indexes; prevent cross-assessment evidence access by deriving access through the parent assessment and existing admin predicate.

### RLS and privileges

- Enable RLS on both tables.
- Authenticated Swayphics admins may read through `public.is_swayphics_admin()`.
- No `anon` or public SELECT/INSERT/UPDATE/DELETE access.
- Edge Function service role writes only the required run and evidence rows.
- Do not add the TinyFish key or any service credential to database rows.
- Do not put API tokens or private credentials into provider request logs.

## 7. Deterministic observations for v1

The first pass should use explicit extraction rules over TinyFish's fetched public content. No generative model is required to decide whether evidence exists.

### Website

Possible observations, only when visible in fetched content:

- page title and meta description;
- whether a primary navigation or service description is present;
- whether a public email, telephone link, contact page, booking link or checkout link is visible;
- whether a public address/location is stated;
- outbound links to official social profiles;
- whether the fetched page appears to be an error/holding page or an unrelated domain.

Do not claim that a booking flow works merely because a booking link exists. Do not claim a site is non-existent merely because search or fetch did not find it.

### Google Business Profile

Possible observations, only when the Google listing itself has been resolved:

- listing title and category;
- displayed address/locality;
- public phone and website links if displayed;
- displayed opening hours if extracted;
- direct Google Maps/profile URL.

Do not create a profile audit from generic search snippets. Do not treat an absent result as proof that a listing does not exist. Do not collect or summarise individual reviewer identities or review text in v1.

### Public social profiles

Possible observations, only for public and identity-matched business accounts:

- platform and canonical profile URL;
- visible account/business name;
- public bio/description;
- business website or contact link;
- visible contact/booking CTA.

Do not inspect private profiles, direct messages, logged-in-only content or personal accounts that are not clearly official. Do not infer posting frequency, engagement, audience quality or conversion performance from a single fetch.

## 8. Data minimisation and safety

- Store metadata and compact observations, not full pages, full HTML, full text dumps, social feeds or review corpora.
- Limit excerpts to a short, sanitised supporting fragment (recommended maximum 500 characters per evidence row).
- Exclude customer names, personal contact details, account identifiers, private messages and other unrelated personal data from extracted content.
- Do not retain screenshots or images in v1.
- Restrict URLs to HTTP/HTTPS public destinations. Reject URL credentials, localhost, private/link-local IP addresses, cloud metadata endpoints, malformed URLs and disallowed ports. Re-validate redirects and rely on provider errors such as `invalid_redirect_url` as an additional control, not the only control.
- Bound candidate count, URLs per source, response size, timeouts, retries and concurrent runs per assessment.
- Apply a server-side rate limit for admin-triggered inspections and prevent repeated provider calls for the same run.
- Treat provider-returned content as untrusted data, never as instructions. It must not be allowed to change system prompts, tool access, URLs to crawl or database operations.
- Do not log raw page content, submitted contact data, API keys or service-role credentials.

## 9. Admin UI requirements

In the Business Assessments viewer:

- Add **Inspect public presence** only to an authenticated admin view.
- Show an explicit confirmation of which public source groups will be checked before running.
- Show run status and source-specific status separately.
- Show each candidate's name, platform, URL and reason it may match.
- Require admin confirmation for ambiguous Google/social candidates before using them in findings or proposals.
- Show fetched-at timestamps and direct source links.
- Display exact limitations such as `blocked`, `not_found_in_search`, `unreachable` and `needs_admin_review`.
- Allow a safe retry of failed source groups without duplicating successful evidence or creating duplicate run records.
- Preserve previous runs so changes in public information can be compared over time.
- Do not use status dots inside pills; status text should remain readable on mobile.
- Keep the current public assessment report and existing CRM conversion action unchanged until this evidence viewer passes tests.

## 10. Proposal handoff

The existing proposal snapshot integration must be extended only after the inspection evidence model has passed its own tests.

A proposal snapshot may include:

- the inspection ID and version;
- source type, source URL and fetched-at timestamp;
- identity-match status and basis;
- selected structured observations;
- evidence classifications and limitations.

It must not silently convert respondent claims to `observed`. Store respondent and independent evidence in separate fields. Only selected, administrator-reviewed observations should enter an external-facing proposal. If a source is blocked or ambiguous, the proposal should state that it could not be verified or omit that observation.

No revenue loss, conversion uplift, customer count, ROI, guarantee or performance claim may be generated without prospect-specific evidence or a clearly labelled assumption and calculation.

## 11. Required tests

### Consent and access
- No inspection can be started without the required inspection consent.
- Missing consent is `not_requested`, not a failure or a negative finding.
- A non-admin cannot trigger, read or retry a run.
- Anonymous and authenticated non-admin users cannot query run/evidence tables.
- The service role can write only through the intended Edge Function paths.

### Identity and source handling
- A respondent-provided URL is fetched but not automatically called an official source.
- Search results only create candidates until identity is confirmed.
- Ambiguous businesses with similar names are held for manual review.
- A Google Maps listing is not created from a general search snippet alone.
- Public social pages are inspected; private/logged-in-only pages are not.
- One successful channel does not hide another channel's failure.

### Provider contract
- TinyFish Search 401/402/403/429/500/503 errors map to safe internal statuses.
- TinyFish Fetch HTTP-level failures are handled separately from per-URL `errors[]`.
- Per-URL errors including `bot_blocked`, `page_not_found`, `target_unreachable`, `timeout` and `invalid_redirect_url` map to precise source states.
- Redirects to private destinations are rejected.
- No API key appears in browser requests, source, database rows or logs.
- Missing `TINYFISH_API_KEY` returns `provider_not_configured` and makes no outbound request.

### Run lifecycle and data integrity
- Double-click and replay create no duplicate inspection run.
- Worker state transitions are persisted.
- A worker failure after one source succeeds keeps the successful evidence and marks the overall run `partial`.
- A stale `running` task can be retried without duplicating evidence.
- A new run creates history; it does not overwrite previous observations.
- Each observation points to an exact source URL and capture time.

### Report and CRM integrity
- Existing `self_reported` finding classifications remain unchanged.
- Inspection records do not create or convert leads.
- Existing assessment conversion behaviour remains unchanged.
- Proposal snapshots keep source references and classifications, and exclude ambiguous/unreviewed evidence.
- No fabricated absence, revenue, conversion, ROI or uplift claim appears.

### UX and accessibility
- Mobile and desktop admin layouts work.
- Inspection confirmation, loading, partial, failure and retry states are clear.
- Keyboard and screen-reader navigation work.
- No completion message appears before the run is persisted.
- Source URLs are safe, visible and open in a new tab with appropriate link protections.

## 12. Implementation sequence and release gate

1. Review TinyFish's current self-service data terms before sending any assessment-related information. Its published Terms of Service allow submitted Customer Data to be used for service operation and improvement, including AI-model training/evaluation. Confirm this is acceptable for Swayphics and the intended business-assessment data, or obtain a separate written agreement with suitable data-use restrictions. Do not enable live inspections until this decision is recorded.
2. Confirm TinyFish REST API account access and configure `TINYFISH_API_KEY` in a non-production Supabase environment. The key must never be pasted into chat or committed.
3. Add optional public-source URLs and versioned inspection consent to the isolated assessment form, with provider-use disclosures in the Swayphics Privacy Policy and the consent notice.
4. Add a reviewed migration for the inspection-run and evidence tables, RLS, indexes and admin read policies. Do not apply it to production before approval and a clean migration-history reconciliation.
5. Add deterministic URL validation and provider contract helpers with mocked tests.
6. Add the admin-authenticated inspection Edge Function and bounded background worker.
7. Add the assessment viewer's source-candidate, evidence and retry UI.
8. Run feature-specific tests, security tests, browser tests and provider failure simulations.
9. Verify a controlled test assessment end-to-end using public test pages and a test TinyFish key.
10. Only then update proposal snapshot handoff and review the final migration/function deployment plan.

**Release gate:** Phase 4 is not complete until the Swayphics administrator can trigger an inspection, view source-specific observed evidence and limitations, retry safely, and demonstrate that the same assessment's existing self-reported findings and CRM state remain unchanged.

## 13. Provider and platform references

- [TinyFish REST API authentication](https://docs.tinyfish.ai/authentication)
- [TinyFish Search API overview](https://docs.tinyfish.ai/search-api)
- [TinyFish Search API reference](https://docs.tinyfish.ai/search-api/reference)
- [TinyFish Fetch API reference](https://docs.tinyfish.ai/fetch-api/reference)
- [Supabase Edge Functions background tasks](https://supabase.com/docs/guides/functions/background-tasks)
- [Supabase Edge Functions limits](https://supabase.com/docs/guides/functions/limits)

The external API contracts and platform limits were checked on 26 November 2026. Verify them again when implementation begins.
