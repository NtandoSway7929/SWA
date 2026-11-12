# Reconciliation audit attribution and duplicate-action safeguards — Stage 1.58

## Implemented
- Evidence entries display the recorded `created_by` administrator identifier.
- Workflow action entries display the recorded `actor_user_id` administrator identifier.
- The interface deliberately displays a shortened UUID-based administrator reference rather than inventing a person's name or querying unrelated profile data.
- Missing actor identifiers are labelled as unavailable.
- Evidence and action timelines are displayed oldest-first, with record ID as a deterministic tie-breaker for identical timestamps.
- Duplicate history-page requests are guarded while an equivalent request is in progress.
- History requests carry a request-generation identifier. Responses for a previously selected case are discarded rather than being rendered against the newly selected case.
- Evidence and case-action submissions already shared a synchronous busy guard; regression coverage now explicitly protects that duplicate-submit guard.
- The UI preserves append-only audit data and does not update or delete evidence/action records.

## Verification performed
- Browser JavaScript and Node regression-test JavaScript were parsed after the changes.
- Source assertions cover actor attribution, chronological sorting, stale-response rejection, history request guards and duplicate-submit protection.

## Not verified
- Node regression tests have not been executed in a Node runtime.
- Authenticated browser interaction, database RPC behavior and Deno tests remain unverified.
- The disposable Supabase migration baseline remains blocked by the pre-existing missing `public.leads` relation.

## Safety
All changes are on `feature/yoco-client-payments`. No production migration, production database operation, merge, deployment, Yoco webhook registration, credential configuration or live payment activation occurred.
