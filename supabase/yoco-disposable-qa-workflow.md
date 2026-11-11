# Yoco disposable QA workflow

Target branch: `feature/yoco-client-payments`

Workflow: `.github/workflows/yoco-disposable-qa.yml`

## What runs

The workflow is deliberately isolated from Swayphics production:

1. It runs on pushes to this feature branch, pull requests targeting this feature branch, and manual dispatch.
2. The Deno job checks formatting, type-checks the four Yoco Edge Function entrypoints, and runs the Yoco Deno tests with a synthetic webhook secret.
3. The database job starts a fresh Supabase stack on a GitHub-hosted runner, applies the repository's complete migration history using `supabase db reset --local`, runs the read-only Yoco migration preflight, and executes the local pgTAP database suite.
4. It then runs 20 concurrent two-worker webhook lease-claim races against the disposable local database.
5. The local Supabase stack is stopped even when a preceding step fails.

No Supabase project ID, Supabase access token, database password, Yoco API key, webhook secret, service-role key, or production environment secret is required. The webhook secret in the Deno job is synthetic and only used by the isolated signature test.

## Local-equivalent commands

From the repository root with Docker, Supabase CLI, Deno and PostgreSQL client installed:

```bash
deno fmt --check supabase/functions/_shared/yoco.ts supabase/functions/_shared/yoco-signature.ts supabase/functions/_shared/yoco-webhook-validation.ts supabase/functions/_shared/yoco-http-validation.ts supabase/functions/_shared/yoco-operations.ts supabase/functions/tests/yoco-*.test.ts supabase/functions/create-payment-checkout/index.ts supabase/functions/yoco-payment-webhook/index.ts supabase/functions/get-payment-status/index.ts supabase/functions/reconcile-payment/index.ts

deno check \
  supabase/functions/create-payment-checkout/index.ts \
  supabase/functions/yoco-payment-webhook/index.ts \
  supabase/functions/get-payment-status/index.ts \
  supabase/functions/reconcile-payment/index.ts

YOCO_WEBHOOK_SECRET=whsec_disposable_ci_test_secret \
  deno test --allow-env=YOCO_WEBHOOK_SECRET supabase/functions/tests/yoco-*.test.ts

supabase start
supabase db reset --local
supabase test db --local

export LOCAL_DB_URL="$(supabase status -o env | sed -n 's/^DB_URL="\\(.*\\)"$/\\1/p')"
psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/tests/202611110008_yoco_migration_preflight.sql
YOCO_CONCURRENCY_REPETITIONS=20 \
  bash supabase/tests/yoco-lease-concurrency-ci.sh
supabase stop --no-backup
```

## Concurrency coverage and limits

The CI race runner creates 20 distinct verified synthetic webhook events and starts two independent PostgreSQL client processes for each event. It asserts exactly one worker acquires the active lease and the other is denied. This exercises concurrent claim exclusion, not payment settlement or refund locking.

The transactional pgTAP lease test separately covers lease expiry, takeover, stale fencing tokens, terminal transition and atomic payment-failure handling. The existing runbook still defines additional two-session settlement, refund-cap and checkout-attempt races. Those are not yet automated by this workflow and must not be described as passed.

The workflow does not call Yoco, register a webhook, deploy Edge Functions, apply migrations to a hosted Supabase project, or access production. Provider payload compatibility, hosted-checkout idempotency after a lost response, browser return flow and real signed sandbox deliveries remain separate validation gates.

## Failure handling

A failed migration, test, type-check or concurrency assertion fails its job. Fix the cause on this feature branch and rerun the workflow. Do not bypass a failing database test by weakening its assertion or changing production schema. The workflow is a disposable validation environment; it is not a release or deployment workflow.
