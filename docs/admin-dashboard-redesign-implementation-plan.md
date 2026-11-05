# Swayphics Admin Dashboard Redesign

## Implementation plan

**Status:** Stages 1–5 implemented and source-regression verified. Stage 6 browser and dashboard smoke checks have passed on the current tested revision; disposable local-Supabase persistence verification is still in progress.  
**Branch:** `design/admin-dashboard-top-nav-hybrid-hero`  
**Base:** Current `main` branch  
**Approved direction:** Top navigation + hybrid overview hero

## 1. Objective

Redesign the private Swayphics admin dashboard to feel more premium, structured and operationally useful, while retaining the existing dashboard's data, workflows, permissions and integrations.

The redesign is a presentation and navigation improvement. It must not become a rewrite of the workspace controller or its backend.

## 2. Existing implementation facts

The current workspace controller builds the navigation at runtime from `navGroups`. It currently contains eight navigation groups and 30 destinations:

- Overview
- InnerMe
- Clients & Pipeline
- Work & Portfolio
- Sales & Billing
- Website
- Settings
- Administration

Navigation buttons use the existing `data-view` contract. Group state is persisted in `swayphics_admin_nav_groups`, and the selected view is persisted in `swayphics_admin_current_view`.

The current layout places `.sway-workspace-sidebar` beside `.sway-workspace-main`. The controller also contains mobile drawer behaviour at a 980px breakpoint. The global header already provides the Swayphics logo, global search, status and logout controls.

The Overview view already derives operational information from workspace state, including open tasks, leads, follow-ups, invoices, activities and existing insights. The redesign should reuse these sources rather than inventing new metrics.

## 3. Design decisions

### 3.1 Top navigation

Replace the desktop left-hand sidebar presentation with a full-width navigation bar above the workspace content.

- Preserve the existing eight navigation groups and all 30 destinations.
- Retain the existing `data-view` values, active-state logic, dynamic count badges and group identifiers.
- Present each group as a clear top-level trigger. Its destinations open in an anchored menu, rather than expanding into a tall permanent sidebar.
- Keep group menus click- and keyboard-operable. Hover must not be the only way to open or use navigation.
- Keep the active destination visibly identifiable, including when its group menu is closed.
- Preserve the saved group preferences and selected-view persistence unless a tested migration is needed.
- Do not duplicate navigation entries or add destinations that are not already implemented.

**Responsive behaviour**

Use the same top-navigation model at desktop, tablet and mobile widths. At narrower widths, the group-trigger row becomes horizontally scrollable, with menus constrained to the viewport. It must not reintroduce a permanent left sidebar or cause document-level horizontal overflow.

The existing mobile-drawer controller and hamburger/close interactions must be reconciled with this model. Remove or repurpose them only after the replacement interaction has been tested at phone and tablet widths.

### 3.2 Hybrid Overview hero

Add a prominent Overview-only hero that combines three functions:

1. **Personal welcome:** a heading using the verified administrator greeting name, supported by concise operational context.
2. **Live snapshot:** a compact cluster of existing, data-backed figures, such as active leads, the administrator's open tasks and follow-ups due today.
3. **Quick actions:** retain the current New task and New lead actions.

The figures must be calculated from the existing workspace state and retain the current status/date definitions. Do not introduce projected growth, conversion rates, revenue forecasts, ROI, or other figures without verified source data.

The current inline greeting note should be consolidated into this hero to avoid repeating the greeting. Existing insights, attention items, follow-up automation, charts, task/activity panels and other Overview content must remain available below it.

The hero belongs only to the Overview destination. Other views should retain their own heading, description and action controls.

### 3.3 Visual direction

- Use a restrained white and light-neutral foundation, charcoal text and Swayphics blue as an accent.
- Keep gradients and shadows subtle. Avoid large saturated-blue surfaces, purple, decorative AI imagery and unnecessary visual noise.
- Use the established Swayphics typography direction: Montserrat for interface/body text and Raleway for prominent headings, subject to checking font loading and existing component inheritance before changing font declarations.
- Improve hierarchy, spacing, alignment and responsive density without shrinking controls below practical touch targets.
- Retain the official logo asset as-is.

## 4. Scope and file strategy

Expected implementation surface:

| File | Intended change |
|---|---|
| `admin-dashboard/admin-workspace.js` | Surgical changes to workspace shell/navigation rendering and the Overview hero. Preserve data loading, actions, persistence and event delegation. |
| `admin-dashboard/admin-dashboard-redesign.css` | New isolated stylesheet for the redesigned navigation, menus, hero and responsive rules. Prefer this over appending another large override block to the existing stylesheet. |
| `admin-dashboard/index.html` | Add the new stylesheet in the correct cascade position. Preserve existing script order, cache-busting conventions, metadata and authentication entry points. |
| `scripts/admin-dashboard-redesign.test.cjs` | Add focused structural and behavioural regression tests. |
| `scripts/admin-dashboard-redesign-browser-smoke.cjs` | Add browser checks for navigation, hero data and responsive layouts if the available test environment supports them. |

The existing test suite and workflow checks remain part of acceptance. Relevant existing coverage includes the admin welcome/auth tests, Settings tests, table-controls tests and dashboard browser smoke tests.

## 5. Functionality preservation contract

The redesign must not remove or weaken:

- Supabase authentication, administrator validation, role/permission checks or session refresh.
- Existing data fetching, mutations, database contracts, Row Level Security or Edge Function behaviour.
- Any of the 30 navigation destinations or their `data-view` identifiers.
- Navigation active states, count badges, group persistence and selected-view persistence.
- Global search, notifications, quick-create actions and the workspace welcome experience.
- Leads, clients, follow-ups, tasks, projects, portfolio, testimonials, quotes, invoices, payments, services, email inbox, documents, website enquiries, client portal requests, exports, team, settings and InnerMe workflows.
- Existing table filters, sorting, bulk actions, record actions, modals, forms or keyboard interactions.

### Explicit exclusions

Do not change:

- Public website `index.html`.
- Login/authentication page `admin/index.html), unless a separately approved integration issue makes a narrowly scoped change essential.
- Client portal files.
- Supabase schema, migrations, policies, grants, functions, secrets or production data.
- Deployment, DNS, production configuration or the production branch.

No production merge or deployment is included in this implementation phase.

## 6. Implementation sequence

### Stage 1 - Baseline and compatibility checks

1. Record the current dashboard DOM and navigation behaviour.
2. Run the existing relevant tests before implementation.
3. Confirm all 30 destinations, the eight group identifiers, saved view state and current mobile breakpoint.
4. Capture baseline desktop, tablet and mobile screenshots for comparison.

### Stage 2 - Navigation conversion

**Implementation recorded on this branch:** the workspace shell now renders a semantic top-navigation landmark with a horizontally scrollable group-trigger row and separate dropdown panels. Existing `data-view` destination identifiers and dynamic destination counters are retained. The trigger-to-panel relationship uses `aria-controls` and `aria-expanded`; menus support outside-click dismissal and Escape. The 980px drawer setup is no longer bound, and the old hamburger is hidden by the isolated redesign stylesheet.

The current Settings module still promotes its Settings destination to a direct top-level item using its existing normalizer. The `swayphics_admin_nav_groups` preference key remains in use, but legacy multiple-open accordion preferences are normalized to one active dropdown because the new top navigation permits one dropdown at a time.

A focused contract test was added to `scripts/admin-dashboard-redesign.test.cjs` and wired into `.github/workflows/validate-site.yml`. The existing mocked-dashboard smoke script was updated to cover 1440, 1024, 768, 390 and 360 pixel viewports.

1. Keep the existing navigation data model and destination identifiers.
2. Refactor the rendered shell so navigation occupies the top of the workspace.
3. Implement anchored group menus with accessible expanded state, Escape handling, outside-click handling and reliable focus behaviour.
4. Adapt the 980px mobile-drawer logic to the horizontally scrollable top-navigation model.
5. Verify all destinations and dynamic badges still navigate correctly.

**Verification status:** structural contract checks and JavaScript parsing have been performed through the available execution environment. The Playwright browser workflow has not yet run; visual clipping, focus behaviour and viewport interaction are not marked as passed until CI/browser execution.

### Stage 3 - Hybrid Overview hero

**Implementation recorded on this branch:** the Overview now opens with a hybrid hero using the authenticated workspace greeting, two existing quick-create handlers and four existing operational calculations: assigned open tasks, follow-ups scheduled today, open pipeline value and outstanding invoice value. The prior inline greeting was consolidated into the hero. Existing insights, needs-attention, follow-up automation, My work, Recent activity and Quick actions sections remain in the Overview renderer.

The isolated redesign stylesheet adds the hero's responsive two-column metric layout, compact mobile treatment, dark-theme presentation and reduced-motion-safe action transitions. No new backend data, estimates, revenue assumptions or metrics were introduced.

A contract test now checks the hero's accessible heading, authenticated greeting source, data-backed metrics, existing quick-action hooks and preservation of the Overview panels.

**Verification status:** the workspace JavaScript, contract-test script and existing dashboard smoke script parse successfully. The contract test passed against the fetched branch sources using the same local in-memory Node module shim described in the baseline record. Existing inline dashboard scripts parse and the redesign stylesheet has balanced braces. Real browser rendering and Playwright interaction remain unverified until CI/browser execution.

1. Build the hero from existing authenticated workspace state.
2. Reuse the verified greeting name and current quick-action handlers.
3. Add only clearly labelled, data-backed operational figures.
4. Consolidate the duplicate inline greeting.
5. Keep all existing Overview sections below the hero.

### Stage 4 - Responsive and visual refinement

**Implementation recorded on this branch:** the responsive browser smoke test now exercises the Overview hero at 1440px, 1024px, 768px, 390px and 360px. It checks the authenticated greeting, four metric tiles, both existing quick actions, hero bounds, horizontal overflow, action visibility and the two-column metric layout at mobile widths. The test continues to exercise top-navigation dropdown bounds and existing table controls at those same viewport sizes.

The hero stylesheet includes a four-column desktop metric strip, a two-column mobile metric grid, stacked mobile actions at 380px and below, dark-theme styling and reduced-motion handling. Navigation retains the horizontally scrollable trigger row and separately positioned dropdown panels.

**Browser verification passed on the current implementation.** GitHub Actions run [42063383186](https://github.com/NtandoSway7929/SWA/actions/runs/42063383186), commit `1014be703c69b28bbea36657b3e5ec08196777cc`, completed the desktop/mobile browser preview and the actual dashboard smoke test successfully. The responsive assertions covered 1440px, 1024px, 768px, 390px and 360px. The hero remained within the viewport, the mobile metric grid used two columns, the retired drawer toggle stayed hidden, and the navigation dropdown stayed inside the viewport. The dashboard smoke run also passed its hero checks at all five widths.

Test and refine at minimum these viewport widths: 1440px, 1024px, 768px, 390px and 360px.

Check menu placement, clipping, text wrapping, sticky positioning, touch-target sizing, page overflow, chart/table scrolling, quick-create placement and the global search/header layout.

### Stage 5 - Regression and review

**Source-level regression review completed on the feature branch.**

- Confirmed the branch changes are limited to the admin dashboard workspace, dashboard HTML/CSS, validation workflows, test scripts and redesign documentation. No public marketing page, admin login page, client portal, Supabase schema, functions, secrets or data files are in the diff.
- Confirmed all eight navigation groups and 30 existing destination IDs remain present.
- Confirmed the Settings direct-navigation normalizer remains compatible with the new navigation shell.
- Removed the redundant Overview page heading and duplicate quick-action buttons now that the hero owns the primary heading and actions.
- Replaced the misleading green "live" decoration with a neutral brand-blue accent; the hero does not claim real-time connectivity.
- Preserved the existing definitions for pipeline valuation and active-lead count. Pipeline value excludes won, lost and follow-up statuses; active-lead count excludes only won and lost.
- Added contract coverage for the no-duplicate-heading rule and the distinct pipeline/active-lead definitions.
- Added push triggers for this feature branch to the validation and isolated browser-preview workflows, allowing automated checks without opening a pull request.

**Source-level verification:** the workspace script, contract-test script and responsive browser smoke script parse; the contract test passes against the fetched branch files using an in-memory Node module shim; all three inline scripts in the dashboard HTML parse; the redesign CSS has balanced braces.

**CI regression verification passed.** The full site-validation workflow [42063382283](https://github.com/NtandoSway7929/SWA/actions/runs/42063382283) completed successfully on commit `1014be703c69b28bbea36657b3e5ec08196777cc`. Its successful steps include the existing admin authentication, Settings, automation, business-control, table-control, dashboard redesign contract, lead WhatsApp and inline-JavaScript checks. The isolated browser workflow also passed its browser preview and actual-dashboard smoke steps on that same commit. Cross-browser testing in Safari and Firefox has not been performed.

Do not merge, deploy or change production without explicit approval.


## 6. Stage 6 — Browser verification and release preparation

**Current evidence (commit `1014be703c69b28bbea36657b3e5ec08196777cc`):**

- The full source regression workflow passed: [GitHub Actions 42063382283](https://github.com/NtandoSway7929/SWA/actions/runs/42063382283).
- The isolated browser workflow successfully installed headless Chromium and started the local-only preview server.
- The standalone desktop/mobile preview passed.
- The actual dashboard smoke test passed. It used a mocked administrator identity and synthetic records, completed 135 mocked API reads, recorded zero unexpected external requests, blocked zero unexpected API writes, and reported zero uncaught page errors.
- The dashboard test covered lead search/filter/sort, selected-row and formula-safe CSV export, task completion, follow-up completion, activity logging, invoice filtering/search/sorting/archive behaviour, and the five responsive viewport widths.
- The Overview hero passed its authenticated greeting, four-metric, quick-action, viewport-boundary and mobile two-column checks.

**Persistence check:** the same browser workflow is currently executing the authenticated read/write persistence test against an unlinked, disposable local Supabase stack. This test uses loopback-only endpoints, synthetic UUID records and local Auth credentials; it does not receive a hosted Supabase project reference or production credentials. Do not mark Stage 6 fully complete until this step and the overall workflow finish successfully.

**Visual evidence:** the earlier completed browser-smoke artifact is available from [GitHub Actions run 42061237275](https://github.com/NtandoSway7929/SWA/actions/runs/42061237275). Its screenshots cover desktop Leads, Tasks and Invoices views and a narrow-mobile Tasks view. That run's browser and dashboard smoke steps passed, but its overall run was later cancelled before the disposable local-Supabase check completed.

**Release decision:** no pull request, merge or deployment has been performed. Do not merge or deploy until the persistence check has passed and the final screenshot/review evidence has been inspected. Keep the branch isolated from `main`.


## 7. Acceptance criteria

The redesign is ready for review only when:

- All eight navigation groups and all 30 destinations remain accessible.
- Every destination still loads the correct view using its existing identifier.
- Active states, dynamic badges, group preferences and selected-view persistence work.
- Top navigation works with mouse, keyboard and touch.
- Menus remain usable at desktop, tablet and mobile widths without clipping.
- The Overview hero uses the authenticated greeting and real workspace data only.
- All existing Overview panels and dashboard workflows remain available.
- Existing authentication, Settings, tables, quick actions, notifications and InnerMe tests continue to pass.
- No changes have been made to Supabase, the public website, the client portal or production deployment configuration.

## 8. Rollback approach

The new visual layer is isolated in a dedicated stylesheet and the implementation is confined to this feature branch. If visual regression occurs, revert the branch changes without changing `main`. Do not use a broad reset or force-push to recover.
