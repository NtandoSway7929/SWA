# InnerMe Semantic Retrieval End-to-End Smoke Test

## What this checks

This test is stronger than the SQL-level positive-path test in supabase/tests/innerme_knowledge_retrieval_smoke_test.sql. It exercises the actual isolated Edge Function and normal chat:

1. Authenticate a dedicated administrator in **Swayphics InnerMe Test**.
2. Create one synthetic, run-unique knowledge record and verify its embedding text includes the canary.
3. Generate a real 384-dimensional gte-small document embedding and store it on the synthetic record.
4. Call the deployed swayphics-ai action search_knowledge with a natural-language query and require the synthetic record to be returned at similarity >= 0.45.
5. Ask normal InnerMe chat for a unique canary phrase that is present only in the synthetic knowledge record. Require the normal-chat response to include that record in its reported retrieved evidence and reproduce the exact phrase.
6. Delete the synthetic fixture and query the table to confirm it is gone, even when an earlier test stage fails.

The canary phrase is **Cobalt Compass 417**. It is a synthetic test value, not a business fact.

## Security and cost boundaries

- The helper endpoint at supabase/functions/innerme-retrieval-smoke-test/index.ts has a hard guard for the isolated project ref ofqofhnlzbouclvvrmzd. It refuses to run under any other Supabase URL and also checks that the caller is an active admin in the isolated project's admin_users table.
- The helper is a separate test function, not part of the production swayphics-ai deployment. Deploy it only to the isolated test project; never deploy it to production.
- A server-side service key is used only to validate the caller's session and confirm the active admin record. Fixture insert/update/delete/read operations use the caller's authenticated JWT, so the existing admin-only RLS policy continues to apply. The service_role role remains without direct privileges on innerme_knowledge.
- The file supabase/isolated-test/innerme-semantic-retrieval-smoke-test-grants.sql grants INSERT and DELETE to authenticated only in the isolated test project. It checks that RLS and the active-admin policy exist first. Never apply this isolated-only SQL to production.
- The helper checks for the Gemini key only after verifying the isolated admin and before inserting the fixture. This avoids using the broader workspace-health action as a provider-key preflight.
- The main chat request calls the configured Gemini provider once or may use its existing fallback route. The workflow therefore requires explicit confirmation that the test project's dedicated Gemini key belongs to a separate Google project with billing disabled. Do not reuse the production key.
- gte-small embeddings are generated through the Supabase Edge Runtime's built-in AI interface. No external embedding API is called.
- The workflow is manual-only. It does not create, approve, or execute proposals; send email; change real business records; or copy production knowledge data.
- The helper performs cleanup in a finally block and fails if it detects a fixture left behind.

## One-time setup and execution

1. Confirm that the isolated test project's GEMINI_API_KEY belongs to the separate no-billing Google test project. The helper checks only whether the secret exists and never prints its value.
2. Apply supabase/isolated-test/innerme-semantic-retrieval-smoke-test-grants.sql to **only** the isolated Supabase project ofqofhnlzbouclvvrmzd after verifying the project ref. It grants fixture INSERT/DELETE to authenticated under the existing active-admin RLS policy and does not grant table privileges to service_role. Never apply this file to production.
3. Deploy supabase/functions/innerme-retrieval-smoke-test/index.ts to **only** the isolated Supabase project ofqofhnlzbouclvvrmzd with JWT verification enabled. Do not add it to the production project's deployed functions.
4. Confirm repository secrets INNERME_TEST_ADMIN_EMAIL and INNERME_TEST_ADMIN_PASSWORD refer to the dedicated isolated test admin, not a personal or production admin account.
5. After this workflow is merged to main and the isolated-only helper is deployed, open the repository's Actions tab, select **InnerMe Isolated Semantic Retrieval End-to-End Smoke Test**, select **Run workflow**, and confirm the no-billing prerequisite.
6. A pass must report a natural-language match, normal-chat canary grounding, and fixture removal. Inspect any failed stage and cleanup result before rerunning.

## What a pass does and does not prove

A pass would verify the runtime chain from document embedding through natural-language vector search and retrieval-grounded normal-chat output, plus synthetic-fixture cleanup in the isolated project.

It would not prove broad semantic quality across real knowledge topics, factual accuracy in all business domains, production readiness, or completion of all 30 roadmap phases. Those require separate representative evidence, regression and security tests, and production rollout checks.

## Failure recovery

If the function returns an error, check its stage, failure, and cleanup fields. If cleanup.passed is false, query the isolated project's public.innerme_knowledge table for the returned fixture slug, remove that synthetic row from the isolated project only, and verify the count is zero before rerunning. Never grant direct table privileges to service_role or disable RLS as a workaround. If fixture writes fail, verify that the isolated-only grants file was applied to the isolated project and that the caller is still an active administrator.
