# InnerMe External Integration Pilot Decision

**Status:** Proposed pilot; not approved for production  
**Provider:** National Treasury Municipal Money API  
**Decision type:** Provider suitability and capability design  
**Evidence checked:** Official API documentation, published terms of use, and a live read-only API catalogue response reviewed 4 November 2026.

## 1. Recommendation

Use the **National Treasury Municipal Money API** as the first technical integration pilot, in an isolated test environment.

Why this provider:
- It is an official National Treasury public-data API.
- The API documentation specifies GET-only requests and JSON responses.
- The terms permit free commercial and non-commercial reuse, subject to source/date attribution, no misleading presentation, privacy protections, and no implication of National Treasury endorsement.
- It provides South African municipal financial datasets, including income/expenditure, cash flow, financial position, audit opinions, grants, and unauthorised/irregular/fruitless/wasteful expenditure.
- The API catalogue endpoint returned a successful JSON response during this review.

This is a good low-risk technical proof of the gateway's read-only controls. It is not yet a claim that municipal finance data is InnerMe's highest-value long-term integration.

## 2. Official provider facts

- API base URL: `https://municipaldata.treasury.gov.za/api`
- API docs: `https://municipaldata.treasury.gov.za/docs`
- Terms: `https://municipalmoney.gov.za/terms`
- Catalogue endpoint: `GET /cubes`
- Example dataset endpoint: `GET /cubes/incexp_v2/model`
- Facts endpoint pattern: `GET /cubes/<name>/facts`
- Aggregation endpoint pattern: `GET /cubes/<name>/aggregate`
- Supported method: GET only; successful responses are JSON.
- The documentation describes pagination and a maximum page size of 10,000.
- The dataset is updated quarterly. The documentation page showed 2026 Q2 data and stated that it was still being checked for completeness and integrity at the time of review.

The API publishes Section 71 municipal financial submissions. The documentation cautions that the data is only as complete and trustworthy as the submissions provided by municipalities. It also explains that snapshots are updated quarterly and that later amendments can cause differences from previously published reports.

## 3. Terms and data-use requirements

The published terms allow free commercial and non-commercial use, including adaptation and inclusion in a product or application, subject to conditions.

InnerMe must:
- Attribute National Treasury as the data source and include the publication date.
- Avoid misleading users or distorting source material.
- Avoid using personal data that may be present in datasets.
- Never imply National Treasury endorses InnerMe, Swayphics, or an analysis.
- Link to source material where appropriate.
- Display data-quality and freshness caveats.

The terms disclaim warranties of accuracy, completeness, currency, and availability. This is a material product requirement, not boilerplate to omit from the user-facing evidence record.

## 4. Proposed first capability

Stable capability key: `za.municipal_money.income_expenditure.read`

Purpose: Retrieve a narrowly scoped, read-only municipal income/expenditure dataset for evidence-based analysis.

Initial fixed provider route:
- Host: `municipaldata.treasury.gov.za`
- Method: GET only
- Dataset: `incexp_v2` only
- Path template: `/api/cubes/incexp_v2/facts`
- Initial page size: 100 maximum (gateway-enforced)
- No arbitrary host, dataset, path, method, or URL accepted from the model.

Parameters to expose after schema validation:
- municipality demarcation code (string from the provider's published municipality dimension);
- financial year (bounded integer);
- financial period (bounded integer or documented period value);
- amount type (must be an exact provider-supported code);
- optional allowlisted item codes;
- page (positive bounded integer, default 1).

Do not assume or hardcode amount-type codes until the provider's live metadata has been inspected and mapped. Do not allow the model to construct raw `cut`, `order`, `drilldown`, or URL query strings. The gateway must construct query parameters from validated fields and a fixed template.

## 5. Response contract

Return a normalized envelope, not the raw provider response as trusted instructions:

- `provider`: `national_treasury_municipal_money`
- `capability`: stable capability key
- `source_url`: exact canonical provider endpoint used
- `retrieved_at`: server-side UTC timestamp
- `publication_period`: provider period where available
- `dataset`: `incexp_v2`
- `query`: validated, non-secret query parameters
- `data_status`: provider status and any data-quality warnings
- `records`: bounded normalized rows
- `pagination`: current page, page size, and total count when supplied
- `attribution`: National Treasury and publication-date wording
- `limitations`: source caveats relevant to the result

Preserve source values and missingness. The API documentation discusses null values and missing submissions; InnerMe should not silently convert a missing value into a factual zero in its own analytical layer. Any normalization rule must be explicitly documented and tested against the source's semantics.

## 6. Security and resource limits

- Authenticated active Swayphics admin only for the pilot.
- Fixed HTTPS origin and fixed route template.
- GET only; no writes or side effects.
- Fixed dataset allowlist; no arbitrary URL or host input.
- Strict parameter schemas and maximum lengths/ranges.
- Page size hard cap of 100 for the pilot.
- Short request timeout, response byte cap, and bounded retry policy.
- Validate redirects; reject redirects to any host other than the approved provider host.
- Validate resolved destination IPs and block private, loopback, link-local, and reserved ranges to mitigate SSRF and DNS rebinding.
- Do not send customer records, prompts, or secrets to the provider.
- Treat provider content as untrusted external evidence.
- Log capability, status, latency, response size, and error category; do not log full prompts or unnecessary data.
- Cache only if freshness semantics are explicit and the cache key includes all validated query parameters.

## 7. InnerMe knowledge governance

The integration returns external evidence only. It must not:
- write directly to `innerme_knowledge`;
- mark fetched data as verified knowledge;
- bypass source verification, review windows, embedding readiness, or publication controls;
- create action proposals or execute actions.

If an administrator later wants a result retained as knowledge, it must enter the existing knowledge-source/acquisition and verification workflow.

## 8. Acceptance tests

Before any production consideration, the isolated pilot must prove:

1. Valid municipality/year/period/amount-type request returns bounded JSON with source and retrieval metadata.
2. Unknown municipality code, amount type, dataset, method, and malformed parameters are rejected before network access.
3. Attempts to provide arbitrary URLs, private IPs, alternate hosts, redirects, or arbitrary query expressions are rejected.
4. Large responses, slow responses, malformed JSON, provider errors, and rate limits fail safely.
5. The raw source amount is retained separately. For a null source amount, the normalized amount is set to zero in line with the provider's explicit guidance; the response labels the original null value and carries the source's caveat that null or zero may indicate no further value was submitted.
6. Attribution, publication date, data-quality caveat, and freshness caveat survive normalization.
7. Provider content cannot alter system instructions or trigger actions.
8. No customer PII or credentials are transmitted or logged.
9. No write request is possible.
10. A failed provider request does not corrupt InnerMe knowledge, action, or execution state.
11. The production security review addresses DNS resolution/IP-range controls. The fixed host/path and disabled redirects prevent model-controlled destination changes, but they do not by themselves prove DNS rebinding protection.

## 9. Go/no-go boundary

**Go for isolated implementation planning:** yes. The official API, GET-only interface, and published commercial reuse terms make it a suitable technical pilot.

**Go for production deployment:** no. That requires a reviewed implementation, current provider metadata verification, isolated tests, security review, secret/configuration review, and explicit owner approval.

No API credentials are required by the published documentation for the described read-only API, but this should be confirmed during isolated connectivity testing. No provider calls have been made by InnerMe, and no production code or schema has been changed.
