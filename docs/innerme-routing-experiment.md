# InnerMe Paired Routing Experiment

## Purpose and limits

This manual experiment compares **gemini-3.5-flash-lite** and **gemini-3.8-flash** on the same four synthetic prompts: two routine tasks and two evidence/safety reasoning tasks. It is a small routing smoke test, **not** a statistically reliable model ranking and not proof that real InnerMe conversations are better.

The suite applies deterministic rubric checks to response text. It measures per-model pass rate, category pass rate, request latency, and token counts returned by Gemini. It does not use a separate AI judge, does not use customer or workspace records, and does not change routing defaults.

## Safety controls

- Live execution is available only through the manual **InnerMe Paired Routing Experiment** GitHub Actions workflow.
- The code has a fixed matrix of four prompts x two models, with an eight-provider-request maximum. It runs sequentially, gives each Gemini request a 40-second timeout, and does not retry HTTP errors, rate limits, timeouts, or invalid responses. The GitHub Actions job has a hard 10-minute overall timeout to leave bounded time for ledger updates and offline checks.
- It reserves each request in the isolated ledger before making that request. The ledger permits only one run per UTC date; if a run is interrupted or fails, it will fail closed for that date rather than allow a rerun that could increase provider use.
- Only aggregate scores, latency, token counts, case keys, status, and error codes are stored. Prompt text and model answers are intentionally not stored or printed.
- Results are written only to https://ofqofhnlzbouclvvrmzd.supabase.co (the isolated Swayphics InnerMe Test project). The runner contains this URL as a fixed constant rather than reading it from an environment variable.
- The experiment does not call Swayphics production, send email, create workspace records, invoke action proposals, or deploy code.
- A provider-level free tier is not a universal zero-cost guarantee. Use a separate Google AI Studio project with billing disabled. **Do not use the production SWAYPHICS Gemini key or a key from the same production Google Cloud project.** Google may change quotas and terms.

## One-time setup after the code is merged

1. In Google AI Studio, create or select a dedicated **test-only Google project**, keep billing disabled, enable Gemini API access, and create a test API key. Confirm that **gemini-3.5-flash-lite** and **gemini-3.8-flash** are available to that project.
2. In GitHub repository settings, add Actions secrets:
   - **INNERME_TEST_GEMINI_API_KEY**: the dedicated test project's key only.
   - **INNERME_TEST_SUPABASE_SERVICE_ROLE_KEY**: the service-role/secret key from the isolated Swayphics InnerMe Test Supabase project only. Never use the production Supabase key.
3. Confirm the private ledger table public.innerme_routing_experiment_runs exists in that isolated Supabase project. It is designed for service-role writes only; no client-side access should be granted.
4. Open **Actions → InnerMe Paired Routing Experiment → Run workflow**. Select the branch containing the reviewed implementation. Do not run it until both secrets are verified.

The automated PR validation executes only static checks, synthetic rubric tests, and a dry run. It does not require these secrets and makes no provider calls.

## Interpreting a result

- **completed** means all eight model-case responses were received and scored by the deterministic checks.
- A nonzero exit, HTTP 429/503, timeout, empty response, or ledger failure is an **inconclusive** experiment, not a model-quality failure. The runner does not retry; inspect the aggregate error code and wait for the next UTC day before attempting another run.
- A case **FAIL** means one or more expected text signals were absent. It may be a rubric mismatch rather than a fully judged answer-quality failure. The area-units rubric accepts common equivalent forms such as `cm²`, `cm^2`, `cm2`, `cm squared`, `square cm`, and `sq. cm`; it still requires the correct value and an area unit. Inspecting response content is not part of this automated run.
- Compare the routine and reasoning categories separately. The sample is deliberately too small to justify changing production routing by itself.
- No run result authorizes merging, deployment, automated self-modification, or a change to InnerMe's permission/action policies. Human review and broader evaluation are still required.

## Reproducible local checks

From the repository root, run:

    node --check scripts/innerme-routing-experiment.mjs
    node --test scripts/innerme-routing-experiment.test.mjs
    node scripts/innerme-routing-experiment.mjs --dry-run

These commands do not contact Gemini or Supabase.
