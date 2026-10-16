# Swayphics AI Coordination Log

Purpose: durable cross-session/cross-agent handoff. This file is public with the repository. Do not add credentials, customer PII, inbox excerpts or sensitive data.

## 2026-10-16 — ChatGPT onboarding and live baseline

**Agent:** ChatGPT (GitHub/Supabase connected tools)  
**Status:** Documentation branch opened; production/database work remained read-only.  
**Baseline:** `main` at `c63e7bf2e1df9030ed1ee79682b4025575b1f35c` at inspection.  
**Branch:** `docs/ai-co-management-foundation`.  
**Documentation PR:** [PR #74](https://github.com/NtandoSway7929/SWA/pull/74) (open, draft; documentation-only).  
**Existing PR:** [PR #4](https://github.com/NtandoSway7929/SWA/pull/4) remains open/draft and is not part of this documentation task.

### Verified observations

- Authenticated GitHub connector has write permission on `NtandoSway7929/SWA`.
- Supabase connection lists active/healthy projects **Swayphics Web** (production) and **Swayphics InnerMe Test** (isolated).
- Production `swayphics-ai`: ACTIVE v137. Isolated-test `swayphics-ai`: ACTIVE v24. Both returned bundle hash `d468870f5dd7bceaf27914c943d21432fad5091b65a659e755e571326c415fce` during this inspection. These versions/hash are dated snapshots; re-check before any deployment.
- Production migration ledger recent entries use several timestamps different from same-purpose filenames seen in the repository. Latest example: ledger `20261016041121 innerme_zero_cost_quota_exhaustion_fix` vs tracked `supabase/migrations/20261016034000_innerme_zero_cost_quota_exhaustion_fix.sql`. Need exact definition and migration-history reconciliation; this is not proof of schema drift alone. Do not replay migrations blindly.
- Security advisor snapshot (2026-10-16): 3 public tables had RLS enabled but zero policies (`enquiry_rate_limits`, `innerme_provider_quota_daily`, `public_innerme_rate_limits`); 7 functions flagged for mutable/unspecified search path; 5 `SECURITY DEFINER` functions listed as executable by anon; performance advisor listed 75 foreign keys without covering indexes. Review intent, grants, function bodies, workload and regression risk before making changes.
- One prior isolated semantic retrieval run #11 was reported failed/inconclusive on an earlier commit; its root cause is not yet verified in this handoff. Do not label it the latest main result.
- Existing PR #4 describes source-level evidence traceability work, but remains draft with authenticated evidence-answer testing and a valid benchmark outstanding in its description. Revalidate against current main and production before making status claims.

### Actions taken

- Started a separate documentation-only branch `docs/ai-co-management-foundation`.
- No production schema, live workspace records, Edge Function deployment, secrets, or permissions were changed as part of this audit.
- The documented advisor findings are not automatically accepted as vulnerabilities; some public token-gated RPCs may be intentional and require code/ACL review.

### Next recommended audit tasks

1. Reconcile checked-in migration filenames, Supabase migration history, and actual definitions for the recent execution-contract, run-controller, workspace-summary, provider-telemetry/guard, and zero-cost-quota migrations.
2. Inspect each advisor finding's intended access model and actual grants/body. Prioritise public-callable `SECURITY DEFINER` RPCs and token-gated client portal/onboarding paths.
3. Check current Actions result and isolated retrieval suite artifacts/logs, then establish an interpretable retrieval baseline; keep provider failures inconclusive.
4. Run authenticated evidence-answer coverage with a dedicated isolated-test admin. Do not fabricate/reuse an identity or use production credentials.
5. Keep a separate task/branch per workstream and ask the other AI to acknowledge handoff in this log before overlapping edits.

### Handoff template

Append new entries rather than replacing prior history.

- **Date / agent / task:**
- **Baseline commit and deployment version:**
- **Ownership claim / branch / PR:**
- **Evidence and findings:**
- **Changes:**
- **Tests/results:**
- **Production touched / rollback:**
- **Handoff and next action:**


## 2026-10-16 — Documentation PR opened

- **PR:** [#74 — Establish durable AI co-management context and coordination](https://github.com/NtandoSway7929/SWA/pull/74)
- **Branch/head:** `docs/ai-co-management-foundation` at `9b62e643b568266f31ff8f02fb089e7ee7f98f30` when opened.
- **Scope:** five documentation files only. PR is intentionally draft pending review and checks.
- **Production change:** none. No Supabase writes or deployments.
- **Next:** review relative links and rendered Markdown, inspect PR checks, then merge only after review.

## 2026-10-16 — Production/test source and schema comparison

**Agent:** ChatGPT
**Evidence level:** PRODUCTION-READ-ONLY-VERIFIED for metadata/schema/function-source comparisons.
**Scope:** Read-only; no deployment, schema or business-record writes.

### Edge Function source comparison

- Production `Swayphics Web`: `swayphics-ai` ACTIVE v137.
- Isolated test `Swayphics InnerMe Test`: `swayphics-ai` ACTIVE v24.
- Both reported bundle SHA-256 `d468870f5dd7bceaf27914c943d21432fad5091b65a659e755e571326c415fce`.
- Compared deployed files to `main` individually: `index.ts`, `innerme-evidence-traceability.mjs`, `innerme-provider-routing.mjs`, `innerme-workspace-intelligence.mjs`, `innerme-context-compaction.mjs`, `innerme-context-manifest.mjs`, `innerme-run-controller.mjs`, `innerme-execution-contracts.mjs`, `innerme-retrieval-ranking.mjs`. All nine exact text comparisons passed in both projects.
- This confirms source/deployment parity for the inspected bundle; it does not prove end-to-end chat/retrieval/controlled execution behaviour.

### Schema and migration parity

- Public tables: production 89, isolated test 26. Shared 25; 64 production-only; one test-only (`innerme_routing_experiment_runs`). The test project is a scoped isolated test environment, not a full production schema replica.
- Migration ledger: production 40 entries, isolated test 17. Six names overlap and all six use different migration version identifiers between projects.
- Eight same-purpose production migration names have version identifiers that differ from the checked-in migration filenames: lead-not-interested, provider telemetry, zero-cost provider guard, provider usage upsert privileges, execution contract snapshots, execution-step controller, workspace-summary RPC and zero-cost quota exhaustion fix. Detailed timestamps are recorded in `AI_SWAYPHICS_MASTER_CONTEXT.md`.
- Do not assume this means SQL/schema drift. Compare exact migration bodies, current function definitions, indexes, policies, grants, triggers and dependent objects. Do not reapply migrations to force ledger parity.

### Security-advisor follow-up

- The three advisor-flagged public tables with RLS but no policies (`enquiry_rate_limits`, `innerme_provider_quota_daily`, `public_innerme_rate_limits`) also have no direct SELECT/INSERT/UPDATE/DELETE privilege for `anon` or `authenticated`. This is consistent with backend/service-role-only access and may be intentional.
- Five anon-executable `SECURITY DEFINER` RPCs were inspected. They are token-gated onboarding/client-portal paths; the inspected definitions hash the supplied token and check token activity/expiry where applicable. `submit_client_portal_request` has per-token rate limiting. Continue reviewing token issuance entropy and life cycle, expiry policy, rate-limit bypasses and data returned. Do not blindly revoke grants because the client portal requires a public token path.
- Seven search-path advisor warnings and 75 unindexed-FK warnings remain triage items; not remediated in this read-only session.

### PR state

- [PR #74](https://github.com/NtandoSway7929/SWA/pull/74) is an open draft documentation PR.
- The site-validation workflow passed on an earlier intermediate head of this documentation branch. The final doc-only head has no combined commit status presently reported by the connector, so do not claim checks passed on the latest head.
- Existing [PR #4](https://github.com/NtandoSway7929/SWA/pull/4) was not modified.
