Deno.serve(async (request: Request) => {
  const url = new URL(request.url);
  if (url.pathname === "/health") return new Response("ok");

  if (url.pathname !== "/integration-gateway" || request.method !== "POST") {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const worker = await EdgeRuntime.userWorkers.create({
    servicePath: "/services/innerme-integration-gateway",
    memoryLimitMb: 128,
    workerTimeoutMs: 20_000,
    noModuleCache: false,
    envVars: ["SUPABASE_URL", "SUPABASE_ANON_KEY"],
    forceCreate: true,
    cpuTimeSoftLimitMs: 5_000,
    cpuTimeHardLimitMs: 10_000,
    staticPatterns: [],
    context: { useReadSyncFileAPI: true },
  });

  try {
    return await worker.fetch(request);
  } catch (error) {
    return Response.json({
      error: "edge_runtime_worker_failed",
      message: error instanceof Error ? error.message : "Unknown runtime error",
    }, { status: 500 });
  }
});
