# Swayphics AI Co-Manager Protocol

This document defines how two or more AI assistants can maintain Swayphics without assuming they share hidden memory or a private channel.

## Authority and responsibility

- The business owner is the final authority on brand direction, prices, business policy, risk tolerance and commercial decisions.
- Each AI is an independent technical and business collaborator expected to investigate, identify problems, propose ideas and implement appropriately scoped work.
- Repository source, live Supabase state and reproducible test evidence outrank stale chat summaries. If evidence conflicts, disclose the conflict and investigate.
- The owner-provided reference documents are useful initial context. This repository's [master context](AI_SWAYPHICS_MASTER_CONTEXT.md) is a durable index; refresh it when important facts change.
- No prompt can guarantee an AI platform's memory lasts forever. Store durable knowledge and decisions in version-controlled files and use platform memory only as an additional layer.

## Required start-of-task checklist

1. Read `docs/AI_SWAYPHICS_MASTER_CONTEXT.md` and this protocol.
2. Read recent entries in `docs/ai-coordination-log.md`, current claims in `docs/ai-ownership-registry.md`, and decisions in `docs/ai-decisions.md`.
3. Inspect current `main`, related branches, open PRs, checks and relevant source before proposing or modifying overlapping work.
4. Verify live Supabase projects, Edge Function versions/hashes, applied migration history and relevant schema/ACLs when the task depends on live state.
5. Record the objective, owner, affected paths/database objects, branch and verification plan before doing non-trivial implementation.

## Shared ownership / collision prevention

- Create a dedicated branch and a narrowly scoped PR for each task.
- Claim work in the ownership registry with agent identity, task ID/PR, affected paths or objects, status, date and handoff notes.
- Do not edit a path or database object claimed by another active task without coordinating a handoff.
- Mark work complete only after the PR/commit and test evidence are recorded. Release the claim when done.
- Before pushing, compare against latest `main` and current PRs; never assume the base branch hasn't moved.
- If no direct AI-to-AI channel exists, use the coordination log/PR discussion as the message bus. An entry is not read by the other AI automatically: the other AI must poll/read it.

## Supabase safety contract

- Default to read-only inspection. Separate production and isolated-test projects and verify project identity before every mutation.
- Never copy production credentials to the test project or use real customer data in synthetic tests.
- Never expose service-role keys or secrets in frontend code, committed config, prompts, logs or results.
- For schema/security work, inspect the table grants, RLS policies, RPC bodies/ACLs, `SECURITY DEFINER`, search paths, dependent triggers, applied migrations and rollback/forward-repair path.
- Treat advisory findings as leads to review. Do not automatically add RLS policies, revoke public execution, change function security or build indexes without understanding the intended access model and regression impact.
- Test DDL/behaviour on an isolated environment first. Use migration-backed changes, verify post-migration state, then run targeted advisors and meaningful tests.
- A health endpoint or unauthenticated rejection does not prove authenticated chat, model-provider calls, action execution, task creation, or email delivery works.
- A proposal/recommendation is not an executed action. Preserve permission checks, approvals, safety gates, idempotency, audit logs and outcome verification.

## Engineering and product principles

- Keep the website/admin frontend in vanilla HTML, CSS and JavaScript unless the owner approves a framework change.
- Prefer small, testable patches. Preserve working UI and behaviour.
- Separate evidence, inference, recommendation and verified runtime result in technical reporting and InnerMe answers.
- Do not claim runtime functionality from the existence of source files/migrations alone.
- Treat provider failures, rate limits, timeouts and missing telemetry as execution/infrastructure uncertainty, not answer-quality failures.
- Evaluate ideas by user/business value, expected reliability, compute and maintenance cost, risk, privacy, and reversibility. Independent exploration is encouraged; destructive action is not a substitute for a documented proposal.
- Protect the owner’s brand preferences and service/pricing constraints captured in the master context.

## Evidence labels

Use these labels in handoffs:

- **SOURCE-CONFIRMED:** directly seen in the current repository/file/schema.
- **CI-VERIFIED:** a named workflow/test passed on a specified commit.
- **ISOLATED-RUNTIME-VERIFIED:** a named test passed against the isolated Supabase project.
- **PRODUCTION-READ-ONLY-VERIFIED:** a non-mutating live check passed.
- **PRODUCTION-END-TO-END-VERIFIED:** the exact authenticated production user journey passed safely.
- **HISTORICAL-REPORT:** recorded by the owner or an earlier session but not revalidated now.
- **INCONCLUSIVE / NOT-VERIFIED:** failure, missing evidence, stale run, insufficient test coverage or unavailable result.

A test result must include the commit/deployment version, test run/link where possible, date and exact scope. Avoid words such as “fixed,” “safe,” “fully working” or “complete” unless the relevant acceptance criteria have been verified.

## Required handoff format

In the coordination log or PR, record:

1. Objective and agent/task owner.
2. Baseline commit/deployment and affected paths/database objects.
3. Findings and evidence, with source links.
4. Changes proposed/made.
5. Tests and exact result, including gaps.
6. Production touched? If yes, what, when, and rollback/repair route.
7. Handoff/next decision and the other agent's ownership boundary.

## Memory persistence

Do not promise “forever” memory. Read and update the repository context, decision log and coordination log at the end of material work. If the platform supports durable memory, save a short stable summary there too, then state what was actually saved. The repository is the recoverable operating record, not platform-level memory.
