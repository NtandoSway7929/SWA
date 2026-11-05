# Swayphics Admin Dashboard Redesign

## Direction
- Navigation: compact top-horizontal navigation, selected by the owner.
- Primary destinations: Overview, Sales, Delivery and Finance.
- Secondary destinations: Insights and InnerMe remain available under the More menu, alongside the other existing workspace views.
- Hero: hybrid brand presentation and live business intelligence.
- Visual reference: the supplied Moveon dashboard image, adapted to Swayphics workflows and records.
- Stack: existing Vanilla HTML, CSS and JavaScript. No new framework or external UI library.

## Information architecture
1. **Overview:** business summary, lead pipeline, recorded cash/revenue, outstanding invoices, tasks, follow-ups, recent activity and quick actions.
2. **Sales:** enquiries, leads, communications, follow-ups and quotes.
3. **Delivery:** clients, projects, tasks and portfolio.
4. **Finance:** invoices, payments, services and invoice settings.
5. **More:** Insights, InnerMe (chat, Action Centre, revenue intelligence, governance and provider usage), website content, testimonials, documents, email, reminders, activity, portal requests, data export, team and settings.

All existing view IDs and view renderers remain authoritative. Top-level navigation is a presentation change; no view is to be removed or remapped to a different data source.

## Dashboard composition
- Compact top bar with the Swayphics identity in the existing admin header, four direct workspace destinations and an accessible More menu.
- Hybrid hero with a business-focused overview heading (kept distinct from the time-based welcome in the admin header), clear business context, existing live-update state and a compact business-momentum chart paired with demand and delivery signal cards on larger screens.
- Mobile overview keeps the main business-momentum chart prominent; supporting demand and delivery analysis remains accessible from Insights.
- KPI cards based on existing records only: total leads, active clients, active projects and outstanding invoice balances.
- A dedicated sales-pipeline panel uses the existing lead estimates and keeps estimated pipeline separate from booked revenue.
- Attention centre for due/overdue tasks, follow-ups, invoices, new enquiries, unread inbound email, portal requests and quotes.
- Follow-up automation panel, assigned work, recent activity and quick actions.
- Existing detailed Insights view remains available for demand and delivery analysis.

## Data and metric rules
- Reuse existing in-memory state and Supabase-backed loaders. Do not introduce a new schema or duplicate fetch pipeline.
- Do not label estimated lead pipeline as booked revenue.
- Cash received, invoiced totals and outstanding balances must remain distinct.
- Do not infer profit, capacity, conversion uplift or ROI from unavailable fields.
- Keep chart time windows and existing aggregation logic unchanged unless a separately reviewed change is approved.
- Preserve existing empty, loading, error and stale/live indicators.

## Preservation requirements
- Keep authentication, roles, permissions, Supabase access, realtime/background refresh and state lifecycle unchanged.
- Preserve every existing navigation destination, quick-create action, mobile interaction, modal, editor, table, bulk action, CSV export, and InnerMe workflow.
- Keep the existing HTML/CSS/JS stack. No React, frameworks, component libraries or database migrations.
- Do not edit production main branch. Work only on `feature/swayphics-admin-dashboard-redesign`.
- Do not touch public website, client portal, Supabase schema, or unrelated admin modules.

## Responsive behaviour
- Desktop: horizontal top navigation with floating More menu; four direct destinations; compact hybrid hero; multi-column metric and insight cards.
- Tablet: wrapping/scrollable navigation and two-column dashboard cards.
- Mobile: four direct destinations remain visible, with More on a compact second row in the navigation grid; stacked hero content; a compact two-column KPI area where readable; single-column operational tables/cards with existing overflow handling.
- The legacy off-canvas workspace drawer is not used by the redesigned top-navigation shell.
- Respect reduced-motion preferences and keyboard focus/aria state.

## Implementation phases
1. Branch and design specification.
2. Top navigation shell and hybrid overview hero.
3. KPI, attention, sales pipeline and operational panel refinement.
4. Tablet/mobile refinement.
5. Regression testing and visual QA.
6. Review changes on the feature branch; no merge/deployment without explicit approval.

## Validation
- Run the repository's existing GitHub Actions validation workflow.
- Preserve and run admin table controls, automation integrity, business controls, welcome/auth, settings and lead WhatsApp tests.
- Add focused regression assertions for the redesign's view destinations, mobile navigation geometry and existing overview actions where practical.
- Inspect the final diff to confirm no Supabase schema, public site, client portal or unrelated files changed.
