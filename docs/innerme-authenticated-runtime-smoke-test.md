# InnerMe Authenticated Runtime Smoke Test

This is a manual, non-mutating live smoke test against the **isolated** Supabase project `Swayphics InnerMe Test` (`ofqofhnlzbouclvvrmzd`). It must never use production account credentials or the production project.

## What the test does

1. Signs in as a dedicated test admin using Supabase Auth.
2. Uses that real access token to confirm that an intentionally nonexistent action-proposal ID is absent.
3. Calls the deployed test `swayphics-ai` function with `action=execute_innerme_action` and that same missing ID.
4. Calls the test function with `action=innerme_workspace_read_health` for a finance-focused prompt. This must select only clients, invoices and payments, return those exact aggregate groups without unrelated lead/task metrics, and report zero query failures for the selected record reads and aggregate RPC.
5. Calls the same health action for a broad daily-priorities prompt. This must preserve all 13 operational domains and all 14 aggregate groups.
6. Calls the run-controller RPC with a confirmed-missing synthetic step ID.
7. Passes only when the expected missing-proposal and missing-step responses occur, the focused request uses `summary_source=database_aggregate` with three relevant domains, and the broad request reports all expected aggregate groups.

The missing proposal and step are checked before the POSTs. The health check returns before any model/provider request. The controlled-action request returns before the Phase 30 execution gate, audit-write, task-creation, or email-delivery paths. The workflow does not create a proposal, task, or email.

## One-time setup

### 1. Create a dedicated Auth user in the test project

Open the [isolated test project's Auth Users page](https://supabase.com/dashboard/project/ofqofhnlzbouclvvrmzd/auth/users). Create a test-only user with a password you have not used elsewhere, and ensure its email is confirmed. Do not use your personal or production admin account.

### 2. Grant that user test-project admin access

Copy the new test user's Auth UUID. In the [isolated test project's SQL Editor](https://supabase.com/dashboard/project/ofqofhnlzbouclvvrmzd/sql/new), run the following after replacing `AUTH_USER_UUID` with that user's UUID:

```sql
insert into public.admin_users (user_id, active)
values ('AUTH_USER_UUID'::uuid, true)
on conflict (user_id) do update
set active = excluded.active;
```

This changes only the isolated test project's `public.admin_users` table. Do not run it against production.

### 3. Add GitHub Actions repository secrets

Open [SWA repository Actions secrets](https://github.com/NtandoSway7929/SWA/settings/secrets/actions) and add these two **repository secrets**:

- `INNERME_TEST_ADMIN_EMAIL`: the dedicated test user's email.
- `INNERME_TEST_ADMIN_PASSWORD`: that test user's password.

The workflow uses the isolated test project's public publishable API key and URL. It does not require or accept a service-role key.

## Run the smoke test

After this documentation and `.github/workflows/innerme-authenticated-runtime-smoke.yml` are merged into `main`:

1. Open the repository's **Actions** tab.
2. Select **InnerMe Authenticated Runtime Smoke Test**.
3. Select **Run workflow** on `main`.

The workspace health checks are read-only and use the isolated test project. The smoke workflow can run from its documented path triggers or manually; the separate normal-chat performance benchmark is manual-only.

## Interpreting results

- **PASS / HTTP 404 with the expected error:** the live test user authenticated, passed the admin check, and reached the missing-proposal branch.
- **PASS / HTTP 200 from the focused workspace health check:** the live Edge Function uses request-aware selection for the finance prompt, returns only the clients, invoices and payments aggregate groups, and reports no failures while reading those selected collections.
- **PASS / HTTP 200 from the broad workspace health check:** the live Edge Function retains all 13 operational domains and all 14 aggregate groups for daily-priorities work. Both health checks return only metadata and do not call an LLM/provider.
- **Runtime metrics:** the focused probe reports the number of workspace data-read requests and the serialized byte size of the progressive workspace JSON. The broad probe reports the corresponding read-call count and JSON size. These do not represent full provider prompt tokens or browser round-trip latency; they isolate the workspace retrieval/context portion.
- **HTTP 401 during sign-in or function invocation:** check the test user's password, confirmation status and token validity.
- **HTTP 403 from the function:** the test user's UUID is not active in the isolated project's `public.admin_users` table, or the admin check failed.
- **Any other result:** treat the smoke test as failed; do not interpret it as proof that action execution is safe.

## Cleanup

After the test, remove the user's row from `public.admin_users` or set `active = false`. Delete the Auth user if it is no longer needed. Remove the two GitHub secrets when the smoke test is no longer required. Never store production credentials in these secret names.

## Normal authenticated chat performance benchmark

The optional workflow **InnerMe Isolated Normal Chat Performance Benchmark** runs only when manually dispatched. It makes one small, read-only chat request against the isolated test project, then queries only that request's provider-usage telemetry. It does not touch the production project or create, update, approve, execute, or email business records. Provider telemetry is written as expected.

Before running it:

1. In the isolated Supabase project **Swayphics InnerMe Test**, open **Project Settings → Edge Functions → Secrets** and set `GEMINI_API_KEY` to a dedicated key from a separate Google test project. Do not copy or reuse the production key. Confirm the Google test project has billing disabled.
2. Ensure these two migrations from the repository have been applied to the isolated project: `supabase/migrations/20261012160000_innerme_provider_usage_telemetry.sql` and `supabase/migrations/20261012163000_innerme_zero_cost_provider_guard.sql`. They create the provider-attempt telemetry table and the fail-closed quota reservation function required by normal chat.
3. Configure the repository secrets `INNERME_TEST_ADMIN_EMAIL` and `INNERME_TEST_ADMIN_PASSWORD` for the isolated test project's dedicated admin user. Telemetry is read using that user's authenticated JWT and the admin-only SELECT policy; the workflow does not need a service-role key.
4. In Actions, select **InnerMe Isolated Normal Chat Performance Benchmark**, select **Run workflow**, and confirm the no-billing test-key input. This explicit confirmation is required because the workflow sends one actual provider request.

The workflow first invokes the read-only health check, which reports only a boolean indicating whether the Gemini key exists. If it is missing, the run stops before sending a normal chat request. The key value is never returned by the health check.

Run [38774493038](https://github.com/NtandoSway7929/SWA/actions/runs/38774493038) exposed the missing isolated `GEMINI_API_KEY`. Run [38813478456](https://github.com/NtandoSway7929/SWA/actions/runs/38813478456) then exposed missing quota/telemetry migrations in the isolated database and a benchmark query that incorrectly used service-role credentials for a table that intentionally grants SELECT only to authenticated admins. The isolated migrations were applied; the workflow now checks telemetry read access before sending the model request and queries telemetry with the authenticated test-admin JWT.

The benchmark reports total HTTP time; server-side workspace-read, base-context, progressive-context and overall timings; workspace-read-call count; progressive context JSON bytes; and provider-attempt latency/token fields recorded for the matching request ID. The request ID links Edge Function timing headers/logs to server-only provider-usage rows.

Interpret the measurements separately:

- **HTTP total** includes network round trips to Supabase and the Edge Function.
- **Server-Timing** separates workspace reads, base context assembly, progressive context assembly and total server time.
- **Provider latency** measures individual model attempts recorded in `innerme_provider_usage`; fallback attempts may create multiple rows for one request.
- **Progressive workspace JSON bytes** is the serialized context before the final provider-envelope size guard may compact it further. It is not the final prompt byte count or token count.

A result from the isolated test project is a controlled diagnostic, not a production latency claim. The benchmark fails closed when credentials, the provider response, timing headers, or the correlated telemetry record are missing.
