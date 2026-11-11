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

## Current clean-install blocker

The first hosted run confirmed that the timestamped migration chain is not a complete clean-install schema. The earliest Swayphics migration alters `public.leads`, but the original core tables are established by standalone SQL scripts such as `swayphics-admin-workspace.sql`, `swayphics-admin-workspace-security-fix.sql`, `swayphics-invoicing.sql` and `swayphics-business-flow.sql`. Those scripts are not represented as an ordered baseline migration. A clean `supabase db reset --local` therefore cannot replay the repository from zero.

Do not create placeholder tables or blindly concatenate the standalone scripts into an early migration: several scripts assume other pre-existing objects, and later timestamped migrations may repeat or supersede their changes. The correct next input is a schema-only export of the actual Swayphics Supabase database (no table data, auth user data, secrets or credentials), reviewed against the standalone scripts and migration history. That export must be obtained and supplied by the project owner; this workflow has no production database access. Until a reviewed, reproducible baseline exists, the disposable database job is expected to fail before Yoco SQL tests execute.

The Deno formatting check is temporarily non-blocking so formatting debt does not prevent type-checking and running the Deno tests. It remains visible as a failed step and is not considered passed. This does not alter the checked-out source files.

## Failure handling

A failed migration, test, type-check or concurrency assertion fails its job. Fix the cause on this feature branch and rerun the workflow. Do not bypass a failing database test by weakening its assertion or changing production schema. The workflow is a disposable validation environment; it is not a release or deployment workflow.


## Latest hosted run — 11 November 2026

Run: [42955221896](https://github.com/NtandoSway7929/SWA/actions/runs/42955221896)

- Deno type-check and test job: passed.
- PostgreSQL grammar job: passed.
- Disposable database job: failed during `supabase start` because the local startup process proceeded into migration application and encountered the existing `public.leads` dependency failure. The runner log also showed a transient container-registry rate-limit response before the database became available; this is not the root schema issue.
- Migration preflight, pgTAP and lease concurrency steps: skipped because migration replay did not complete.

The standalone scripts have now been inspected for baseline dependencies. `swayphics-admin-workspace.sql` creates the initial core tables, including `public.leads`; `swayphics-invoicing.sql` assumes `public.payments` and `public.clients`; `swayphics-admin-workspace-security-fix.sql` assumes additional portal, portfolio, testimonial and invoicing objects; and `swayphics-business-flow.sql` adds a large number of functions, triggers, workflow dependencies and optional extensions. This confirms that simply inserting one `CREATE TABLE public.leads` statement would create a misleading and incomplete baseline.

**Decision:** do not generate a synthetic baseline from partial scripts. Obtain a schema-only export from the project owner and reconcile the complete object inventory and dependencies before creating a reproducible baseline migration.
