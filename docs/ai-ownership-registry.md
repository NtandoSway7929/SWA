# Swayphics AI Ownership Registry

This file coordinates work between AI sessions. Always refresh it and inspect open PRs before changing code/schema. It is public; never record secrets or personal customer data here.

## Coordination rules

- One active owner per task and per overlapping file/database object.
- Work should be isolated by branch/PR. Put exact paths and affected database objects in the claim.
- Claims are advisory until committed/visible in GitHub; check recent activity before relying on them.
- If another agent already owns the same surface, do not edit concurrently. Request a handoff in the coordination log or PR discussion.
- A claim is released only after the handoff, PR state and validation evidence are recorded.
- Production DB changes and Edge Function deployments require a separate explicit plan with isolated verification, expected impact and recovery strategy.

## Active claims

| Task | Agent | Branch / PR | Paths / resources | Status | Last update | Handoff |
|---|---|---|---|---|---|---|
| AI co-management foundation docs | ChatGPT | `docs/ai-co-management-foundation` ([PR #74](https://github.com/NtandoSway7929/SWA/pull/74), draft) | `docs/AI_SWAYPHICS_MASTER_CONTEXT.md`, `docs/ai-co-manager-protocol.md`, `docs/ai-coordination-log.md`, `docs/ai-ownership-registry.md`, `docs/ai-decisions.md` | Draft PR open; await review | 2026-10-16 | [PR #74](https://github.com/NtandoSway7929/SWA/pull/74). Release claim after review/merge or handoff; another agent may review but should not push conflicting changes on this branch. |
| InnerMe evidence traceability | Existing owner PR | [PR #4](https://github.com/NtandoSway7929/SWA/pull/4) | InnerMe traceability helper/prompt/tests and affected workflow files per PR | Existing draft; separate scope | 2026-10-16 | Do not merge or rewrite as part of docs onboarding. Use PR #4 discussion for that task. |

## Queue / unclaimed recommended work

| Task | Suggested owner | Scope | Notes |
|---|---|---|---|
| Migration ledger/schema parity audit | Unclaimed | Recent InnerMe execution, run-controller, workspace summary, provider telemetry/quota guard migrations | Read-only first. Do not replay migrations. |
| Security advisor triage | Unclaimed | Anon-callable SECURITY DEFINER RPCs, function search paths, no-policy RLS tables | Review intended public token access, grants, and code paths before any changes. |
| Retrieval benchmark diagnosis | Unclaimed | Isolated semantic retrieval regression suite + archived results/logs | Distinguish test harness/provider failure from retrieval-quality failure. |
| Authenticated evidence-answer verification | Unclaimed | Isolated project with dedicated test admin only | Never use a production admin identity or create production business records. |

## Claim update format

Before substantive work, update this table or append a coordination-log entry with:

- Task identifier and objective.
- Agent identity and current contact/handoff method.
- Branch/PR and exact code paths/database objects.
- Planned evidence and acceptance criteria.
- Risks, dependencies and expected time window (only if relevant).
- Completion state and test evidence.

No single AI has implicit ownership of all future tasks. Explore independent ideas, but announce claims and respect in-progress ownership.
