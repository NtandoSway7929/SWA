# Swayphics Durable Decision Log

This is the shared record of durable business, product and engineering decisions. Append new decisions; do not silently rewrite history. Check current owner direction before treating historical choices as permanent.

## Standing business and design decisions

| ID | Decision | Source/status |
|---|---|---|
| BIZ-001 | Swayphics is positioned as a South African Creative & Design Lab; tagline “EMPOWERING THROUGH DESIGN.” | Owner direction and website source |
| BIZ-002 | Serve small businesses/entrepreneurs with practical branding and digital-presence needs; optimise for commercial outcomes rather than decoration alone. | Owner direction |
| BIZ-003 | Keep the listed prices in the master context as reference defaults; do not revisit pricing unless the owner reopens the topic. | Owner direction + repository service seed values |
| BIZ-004 | Do not offer “Visual Brand Audit” unless owner explicitly reverses its exclusion. | Explicit owner exclusion |
| BIZ-005 | Do not redraw/replace/alter official logo assets without direct instruction. Avoid purple and generic AI-looking graphics. | Owner design constraints |

## Standing engineering decisions

| ID | Decision | Source/status |
|---|---|---|
| ENG-001 | Keep the frontend vanilla HTML/CSS/JavaScript; no new framework without approval. | Owner engineering constraint |
| ENG-002 | `index.html` is the primary website source of truth; admin workspace files are split between `admin-dashboard/index.html`, `admin-workspace.js` and `admin-workspace.css`. | Owner direction/source layout |
| ENG-003 | Prefer surgical edits and regression tests over broad rewrites. | Owner workflow preference |
| ENG-004 | A checked-in migration, helper, benchmark result or health response does not alone prove end-to-end production behaviour. | Verification rule |
| ENG-005 | Keep InnerMe Lite (public guidance) separate from private admin InnerMe. | Architecture/safety boundary |
| ENG-006 | Recommendations/plans are not executions. Preserve explicit authorization, approval, safety gate, audit and outcome verification. | InnerMe governance model |
| ENG-007 | Do not infer roadmap phase dependencies from numbering. Cite exact source artifacts where dependencies are explicit. | `docs/innerme-30-phase-roadmap.md` |
| ENG-008 | Inconclusive provider/infra failures are not model-quality failures or benchmark passes. | InnerMe evaluation governance |
| ENG-009 | Do not apply database changes from advisor output alone. Confirm intended grants/access, compare schema/history, test isolated, and document a recoverable migration plan. | Supabase security and migration change-control |

## Open questions / decisions required

| ID | Question | Current evidence | Required resolution |
|---|---|---|---|
| OPEN-001 | Canonical URL: `/index.html` or root `/`? | Earlier owner preference conflicts with reviewed source canonical `https://swayphics.co.za/`. | Inspect redirects, sitemap, current source, Search Console evidence; owner approves policy change. |
| OPEN-002 | Do recent migration timestamp differences represent intentional renumbering or migration-history/schema drift? | Live ledger names/timestamps differ from current checked-in filenames for several similarly named migrations. | Compare SQL bodies, live object definitions and migration history; no blind replay/rename. |
| OPEN-003 | How should the no-policy rate-limit/quota tables be restricted? | RLS is on and advisor sees no policies on three tables. | Check direct grants and service-role/backend-only usage; retain intentional deny-all where appropriate. |
| OPEN-004 | Which public token-gated `SECURITY DEFINER` RPCs are intentionally callable by anon? | Advisor shows five anon-executable definer functions, including onboarding/client-portal paths. | Inspect bodies, token security and grants; verify legitimate visitor journey and absence of cross-client access. |
| OPEN-005 | What is the authoritative current InnerMe semantic retrieval baseline? | A previous isolated run #11 was inconclusive/failed on an earlier commit; root cause not established in this handoff. | Inspect run artifacts/logs, reproduce on current main/isolated project, separate infrastructure failure from retrieval performance. |
| OPEN-006 | What remains to close InnerMe evidence traceability PR #4? | PR #4 is open/draft and describes authenticated evidence-answer coverage plus a valid benchmark as outstanding. | Reconcile against current main, current deployments and updated test evidence before changing PR state. |

## Updating the log

Record decision ID, date, owner/agents involved, options, evidence, risk/impact, final decision, and affected source/migration/PR. Preserve superseded entries with a note explaining what replaced them.
