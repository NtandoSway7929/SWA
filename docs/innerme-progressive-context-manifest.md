# InnerMe Progressive Context Manifest

## Purpose

Reduce model-facing workspace payload by using progressive disclosure rather than sending all retrieved record details to every ordinary chat turn. This change complements existing request-byte guards and deterministic workspace compaction.

## Runtime behavior

The pure selector in `supabase/functions/swayphics-ai/innerme-context-manifest.mjs` classifies the current request into one of three normal context profiles:

- `manifest_only`: no workspace collection clearly matches, so the provider receives a compact index, current date, available metric summaries, and no unrelated raw collection details.
- `topic_focused`: the query matches a business domain such as invoices, payments, follow-ups, leads, email, tasks, or projects; only the relevant collection details and key relationships are expanded.
- `broad_operations`: cross-domain requests such as daily priorities or business growth retain the operational detail set required for the decision.
- `focused_record`: an explicit UI-selected record takes precedence over generic intent; related collections and `connected_context` remain available.

A loaded row name in the current bounded query window can also cause its collection to be expanded when the admin mentions that name without repeating the collection category.

## Manifest semantics and evidence rules

- The manifest gives each collection a description, trigger terms, bounded loaded-row count, whether detail was expanded, and a small record index when details are not expanded.
- `loaded_records` and `workspace_source_record_counts` reflect rows returned by bounded queries; they are **not guaranteed database-wide totals**.
- Index entries are lookup pointers. They are not enough to make record-specific claims.
- The `workspace_model_context_record_counts` values now correspond to collections actually selected for the current model request, with omitted collections represented as zero.
- Large follow-up detail arrays are included only when the request is broad, follow-up-related, or focused on a lead/client where they matter.
- Playbooks expose a compact name/purpose index by default. Steps for a matching playbook are included only when the request selects that procedure.
- Active agent instructions are not injected into ordinary answers; the manifest exposes compact capability metadata and adds a matching agent's details only when the query identifies that agent.
- The selector does not make permissions decisions, write workspace data, or call a model.

## Exact focused-record lookup

The initial workspace retrieval uses bounded lists. If a UI-selected record ID is not found in those lists, the Edge Function now performs an exact lookup against an allowlisted table using the authenticated admin Supabase client. RLS remains in force. Supported types are restricted to the known focused-record types. Lookup failure is recorded as a query failure and explicit lookup status; a missing record is not fabricated.

## What is and is not improved

This implementation reduces the **model-facing detail context** and makes exact UI focus reliable beyond the recent-row window. The existing Edge Function still performs its established bounded workspace reads before selecting context because it currently calculates operational summaries and supports several specialized action paths from those results. Therefore this change does not yet reduce the number of database reads on every request. Query-level conditional loading and database-side aggregate counts should be a later change after this selector is validated.

No database migration is required. No production deployment or live provider experiment is part of this PR. Existing execution-contract checks, Phase 30 policy gates, explicit approval, confirmation and provider quota checks are unchanged.

## Validation

`innerme-context-manifest.test.ts` verifies manifest-only behavior, topic-focused domain selection, broad operations context, record-name expansion, focused-record precedence, on-demand playbook detail, count semantics, and allowlisted exact-lookup descriptors.

The existing `Validate InnerMe Edge Function` workflow runs these tests without making Gemini requests.
