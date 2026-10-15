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

## Query-level retrieval

The workspace query plan is now built **before the Supabase reads** for routine assistant chat. It uses the current question, a small history window, an optional UI-focused record, and a deterministic list of permitted collections.

- Routine non-business questions skip all operational tables and load only global preferences.
- Topic-focused requests query the matching domain plus relationship collections, for example invoices with payments and clients, or leads with linked follow-ups, communications, quotes, email metadata and clients.
- A name-only follow-up such as “What about Maisha's Touch?” receives a bounded entity-resolution fallback across leads, clients, tasks and projects.
- An explicit focused record selects its allowlisted table and the relationships required for that record type. Exact-ID lookup still uses the authenticated admin client and remains subject to RLS.
- Broad business reviews/daily priorities keep the full operational evidence set. Non-chat and specialised action paths retain their established full-context behavior for compatibility.

Query-skipped collections use a distinct `query_executed: false` manifest state. Their `loaded_records` is `null`, no record index is manufactured, and metrics for collections that were not queried are omitted rather than represented as zero. Remaining operational metrics are explicitly described as derived from bounded results, not guaranteed database-wide totals. This avoids false certainty while reducing reads.

## Remaining limit: database-wide summaries

The separate database-side aggregate RPC is **not implemented by this change**. The current operational summaries are still calculated from bounded query results; their sample scope is now disclosed rather than overstated. Before replacing them with SQL aggregates, the isolated **Swayphics InnerMe Test** project needs a faithful operational schema: the current isolated database does not contain most of the production workspace tables used by these summaries. An aggregate query tested against that incomplete schema would not validate the production data flow.

No schema migration or provider call is required for query planning itself. Execution-contract validation, Phase 30 safety gates, explicit approval, confirmation and provider quota checks remain unchanged. This branch has not been deployed by this change.

## Validation

`innerme-context-manifest.test.ts` now covers query planning, selective invoice reads, entity-only lead follow-up, broad-context preservation, focused-record relationships, omitted/unqueried metrics, prior progressive manifest behavior, on-demand playbook detail and allowlisted exact-lookup descriptors. These tests require no Gemini provider calls.

The existing `Validate InnerMe Edge Function` workflow runs these tests. CI and rollout status must be checked before treating the branch as validated or live.
