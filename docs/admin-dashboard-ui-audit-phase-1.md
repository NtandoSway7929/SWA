# Phase 1 Audit: Swayphics Admin Dashboard UI/UX

**Date:** 23 October 2026  
**Repository:** [NtandoSway7929/SWA](https://github.com/NtandoSway7929/SWA)  
**Status:** Static source audit complete; authenticated visual/interaction audit still required.  
**Change impact:** Documentation only. No dashboard code, database schema, auth behaviour, or production configuration is changed by this report.

## 1. Scope and method

Reviewed the current source of:

- `admin-dashboard/index.html`
- `admin-dashboard/admin-workspace.js`
- `admin-dashboard/admin-workspace.css`
- `.github/workflows/validate-site.yml`
- `.github/workflows/innerme-chat-browser-smoke.yml`
- Invoice amount semantics in `supabase/swayphics-business-flow.sql`

Inspected the public entry points `/admin-dashboard/`, `/admin-dashboard/index.html`, and `/admin/`. The dashboard route presents an authentication/session gate when not signed in. An authenticated Swayphics browser session was not available in this audit context, so no attempt was made to bypass the gate. As a result, the conclusions below distinguish source-confirmed features from runtime behaviours that still need to be tested in a signed-in browser.

## 2. Existing foundations to retain

### Navigation and workspace structure

- Navigation is grouped into Overview, InnerMe, Clients & Pipeline, Work & Portfolio, Sales & Billing, Website, and Administration.
- Active navigation has a visible blue active state.
- Navigation groups can collapse, and the collapsed/open state is persisted in local storage.
- The workspace has mobile-sidebar logic: a drawer, an accessible expanded state, close controls, Escape-key handling, outside-click handling, and swipe-to-close behaviour.
- The CSS uses a drawer model through the 980px breakpoint and includes small-screen layout rules. Table containers support horizontal scrolling, while the shared table styling sets a 620px minimum table width.

**Audit conclusion:** Keep the information architecture and drawer as the baseline. Validate its real behaviour at desktop, tablet, and mobile widths before considering navigation redesign.

### Global search

- The search field has an accessible label, connects to a results container, and updates `aria-expanded`.
- Ctrl/Cmd+K opens search; Escape closes it; Enter opens the first result.
- Search indexes a wide range of workspace records (including enquiries, leads, clients, follow-ups, projects, tasks, quotes, invoices, payments, communications, documents, portal requests, services, announcements, social records, activities, and team members).
- Matches are ranked and capped at 12 results.

**Gap:** In the inspected code, arrow-key movement through results and an active-option/focus-management pattern were not found. The listbox uses option roles, so keyboard behaviour and screen-reader announcements should be verified and improved if needed.

### Overview and operational prioritisation

The Overview is not just a collection of headline numbers. It already includes:

- A “needs attention” section that identifies overdue/due tasks and follow-ups, invoices requiring attention, new enquiries, and unread inbound email.
- Quick actions to create a task or lead.
- Cards for the current admin’s open tasks, follow-ups today, estimated open pipeline, and outstanding invoices.
- A short “My work” task table and recent activity.

**Audit conclusion:** Refine the ordering and action paths rather than rebuilding the Overview from scratch. Keep urgent, actionable work ahead of lower-priority analytics.

### Record-level operations

The primary Leads, Tasks, Follow-ups, Clients, Enquiries, and Invoices renderers already expose record-specific actions through action menus/buttons. Examples include editing records, completing tasks/follow-ups, moving leads through the pipeline, converting leads, creating invoices/payments, sending invoices, and archiving/restoring records. Invoice view also distinguishes active and archived invoices.

**Audit conclusion:** Preserve established actions and focus on discoverability, consistency, feedback, and safe handling.

## 3. Confirmed gaps and risks

| Priority | Finding | Evidence / impact | Recommended response |
|---|---|---|---|
| **P1** | Core tables lack view-level search/filter/sort controls | The primary renderers for Leads, Tasks, and Follow-ups output tables and row-action menus, but no table-local search input, filter control, sort control, row checkboxes, or bulk-action toolbar was found. Invoices has an active/archive toggle but no comparable local search or sort controls. | Add table-local controls only where they help a real workflow. Start with Leads, Follow-ups, and Tasks; add invoice filters relevant to status, due date, and client. |
| **P1** | Overview and invoice-view treatment of archived invoices differs | Overview’s outstanding-invoice calculation excludes cancelled invoices but does not explicitly exclude archived invoices. Invoice-view summary calculations use active invoices, excluding archived records. If an archived invoice retains a positive outstanding amount, the Overview and Invoices view can disagree. | Confirm the intended financial definition and test with an archived-but-unpaid invoice. If archived invoices should be excluded from the operational KPI, align the calculation without changing the underlying invoice balance. |
| **P1** | Full dashboard browser regression coverage is not established | The site validation workflow checks JavaScript syntax and the welcome-auth handshake. The Playwright browser smoke workflow focuses on InnerMe chat/welcome behaviour with mocked APIs and desktop/mobile checks; it does not establish that all CRM, task, billing, navigation, and modal workflows are tested. | Add a focused authenticated-dashboard smoke suite before significant UI changes. Cover the priority views and key actions with isolated test data. |
| **P2** | Global-search keyboard navigation is limited | Search handling explicitly covers Escape and Enter-to-open-first-result; arrow-key result navigation was not found in the inspected handler. | Implement/test ArrowUp/ArrowDown, a tracked active option, appropriate ARIA state, and predictable focus return. |
| **P2** | Chart exploration appears limited in the workspace module | No custom pointer/mouse hover-tooltip handlers or date-range selector hooks were found in `admin-workspace.js`. This is a source finding, not a claim that every chart has been visually tested. | Inspect the rendered Insights view. Add precise hover details or range controls only to charts where the added information aids a decision. |
| **P2** | Modal accessibility and action feedback need runtime validation | Dynamic forms create a dialog with `role="dialog"` and `aria-modal="true"`; some save paths expose a “Saving…” state. Source inspection alone does not establish focus trapping/restoration, field-label associations, consistent success/error messages, or behaviour after network failure. | Test keyboard-only operation, focus return, validation errors, disabled/pending states, and failed writes. Standardise feedback where current behaviour differs. |
| **P2** | Responsive behaviour is implemented but not proven across dashboard views | Responsive drawer CSS, safe-area handling, and table overflow support exist. The horizontal table minimum width means some data tables will need deliberate horizontal scrolling on small devices. | Test the full views at common phone/tablet/desktop sizes, including dark mode, and ensure scroll affordances and actions remain discoverable. |
| **P3** | Stylesheet has multiple later override layers | The workspace stylesheet includes repeated shell/sidebar declarations and later responsive hardening rules. Some layers may be intentional; the cascade is harder to reason about without browser verification. | Do not perform a broad CSS cleanup during this audit. Consolidate only after the layout is captured and regression-tested. |

## 4. View-by-view audit checklist

| View | Existing behaviour found in source | Test required before redesign |
|---|---|---|
| Overview | Attention items, KPI cards, task list, activity, and quick actions | Confirm item ordering, links/actions, data accuracy, no duplicates, loading/empty/error states |
| Leads | All leads visible; individual actions for edit, email, assessment/proposal, status handling, conversion, and delete | Search/filter/sort needs; action-menu discoverability; conversion/deletion safeguards; phone-width usability |
| Follow-ups | Scheduled contacts, status, and complete/edit/delete actions | Filter by due/overdue/status/assignee; prevent accidental completion/deletion; verify schedule updates |
| Tasks | Assignment, client, priority, due date, status, and complete/edit/delete actions | Filter by due date/status/assignee/priority; sort by deadline; verify mobile table navigation |
| Invoices | Amounts, paid/outstanding values, status, due date, email status, archive switch, and record actions | Cross-check totals against source data; filter by status/due/client; test send/payment/archive/restore failures |
| Enquiries | The view currently lists new enquiries and provides a contact-to-lead or close action | Confirm whether historical/closed enquiries must also be discoverable from this view or another view |
| Insights | Dedicated financial, lead, and delivery indicators/charts | Confirm chart labels, data definitions, date range expectations, hover detail, and consistency with authoritative records |
| Navigation / global search | Grouped navigation, active state, search shortcut/results, mobile drawer | Test keyboard-only operation, focus and screen-reader semantics, deep results, mobile drawer opening/closing |
| Forms / modals | Dynamic dialog forms and save states exist in source | Test required fields, validation, focus management, Escape/close, duplicate submission, success and failure feedback |

## 5. Test matrix for the next phase

The following is a proposed manual/browser matrix, not a statement that these tests have already run.

| Context | Key checks |
|---|---|
| Desktop, wide (1440px) | Sidebar and content alignment, table readability, action menus, global search, Overview hierarchy |
| Laptop (1280×720) | Vertical density, sticky navigation, modal viewport fit, scroll position after refresh/data updates |
| Tablet (768px wide) | Drawer open/close, active navigation, no content overlap, usable table overflow |
| Phone (390px wide) | Drawer and heading, action-button touch targets, table scroll, forms, safe-area spacing |
| Keyboard only | Logical tab sequence, visible focus, search navigation, modal focus containment/restoration, Escape behaviour |
| Light and dark themes | Text contrast, statuses, focus outlines, table headers, disabled/loading/error states |
| Failed or slow request | Loading state, retry path, no false success, no duplicate submission, data refresh after action |

## 6. Phase 1 recommendation

1. Do not redesign the whole dashboard or change the navigation hierarchy yet.
2. First validate the outstanding-invoice KPI definition and perform the authenticated visual/interaction pass.
3. Then improve Leads, Follow-ups, and Tasks tables with the minimum useful search/filter/sort controls.
4. Only introduce bulk actions for repeated operations with clear safety rules; do not add multi-select everywhere automatically.
5. Expand browser smoke coverage for core views and actions before merging interface changes.

## 7. Exit criteria

Phase 1 is **partially complete**: the static source inventory and priorities are documented. The phase is fully complete only after an authenticated browser pass captures the current desktop/mobile layouts and exercises the priority interactions. This audit makes no production code changes and does not claim that untested interactions passed.
