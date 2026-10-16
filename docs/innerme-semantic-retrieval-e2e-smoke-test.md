# InnerMe Isolated Semantic Retrieval Regression Suite

## Purpose

The original single-canary runtime smoke test has been expanded into a fixed, versioned regression suite. The suite tests semantic retrieval quality, knowledge eligibility gates, normal-chat grounding, and synthetic-fixture cleanup in the isolated **Swayphics InnerMe Test** project.

Canonical baseline: `supabase/functions/innerme-retrieval-smoke-test/regression-baseline.json`.

Current baseline version: **1.0.0**.

## Fixed coverage

The baseline includes six run-unique synthetic knowledge fixtures and ten pinned test cases:

| Case family | Count | Required behaviour |
|---|---:|---|
| Relevant semantic retrieval | 3 | Natural-language queries retrieve the intended verified/current fixture at similarity `>= 0.45`. |
| Irrelevant-query rejection | 1 | An unrelated astronomy query must not return the synthetic invoice fixture. |
| Eligibility exclusions | 3 | Stale, unverified, and expired-review records must not be returned even when the query matches their wording. |
| Normal-chat grounding | 3 | Normal chat must report the correct verified fixture as retrieved evidence and reproduce its exact canary phrase. |

The suite pins the six fixture keys, all ten case IDs, their types, expected outcomes, eligibility metadata and the `gte-small` 384-dimensional retrieval contract. Case prompts, synthetic statements, titles and phrases are versioned in the JSON baseline. The endpoint rejects a baseline that changes the suite version, threshold, mandatory case IDs, expected match polarity, or exclusion fixture metadata without a corresponding helper change.

## What happens during a run

1. GitHub Actions checks the explicit no-billing confirmation and the dedicated isolated-admin credentials.
2. The workflow checks out the versioned baseline and authenticates to the isolated project.
3. The test-only Edge Function verifies the project ref, parses the signed-in user's bearer token with a separately unit-tested parser, verifies the active administrator, then validates the baseline contract.
4. It creates six uniquely named synthetic records, uses the real built-in `gte-small` model to generate and save 384-dimensional embeddings, and executes the seven retrieval and eligibility cases.
5. It sends up to three read-only normal-chat requests to test grounding across invoice, appointment-rescheduling and warehouse-dispatch topics.
6. It deletes all run-specific fixtures, confirms there are no residual rows, and returns a case-by-case result report.

Each run has unique fixture slugs and domain names to avoid cross-run interference. Cleanup runs even if a fixture, retrieval or chat stage fails. A cleanup failure is a suite failure and must be resolved before rerunning.

## Security and cost boundaries

- The helper has a hard project guard for Supabase ref `ofqofhnlzbouclvvrmzd`. Never deploy it to the production project.
- Fixture database operations use the caller's authenticated JWT and the existing active-admin RLS policy. The isolated-only grants file is `supabase/isolated-test/innerme-semantic-retrieval-smoke-test-grants.sql`; it must never be applied to production.
- `service_role` retains no direct privileges on `public.innerme_knowledge`. The helper uses its server-side service key only to validate the user's session and active-admin record.
- `gte-small` embeddings use Supabase's built-in Edge Runtime AI interface. No external embedding provider is called.
- The three normal-chat grounding cases make up to three real provider chat requests. Keep the isolated Gemini key in a separate Google test project with billing disabled. Do not reuse the production key. The workflow requires explicit confirmation before it runs.
- The suite does not create or execute proposals, send email, mutate real business records, or copy production knowledge rows.

## Regression and inconclusive-result policy

- If a pinned case executes successfully but its expected retrieval/grounding assertion is false, the case is marked **failed**. The workflow exits non-zero, blocking the regression gate.
- If a provider, Edge Function, authentication, embedding or retrieval execution error prevents a trustworthy assertion, the run is marked **inconclusive**, not misreported as an answer-quality regression. The workflow still exits non-zero, so the pipeline cannot silently treat it as a pass.
- A complete pass requires all ten cases to pass and all synthetic fixtures to be confirmed removed.
- The workflow writes a case table to the GitHub Actions run summary and uploads two files as an artifact: the full case-level result JSON and the exact baseline JSON used. The result includes the baseline SHA-256, GitHub run ID, commit, per-case status/similarity and cleanup state. Artifacts are retained for 90 days; the versioned expected-case baseline remains in Git.

## Running the suite

Open the repository's Actions tab, choose **InnerMe Isolated Semantic Retrieval Regression Suite**, select **Run workflow**, and confirm the separate no-billing Google test project prerequisite.

Workflow: `.github/workflows/innerme-semantic-retrieval-smoke.yml`.

## What a passing suite does and does not prove

A pass establishes that these fixed positive, negative, eligibility-exclusion and normal-chat grounding cases work together in the isolated runtime at the recorded baseline version. It does not prove broad factual accuracy for every domain, guarantee all future responses, establish production readiness, or prove completion of all 30 roadmap phases. Expand the suite only with reviewed, representative cases and bump the baseline version when the expected contract deliberately changes.

## Failure recovery

Inspect the per-case status and failure stage in the run summary/artifact. If cleanup did not pass, query the isolated project's `public.innerme_knowledge` for slugs beginning with `__innerme_semantic_regression_`, remove only those synthetic fixtures in the isolated project, and verify the residue count is zero. Never grant direct table privileges to `service_role`, disable RLS, or run the isolated-only grants script against production.
