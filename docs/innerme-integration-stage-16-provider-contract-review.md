# InnerMe Integration — Stage 16 Official Provider Contract Review

**Date:** 4 November 2026  
**Branch:** feature/innerme-municipal-money-gateway  
**PR:** #147  
**Status:** Public documentation reviewed. No live API request was sent and no Supabase project was accessed.

## Sources reviewed

1. National Treasury Municipal Finance API documentation: https://municipaldata.treasury.gov.za/docs
2. National Treasury Municipal Money terms of use: https://municipalmoney.gov.za/terms
3. Current Income and Expenditure (v2) data page: https://municipaldata.treasury.gov.za/table/incexp_v2/
4. National Treasury MFMA 2025–26 Section 71 second-quarter publication page: https://mfma.treasury.gov.za/Publications%20and%20Media%20Releases/Section%2071%20Information%20%28In-year%20Management%2C%20Monitoring%20and%20Reporting%29/2025-26/2nd%20Quarter/Default.aspx

The source pages were reviewed on 4 November 2026.

## 1. Dataset scope and field semantics

The API documentation identifies `incexp_v2` as the Statement of Financial Performance, a Section 71-level aggregation of mSCOA data from FY 2019–20 onwards, replacing the original `incexp` cube.

The documented v2 dimensions/attributes include:
- `amount_type.code` and `amount_type.label`;
- `financial_period.period`;
- `financial_year_end.year`, defined as the calendar year falling at the end of the financial year;
- `item.code`, `item.label`, composition and return-form position;
- `demarcation.code` and `demarcation.label`; and
- `period_length.length`.

The documentation describes the general API member pattern as `/cubes/<name>/members/<member_name>` and the facts pattern as `/cubes/<name>/facts`. It states that the API supports GET, successful responses use HTTP 200 with JSON, and monetary values are integer South African Rand amounts without cents.

The adapter's fixed facts/member routes and required response fields are consistent with the published endpoint pattern and documented dimensions. This is documentation-level validation only: no live v2 API response or current member catalogue has been inspected.

## 2. Financial-year validation correction

The prior adapter accepted financial-year values from 2020 through 2035. That allowed future years with no published data to pass input validation.

The public documentation says `incexp_v2` begins with FY 2019–20 and defines `financial_year_end.year` as the calendar year at the end of the financial year. The adapter therefore retains a lower bound of 2020 and now caps the upper bound at the current UTC calendar year. It no longer accepts arbitrary future years.

This is a guardrail, not proof that data exists for every year in the range. The Treasury site currently displays 2026 Q2 as its latest update and says those figures are still undergoing completeness and integrity verification. Its public v2 table page also shows earlier year choices in its selector; the relationship between those choices and the documented v2 coverage needs query-level confirmation. The lower-year boundary and exact available years must be checked against actual v2 metadata before production release.

The latest provider-free gateway validation passed [run #41820778732](https://github.com/NtandoSway7929/SWA/actions/runs/41820778732): **60/60 tests passed**, Edge Function type-check passed and `git diff --check` passed. The full adapter Edge Runtime mock also passed [run #41820772769](https://github.com/NtandoSway7929/SWA/actions/runs/41820772769). It continues to validate three catalogue preflights and one facts request; it does not call Treasury.

## 3. Provider freshness and reliability

The API documentation says Municipal Money is updated quarterly from snapshots of the Local Government Database. It warns that completeness and trustworthiness depend on municipal submissions and that API figures can differ from previously published report snapshots when submissions are later amended.

The current documentation page states that its figures have been updated with 2026 Q2 data and that the data is being verified for completeness and integrity. That banner describes the displayed data update, not an exact publication date for the data returned by a given facts query.

The API documentation describes a model field named `last_updated` as a partial ISO date indicating when the latest update was applied. It is an update timestamp/period, not documentation that it is the publication date required by the terms. Do not copy `last_updated`, the current website banner, or `retrieved_at` into `attribution.publication_date` unless National Treasury confirms that value is the relevant publication date for the particular data.

## 4. Terms requirement and unresolved publication date

The terms allow commercial and non-commercial reuse, but require users to acknowledge National Treasury as the source and state the date of publication. They also prohibit misleading use, misuse of personal data, or implying Treasury endorsement.

The current facts adapter still reports `attribution.publication_date: null`. No exact official publication date applicable to the data returned by this endpoint was established from the pages reviewed. The terms blocker therefore remains open: keep the capability internal and do not onward-display, publish or distribute these results until the publication date is sourced authoritatively and included with the data.

The MFMA 2025–26 second-quarter page includes a press release described as results "as at 31 December 2025". That is the reporting cut-off date, not by itself evidence of the date on which the report or the API dataset was published. Do not substitute it for the publication date.

## 5. Request limits and catalogue counts

The public API documentation reviewed describes GET, JSON/200 success, pagination, cuts and member endpoints, but does not publish a numeric API rate limit in the sections reviewed. No provider rate allowance is therefore confirmed. The internal quota controls are not a substitute for a provider rate limit.

The documentation describes the available dimensions and representative values but does not establish current live cardinality for municipality, amount type or item catalogues. Their completeness and compatibility with the adapter's 1,000-member cap remain unverified against the live endpoint.

## 6. Release decision

Confirmed from public documentation:
- `incexp_v2` is the v2 financial-performance dataset and is described as covering FY 2019–20 onwards.
- The year dimension is a financial-year-end calendar year.
- The documented API request model is GET-based, with JSON success responses and pagination.
- Monetary values are integer ZAR amounts without cents.
- National Treasury terms require source and publication-date acknowledgement.
- The latest page banner refers to 2026 Q2 and explicitly says figures remain under completeness/integrity verification.

Not confirmed:
- current live v2 member catalogue contents and counts;
- exact year values available from the v2 API;
- current provider request allowance;
- the precise publication date applicable to a given facts response; and
- the deployed API model's current `last_updated` value and how it maps to an actual publication notice.

No live Treasury endpoint was called. No credentials, user data, or request payloads were sent to Treasury. The implementation remains not production-ready.
