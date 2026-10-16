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
