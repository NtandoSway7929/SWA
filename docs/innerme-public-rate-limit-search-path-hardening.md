# Public InnerMe rate-limit RPC search-path hardening

## Finding

The public website's rate-limit RPC `public.consume_public_innerme_rate_limit(text, text)` was explicitly configured with `search_path = public`. The function is `SECURITY INVOKER`, its application table references are schema-qualified, and execution is granted to `service_role` rather than `anon` or `authenticated`. Current schema privileges also prevent anonymous and authenticated roles from creating objects in `public`.

This was defense-in-depth hardening, not evidence of a confirmed exploit.

## Change

Pin the function search path to the empty string so unqualified object resolution is limited to PostgreSQL built-ins. Keep rate-limit thresholds, hashed identifiers, table permissions, function grants and the invoker-security boundary unchanged. The migration checks these invariants and aborts if the catalog does not reflect them.

## Verification

```sh
node --check scripts/innerme-public-rate-limit-search-path.test.mjs
node --test scripts/innerme-public-rate-limit-search-path.test.mjs
```

After applying to an environment, confirm the function's `proconfig` includes `search_path=""`, `prosecdef` remains false, and only `service_role` can execute it. Test before production.
