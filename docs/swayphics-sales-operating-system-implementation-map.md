# Sales Operating System — Implementation Map

Status: Phase 3 implementation design
Branch: `feature/swayphics-sales-operating-system`
Base: `main`
Related specification: `docs/swayphics-sales-operating-system.md`
Production impact: None.

## 1. Confirmed existing implementation

Evidence was read from the current `main` repository source. Confirm live production behaviour separately before deployment.

| Requirement | Existing implementation | Decision |
|---|---|---|
| Lead stages and estimated value | `public.leads` schema; lead manager in `admin-dashboard/admin-workspace.js` | Reuse existing fields/statuses. |
| Source attribution | `leads.source`; `renderLeadSourceAnalytics()` groups lead volume, won count and estimated value by source | Reuse; improve definitions before relying on the current “rate”. |
| Scheduled follow-ups | `public.follow_ups`; Follow-ups view and due/overdue items in `renderNeedsAttention()` | Reuse and consolidate into a sales-focused queue. |
| Communication history | `public.communication_logs`; Communication log view; lead/client links | Reuse as activity source; add structured outcome only if the existing model cannot support reliable metrics. |
| Proposal/quote tracking | `public.quotes` and quote workspace | Reuse and link to lead/client. |
| Won lead conversion | `convert_swayphics_lead_to_client(uuid)` in business-flow SQL | Preserve idempotence and current authorization checks. |
| Stale-lead handling | `process_swayphics_stale_leads()` and `workflow_settings.lead_no_response_days` | Audit side effects before changing; do not use stale/no-response as a synonym for lost. |
| Revenue and payments | Existing payments/invoices, cash-flow insights and synchronization functions | Reconcile source-of-truth and avoid double counting. |
| Stage analytics | `renderLeadConversionAnalytics()` uses current stage and `leadStageHistory` | Keep current view; clarify cohort-based conversion separately. |
| Admin navigation and state | Workspace nav groups, `state.leads`, `state.followups`, `state.communications`, `state.quotes`, `state.payments` | Extend existing workspace; no parallel CRM. |

## 2. Confirmed reporting limitation

The current `renderInsights()` calculates `won / all currently tracked leads` and the current source report calculates `won / leads currently grouped by source`. The UI already labels the first metric as a share of all currently tracked leads, not a cohort conversion rate. These metrics are useful as descriptive snapshots but should not be presented as a campaign or proposal conversion rate.

The initial sales system should keep descriptive current-pipeline counts and introduce cohort-based metrics only when reliable contact timestamps/outcomes and a defined attribution window exist.

## 3. Implementation sequence

### Batch A — Sales action queue (first UI batch)
- Reuse `state.leads`, `state.followups`, `state.communications`, `state.quotes`, and existing navigation actions.
- Add a focused Sales Work Queue view inside the current admin workspace, not a new application.
- Prioritize: explicit inbound reply awaiting response (only if a reliable signal exists); overdue follow-ups; due-today follow-ups; active qualified leads without a next action; proposals with no recorded next step.
- Each item must link to the existing record and show why it is surfaced.
- Exclude won/lost/not-interested leads from routine prospecting actions.
- Do not send messages or mutate data merely by opening the view.

### Batch B — Qualification fields and source hygiene
- Inspect lead create/edit form and persistence paths before deciding if existing research/assessment fields are sufficient.
- Prefer explicit fields for segment, evidence URL/source, website need, contactability and priority only if a minimal schema change is justified.
- Unknown evidence remains unknown; no automated AI scoring without transparent evidence and human override.
- Do not store campaign membership as an unstructured concatenated string.

### Batch C — Outcome logging and metrics
- Inspect how communications are created/edited and whether structured outcomes can be added without breaking current logs.
- If schema changes are needed, create a forward-only migration with RLS policies and tests.
- Define cohort, time window, denominator and exclusion rules for reply, positive reply, conversation, proposal and close rates.
- Keep acquisition spend and cost per acquired client unavailable until campaign spend and attribution are captured reliably.

### Batch D — Regression and rollout
- Extend existing dashboard smoke tests with synthetic leads, communications and follow-ups.
- Assert no external message is sent; all external network mutation paths are blocked in tests.
- Test sorting, navigation, mobile layout, opt-out/disqualified exclusion, duplicate detection, RLS, lead conversion idempotence and payment reconciliation.
- Open a draft PR for review after tests; do not merge or deploy without explicit approval.

## 4. First-batch acceptance criteria

1. Sales queue uses existing records and displays a helpful empty state.
2. Due and overdue follow-ups sort deterministically by urgency/date.
3. Won, lost and not-interested leads are excluded from routine outreach recommendations.
4. Every queue item links to the existing record view/action without inventing data.
5. Queue rendering performs no database writes and sends no external messages.
6. Existing lead/contact-toggle/follow-up behaviours still pass tests.
7. Mobile layout remains usable and labels have accessible names.
8. The feature can be disabled/reverted without changing database schema.

## 5. Unresolved before implementation

- Whether inbound email replies can be reliably joined to a lead without false matching.
- Whether the current follow-up editor can represent all needed outreach outcomes.
- Whether lead stage history is complete enough for historical conversion cohorts.
- Whether campaign spend exists in a current table or must be added.
- Whether production RLS policies and the current deployed migration set match the repository.

These must be checked rather than assumed. The first UI batch should not depend on any unresolved item.
