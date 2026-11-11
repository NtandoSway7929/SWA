# Stage 1.50 — Swayphics migration-baseline forensic review

**Date:** 2026-11-11  
**Branch:** `feature/yoco-client-payments`  
**Purpose:** identify why a clean disposable Supabase database cannot replay the repository migration history, and define the evidence required before repairing it.

## Finding

The disposable database currently fails while applying the first Swayphics migration:

```
Applying migration 20261009120000_swayphics_lead_not_interested.sql
ERROR: relation "public.leads" does not exist (SQLSTATE 42P01)
```

A scan of every file under `supabase/migrations/` on this branch found no foundational Swayphics migration that creates `public.leads` before that migration. The migration history begins with an ALTER TABLE against an object that is not created by the replayable migration history.

This is a repository-history/baseline gap, not a Yoco migration failure. The Yoco migrations and SQL tests have not yet been applied to PostgreSQL in this workflow.

## Existing SQL bootstrap assets reviewed

| File | Objects it creates | Important dependencies / limitations |
|---|---|---|
| `supabase/swayphics-admin-workspace.sql` | `admin_users`, `clients`, `leads`, `client_projects`, `tasks`, `follow_ups`, `quotes`, `payments`, `website_enquiries`, `site_announcements`, `communication_logs`, `social_accounts`, `social_posts`, `social_metrics`, `activity_log` | Describes itself as an operational layer around existing portfolio/testimonial managers. Its companion security script expects additional objects, including `portfolio_projects`, `testimonials` and `client_portal_requests`. |
| `supabase/swayphics-admin-workspace-security-fix.sql` | Security helper functions, grants, RLS policies and related alterations | Not a bootstrap: it alters and grants access to existing operational and public-site tables. |
| `supabase/swayphics-invoicing.sql` | `services`, `invoice_settings`, `invoices`, `invoice_items` | Depends on `clients`, `client_projects` and `admin_users`; it also alters `payments`. |
| `supabase/swayphics-business-flow.sql` | `workflow_settings`, `client_review_requests`, `admin_settings_audit_log` | A large additive workflow script. It alters `leads`, `clients`, `client_projects`, `portfolio_projects`, `invoices` and `follow_ups`; it is not a self-contained initial schema. |
| `supabase/swayphics-payment-integrity-fix.sql` | Payment integrity trigger/function | Depends on the existing `payments` and `invoices` structures. |

## Why an automatic conversion is unsafe

1. The admin-workspace SQL is not the complete Swayphics schema. It explicitly assumes existing portfolio/testimonial managers.
2. The security-fix SQL is dependent on tables created elsewhere and cannot safely be promoted to the first migration.
3. Invoicing and business-flow SQL are additive scripts with cross-dependencies; running them in an arbitrary order would fail or create a schema that differs from the deployed application.
4. Replaying a guessed bootstrap against an empty database would prove only that the guessed schema is internally executable. It would not prove that it matches the live Swayphics schema, historical data assumptions, existing triggers, policies, grants or invoice/payment records.

## Required evidence to repair the baseline

Obtain a **schema-only export** from the actual Swayphics Supabase project, excluding table data, Auth users, secrets and credentials. The export must include at minimum:

- public schema tables, columns, types, defaults, constraints and indexes;
- foreign keys and sequences;
- functions, triggers and views;
- RLS enablement and policies;
- grants and function ownership;
- relevant extensions and publication membership.

Compare that snapshot against the repository SQL assets and all existing migrations. Then prepare a reviewed baseline migration (or a documented local test bootstrap) that reproduces the existing schema without changing production. The baseline must be tested from an empty disposable database before it is used to validate the Yoco migrations.

## QA status after Stage 1.49

- Administrator invoice-settings UI regression step: passed in GitHub Actions.
- Yoco Edge Function type-check: passed.
- Yoco Deno tests: passed.
- PostgreSQL grammar parser: passed for the selected Yoco SQL files; this is syntax parsing only.
- Disposable Supabase startup/migration replay: blocked before Yoco migrations by missing `public.leads`.
- Yoco migration preflight, pgTAP, transaction tests and two-worker lease races: skipped because database startup failed.
- Browser UI validation and Yoco sandbox contract validation: not yet performed.

## Safety decision

No baseline migration is generated from the standalone scripts at this stage. No remote Supabase project was queried, no remote SQL was run, and no production schema, payment configuration, deployment or branch merge was changed.

**Exit decision:** forensic diagnosis completed; runtime database QA remains blocked pending a schema-only export from the actual project or an independently verified canonical schema snapshot.
