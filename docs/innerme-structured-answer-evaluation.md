# InnerMe Structured Answer Evaluation

## Purpose

The provider-free evaluation script `scripts/innerme-structured-answer-evaluation.mjs` is a deterministic golden-fixture check for the InnerMe Intelligent UI v1 contract. It runs in CI alongside the UI parser and mocked browser tests.

## Golden cases

| Case | Expected mode | Deterministic acceptance criteria |
|---|---|---|
| Simple factual calculation | Plain text | Does not parse as an `innerme_ui` envelope |
| Multi-metric summary | Structured metrics | All three labels, values and units remain intact; unlike measures are not forced into one chart |
| Action plan | Structured checklist | Checklist envelope and item array parse correctly |
| Comparable series | Structured chart | One visits series; unique month labels; finite numeric values |
| Citation-sensitive answer | Plain text | Inline `[1]` citation remains intact and output is not forced into JSON |

All numbers and content in these cases are explicitly synthetic examples. They are not business records or statements about current Swayphics performance.

## What this test proves

- The expected sample outputs conform to the v1 envelope and frontend parser.
- Labels, values, units, numeric chart points, checklist items, and evidence citation formatting meet their deterministic contract assertions.
- The script makes zero AI-provider requests and requires no credentials.

## What this test does not prove

- It does **not** show that a live model will choose the expected response mode for the corresponding prompt.
- It does not measure factual accuracy, grounding quality, citation correctness, chart suitability as judged by a human, or consistency over multiple generations.
- Green CI results are not to be reported as live model-evaluation results.

## Live quality-evaluation gate

A future live test should be run separately, with explicit authorization for provider usage, on the isolated InnerMe Test project with synthetic prompts only. It should capture the exact prompt class, selected provider/model, returned output mode, schema validity, unit preservation, citation preservation, latency, token usage and provider outcome. Record provider errors as inconclusive rather than model-quality failures. Do not read or mutate production business records for these tests.

## Running locally

```sh
node scripts/innerme-structured-answer-evaluation.mjs
```

The script emits a JSON report with `provider_requests: 0` and `live_model_behavior_verified: false`.
