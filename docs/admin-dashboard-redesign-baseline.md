# Swayphics Admin Dashboard Redesign — Baseline Audit

**Audit date:** 5 November 2026  
**Repository:** `NtandoSway7929/SWA`  
**Baseline ref:** `main`  
**Baseline commit:** `241d5b0f1d890c9f22adda54851d1ee85e4fa468`  
**Redesign branch:** `design/admin-dashboard-top-nav-hybrid-hero`  
**Scope:** Read-only inspection. No production or dashboard code changed during this audit.

## 1. Executive result

The existing dashboard is a large, stateful Vanilla JavaScript application. Its navigation, record workflows, role-aware settings, InnerMe integrations and operational summaries are built into a live workspace controller. The redesign should therefore be implemented as a targeted shell/navigation and Overview presentation change, not a rewrite of the application.

The baseline source audit is complete. The executable test baseline is **not yet confirmed**: this environment could not resolve `github.com` for a shallow clone, so it was not possible to run the repository test scripts locally. GitHub commit-status lookup returned no status entries for the inspected baseline commit, and the available workflow-run lookup returned no PR-triggered runs for that SHA. These empty results do not establish that the tests pass or fail.

## 2. Source baseline

| Source | Baseline blob SHA | Size inspected |
|---|---|---:|
| `admin-dashboard/index.html` | `5f1be78985dd3f2285c6616eccbe941e6ebb8077` | 541,778 characters |
| `admin-dashboard/admin-workspace.js` | `1ac9c3f74011b9074fef20abdcf59ad5c5971c74` | 1,061,799 characters |
| `admin-dashboard/admin-workspace.css` | `89f35366a10220cedfa8c2751aa2a446af6539d0` | 215,111 characters |

The dashboard is served from `admin-dashboard/index.html`. The login entry point remains `admin/index.html`; it is not part of the redesign scope.

The page already has an application header with the official Swayphics logo, a global workspace search (Ctrl+K), theme control, notifications, authentication status and logout. It also contains an existing mobile sidebar toggle. The global search, notification and theme controls are separate from the workspace navigation and must remain available.

## 3. Navigation contract

The controller defines eight groups and 30 destinations. The exact source-of-truth identifiers are:

| Group ID | Group label | Destination IDs |
|---|---|---|
| `overview` | Overview | `overview`, `insights`, `reminders` |
| `innerme` | InnerMe | `swayphics-ai`, `innerme-actions`, `innerme-revenue`, `innerme-intelligence`, `innerme-provider-usage` |
| `crm` | Clients & Pipeline | `enquiries`, `leads`, `clients`, `communications`, `email`, `documents`, `followups` |
| `delivery` | Work & Portfolio | `projects`, `tasks`, `portfolio` |
| `billing` | Sales & Billing | `quotes`, `invoices`, `payments`, `services`, `invoice-settings` |
| `website` | Website | `content`, `testimonials` |
| `settings` | Settings | `settings` |
| `admin` | Administration | `activity`, `portal-requests`, `data-export`, `team` |

Preservation requirements:

- Keep each of the eight group IDs and all 30 destination IDs.
- Keep the existing `data-view` contract. Search results, notifications, InnerMe record actions and workspace flows navigate using these destination identifiers.
- Keep the active destination state and the five existing dynamic counters: tasks assigned to the current administrator, active leads (using the existing lead-status definition), pending follow-ups, new website enquiries and new client portal requests.
- Keep selected-view persistence in `swayphics_admin_current_view`.
- Keep group preference persistence in `swayphics_admin_nav_groups`, unless a narrowly scoped compatibility change is necessary and tested.
- Preserve Settings and InnerMe subview routing, including the existing InnerMe active-subview behaviour.
- Preserve Portfolio and Testimonials' special handling: their existing DOM managers are moved into the workspace rather than rebuilt by the generic view renderer.

The current renderer outputs a grouped sidebar. Group state is represented by `open` / `collapsed` classes and `aria-expanded` on `data-nav-group-toggle` buttons. The group toggle and destination handlers are bound by the workspace controller. The existing active destination is kept open when the shell is rebuilt, and the controller auto-opens the InnerMe group for InnerMe subviews.

## 4. Responsive baseline and known interaction dependencies

The current JavaScript sets `MOBILE_SIDEBAR_BREAKPOINT = 980`. The existing mobile flow uses:

- Header toggle: `.admin-mobile-sidebar-toggle`
- Workspace sidebar: `.sway-workspace-sidebar`
- Workspace toggle/close controls: `.sway-workspace-mobile-toggle` and `.sway-workspace-mobile-close`
- Drawer state: `.mobile-open`, `.nav-open` and `body.sway-mobile-nav-open`
- Escape/outside-click handling and swipe gestures

The stylesheet contains historical 760px and 980px navigation rules, followed by later corrective overrides that align the sidebar drawer to the 980px JavaScript breakpoint. There are also later desktop geometry overrides. A new dedicated stylesheet loaded after the current workspace CSS is the safer way to establish the top-navigation presentation without deleting large amounts of accumulated component CSS.

The existing browser smoke script explicitly switches to a 390×844 viewport and checks the drawer state via the sidebar and header toggle. This assertion is tied to the old drawer presentation. It must be replaced with top-navigation visibility, menu opening, destination navigation and overflow checks when the redesign is implemented. Do not simply delete the mobile assertion.

Required future viewport checks: 1440px desktop, 1024px compact desktop, 768px tablet, 390px mobile and 360px narrow mobile. The existing 390px assertion is baseline evidence, not evidence that all these viewports have already been tested.

## 5. Overview baseline

The current `renderOverview()` already computes and renders:

- **My open tasks:** tasks not completed and assigned to the currently signed-in administrator.
- **Tasks due today:** the subset of those tasks whose due date equals the dashboard's current South African date.
- **Follow-ups today:** pending follow-ups scheduled for today.
- **Open pipeline:** the sum of estimated values for leads excluding `won`, `lost` and `follow-up` statuses, using the existing calculation.
- **Outstanding:** outstanding amounts for non-cancelled invoices, falling back to invoice totals when no outstanding amount is present.
- **Recent work:** up to six open tasks assigned to the current administrator.
- **Recent activity:** up to eight activity records.

The current Overview displays four KPI cards (My open tasks, Follow-ups today, Open pipeline and Outstanding), the existing Insights overview, a personalised inline greeting, Needs Attention, Follow-up Automation, My Work and recent activity panels.

The hybrid hero should consolidate the greeting and the most useful existing metrics/actions, but the underlying calculations and the remaining panels must remain. It must not duplicate the greeting or silently change the definitions of these metrics. Do not imply that the pipeline total is booked revenue or that outstanding invoices have been collected.

The current heading includes New task and New lead actions using the existing `data-quick` handlers. Reuse those handlers.

## 6. Relevant regression coverage found in the repository

The `.github/workflows/validate-site.yml` workflow runs:

- JavaScript syntax checks for the main workspace and related dashboard scripts.
- `scripts/admin-welcome-auth.test.cjs` (28 test cases discovered in source).
- `scripts/admin-settings-expanded.test.cjs` (9 test cases discovered in source).
- `scripts/admin-automation-integrity.test.cjs` (source-level integrity assertions).
- `scripts/admin-dashboard-business-controls.test.cjs` (12 test cases discovered in source).
- `scripts/admin-table-controls.test.cjs` (assertion-based test script).
- `scripts/lead-whatsapp.test.cjs` (assertion-based test script).
- Inline JavaScript syntax validation for the website, login, dashboard and other HTML entry points.

The `.github/workflows/admin-table-controls-preview.yml` workflow is relevant to changes in the workspace JavaScript, CSS and dashboard HTML. It installs Playwright and Chromium, runs desktop/mobile browser tests, exercises the actual dashboard with mocked API data, and verifies selected persistence against a disposable local Supabase stack.

The `.github/workflows/innerme-chat-browser-smoke.yml` workflow also targets dashboard HTML, workspace CSS/JS and the welcome/InnerMe UI. It runs mocked-backend browser checks, so it is an important regression safeguard for the InnerMe workspace.

The source audit identified the following existing tests and scripts. Counts below are source-level test declarations/assertion calls, not executed test results.

| Test/script | Source-level coverage relevant to redesign |
|---|---|
| `admin-welcome-auth.test.cjs` | Authenticated greeting identity, greeting preference, session validation, startup ordering and failure handling |
| `admin-settings-expanded.test.cjs` | Settings module order, eleven settings sections, greeting name as a Settings destination, owner-gated controls and notification preferences |
| `admin-dashboard-business-controls.test.cjs` | Settings asset loading/order, selected-panel visibility, business controls, governance and narrow-screen styles |
| `admin-table-controls.test.cjs` | Leads/tasks/follow-ups table integration, filtering/sorting/selection and lead contact workflow contracts |
| `admin-table-controls-dashboard-smoke.cjs` | Actual dashboard startup against mocked Supabase responses, navigation to Leads/Tasks, table controls, blocked mutations and 390px mobile drawer state |
| `admin-table-controls-browser.test.cjs` | Browser preview for desktop and mobile table behaviour |
| `lead-whatsapp.test.cjs` | WhatsApp helper loading order and link construction contract |

**Coverage gap to address:** the browser smoke test has navigation helper coverage for existing grouped sidebar controls, but the redesign needs explicit checks for every top-level group, dropdown open/close behaviour, keyboard operation, active-item state, count badges and the five planned responsive viewport widths.

## 7. Baseline execution and CI evidence

| Check | Result | Evidence / limitation |
|---|---|---|
| Repository and branch source inspection | <strong>COMPLETE</strong> | Main source files and relevant test/workflow files were fetched and inspected. |
| Navigation inventory | <strong>COMPLETE</strong> | Eight groups and 30 destination IDs enumerated from the controller source. |
| Overview metric definitions | <strong>COMPLETE</strong> | Existing calculations inspected in `renderOverview()`. |
| Test/workflow inventory | <strong>COMPLETE</strong> | Relevant CI workflows and browser scripts inspected. |
| Local Node syntax/test execution | <strong>NOT RUN</strong> | Shallow clone could not resolve `github.com`; repository files could not be placed in a local test checkout in this environment. |
| Existing GitHub commit statuses | <strong>UNCONFIRMED</strong> | Combined status lookup returned an empty status list for baseline SHA `241d5b0f...`. |
| PR workflow run history for baseline SHA | <strong>UNCONFIRMED</strong> | Available commit workflow-run lookup returned no PR-triggered runs for this SHA. It does not expose complete push workflow history. |
| Actual browser screenshots at target viewports | <strong>NOT CAPTURED</strong> | No browser runtime was available in this environment. |

No pass/fail claim is made for tests that were not executed. These checks must run in GitHub Actions or a local checkout before the redesign is considered verified.

## 8. Implementation constraints derived from the baseline

1. Keep the existing application controller and data model; make surgical edits only.
2. Prefer a new `admin-dashboard/admin-dashboard-redesign.css` file loaded after existing stylesheets.
3. Preserve the `data-view`, `data-nav-group`, `data-nav-group-toggle`, quick-action and active-view contracts.
4. Replace the mobile drawer with the approved responsive top navigation only in the presentation layer; update browser tests to verify the replacement interaction.
5. Use existing workspace state and calculations for the hybrid hero.
6. Keep the greeting sourced from the authenticated administrator identity and existing saved greeting preference.
7. Do not modify public `index.html`, login `admin/index.html`, client portal, Supabase schema/functions/data or production deployment configuration.
8. Do not merge or deploy as part of this branch implementation.
