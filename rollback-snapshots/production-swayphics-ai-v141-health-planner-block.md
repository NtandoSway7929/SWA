# Production v141 retrieval planner restoration

Production `swayphics-ai` v142 added this block to `innerme-context-manifest.mjs` directly after:

```js
  const history = Array.isArray(options?.history) ? options.history : [];
```

Remove exactly this v142-only block to restore the v141 planner path:

```js
  // The health probe is a read-only workspace diagnostic, not a chat turn.
  // It must query the operational collections so its health response can
  // detect query/schema failures instead of silently checking zero tables.
  if (action === "innerme_workspace_read_health") {
    return {
      profile: "health_probe",
      reason: "Read-only health diagnostics validate workspace queries and the database aggregate.",
      collections: [...CORE_COLLECTIONS],
      businessBrainCollections: [],
    };
  }
```

After removal, the source should transition from the history declaration directly to:

```js
  const text = [
    message,
    ...history.slice(-4).map((item) => String(item?.content ?? "")),
  ].join("\n");
```

The original v141 health handler is in `production-swayphics-ai-v141-health-check.md` in this same rollback branch. Restore that block too, otherwise the function will continue using the v142 health success predicate.
