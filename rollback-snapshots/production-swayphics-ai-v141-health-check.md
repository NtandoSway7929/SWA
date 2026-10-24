# Production `swayphics-ai` v141 rollback snapshot

Captured before deploying v142 on 2026-10-24.

- Supabase project: `sqifhribgsqfaxgtobsa` (Swayphics Web)
- Function: `swayphics-ai`
- Original version: `141`
- Original deployment hash: `758adbe35b20ed2cbca5a35852e5374093193048d546629f5742124b51e45589`
- Changed files in v142: `index.ts`, `innerme-context-manifest.mjs`
- All other seven function source files were preserved unchanged.
- Rollback below restores only the original v141 health handler and retrieval planner. Do not replace production with the current repository's full function source.

## Original health handler block from v141

```ts
if (action === "innerme_workspace_read_health") {
    const summary =
      databaseAggregate &&
      typeof databaseAggregate === "object" &&
      !Array.isArray(databaseAggregate)
        ? databaseAggregate
        : {};
    const knownMetricGroups = [
      "lead_counts",
      "lead_value_zar",
      "followup_counts",
      "quote_summary",
      "invoice_summary",
      "payment_summary",
      "enquiry_summary",
      "task_summary",
      "project_summary",
      "client_summary",
      "portal_request_summary",
      "communication_summary",
      "activity_summary",
      "email_summary",
    ];
    const metricGroups = knownMetricGroups.filter((key) =>
      Object.prototype.hasOwnProperty.call(summary, key)
    );
    const aggregateReady =
      summary.summary_source === "database_aggregate" &&
      !workspaceSummary?.error &&
      metricGroups.length > 0;
    const progressiveContextAssemblyStartedAt = performance.now();
    const probeContext: any = buildInnerMeProgressiveContext(safeContext, message);
    const progressiveContextAssemblyLatencyMs = Math.max(
      0,
      Math.round(performance.now() - progressiveContextAssemblyStartedAt),
    );
    const progressiveWorkspaceJsonBytes = new TextEncoder()
      .encode(JSON.stringify(probeContext))
      .byteLength;
    const detailCollections = Array.isArray(probeContext?.workspace_manifest?.detail_collections)
      ? probeContext.workspace_manifest.detail_collections as string[]
      : [];
    const loadedDetailCollections = detailCollections.filter((collection) =>
      workspaceQueryPlan.collections.includes(collection)
    );
    const progressiveDetailRecordCount = loadedDetailCollections.reduce(
      (total: number, collection: string) => {
        const records = probeContext?.[collection];
        return total + (Array.isArray(records) ? records.length : 0);
      },
      0,
    );

    return json({
      ok: aggregateReady,
      read_only: true,
      service: "swayphics-ai",
      check: "workspace_retrieval_and_aggregate",
      provider_configuration: {
        // Configuration status only; never return key material or other secrets.
        gemini_key_configured: Boolean(geminiKey),
      },
      request_id: requestId,
      server_elapsed_ms: Math.max(0, Math.round(performance.now() - requestStartedAt)),
      workspace_retrieval_ms: workspaceRetrievalLatencyMs,
      workspace_context_assembly_ms: workspaceContextAssemblyLatencyMs,
      progressive_context_assembly_ms: progressiveContextAssemblyLatencyMs,
      retrieval_profile: workspaceQueryPlan.profile,
      queried_collection_count: workspaceQueryPlan.collections.length,
      queried_collections: workspaceQueryPlan.collections,
      queried_business_brain_collection_count: workspaceQueryPlan.businessBrainCollections.length,
      workspace_data_read_call_count: workspaceDataReadCallCount,
      progressive_workspace_json_bytes: progressiveWorkspaceJsonBytes,
      progressive_detail_collection_count: loadedDetailCollections.length,
      progressive_detail_record_count: progressiveDetailRecordCount,
      summary_source: summary.summary_source || "bounded_fallback",
      summary_metric_groups: metricGroups,
      summary_query_failed: Boolean(workspaceSummary?.error),
      workspace_query_failure_count: queryFailures.length,
    }, aggregateReady ? 200 : 503, origin);
  }

```

## Original retrieval planner function header from v141

The insertion point immediately following the history variable was the following; retain the rest of the v142 planner unchanged when rolling back.

```js
  const action = String(options?.action ?? "").trim();
  const message = String(options?.message ?? "");
  const history = Array.isArray(options?.history) ? options.history : [];
  const text = [
    message,
    ...history.slice(-4).map((item) => String(item?.content ?? "")),
  ].join("\n");
```

## Rollback procedure

1. Fetch the current active function files using Supabase project `sqifhribgsqfaxgtobsa`, function `swayphics-ai`.
2. Replace the active health handler with the exact v141 block above.
3. Remove the inserted health-probe planner block from `innerme-context-manifest.mjs`, restoring the original history-to-text transition above.
4. Deploy the preserved bundle with the original `verify_jwt=false` setting.
5. Confirm the new active version and verify that the v141 health logic is restored. Do not issue any provider request during rollback verification.
