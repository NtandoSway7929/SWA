# InnerMe Isolated Semantic Retrieval Regression Suite

## Purpose

The original single-canary runtime smoke test has been expanded into a fixed, versioned regression suite. The suite tests semantic retrieval quality, knowledge eligibility gates, normal-chat grounding, and synthetic-fixture cleanup in the isolated **Swayphics InnerMe Test** project.

Canonical baseline: `supabase/functions/innerme-retrieval-smoke-test/regression-baseline.json`.

Current baseline version: **1.2.0**. Run #5 attempt 2 exposed a false positive at similarity 0.7172 for an unrelated query. The lowest relevant match in that run was 0.9009. Version 1.2.0 retains the calibrated 0.80 cutoff and adds fifteen corpus-wide queries across invoice, appointment and dispatch paraphrases plus unrelated subjects. Unlike the original fixture-scoped checks, these cases search the complete temporary corpus and assert the exact expected fixture set, allowing case-level precision, recall, and unrelated-query rejection to be measured. Run #7 (attempt 2) showed intended matches ranking first at 0.848–0.891 while cross-topic tail matches scored 0.801–0.838, with a smallest observed top-to-tail gap of approximately 0.0415. The rerun (attempt 3) narrowed one invoice/appointment gap to approximately 0.0392. The application therefore uses a 0.035 relative-score gap per query after the 0.80 absolute threshold, leaving a small buffer under the narrowest observed gap. This remains an empirically tested starting point for these isolated cases, not a claim that every real-world knowledge corpus has the same score distribution.

## Fixed coverage

The baseline includes six run-unique synthetic knowledge fixtures and twenty-eight pinned test cases:

| Case family | Count | Required behaviour |
|---|---:|---|
| Fixture-scoped relevant retrieval | 3 | Canonical topic queries retrieve their intended fixture at similarity `>= 0.80`. |
| Fixture-scoped irrelevant-query rejection | 3 | Astronomy, cooking and algorithm queries do not retrieve the target invoice fixture under its domain filter. |
| Corpus-wide paraphrase retrieval | 9 | Three independently worded invoice, appointment and dispatch queries each return only the intended eligible fixture from the shared temporary corpus. |
| Corpus-wide unrelated-query rejection | 6 | Moon phases, guitar tuning, tomato soil, ocean tides, mountain pressure and chess queries return no fixture from the test corpus. |
| Eligibility exclusions | 3 | Stale, unverified, and expired-review records are not returned even when a query matches their wording. |
| Normal-chat grounding | 3 | Normal chat reports the correct verified fixture as retrieved evidence and reproduces its exact canary phrase. |
| Normal-chat irrelevant-context exclusion | 1 | Normal chat does not retrieve the invoice fixture or reproduce its canary when asked an unrelated astronomy question. |

The suite pins the six fixture keys, all twenty-eight case IDs, their types, expected outcomes, corpus-wide scope and expected fixture sets, eligibility metadata, the 0.80 retrieval cutoff and the `gte-small` 384-dimensional retrieval contract. Case prompts, synthetic statements, titles and phrases are versioned in the JSON baseline. The endpoint rejects a baseline that changes the suite version, threshold, mandatory case IDs, expected match polarity, or exclusion fixture metadata without a corresponding helper change.

## What happens during a run

1. GitHub Actions checks the explicit no-billing confirmation and the dedicated isolated-admin credentials.
2. The workflow checks out the versioned baseline and authenticates to the isolated project.
3. The test-only Edge Function verifies the project ref, parses the signed-in user's bearer token with a separately unit-tested parser, verifies the active administrator, then validates the baseline contract.
4. It creates six uniquely named synthetic records, uses the real built-in `gte-small` model to generate and save 384-dimensional embeddings, and executes twenty-four retrieval and eligibility cases. Fifteen new cases omit the domain filter and evaluate all fixtures together.
5. When normal-chat checks are enabled, it sends one read-only normal-chat request by default (invoice grounding). Choosing `chat_case_id=all` sends all four pinned chat cases, including the irrelevant-astronomy exclusion.
6. It deletes all run-specific fixtures, confirms there are no residual rows, and returns a case-by-case result report.

Each run has unique fixture slugs and domain names to avoid cross-run interference. Cleanup runs even if a fixture, retrieval or chat stage fails. A cleanup failure is a suite failure and must be resolved before rerunning.

## Ranking policy

The same local, zero-provider-call selector is used by normal chat and the authenticated `search_knowledge` test action. It keeps all results no more than `0.035` similarity below the best result for each query, preserving multiple closely ranked pieces of evidence while removing weak tail matches. `scripts/innerme-retrieval-ranking.test.mjs` pins all nine positive corpus-query score sets observed in run #7 attempt 2 and verifies that the selected evidence contains the expected fixture. The absolute `0.80` threshold and all eligibility conditions remain in force.

## Security and cost boundaries

- The helper has a hard project guard for Supabase ref `ofqofhnlzbouclvvrmzd`. Never deploy it to the production project.
- Fixture database operations use the caller's authenticated JWT and the existing active-admin RLS policy. The isolated-only grants file is `supabase/isolated-test/innerme-semantic-retrieval-smoke-test-grants.sql`; it must never be applied to production.
- `service_role` retains no direct privileges on `public.innerme_knowledge`. The helper uses its server-side service key only to validate the user's session and active-admin record.
- `gte-small` embeddings use Supabase's built-in Edge Runtime AI interface. No external embedding provider is called.
- Retrieval-only mode makes no Gemini chat requests. When chat checks are enabled, the default targeted mode sends one normal-chat request; the isolated runtime reserves room for a possible guarded fallback, so its quota preflight requires two remaining Gemini request reservations. Choose `chat_case_id=all` to run all four normal-chat cases; full mode reserves eight possible attempts.
- Keep the isolated Gemini key in a separate Google test project with billing disabled. Do not reuse the production key. The workflow requires explicit no-billing confirmation for any chat-check mode.
- The suite does not create or execute proposals, send email, mutate real business records, or copy production knowledge rows.

## Regression and inconclusive-result policy

- If a pinned case executes successfully but its expected retrieval/grounding assertion is false, the case is marked **failed**. The workflow exits non-zero, blocking the regression gate.
- If a provider, Edge Function, authentication, embedding or retrieval execution error prevents a trustworthy assertion, the run is marked **inconclusive**, not misreported as an answer-quality regression. The workflow still exits non-zero, so the pipeline cannot silently treat it as a pass.
- A full-mode pass requires all twenty-eight cases to pass, corpus metrics to cover all fifteen corpus-wide cases, and all synthetic fixtures to be confirmed removed. Targeted grounding mode requires all twenty-four retrieval/eligibility cases and the selected normal-chat case to pass; the other three chat cases must be marked intentionally skipped, corpus metrics must be complete, and fixture cleanup must be verified. Retrieval-only mode requires all twenty-four retrieval/eligibility cases to pass, all four normal-chat cases to be intentionally skipped, complete corpus metrics, and verified fixture cleanup; it does not claim normal-chat grounding has passed.
- The workflow writes a case table to the GitHub Actions run summary and uploads the full case-level result JSON, the exact versioned baseline, and the effective request JSON (including whether chat checks were enabled). The result includes the baseline SHA-256, GitHub run ID, commit, per-case status/similarity, ordered fixture ranks and similarity scores, and cleanup state. Artifacts are retained for 90 days; the versioned expected-case baseline remains in Git.

## Running the suite

Open the repository's Actions tab, choose **InnerMe Isolated Semantic Retrieval Regression Suite**, and select **Run workflow**. The default `run_chat_checks=false` runs retrieval-only mode and makes no Gemini chat requests. To test grounding, set `run_chat_checks=true` and keep the default `chat_case_id=normal_chat_invoice_grounding` for one focused normal-chat case; the other three chat cases will be skipped. Choose `chat_case_id=all` only when deliberately running the full four-case chat suite. Every chat-enabled mode requires confirmation that the isolated Gemini key belongs to a separate Google project with billing disabled.

Workflow: `.github/workflows/innerme-semantic-retrieval-smoke.yml`.

## What a passing suite does and does not prove

A pass establishes that these fixed positive, negative, eligibility-exclusion, normal-chat grounding and irrelevant-context exclusion cases work together in the isolated runtime at the recorded baseline version. It does not prove broad factual accuracy for every domain, guarantee all future responses, establish production readiness, or prove completion of all 30 roadmap phases. Expand the suite only with reviewed, representative cases and bump the baseline version when the expected contract deliberately changes.

## Failure recovery

Inspect the per-case status and failure stage in the run summary/artifact. If cleanup did not pass, query the isolated project's `public.innerme_knowledge` for slugs beginning with `__innerme_semantic_regression_`, remove only those synthetic fixtures in the isolated project, and verify the residue count is zero. Never grant direct table privileges to `service_role`, disable RLS, or run the isolated-only grants script against production.
