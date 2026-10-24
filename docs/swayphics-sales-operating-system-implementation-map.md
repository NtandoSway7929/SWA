# Sales Operating System — Implementation Map

Status: Phase 4 implementation in progress (batches A-D; latest revision validation pending)
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

## Implementation progress — 2026-10-24

### Batch A — completed on the feature branch

- Added the read-only Sales Work Queue to the current admin workspace.
- Queue prioritises due/overdue follow-ups, sent quotes awaiting a response, and active leads without a next action.
- Added a static regression test; site validation and isolated desktop/mobile admin tests with disposable Supabase persistence/access-control checks passed for the batch-A commit.
- No merge, deployment, production database write or external message was performed.

### Batch B — qualification fields implemented and validated (2026-10-24)

- Added structured business segment, explicit service fit/capacity, website need, contactability, buying signal, qualification priority and primary evidence URL fields to the lead editor.
- Added reviewer timestamp and reviewer identity fields. They are updated only when a qualification field actually changes.
- Defaults are explicitly Unknown/Unassessed. Priority is human-set and its definitions are displayed in the form; no opaque AI score is introduced.
- Clarified that `leads.source` means original acquisition source/channel, not campaign membership, campaign spend or contact attempts.
- Added forward-only SQL and aligned the bootstrap and disposable local test schemas. The migration is not applied to production by this PR.
- Added static tests for form fields, migration, bootstrap schema, and disposable test schema. Full CI and browser validation must pass before considering this batch ready for review.

### Batch C — communication outcomes implemented (2026-10-24)

- Added explicit communication outcomes with a `not_recorded` default; the data model does not infer results from missing fields.
- Added a rolling 30-day prospect-contact cohort in Insights. The denominator is distinct leads with a manually logged outbound communication in that window; each lead is counted once, and only inbound records on/after the first in-window outbound attempt count as replies.
- Metrics show attempts, unique prospects contacted, recorded replies, explicit positive replies, meetings agreed, proposals requested, follow-ups requested and opt-outs. They are labelled as manual logs, not provider delivery/read receipts.
- Added opt-out safeguards to the Sales Work Queue, automated quote-follow-up suggestions and the email composer. A later explicit opt-in record can restore eligibility; invalid lead contactability and the latest invalid email-route outcome also block email composition.
- Added a forward-only migration, bootstrap/disposable schema changes, RLS rules and tests for persistence, invalid values, synthetic browser save and email suppression.
- The migration has not been applied to production. Full static, browser, local Supabase and regression CI must pass before the batch is ready for review.

### Batch D — campaign attribution and spend tracking implemented on the feature branch (2026-10-24)

- Added `sales_campaigns`, `sales_campaign_leads` and `sales_campaign_spend`, with forward-only migration, bootstrap alignment, disposable test schema, admin-only RLS and integrity constraints.
- Primary versus assisted attribution is a manually recorded claim. A lead may have one primary campaign; duplicate campaign/lead links are rejected.
- Campaign budgets and actual spend remain separate. Actual spend totals are grouped by currency, never combined across unlike currencies. The UI labels current won status as present CRM state, not proof of campaign-caused sales or historical conversion.
- Added date, amount, currency, segment and evidence-URL validation. The migration and workspace subscription list now include Realtime handling for campaign tables; rollout must still apply SQL in the right order.
- The isolated browser workflow covers synthetic campaign creation, primary lead attribution and spend entry. The local Supabase workflow covers persistence, constraints and RLS. The latest revision must pass all validation before this PR is ready for review.
- No campaign, qualification or communication migration has been applied to production; no outbound communication has been sent.

## 4. Batch A acceptance criteria

1. Sales queue uses existing records and displays a helpful empty state.
2. Due and overdue follow-ups sort deterministically by urgency/date.
3. Won, lost and not-interested leads are excluded from routine outreach recommendations.
4. Every queue item links to the existing record view/action without inventing data.
5. Queue rendering performs no database writes and sends no external messages.
6. Existing lead/contact-toggle/follow-up behaviours still pass tests.
7. Mobile layout remains usable and labels have accessible names.
8. The feature can be disabled/reverted without changing database schema.

## 5. Remaining items before live rollout

- Email reply-to-lead association remains manual; automatic matching must not be enabled without evidence that it avoids false joins.
- Reliable historical stage timestamps are still required before reporting closed-won cohort conversion, campaign ROI or cost per acquired client.
- Before applying SQL, verify the live Supabase schema, existing policies and applied migration set against the repository. The new migration files are forward-only but have not been applied to production.
- The current PR is intentionally unmerged and undeployed. Merge, production SQL application and deployment require explicit approval.

Unknown results remain unknown; silence is not rejection, manually recorded events are not provider delivery/read receipts, and campaign association is not proof of causation.
