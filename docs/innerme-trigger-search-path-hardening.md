# InnerMe trigger search-path hardening

## Scope

This change pins the two existing trigger helpers `public.set_innerme_updated_at()` and `public.refresh_innerme_embedding_text()` to `search_path = pg_catalog`.

The inspected function bodies only read or assign fields on the trigger row and call PostgreSQL built-ins. Neither needs to resolve application objects from `public` or another application schema. Keeping resolution within `pg_catalog` removes the mutable search-path setting flagged by the production Supabase security advisor without changing the functions' bodies, trigger wiring, permissions, or security-invoker behavior.

## Verification

Run the provider-free regression test:

```sh
node --test scripts/innerme-trigger-search-path.test.mjs
```

The migration also checks its postcondition and raises an exception unless both exact function signatures report `search_path=pg_catalog`.

After the migration is applied to an environment, verify the persisted configuration with:

```sql
select
  p.oid::regprocedure as function_signature,
  p.prosecdef as security_definer,
  p.proconfig,
  coalesce(p.proconfig @> array['search_path=pg_catalog'], false) as search_path_is_pinned
from pg_catalog.pg_proc as p
where p.oid in (
  'public.set_innerme_updated_at()'::regprocedure,
  'public.refresh_innerme_embedding_text()'::regprocedure
)
order by 1;
```

Expected result: two rows, both with `security_definer = false` and `search_path_is_pinned = true`. Apply and verify in the isolated InnerMe test project before considering production. This branch does not apply the migration or deploy a function.
