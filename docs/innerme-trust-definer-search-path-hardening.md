# InnerMe trust/calibration function search-path hardening

## Scope

This migration pins the four reviewed private trust/calibration implementations to an empty `search_path`:

- `innerme_private.record_innerme_agent_trust_evidence(...)`
- `innerme_private.refresh_innerme_agent_trust_calibration()`
- `innerme_private.review_innerme_agent_trust_evidence(uuid, text)`
- `innerme_private.review_innerme_trust_calibration(uuid, text)`

All application tables and application helper calls in their inspected bodies are schema-qualified. The remaining unqualified names are PostgreSQL built-ins, which remain resolvable through the implicit `pg_catalog` lookup.

This is defense-in-depth, not a confirmed exploit. The change preserves each function's `SECURITY DEFINER` setting, owner, existing ACLs, authorization checks, function body, evidence policy, trust thresholds, and all trust/calibration rows.

## Verification

Run the provider-free test:

```sh
node --check scripts/innerme-trust-definer-search-path.test.mjs
node --test scripts/innerme-trust-definer-search-path.test.mjs
```

The migration's postcondition requires all four exact functions to remain definer functions, have `search_path=""`, be non-executable by `anon`, and remain executable by `authenticated` (with internal admin checks preserved).

Apply to **Swayphics InnerMe Test** first. This migration should not create or review evidence, create calibration proposals, change trust stages, or run agent actions.
