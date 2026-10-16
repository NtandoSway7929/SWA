# Swayphics Master Context for AI Co-Managers

**Purpose:** Durable, public-repository-safe operating context for any AI helping maintain Swayphics.  
**Last verified:** 2026-10-16.  
**Repository:** [NtandoSway7929/SWA](https://github.com/NtandoSway7929/SWA)  
**Default branch:** `main`.  
**Owner instruction:** Preserve existing decisions and working behaviour; verify live state before acting.

> This file is a concise index, not a substitute for checking the current source, database state, deployment, or test evidence. Historical reports and checked-in artifacts do not prove that a feature works in production. This repository is public; never add secrets, customer records, credentials, private messages, or sensitive environment configuration.

## 1. Business and brand

Swayphics is a South African **Creative & Design Lab**. Its tagline is **“EMPOWERING THROUGH DESIGN”** and the public website headline is **“Build a Brand Worth Remembering.”** The business aims to help small businesses, entrepreneurs and emerging ventures build credible brands and useful digital presence, with particular attention to practical conversion gaps such as a weak website, unclear calls to action, or missing booking/enquiry flows.

The desired voice is polished, premium, direct, human and empathetic. Class and occasional light humour are appropriate; generic AI-sounding language, empty buzzwords, robotic corporate tone and unsupported claims are not. The creative principle expressed by the owner is: **“we don’t AI-generate, we create.”**

### Design constraints

- Main palette: `#002096`, `#0031C5`, `#0152F4`, `#2C91FC`, `#77C1FC`, `#FFFFFF`.
- Purple is explicitly unwanted. Avoid gratuitous bright-blue backgrounds and generic AI-looking graphics.
- Owner-stated type preference: Montserrat for body/UI/buttons and Raleway for headings. Current website source has used Plus Jakarta Sans for body and Raleway for headings. Treat that as a discrepancy, not permission for an unrequested wholesale redesign.
- Preserve the actual official logo asset. Do not redraw, substitute, distort, change transparency treatment, or alter it without an explicit instruction.
- `FIST.webp` is used as the favicon/brand mark and must not be mistaken for the full logo.
- The portfolio's 3D concave carousel has been described as working. Avoid replacing working components without a demonstrated reason and regression tests.

## 2. Services and price baseline

Repository seed values in `supabase/swayphics-invoicing.sql` list:

| Service | Default/starting price |
|---|---:|
| Logo design | R250 |
| Flyer / poster | R150–R250 |
| Letterhead | R150 |
| Company registration | R500, listed as including CIPC-related costs; confirm the written inclusions |
| Business identity kit | Custom quote |
| Packaging design | R150 |
| Apparel design | R50–R100 |
| Business card | R100 |
| Social media management | R500/month |
| Google Business Profile setup | R500–R900 |
| Professional email setup | R300–R600 |
| Appointment/booking setup | R600–R1,200 |
| Website design | From R1,500 |

These are repository defaults and prior owner-approved price references, not a live price scrape. A project-specific written quote controls final scope and pricing. The public enquiry service list also includes **AI Customer Reply Setup**, but the reviewed seed catalogue did not establish its price. Confirm scope and price before quoting.

**Do not introduce the previously considered “Visual Brand Audit” service.** The owner explicitly excluded it. Do not revise prices or invent bundles/discounts without a new owner decision. ParSway is a separate venture and is outside this Swayphics context.

## 3. Website and repository architecture

- Website: [https://swayphics.co.za/](https://swayphics.co.za/)
- Repository: [https://github.com/NtandoSway7929/SWA](https://github.com/NtandoSway7929/SWA)
- `index.html` is the owner-stated primary website source of truth.
- Keep the frontend in vanilla HTML/CSS/JavaScript. Do not introduce React or another framework without explicit approval.
- Inspect the exact current file, caller/callee path, relevant SQL/migration and tests before editing.
- Prefer small, surgical changes over broad rewrites. Preserve existing state, interactions and working design patterns.

Important paths:

- `index.html`: public site.
- `admin/index.html`: private admin login.
- `admin-dashboard/index.html`: dashboard shell/navigation.
- `admin-dashboard/admin-workspace.js`, `admin-dashboard/admin-workspace.css`: main workspace logic/style.
- `admin-dashboard/innerme-*.js`: InnerMe chat, autonomy, incidents, intelligence, monitoring, predictive intelligence, provider usage and trust UI.
- `client-portal/`: client-facing portal.
- `supabase/functions/swayphics-ai/`: principal InnerMe Edge Function and helper modules/tests.
- `supabase/functions/innerme-retrieval-smoke-test/`: isolated semantic-retrieval test endpoint.
- `supabase/functions/submit-enquiry/`, `send-email/`, `sync-email-inbox/`, `send-admin-push/`, `generate-invoice/`, `request-client-review/`, `innerme-interventions/`: other key Edge Functions.
- `supabase/migrations/` and other files in `supabase/`: database schema, RPCs, policies, provider telemetry, knowledge, billing, run control and action-governance artifacts.
- `docs/`: roadmap, release, architecture and test documentation.
- `.github/workflows/`: validation, deployment and InnerMe test/benchmark workflows.
- `scripts/`: local tests and experiments for routing, retrieval ranking/regression and quota guards.

SEO discrepancy to keep in view: an earlier owner discussion preferred `https://swayphics.co.za/index.html` as canonical, while the reviewed source uses `https://swayphics.co.za/`. Inspect current source, redirect behaviour, sitemap and Search Console evidence before changing canonical policy.

## 4. Admin dashboard working model

Current navigation/source covers:

- **InnerMe:** Chat, Action Centre, Revenue Intelligence, Intelligence & Governance, Provider Usage.
- **Clients & Pipeline:** Enquiries, Leads, Clients, Communication Log, Inbox, Documents, Follow-ups.
- **Work & Portfolio:** Projects, Tasks, Portfolio.
- **Sales & Billing:** Quotes, Invoices, Payments, Services, Invoice Settings.
- **Website:** Website Content, Testimonials.
- **Administration:** Activity, Portal Requests, Data & Backup, Team.
- Other areas include Insights and Automated Reminders.

Owner-stated UX requirements to preserve and retest:

- Refresh should not send the operator back to Overview when another view was active.
- Mobile sidebar is intended to be swipe-only; do not re-add a toggle button.
- InnerMe belongs in its own sidebar group, not as dashboard cards embedded in Overview.
- The InnerMe chat should remain a clean chat UI without Overview-style Action Centre/revenue cards, and the owner requested removal of the orb.
- Dark mode should be truly dark where intended, without unwanted white gradients. Dark chat uses white bubbles with dark text; preserve the established light chat.
- Keep Intelligence & Governance copy and controls readable; don't crop headings or labels.

Lead action history included assessment-report editing, email, convert-to-client and delete. The owner requested a **Not Interested** status for prospects who are not ready now but can be contacted later. A migration exists at `supabase/migrations/20261009120000_swayphics_lead_not_interested.sql`; verify the present UI and live schema before claiming the whole flow works.

Previously reported bugs, now **historical retest candidates** rather than confirmed current defects: a `lead_proposals` 403, lead-email action, dropdown scroll/positioning, lead deletion HTTP 400 and inbox sync HTTP 546/resource exhaustion.

## 5. InnerMe and InnerMe Lite separation

**Internal InnerMe** is the private business-intelligence/operations agent within the admin workspace. Its intent includes grounded workspace reasoning, governed knowledge retrieval, decision support, follow-ups, incident handling, proposals, forecasts and controlled action preparation.

**InnerMe Lite** is the public website service-guidance assistant. It must not have access to private workspace data or administrative operations. Public and private experiences must stay separated through server-side authorization, explicit context selection and safe response contracts, not frontend-only controls.

### Architecture and roadmap

The main Edge Function is `supabase/functions/swayphics-ai/index.ts`. Supporting modules cover evidence traceability, provider routing, workspace intelligence, context compaction/manifests, retrieval ranking, execution contracts and durable run control. SQL migrations define supporting tables/RPCs, governance, telemetry and safety checks. The UI has separate `admin-dashboard/innerme-*.js` controllers.

Read [the 30-phase roadmap index](innerme-30-phase-roadmap.md) before reasoning about phase scope. Preserve these rules:

- A source file/migration proves that an artifact exists, not that the feature passed live testing.
- Never infer dependencies from phase numbering alone.
- Recommendations and plans do not execute themselves.
- Approval, permission checks, pre-execution safety gates, audit logs and outcome verification remain separate meaningful steps.
- Inconclusive provider/benchmark failures must not be scored as an answer-quality failure or a pass.
- Don't invent titles/scope where the roadmap itself says mapping is unverified.

## 6. Connected live-environment baseline (read-only observation, 2026-10-16)

The connected Supabase environment listed two active/healthy projects:

- **Swayphics Web** (production).
- **Swayphics InnerMe Test** (isolated test project).

At the time of the audit, deployed `swayphics-ai` was ACTIVE v137 in production and ACTIVE v24 in test. Supabase returned the same bundle hash for both: `d468870f5dd7bceaf27914c943d21432fad5091b65a659e755e571326c415fce`. This is a time-stamped snapshot, not a guarantee of current deployment status. Check again before a deployment.

The live production migration ledger reported recent entries whose version timestamps differ from the checked-in migration filenames for similarly named work, including execution-contract snapshots, execution-step run controller, workspace summary RPC, provider telemetry/guard and zero-cost quota-exhaustion fix. Example: the live ledger reported `20261016041121 innerme_zero_cost_quota_exhaustion_fix`, while the checked-in file observed was `supabase/migrations/20261016034000_innerme_zero_cost_quota_exhaustion_fix.sql`. **This is a migration-history parity question, not proof by itself that schema objects are missing or wrong.** Compare exact SQL, function definitions, grants, and recorded migration history before applying or renaming anything. Never blindly rerun a migration.

The production Supabase security advisors observed on 2026-10-16 reported:

- Three public tables with RLS enabled but no policies: `enquiry_rate_limits`, `innerme_provider_quota_daily`, `public_innerme_rate_limits`.
- Seven functions flagged for a mutable/unspecified function search path.
- Five `SECURITY DEFINER` functions reported as executable by `anon`. Token-gated public client portal/onboarding RPCs may be intentional; examine function bodies, token entropy/expiry and grants before changing access.
- Performance advisor reported 75 foreign keys without covering indexes.

These are **review findings**, not verified exploitable vulnerabilities or blanket instructions to change production. Determine intended access models, privileges and workload impact. Rate-limit and quota tables may intentionally be service-role-only, so do not create permissive RLS policies merely to silence the advisor. Do not bulk-revoke tokenised RPCs or add broad indexes without an evidence-led review.

### Recently observed GitHub state

At the audit, `main` was at `c63e7bf2e1df9030ed1ee79682b4025575b1f35c`. Latest reported actions associated with it included successful site validation, InnerMe validation, authenticated runtime smoke and Pages deployment. Check current workflow runs before relying on that snapshot.

Existing [PR #4](https://github.com/NtandoSway7929/SWA/pull/4), titled “Require source-level evidence traceability in InnerMe,” was still open and draft when inspected. Do not merge or rewrite it as part of the onboarding/docs work. Its description references older deployment/benchmark evidence and explicitly leaves an authenticated evidence-answer test plus a valid benchmark outstanding; re-evaluate those requirements against current source and runtime before changing its status.

An isolated semantic retrieval regression run (#11) previously failed/inconclusive on an earlier commit. Its cause was not verified from the current available evidence. Do not describe it as the current main's verified result without checking the run and logs.

## 7. Change-control and operating rules

1. **Inspect before editing.** Read the exact current source, relevant tests, migration history, deployment and open PRs.
2. **Use an isolated branch.** One scoped task per branch/PR. Do not push unrelated work directly to `main`.
3. **Check shared coordination documents** before claiming work. Declare the exact task, paths, database objects and current branch. Avoid parallel edits to overlapping paths; ask the other agent for a handoff if ownership is unclear.
4. **Treat public repository content as public.** Never commit API keys, passwords, tokens, service-role secrets, customer PII, private inbox content or production data extracts.
5. **Keep database changes migration-backed.** Compare the proposed migration against live schema/history; do not use blind replays to solve drift. Review RLS, grants, `SECURITY DEFINER`, `search_path`, triggers and rollback/forward-repair implications.
6. **No speculative production action.** Do not deploy code or apply schema/security changes merely because a test passed or an advisor flagged an item. Require isolated tests and a production acceptance plan. Avoid irreversible changes; capture backups/rollback options where available.
7. **Test at the correct evidence level.** Distinguish unit tests, CI, isolated live tests, read-only production checks and authenticated end-to-end tests. Report exactly what each validates and doesn't validate.
8. **Communicate with durable records.** Log plans, findings, PRs, commands/results and handoffs in `ai-coordination-log.md`; update ownership and decision records when appropriate. Do not claim an agent has seen another agent's message unless there is an observable record.
9. **Use independent judgement.** Propose novel business/product/technical improvements with expected value, cost, risk, evidence and a reversible experiment. Avoid changes solely for sophistication.
10. **Final report.** State changed paths, branch/commit/PR, checks run, current failures/uncertainties, whether production was touched, and the next decision/action.

## 8. Companion documents

- [AI co-manager protocol](ai-co-manager-protocol.md)
- [AI coordination log](ai-coordination-log.md)
- [AI ownership registry](ai-ownership-registry.md)
- [AI decisions](ai-decisions.md)
- [InnerMe 30-phase roadmap](innerme-30-phase-roadmap.md)
- [Authenticated runtime smoke-test instructions](innerme-authenticated-runtime-smoke-test.md)
- [Execution contract validation](innerme-execution-contract-validation.md)
- [Semantic retrieval smoke test](innerme-semantic-retrieval-e2e-smoke-test.md)
