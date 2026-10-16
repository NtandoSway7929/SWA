# InnerMe Knowledge Retrieval Positive-Path Smoke Test

## Purpose

The normal-chat benchmark confirms that knowledge retrieval does not error, but an empty knowledge table can still produce zero matches. This separate smoke test proves that the `match_innerme_knowledge` RPC can retrieve a valid, eligible knowledge record with a matching vector.

## Safety and scope

Run this test only against the isolated Supabase project **Swayphics InnerMe Test** (`ofqofhnlzbouclvvrmzd`), never the production project.

The script at [`supabase/tests/innerme_knowledge_retrieval_smoke_test.sql`](https://github.com/NtandoSway7929/SWA/blob/main/supabase/tests/innerme_knowledge_retrieval_smoke_test.sql):

- Inserts one clearly labelled synthetic knowledge record inside a transaction.
- Uses a synthetic 384-dimensional basis vector. It does not call an embedding model, an LLM, or any billable provider.
- Invokes `match_innerme_knowledge` with matching domain, jurisdiction, and knowledge-type filters and checks that the exact record is returned with similarity of at least `0.999`.
- Displays the returned record, then explicitly rolls the transaction back so the synthetic row is not persisted.

The script expects the isolated project to have the knowledge schema and RPC from `20261015224500_innerme_knowledge_retrieval_schema_baseline.sql` and triggers from `20261015225000_innerme_knowledge_retrieval_triggers.sql`.

## Run it

1. Open the [isolated test project's SQL Editor](https://supabase.com/dashboard/project/ofqofhnlzbouclvvrmzd/sql/new).
2. Open the [SQL test file in the repository](https://github.com/NtandoSway7929/SWA/blob/main/supabase/tests/innerme_knowledge_retrieval_smoke_test.sql), copy the full script, and run it in the isolated project's SQL Editor.
3. Confirm the output includes slug `__innerme_retrieval_smoke_test__` and similarity `1`. The assertion raises an error if the exact record cannot be retrieved at the required similarity.
4. Confirm cleanup by checking that no row with that slug remains in `public.innerme_knowledge` after the script finishes.

Do not remove the final `ROLLBACK` or replace it with `COMMIT`.

## Interpreting the result

A pass verifies the positive path through the vector column, active/verified/review-date/embedding-status filters, metadata filters, cosine-similarity calculation, and RPC result. A failed dimension check indicates drift between the test vector and the current embedding schema.

This is a **retrieval plumbing test**, not a semantic-quality benchmark. The synthetic vector is deliberately identical to the query vector, so it does not test embedding generation, the relevance of real knowledge content, or end-to-end answer grounding. The isolated knowledge table remains empty after the test; therefore, the normal-chat benchmark may correctly report `KNOWLEDGE_MATCH_COUNT=0` when no real test knowledge has been loaded.
