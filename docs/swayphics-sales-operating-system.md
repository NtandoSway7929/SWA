# Swayphics Sales Operating System (SOS)

Status: Phase 2 specification, draft for review
Branch: `feature/swayphics-sales-operating-system`
Base: `main`
Scope: Internal sales operations for Swayphics, initially focused on website design and development.
Production impact: None. This document does not change the live site, database, or outbound messaging.

## 1. Objective

Create a repeatable, measurable process that helps Swayphics identify qualified prospects, contact them appropriately, follow up on time, convert suitable opportunities into scoped proposals, and distinguish won work from cash collected.

The system supports sales decisions; it does not promise or assume a conversion outcome.

## 2. Existing foundations to reuse

The current repository already defines these relevant Supabase tables in `supabase/swayphics-admin-workspace.sql`:

- `leads`: business/contact details, service interest, source, status, estimated value, owner, next follow-up, notes, and research/assessment fields.
- `follow_ups`: scheduled date, channel, status, note, assigned owner, and linked lead/client.
- `communication_logs`: inbound/outbound channel, subject, message, contact timestamp, and linked lead/client.
- `quotes`: linked lead/client, amount, status, validity date, and notes.
- `payments`: client/project, amount, status, method, due date, paid date, and reference.
- `activity_log`: existing activity trail.

The business-flow SQL already includes configurable stale-lead handling, lead-to-client conversion, and payment/invoice synchronization. Extend these paths only after confirming their live behaviour and callers.

## 3. Operating pipeline

Use the existing lead statuses where possible:

1. **New** — recorded but not yet contacted.
2. **Contacted** — at least one genuine outbound attempt logged.
3. **Interested** — prospect has shown a meaningful positive response or agreed to discuss.
4. **Proposal sent** — a scoped quote/proposal has actually been sent.
5. **Negotiating** — prospect is actively discussing scope, terms, timing, or price.
6. **Won** — prospect has accepted the project and the existing lead-to-client conversion path is completed.
7. **Lost** — prospect explicitly declined, selected another provider, became ineligible, or a documented close-out rule was met.

A scheduled follow-up is an activity, not a pipeline status. Do not infer that a prospect is interested simply because a follow-up is due.

For a no-response lead, keep the actual sales status truthful and use the existing follow-up date / follow-up task to drive work. Any existing stale-lead status behaviour must be checked for reporting side effects before it is changed.

## 4. Prospect qualification

Use a transparent, evidence-based checklist rather than an opaque AI-generated score. For each candidate, record:

- **Website need:** no website, materially broken experience, or a specific verified improvement opportunity.
- **Commercial relevance:** the proposed site has a plausible role in enquiries, bookings, portfolio discovery, or explaining services.
- **Contactability:** a legitimate, publicly supplied business channel and, where possible, the correct decision-maker.
- **Fit:** the requested scope is within Swayphics' capability and current capacity.
- **Buying signal:** a stated need, question, referral, request for pricing, or agreed conversation. A weak online presence alone is not a buying signal.

Recommended priority bands:
- **A / contact first:** clear verified need, good service fit, valid contact route, and at least one meaningful timing or buying signal.
- **B / test:** verified need and fit, but timing or buying intent is unknown.
- **C / defer or disqualify:** weak fit, unverified claims, no appropriate contact route, or no commercially credible use case.

Each qualification decision should cite its observation/source in the lead research fields. Missing evidence must remain marked unknown, not treated as a negative fact.

## 5. Outreach controls

- Log every real outbound or inbound contact in `communication_logs` with the correct direction, channel, timestamp, and linked lead.
- Log the outcome separately in a structured field or activity record if available; do not rely on message text alone for reporting.
- Follow-up records must have a date, channel, lead/client link, and a clear purpose.
- Suggested initial sequence: first contact, one relevant follow-up after 3–4 days, another appropriate attempt after 7–10 days, and a final close-out attempt around day 14. This is an initial operating hypothesis, configurable by channel and response.
- Stop the sequence when the prospect replies, opts out, is disqualified, or enters a stage where the next action differs.
- Never auto-send external messages in the initial release. Prepare drafts and reminders for human review. Any later sending automation requires explicit enablement, rate limits, suppression/opt-out checks, and auditable logs.
- Avoid duplicate outreach by checking prior contact history and a normalized business/contact identity before adding or contacting a lead.

## 6. Daily work queue

The dashboard should prioritize actions in this order:

1. Explicitly requested callbacks or replies awaiting a response.
2. Overdue follow-ups on active, qualified leads.
3. Follow-ups due today.
4. Qualified prospects not yet contacted.
5. Proposals awaiting a decision or a scheduled next step.
6. Data hygiene tasks (missing contact route, stale status, duplicate candidates).

Every queue item should show: business name, current stage, reason it appears, last contact, next action/date, service need, lead owner, and a direct link to the existing lead record. Completed, lost, won, and opted-out leads must not appear as routine outreach tasks.

## 7. Metrics and definitions

All rates must show numerator, denominator, time window, and cohort. Do not mix lifetime totals with a selected campaign's totals.

- **Delivered/contact attempts:** count of logged outbound attempts. This is not proof of delivery or reading.
- **Reply rate:** unique contacted leads with at least one inbound response during the defined attribution window divided by unique leads contacted in that cohort. Exclude bounced/invalid contacts where that state is known; disclose when delivery status is unavailable.
- **Positive reply rate:** contacted leads that show a meaningful positive response divided by contacted leads. Use a structured outcome, not sentiment inferred from message wording alone.
- **Conversation rate:** contacted leads that complete a substantive discovery conversation divided by contacted leads.
- **Proposal rate:** leads with a proposal sent divided by leads that completed a substantive discovery conversation.
- **Close rate:** won leads divided by a clearly specified cohort, preferably proposals sent for proposal-to-close analysis. Also report contacted-to-won separately.
- **Collected revenue:** sum of payments with status paid and a confirmed paid date, using the source-of-truth payment/invoice records and preventing double counting.
- **Acquisition spend:** actual recorded spend tied to a campaign/channel and period. Unrecorded spend is unknown, not zero.
- **Cost per acquired client:** attributable acquisition spend divided by new clients won in the same attribution cohort. If no clients were won, report undefined/not applicable rather than zero.
- **Average deal value:** total won value divided by number of won deals in the same cohort; keep this distinct from cash collected.

Do not calculate source/industry conversion rates until reliable source and segment values are captured consistently. Show small sample sizes and avoid presenting early results as statistically conclusive.

## 7A. Communication outcomes and opt-out controls

Every communication log has an explicit result field. Existing records default to `not_recorded`; missing outcomes must not be retrospectively guessed. Supported outcomes include no reply yet, positive/neutral/negative reply, meeting agreed, proposal requested, follow-up requested, opt-out, explicit opt-in, invalid contact route and other. “No reply yet” is only appropriate after a reasonable response window, and is not a rejection.

An explicit opt-out suppresses routine lead follow-up suggestions and email composition. A later, separately logged explicit opt-in can restore eligibility. An invalid lead contactability assessment or the latest unresolved invalid-email outcome also blocks email composition until the contact route is verified. Billing/invoice work remains separate from sales outreach suppression.

The rolling 30-day outreach report uses distinct leads with a manually logged outbound communication during the window. Each lead enters the denominator once; a reply counts only when there is a manually logged inbound communication at or after the cohort's first outbound event. Positive replies, meetings, proposals requested, follow-up requests and opt-outs require explicit inbound outcomes. These are not email delivery/read receipts, and the report must disclose incomplete or missing communication history.

## 8. Campaign tracking

Campaign-level tracking should capture campaign name, channel, industry/segment, start/end dates, spend amount and currency, and the set of leads included. Reuse existing `leads.source` for source attribution, but do not overload it with multiple meanings. If campaign membership cannot be represented safely with current fields, propose a normalized campaign table in a later implementation step instead of storing structured data in free text.

## 9. Won sale and payment truth

- A proposal marked accepted is not, by itself, proof that payment has been received.
- A lead is won only after the client/project handoff is successfully recorded by the existing conversion flow.
- Record the accepted scope and agreed amount in the quote/project records.
- Report contracted/won value separately from invoiced, outstanding, and cash-collected amounts.
- Avoid counting both a paid invoice and its corresponding payment record as separate revenue.
- Conversion must remain idempotent and must not create duplicate clients.

## 10. Implementation and safety requirements

- Preserve Vanilla HTML/CSS/JavaScript; no new framework or paid CRM dependency.
- Reuse current Supabase tables and functions unless a documented gap justifies a schema change.
- Any schema change must be a forward-only migration with rollback notes, constraints, indexes where justified, and RLS review.
- Do not weaken RLS or expose service-role credentials to the browser.
- Keep production read-only during audit and implementation until a reviewed change is explicitly approved for deployment.
- Use synthetic fixtures for browser tests; never send test messages to real prospects.
- Add tests for pipeline stage transitions, due/overdue ordering, opt-out suppression, duplicate detection, metric formulas, and payment/revenue reconciliation.
- Validate desktop and mobile, existing lead actions, current admin workflows, accessibility basics, and relevant CI before merge/deploy.

## 11. Phase gates

- **Phase 1 — Audit:** inspect current code/schema/workflows and document confirmed foundations and unknowns.
- **Phase 2 — Rules/specification:** define statuses, qualification, outreach safeguards, metric formulas, and acceptance criteria. (This document.)
- **Phase 3 — Implementation design:** map each requirement to existing UI components, data fields, SQL functions, and tests; list true gaps.
- **Phase 4 — Small implementation batches:** implement only verified gaps on this feature branch.
- **Phase 5 — Isolated validation:** run unit/static checks and synthetic browser/database tests without contacting real prospects or mutating production data.
- **Phase 6 — Review and deployment gate:** inspect the diff and CI; deployment requires explicit approval.

## 12. Acceptance criteria for the first usable release

1. A lead can be qualified with source evidence and a transparent priority band.
2. Every outreach attempt and response can be recorded against the correct lead.
3. Due and overdue actions are visible and ordered in one daily queue.
4. Opted-out, won, lost, and disqualified leads are excluded from routine outreach.
5. A proposal can be traced to the lead, agreed amount, outcome, and resulting client/project.
6. Reports distinguish contact attempts, replies, proposals, wins, contracted value, and collected cash.
7. Campaign spend and client acquisition cost are not fabricated when data is missing.
8. Existing admin, RLS, lead conversion, payment synchronization, and mobile behaviour pass regression checks.
9. No external message is sent automatically by default.
10. No production mutation or deployment occurs without review and approval.
