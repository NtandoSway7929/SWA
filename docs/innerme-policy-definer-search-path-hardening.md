# InnerMe Phase 30 policy function search-path hardening

## Scope and rationale

The Phase 30 implementation has two private `SECURITY DEFINER` functions:

- `innerme_private.innerme_action_policy_fingerprint(uuid)`
- `innerme_private.evaluate_innerme_action_policy(uuid, text)`

Both bodies use schema-qualified application tables and helper functions; unqualified calls are PostgreSQL built-ins. Pinning `search_path` to the empty string prevents resolution through application schemas inside these privileged functions.

The migration preserves `SECURITY DEFINER`, ownership, grants, approval/execution rules, function bodies, and all action data. Its catalog postcondition fails closed unless both functions stay definer functions, remain callable by `authenticated` (the functions enforce admin authorization internally), remain unavailable to `anon`, and have an empty search path.

## Verification

```sh
node --check scripts/innerme-policy-definer-search-path.test.mjs
node --test scripts/innerme-policy-definer-search-path.test.mjs
```

Apply to **Swayphics InnerMe Test** first. Do not create an action proposal, approve an action, send an email, or insert a task as part of this configuration-only test.
