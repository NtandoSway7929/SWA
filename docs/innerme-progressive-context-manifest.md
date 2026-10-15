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

## Database-side operational aggregates

The new `public.get_innerme_workspace_summary(text[])` RPC returns request-scoped aggregate metrics for the specific operational collections selected by the query planner. It calculates counts, follow-up status totals, pipeline values and finance totals in PostgreSQL instead of treating the Edge Function's bounded record samples as database-wide totals.

- The RPC only accepts an explicit non-empty allowlist of workspace domains; unknown or duplicate domains are rejected.
- It is `SECURITY INVOKER`, requires an authenticated Swayphics administrator, retains underlying table grants and RLS, and has execution revoked from `PUBLIC` and `anon`.
- It queries only the aggregate groups relevant to the requested collections and does not return customer record details.
- The Edge Function requests aggregates in parallel with bounded detail reads. Exact aggregate groups replace the corresponding bounded estimates, while detailed follow-up items and linked business records remain bounded samples.
- On aggregate RPC failure, the Edge Function falls back to the existing bounded calculation and surfaces `workspace_summary` in query failures. It does not represent a fallback sample as a database-wide total.
- Context compaction preserves the `database_aggregate` provenance marker and its scope statement and omits aggregate groups for domains not queried.

The aggregate RPC has been applied to the isolated **Swayphics InnerMe Test** project and exercised under an authenticated synthetic admin context. A transaction-based fixture test checked lead counts/values, due/overdue follow-ups, quote totals, outstanding invoices, paid payments, enquiries, tasks, projects, clients, portal requests, communications, activity log and mailbox counts. The test rolled back all synthetic rows; a follow-up query confirmed none of the labelled lead/task fixture IDs remained. Anonymous function execution was denied and authenticated execution was granted.

The SQL migration and Edge Function integration remain subject to CI review before rollout. No production migration or deployment of this aggregate RPC is claimed by this branch.
